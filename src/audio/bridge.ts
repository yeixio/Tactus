// Connects the app state to the audio engine running on the audio thread.
import workletUrl from '../engine/worklet.ts?worker&url'
import type { FromEngine, PlayedEvent, Quantize, ToEngine } from '../engine/protocol'
import { synthesizeFactorySample } from '../engine/core/samples'
import { compileSong, resolveAll } from '../model/sound'
import type { Project } from '../model/types'
import { useApp, useEngine } from '../state/store'
import { loadSound, userSampleBytes } from '../platform'
import { soundPath, usedSampleIds } from '../model/soundpack'
import { encodeWav } from '../engine/render'

class AudioBridge {
  ctx: AudioContext | null = null
  node: AudioWorkletNode | null = null
  starting: Promise<void> | null = null
  sent = new Set<string>()
  decoded = new Map<string, { channels: Float32Array[]; sampleRate: number }>()
  lastProject: Project | null = null
  paramsQueued = false
  monitorOn = false
  onRecorded: ((wav: ArrayBuffer) => void) | null = null
  preferredRate: number | undefined

  /** Start audio (must follow a user gesture). Safe to call repeatedly. */
  ensure(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') return this.ctx.resume()
      return Promise.resolve()
    }
    if (!this.starting) this.starting = this.start().catch((e) => { useEngine.setState({ error: String(e?.message ?? e) }); this.starting = null })
    return this.starting
  }

  private async start() {
    const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: this.preferredRate })
    await ctx.audioWorklet.addModule(workletUrl)
    const node = new AudioWorkletNode(ctx, 'tactus-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
    node.connect(ctx.destination)
    node.port.onmessage = (e: MessageEvent<FromEngine>) => this.receive(e.data)
    this.ctx = ctx
    this.node = node
    await ctx.resume()
    useEngine.setState({ ready: true, sampleRate: ctx.sampleRate, latencyMs: Math.round(((ctx.baseLatency ?? 0) + ((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0)) * 1000) })
    this.sent.clear()
    this.syncAll(useApp.getState().project)
  }

  private receive(m: FromEngine) {
    if (m.type === 'status') useEngine.setState({ status: m })
    else if (m.type === 'events') {
      const prev = useEngine.getState().events
      const all: PlayedEvent[] = [...prev, ...m.events]
      useEngine.setState({ events: all.slice(-400) })
    } else if (m.type === 'recorded') {
      const wav = encodeWav(m.channels, this.ctx!.sampleRate, 24)
      useEngine.setState({ recording: false })
      this.onRecorded?.(wav)
    }
  }

  send(m: ToEngine, transfer?: Transferable[]) {
    this.node?.port.postMessage(m, transfer ?? [])
  }

  async userSample(name: string) {
    const id = `user:${name}`
    if (this.decoded.has(id)) return this.decoded.get(id)!
    const bytes = userSampleBytes.get(name)
    if (!bytes) return null
    const ctx = this.ctx ?? new OfflineAudioContext(2, 1, 44100)
    const buf = await ctx.decodeAudioData(bytes.slice(0))
    const d = { channels: Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i).slice()), sampleRate: buf.sampleRate }
    this.decoded.set(id, d)
    return d
  }

  /** Decode a factory sound-pack file ("sound:<path>"). */
  async packSample(id: string) {
    if (this.decoded.has(id)) return this.decoded.get(id)!
    const rel = soundPath(id)
    if (!rel) return null
    const bytes = await loadSound(rel)
    const ctx = this.ctx ?? new OfflineAudioContext(2, 1, 44100)
    const buf = await ctx.decodeAudioData(bytes)
    const d = { channels: Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i).slice()), sampleRate: buf.sampleRate }
    this.decoded.set(id, d)
    return d
  }

  /** Audio for any sample id the engine can play: synthesized, from the sound pack, or the user's. */
  private async sampleData(id: string, rate: number) {
    if (id.startsWith('factory:')) return synthesizeFactorySample(id, rate)
    try {
      if (id.startsWith('sound:')) return await this.packSample(id)
      if (id.startsWith('user:')) return await this.userSample(id.slice(5))
    } catch (e) {
      console.warn('Could not load sample', id, e)
    }
    return null
  }

  /** Send any samples the project uses that the engine has not received yet. */
  private async syncSamples(p: Project) {
    if (!this.ctx) return
    const rate = this.ctx.sampleRate
    await Promise.all(usedSampleIds(p).filter((id) => !this.sent.has(id)).map(async (id) => {
      this.sent.add(id)
      const d = await this.sampleData(id, rate)
      if (!d) { this.sent.delete(id); return }
      const channels = id.startsWith('factory:') ? d.channels : d.channels.map((c) => c.slice())
      this.send({ type: 'sample', id, channels, sampleRate: d.sampleRate }, channels.map((c) => c.buffer))
    }))
  }

  syncAll(p: Project) {
    this.syncSamples(p)
    const { tracks, master } = resolveAll(p)
    this.send({ type: 'params', tracks, master })
    this.send({ type: 'song', song: compileSong(p), at: 'now' })
    this.lastProject = p
  }

  /** Called on every project change. Sends only what changed. */
  sync(p: Project, at: Quantize) {
    const prev = this.lastProject
    this.lastProject = p
    if (!this.node) return
    if (!prev) return this.syncAll(p)
    const structural = prev.bpm !== p.bpm || prev.swing !== p.swing || prev.scenes !== p.scenes || prev.arrangement !== p.arrangement ||
      prev.tracks.length !== p.tracks.length || p.tracks.some((t, i) => prev.tracks[i]?.id !== t.id || prev.tracks[i]?.clips !== t.clips)
    this.syncSamples(p)
    if (!this.paramsQueued) {
      this.paramsQueued = true
      requestAnimationFrame(() => {
        this.paramsQueued = false
        const cur = this.lastProject!
        const { tracks, master } = resolveAll(cur)
        this.send({ type: 'params', tracks, master })
      })
    }
    if (structural) {
      // a new track must exist in the engine before its clips arrive
      if (prev.tracks.length !== p.tracks.length || p.tracks.some((t, i) => prev.tracks[i]?.id !== t.id)) {
        const { tracks, master } = resolveAll(p)
        this.send({ type: 'params', tracks, master })
      }
      this.send({ type: 'song', song: compileSong(p), at })
    }
  }

  setMonitor(on: boolean) {
    if (on === this.monitorOn) return
    this.monitorOn = on
    this.send({ type: 'monitor', events: on })
    if (!on) useEngine.setState({ events: [] })
  }

  async play(mode: 'live' | 'song', fromBar = 0) {
    await this.ensure()
    this.send({ type: 'play', mode, fromBar })
  }
  stop() { this.send({ type: 'stop' }) }
  async launchScene(scene: string, at: Quantize) { await this.ensure(); this.send({ type: 'launchScene', scene, at }) }
  async launchClip(track: string, clip: string | null, at: Quantize) { await this.ensure(); this.send({ type: 'launchClip', track, clip, at }) }
  async preview(track: string, pitch: number, vel = 0.8, len = 2) { await this.ensure(); this.send({ type: 'preview', track, pitch, vel, len }) }
  noteOn(track: string, pitch: number, vel: number) { this.ensure(); this.send({ type: 'noteOn', track, pitch, vel }) }
  noteOff(track: string, pitch: number) { this.send({ type: 'noteOff', track, pitch }) }
  async record(on: boolean) { await this.ensure(); useEngine.setState({ recording: on }); this.send({ type: 'record', on }) }

  async setSampleRate(rate: number) {
    this.preferredRate = rate
    if (!this.ctx) return
    await this.ctx.close()
    this.ctx = null
    this.node = null
    this.starting = null
    this.decoded.clear()
    await this.ensure()
  }

  /** Samples to hand to the export worker. */
  async samplesFor(p: Project, rate: number) {
    const out: { id: string; channels: Float32Array[]; sampleRate: number }[] = []
    for (const id of usedSampleIds(p)) {
      const d = await this.sampleData(id, rate)
      if (d) out.push({ id, channels: d.channels.map((c) => c.slice()), sampleRate: d.sampleRate })
    }
    return out
  }
}

export const audio = new AudioBridge()

useApp.subscribe((s, prev) => {
  if (s.project !== prev.project) audio.sync(s.project, s.applyAt)
})
