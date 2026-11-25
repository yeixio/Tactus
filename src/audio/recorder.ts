// Recording from the microphone. Takes are raw PCM from an AudioWorklet (no MediaRecorder),
// so they come out the same on desktop, iOS and Android.
import recorderUrl from './recorder.worklet.ts?worker&url'
import { audio } from './bridge'
import { cleanTake, detectPitch, type Take } from './take'
import { encodeWav } from '../engine/render'
import { userSampleBytes } from '../platform'

export type { Take }

export interface RecordOptions {
  /** Longest take, in seconds. */
  maxSeconds?: number
  /** Stop by itself once the sound has started and then gone quiet. */
  autoStop?: boolean
  /** Called about 30 times a second with the input peak level (0..1). */
  onLevel?: (peak: number, heard: boolean) => void
}

export class MicError extends Error {}

const worklets = new WeakSet<BaseAudioContext>()

/** A take in progress. Call stop() or wait for done. */
export class Recording {
  done: Promise<Take | null>
  private finish!: () => void
  private stopped = false
  constructor(run: (finish: (cb: () => void) => void) => Promise<Take | null>) {
    let resolveStop: () => void
    const stopP = new Promise<void>((r) => { resolveStop = r })
    this.finish = () => { if (!this.stopped) { this.stopped = true; resolveStop() } }
    this.done = run((cb) => { stopP.then(cb) })
  }
  stop() { this.finish() }
}

export function micAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

/** Start recording from the microphone. Rejects with a MicError when the mic can't be used. */
export async function recordMic(opts: RecordOptions = {}): Promise<Recording> {
  if (!micAvailable()) throw new MicError('This device has no microphone access here.')
  await audio.ensure()
  const ctx = audio.ctx!
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  } catch (e) {
    const name = (e as DOMException)?.name
    throw new MicError(name === 'NotAllowedError' || name === 'SecurityError'
      ? 'Microphone access is off. Allow Tactus to use the microphone in your system settings, then try again.'
      : name === 'NotFoundError' ? 'No microphone was found.' : `The microphone could not start (${name ?? e}).`)
  }
  if (!worklets.has(ctx)) { await ctx.audioWorklet.addModule(recorderUrl); worklets.add(ctx) }
  const src = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'tactus-recorder', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'clamped-max' })
  const mute = ctx.createGain()
  mute.gain.value = 0
  src.connect(node).connect(mute).connect(ctx.destination) // the node only runs while connected

  const sr = ctx.sampleRate
  const max = Math.round((opts.maxSeconds ?? 10) * sr)
  const chunks: Float32Array[] = []
  let total = 0
  let heard = false, quietFor = 0, levelAcc = 0, levelN = 0, loudest = 0
  const START = 0.03 // about -30 dBFS counts as sound
  const recording = new Recording((onStop) => new Promise((resolve) => {
    let ended = false
    const end = () => {
      if (ended) return
      ended = true
      node.port.postMessage({ type: 'stop' })
      setTimeout(() => {
        src.disconnect(); node.disconnect(); mute.disconnect()
        for (const t of stream.getTracks()) t.stop()
        const all = new Float32Array(total)
        let o = 0
        for (const c of chunks) { all.set(c, o); o += c.length }
        resolve(cleanTake({ samples: all, sampleRate: sr }))
      }, 60)
    }
    onStop(end)
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (ended) return
      const c = e.data
      chunks.push(c)
      total += c.length
      let pk = 0
      for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > pk) pk = a }
      if (pk > loudest) loudest = pk
      if (pk > START) heard = true
      // quiet means well below the loudest part of this take
      if (heard && pk < Math.max(0.01, loudest * 0.05)) quietFor += c.length
      else quietFor = 0
      levelAcc = Math.max(levelAcc, pk)
      if (++levelN * c.length >= sr / 30) { opts.onLevel?.(levelAcc, heard); levelAcc = 0; levelN = 0 }
      if (total >= max || (opts.autoStop !== false && heard && quietFor > sr * 0.7)) recording.stop()
    }
  }))
  return recording
}

/** Keep a take as a user sample (saved in the project's samples folder). Returns its sample id. */
export function storeTake(take: Take, label = 'recording'): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  let name = `${label.replace(/[^\w-]+/g, '_')}-${stamp}.wav`
  for (let k = 2; userSampleBytes.has(name); k++) name = name.replace(/(-\d+)?\.wav$/, `-${k}.wav`)
  userSampleBytes.set(name, encodeWav([take.samples], take.sampleRate, 16))
  return `user:${name}`
}

/** The MIDI note to map a take to: its detected pitch, rounded, or middle C for unpitched sounds. */
export function takeRoot(take: Take): number {
  const p = detectPitch(take)
  return p === null ? 60 : Math.max(24, Math.min(108, Math.round(p)))
}
