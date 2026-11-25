// The audio engine core. Pure TypeScript with no DOM or Web Audio dependencies, so the
// same code runs on the audio thread (AudioWorklet), in the export worker, and in tests.
// Real-time rules: no allocation in the hot path after warm-up, no blocking, bounded work.

import type { DrumPad, SynthParams } from '../../model/types'
import type { EngineClip, EngineMaster, EngineSong, EngineStatus, EngineTrackParams, PlayedEvent, Quantize, ToEngine, FromEngine } from '../protocol'
import { synthesizeFactorySample, type SampleData } from './samples'

const TAU = Math.PI * 2
const MAX_SYNTH_VOICES = 16
const MAX_DRUM_VOICES = 24
const WAVES = new Set(['saw', 'square', 'triangle', 'sine'])
/** Slow per-voice pitch drift, in cents, so held notes and chords sound less static. */
const DRIFT_CENTS = 2.5

// ---------------------------------------------------------------------------------------------
// DSP building blocks

class SVF {
  ic1 = 0; ic2 = 0; a1 = 1; a2 = 0; a3 = 0; k = 2
  set(fc: number, res: number, sr: number) {
    const g = Math.tan((Math.PI * Math.min(fc, sr * 0.45)) / sr)
    this.k = 2 - 1.96 * Math.min(0.99, Math.max(0, res))
    this.a1 = 1 / (1 + g * (g + this.k))
    this.a2 = g * this.a1
    this.a3 = g * this.a2
  }
  lp(x: number) {
    const v3 = x - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    return v2
  }
  hp(x: number) {
    const v3 = x - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    return x - this.k * v1 - v2
  }
  reset() { this.ic1 = this.ic2 = 0 }
}

class Env {
  v = 0
  stage = 0 // 0 idle, 1 attack, 2 decay/sustain, 3 release
  aInc = 0; dCoef = 0; rCoef = 0; s = 0
  set(a: number, d: number, s: number, r: number, sr: number) {
    this.aInc = 1 / Math.max(1, a * sr)
    this.dCoef = Math.exp(-4.6 / Math.max(1, d * sr))
    this.rCoef = Math.exp(-4.6 / Math.max(1, r * sr))
    this.s = s
  }
  gate(on: boolean, retrigger = true) {
    if (on) { if (retrigger || this.stage === 0 || this.stage === 3) this.stage = 1 }
    else if (this.stage !== 0) this.stage = 3
  }
  next() {
    switch (this.stage) {
      case 1: this.v += this.aInc; if (this.v >= 1) { this.v = 1; this.stage = 2 } break
      case 2: this.v = this.s + (this.v - this.s) * this.dCoef; break
      case 3: this.v *= this.rCoef; if (this.v < 1e-4) { this.v = 0; this.stage = 0 } break
    }
    return this.v
  }
}

function blep(t: number, dt: number) {
  if (t < dt) { t /= dt; return t + t - t * t - 1 }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1 }
  return 0
}

function osc(wave: string, p: number, dt: number) {
  switch (wave) {
    case 'saw': return 2 * p - 1 - blep(p, dt)
    case 'square': { let v = p < 0.5 ? 1 : -1; v += blep(p, dt); v -= blep((p + 0.5) % 1, dt); return v }
    case 'triangle': return 1 - 4 * Math.abs(p - 0.5)
    default: return Math.sin(TAU * p)
  }
}

let noiseState = 22222
function white() {
  noiseState = (noiseState * 1664525 + 1013904223) >>> 0
  return noiseState / 2147483648 - 1
}

class Rng {
  s: number
  constructor(seed: number) { this.s = seed >>> 0 || 1 }
  next() { let x = this.s; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; this.s = x; return x / 4294967296 }
}

// ---------------------------------------------------------------------------------------------
// Voices

class SynthVoice {
  active = false
  pitch = 0
  curNote = 0 // glided pitch (float)
  vel = 0
  gate = 0 // samples remaining while held; -1 = until noteOff
  age = 0
  delay = 0 // samples before start (sub-block offset)
  phases = new Float64Array(8)
  ph2 = 0
  phSub = 0
  fL = new SVF()
  fR = new SVF()
  amp = new Env()
  flt = new Env()
  ctr = 0
  freq = 440
  // analog drift
  drPh = 0
  drRate = 0.3
  // sampled source (osc1 = an instrument from the sound pack)
  sdata: SampleData | null = null
  spos = 0
  srate = 1
  sroot = 60
}

class DrumVoice {
  active = false
  pad = 0
  pos = 0
  rate = 1
  gain = 1
  panL = 1
  panR = 1
  env = 1
  envCoef = 1
  choke = 0
  fadeOut = 0
  delay = 0
  data: SampleData | null = null
}

interface ClipIndex {
  id: string
  length: number
  byStep: EngineClip['notes'][]
}

interface QueuedEvent {
  time: number // absolute sample
  track: number
  pitch: number
  vel: number
  len: number // samples (synth gate)
  clip: string
  step: number
  absStep: number
}

class TrackState {
  id: string
  params: EngineTrackParams
  synth: SynthParams | null = null
  pads: DrumPad[] | null = null
  clips = new Map<string, ClipIndex>()
  playing: string | null = null
  clipStart = 0
  queued: string | null | undefined = undefined // undefined = nothing queued
  queuedAt = 0
  voices: SynthVoice[] = []
  drums: DrumVoice[] = []
  bufL: Float32Array
  bufR: Float32Array
  toneF = [new SVF(), new SVF()]
  // smoothed values
  sVol = 0; sPanL = 1; sPanR = 1; sDelay = 0; sReverb = 0
  lfoPh = 0
  peak = 0
  rng: Rng
  monoVoice: SynthVoice | null = null
  chorus: Chorus | null = null
  held = new Map<number, SynthVoice>()
  constructor(p: EngineTrackParams, max: number, seed: number) {
    this.id = p.id
    this.params = p
    this.bufL = new Float32Array(max)
    this.bufR = new Float32Array(max)
    for (let i = 0; i < MAX_SYNTH_VOICES; i++) this.voices.push(new SynthVoice())
    for (let i = 0; i < MAX_DRUM_VOICES; i++) this.drums.push(new DrumVoice())
    this.rng = new Rng(seed)
  }
}

// ---------------------------------------------------------------------------------------------
// Effects

/** A Juno-style stereo chorus: one modulated delay per side, with opposite LFO phases. */
class Chorus {
  l: Float32Array; r: Float32Array; w = 0; ph = 0; sr: number
  constructor(sr: number) { this.sr = sr; this.l = new Float32Array(Math.ceil(sr * 0.04)); this.r = new Float32Array(Math.ceil(sr * 0.04)) }
  process(L: Float32Array, R: Float32Array, n: number, amount: number) {
    const N = this.l.length
    const base = 0.0075 * this.sr, depth = 0.0032 * this.sr
    const inc = 0.55 / this.sr
    const wet = amount * 0.85, norm = 1 / (1 + amount * 0.35)
    for (let i = 0; i < n; i++) {
      this.ph += inc; if (this.ph >= 1) this.ph -= 1
      const tri = this.ph < 0.5 ? this.ph * 4 - 1 : 3 - this.ph * 4
      const xl = L[i], xr = R[i]
      this.l[this.w] = xl; this.r[this.w] = xr
      let a = 0, b = 0
      for (let side = 0; side < 2; side++) {
        const d = base + depth * (side ? -tri : tri)
        let rp = this.w - d
        if (rp < 0) rp += N
        const i0 = rp | 0, fr = rp - i0, i1 = i0 + 1 >= N ? 0 : i0 + 1
        const buf = side ? this.r : this.l
        const y = buf[i0] + (buf[i1] - buf[i0]) * fr
        if (side) b = y; else a = y
      }
      if (++this.w >= N) this.w = 0
      // cross the wet sides for width
      L[i] = (xl + b * wet) * norm
      R[i] = (xr + a * wet) * norm
    }
  }
}

/**
 * Feedback-delay-network reverb: pre-delay, input diffusion, eight modulated delay lines
 * mixed by a Householder matrix, with damping in the loop. Smoother and less metallic
 * than a comb-filter (Freeverb) design.
 */
class Reverb {
  sr: number
  pre: Float32Array; pw = 0
  dif: Float32Array[]; difI: number[]
  lines: Float32Array[]; li: number[]; len: number[]
  lp = new Float64Array(8)
  y = new Float64Array(8)
  mph = new Float64Array(8)
  hp = 0
  constructor(sr: number) {
    this.sr = sr
    const s = sr / 44100
    this.pre = new Float32Array(Math.ceil(sr * 0.06))
    this.dif = [142, 107, 379, 277].map((n) => new Float32Array(Math.round(n * s)))
    this.difI = [0, 0, 0, 0]
    this.len = [1433, 1601, 1867, 2053, 2251, 2399, 2617, 2789].map((n) => Math.round(n * s))
    this.lines = this.len.map((n) => new Float32Array(n + 32))
    this.li = this.len.map(() => 0)
    for (let i = 0; i < 8; i++) this.mph[i] = i / 8
  }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number, size: number) {
    const sr = this.sr
    const t60 = 0.45 + size * 2.2 + size * size * size * 2.5
    const g = this.len.map((l) => Math.pow(10, (-3 * l) / (t60 * sr)))
    const damp = 1 - Math.exp((-2 * Math.PI * (9500 - size * 4500)) / sr)
    const preLen = Math.max(1, Math.round((0.004 + size * 0.022) * sr))
    const P = this.pre.length
    const modInc = 0.6 / sr, modDepth = 6 * (sr / 44100)
    const lines = this.lines, len = this.len, y = this.y, lp = this.lp, mph = this.mph, li = this.li
    for (let i = 0; i < n; i++) {
      let x = (inL[i] + inR[i]) * 0.5
      this.hp += (x - this.hp) * 0.02
      x -= this.hp
      this.pre[this.pw] = x
      let rp = this.pw - preLen
      if (rp < 0) rp += P
      x = this.pre[rp]
      if (++this.pw >= P) this.pw = 0
      for (let d = 0; d < 4; d++) {
        const buf = this.dif[d], k = this.difI[d]
        const b = buf[k]
        const v = x + b * 0.6
        buf[k] = v
        x = b - v * 0.6
        this.difI[d] = k + 1 >= buf.length ? 0 : k + 1
      }
      let sum = 0
      for (let j = 0; j < 8; j++) {
        const buf = lines[j], N = buf.length
        mph[j] += modInc * (1 + j * 0.13); if (mph[j] >= 1) mph[j] -= 1
        const tri = mph[j] < 0.5 ? mph[j] * 4 - 1 : 3 - mph[j] * 4
        let r = li[j] - len[j] + modDepth * tri
        if (r < 0) r += N
        const i0 = r | 0, fr = r - i0, i1 = i0 + 1 >= N ? 0 : i0 + 1
        const v = buf[i0] + (buf[i1] - buf[i0]) * fr
        lp[j] += (v - lp[j]) * damp
        y[j] = lp[j]
        sum += y[j]
      }
      const h = sum * 0.25
      for (let j = 0; j < 8; j++) {
        const buf = lines[j]
        buf[li[j]] = (j & 1 ? -x : x) + (y[j] - h) * g[j]
        if (++li[j] >= buf.length) li[j] = 0
      }
      outL[i] += (y[0] + y[2] - y[4] - y[6]) * 0.42
      outR[i] += (y[1] + y[3] - y[5] - y[7]) * 0.42
    }
  }
}

class Delay {
  l: Float32Array; r: Float32Array; w = 0; time = 0; lpL = 0; lpR = 0
  constructor(sr: number) { this.l = new Float32Array(Math.ceil(sr * 4)); this.r = new Float32Array(Math.ceil(sr * 4)) }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number, timeSamples: number, fb: number) {
    const N = this.l.length
    for (let i = 0; i < n; i++) {
      this.time += (timeSamples - this.time) * 0.0005
      const d = Math.min(N - 2, Math.max(1, this.time))
      let rp = this.w - d
      if (rp < 0) rp += N
      const i0 = Math.floor(rp), fr = rp - i0, i1 = (i0 + 1) % N
      const yl = this.l[i0] + (this.l[i1] - this.l[i0]) * fr
      const yr = this.r[i0] + (this.r[i1] - this.r[i0]) * fr
      this.lpL += (yl - this.lpL) * 0.35
      this.lpR += (yr - this.lpR) * 0.35
      // ping-pong: mono input into the left line, lines cross-feed
      this.l[this.w] = (inL[i] + inR[i]) * 0.5 + this.lpR * fb
      this.r[this.w] = this.lpL * fb
      if (++this.w >= N) this.w = 0
      outL[i] += yl
      outR[i] += yr
    }
  }
}

// ---------------------------------------------------------------------------------------------

export class Engine {
  sr: number
  maxBlock: number
  tracks: TrackState[] = []
  trackIndex = new Map<string, number>()
  song: EngineSong = { bpm: 120, swing: 0, tracks: [], scenes: [], arrangement: [] }
  pendingSong: { song: EngineSong; at: Quantize } | null = null
  master: EngineMaster = { volume: 0.85, delayTime: 3, delayFeedback: 0.35, reverbSize: 0.6 }
  samples = new Map<string, SampleData>()
  /** Sampled instruments by name: recorded root notes (sorted) and their audio. */
  instruments = new Map<string, { roots: number[]; data: SampleData[] }>()
  vrng = new Rng(0x7ac75)
  playing = false
  mode: 'live' | 'song' = 'live'
  stepPos = 0 // musical position in 16ths (song mode: from song start)
  sampleTime = 0 // absolute samples rendered
  nextStep = 0 // next integer step to schedule
  queue: QueuedEvent[] = []
  songBlock = -1
  songEnded = false
  loopSong = true
  duckEnv = 0
  // buses
  dl: Float32Array; dr: Float32Array; rl: Float32Array; rr: Float32Array
  mixL: Float32Array; mixR: Float32Array
  reverb: Reverb
  delay: Delay
  compEnv = 0
  limGain = 1
  masterPeak = 0
  // monitoring
  monitor = false
  events: PlayedEvent[] = []
  recording = false
  recChunks: Float32Array[][] = []
  voicesActive = 0
  detune = new Float64Array(8)
  panW = new Float64Array(8)
  post: (m: FromEngine, transfer?: Transferable[]) => void

  constructor(sampleRate: number, post: (m: FromEngine, transfer?: Transferable[]) => void = () => {}, maxBlock = 512) {
    this.sr = sampleRate
    this.maxBlock = maxBlock
    this.post = post
    this.dl = new Float32Array(maxBlock); this.dr = new Float32Array(maxBlock)
    this.rl = new Float32Array(maxBlock); this.rr = new Float32Array(maxBlock)
    this.mixL = new Float32Array(maxBlock); this.mixR = new Float32Array(maxBlock)
    this.reverb = new Reverb(sampleRate)
    this.delay = new Delay(sampleRate)
  }

  get samplesPerStep() { return (this.sr * 60) / this.song.bpm / 4 }

  // -------------------------------------------------------------------------- messages
  handle(m: ToEngine) {
    switch (m.type) {
      case 'song':
        if (!this.playing || m.at === 'now') this.applySong(m.song)
        else this.pendingSong = { song: m.song, at: m.at }
        break
      case 'params': this.applyParams(m.tracks, m.master); break
      case 'sample': this.addSample(m.id, { channels: m.channels, sampleRate: m.sampleRate }); break
      case 'play': this.play(m.mode, m.fromBar ?? 0); break
      case 'stop': this.stop(); break
      case 'launchScene': {
        const sc = this.song.scenes.find((s) => s.id === m.scene)
        if (!sc) break
        if (this.mode === 'song' && this.playing) this.mode = 'live'
        for (const t of this.tracks) this.launch(t, sc.slots[t.id] ?? null, m.at)
        break
      }
      case 'launchClip': {
        const t = this.tracks[this.trackIndex.get(m.track) ?? -1]
        if (!t) break
        if (this.mode === 'song' && this.playing) this.mode = 'live'
        this.launch(t, m.clip, m.at)
        break
      }
      case 'noteOn': { const ti = this.trackIndex.get(m.track); if (ti !== undefined) this.trigger(ti, m.pitch, m.vel, -1, 0); break }
      case 'noteOff': { const ti = this.trackIndex.get(m.track); if (ti !== undefined) this.release(ti, m.pitch); break }
      case 'preview': { const ti = this.trackIndex.get(m.track); if (ti !== undefined) this.trigger(ti, m.pitch, m.vel, Math.round(m.len * this.samplesPerStep), 0); break }
      case 'monitor': this.monitor = m.events; break
      case 'record':
        if (m.on) { this.recording = true; this.recChunks = [] }
        else if (this.recording) {
          this.recording = false
          const total = this.recChunks.reduce((a, c) => a + c[0].length, 0)
          const L = new Float32Array(total), R = new Float32Array(total)
          let o = 0
          for (const c of this.recChunks) { L.set(c[0], o); R.set(c[1], o); o += c[0].length }
          this.recChunks = []
          this.post({ type: 'recorded', channels: [L, R] }, [L.buffer, R.buffer])
        }
        break
    }
  }

  applySong(song: EngineSong) {
    this.song = song
    // keep track states that still exist
    for (const st of song.tracks) {
      const t = this.tracks[this.trackIndex.get(st.id) ?? -1]
      if (!t) continue
      t.clips.clear()
      for (const c of st.clips) {
        const byStep: EngineClip['notes'][] = Array.from({ length: c.length }, () => [])
        for (const n of c.notes) if (n.step >= 0 && n.step < c.length) byStep[Math.floor(n.step)].push(n)
        t.clips.set(c.id, { id: c.id, length: c.length, byStep })
      }
      if (t.playing && !t.clips.has(t.playing)) t.playing = null
    }
  }

  applyParams(params: EngineTrackParams[], master: EngineMaster) {
    this.master = master
    const next: TrackState[] = []
    const idx = new Map<string, number>()
    params.forEach((p, i) => {
      let t = this.tracks[this.trackIndex.get(p.id) ?? -1]
      if (!t) {
        t = new TrackState(p, this.maxBlock, i * 977 + 13)
        t.sVol = p.volume
      }
      t.params = p
      t.synth = p.synth ?? null
      t.pads = p.pads ?? null
      if ((t.synth?.chorus ?? 0) > 0 && !t.chorus) t.chorus = new Chorus(this.sr)
      if (t.pads) for (const pad of t.pads) this.ensureSample(pad.sample)
      next.push(t)
      idx.set(p.id, i)
    })
    this.tracks = next
    this.trackIndex = idx
    // clips may have arrived before the track existed
    this.applySong(this.song)
  }

  addSample(id: string, d: SampleData) {
    this.samples.set(id, d)
    const m = /^sound:([\w-]+)\/(\d+)$/.exec(id)
    if (!m) return
    let inst = this.instruments.get(m[1])
    if (!inst) { inst = { roots: [], data: [] }; this.instruments.set(m[1], inst) }
    const root = Number(m[2])
    const k = inst.roots.indexOf(root)
    if (k >= 0) { inst.data[k] = d; return }
    let at = 0
    while (at < inst.roots.length && inst.roots[at] < root) at++
    inst.roots.splice(at, 0, root)
    inst.data.splice(at, 0, d)
  }

  /** Point a voice at the recording nearest to a pitch. Returns false when the instrument isn't loaded. */
  pickZone(v: SynthVoice, sp: SynthParams, pitch: number): boolean {
    if (sp.osc1 === 'sampler') {
      const d = sp.sample ? this.samples.get(sp.sample) : undefined
      v.sdata = d ?? null
      v.sroot = sp.sampleRoot ?? 60
      v.spos = 0
      return !!d
    }
    const inst = this.instruments.get(sp.osc1)
    if (!inst || !inst.roots.length) { v.sdata = null; return false }
    let best = 0
    for (let k = 1; k < inst.roots.length; k++) if (Math.abs(inst.roots[k] - pitch) < Math.abs(inst.roots[best] - pitch)) best = k
    v.sdata = inst.data[best]
    v.sroot = inst.roots[best]
    v.spos = 0
    return true
  }

  ensureSample(id: string) {
    if (this.samples.has(id)) return
    const s = synthesizeFactorySample(id, this.sr)
    if (s) this.samples.set(id, s)
  }

  play(mode: 'live' | 'song', fromBar: number) {
    this.mode = mode
    this.playing = true
    this.songEnded = false
    this.stepPos = mode === 'song' ? fromBar * 16 : 0
    this.nextStep = Math.ceil(this.stepPos - 1e-9)
    this.songBlock = -1
    this.queue.length = 0
    if (this.pendingSong) { this.applySong(this.pendingSong.song); this.pendingSong = null }
    for (const t of this.tracks) {
      if (t.queued !== undefined) { t.playing = t.queued; t.queued = undefined }
      t.clipStart = this.nextStep
    }
    if (mode === 'song') {
      // start inside the section that contains fromBar
      let acc = 0
      for (let b = 0; b < this.song.arrangement.length; b++) {
        const blk = this.song.arrangement[b]
        const end = acc + blk.bars * 16
        if (this.nextStep >= acc && this.nextStep < end) {
          const sc = this.song.scenes.find((x) => x.id === blk.scene)
          for (const t of this.tracks) { t.playing = sc?.slots[t.id] ?? null; t.clipStart = acc }
          this.songBlock = b
          break
        }
        acc = end
      }
    }
  }

  stop() {
    this.playing = false
    this.queue.length = 0
    for (const t of this.tracks) {
      for (const v of t.voices) if (v.active) { v.amp.gate(false); v.flt.gate(false); v.gate = 0 }
      t.held.clear()
      t.queued = undefined
    }
  }

  launch(t: TrackState, clip: string | null, at: Quantize) {
    if (clip !== null && !t.clips.has(clip)) clip = null
    if (!this.playing) { t.playing = clip; t.queued = undefined; return }
    const now = Math.ceil(this.stepPos - 1e-9)
    const q = at === 'bar' ? 16 : at === 'beat' ? 4 : 1
    t.queued = clip
    t.queuedAt = Math.ceil(now / q) * q
    if (t.queuedAt < this.nextStep) t.queuedAt = this.nextStep
  }

  // -------------------------------------------------------------------------- scheduling
  /** Handle quantized actions and trigger the notes of one 16th step. */
  scheduleStep(s: number) {
    const sps = this.samplesPerStep
    if (this.pendingSong) {
      const q = this.pendingSong.at === 'bar' ? 16 : this.pendingSong.at === 'beat' ? 4 : 1
      if (s % q === 0) { this.applySong(this.pendingSong.song); this.pendingSong = null }
    }
    if (this.mode === 'song') {
      const total = this.song.arrangement.reduce((a, b) => a + b.bars * 16, 0)
      if (total === 0) return
      let local = s
      if (local >= total) {
        if (!this.loopSong) { this.songEnded = true; return }
        local = s % total
      }
      let acc = 0
      for (let b = 0; b < this.song.arrangement.length; b++) {
        const blk = this.song.arrangement[b]
        if (local === acc) {
          const sc = this.song.scenes.find((x) => x.id === blk.scene)
          for (const t of this.tracks) { t.playing = sc?.slots[t.id] ?? null; t.clipStart = s; t.queued = undefined }
          this.songBlock = b
          break
        }
        acc += blk.bars * 16
        if (local < acc) break
      }
    }
    // swing delays every odd 16th
    const swingDelay = s % 2 === 1 ? this.song.swing * sps : 0
    const baseTime = this.sampleTime + (s - this.stepPos) * sps + swingDelay
    for (let ti = 0; ti < this.tracks.length; ti++) {
      const t = this.tracks[ti]
      if (t.queued !== undefined && s >= t.queuedAt) { t.playing = t.queued; t.clipStart = s; t.queued = undefined }
      if (!t.playing) continue
      const c = t.clips.get(t.playing)
      if (!c) continue
      const local = (((s - t.clipStart) % c.length) + c.length) % c.length
      const p = t.params
      const notes = c.byStep[local]
      for (let k = 0; k < notes.length; k++) {
        const n = notes[k]
        if (p.chaos > 0 && t.rng.next() < p.chaos * 0.3) continue
        let vel = n.vel
        let time = baseTime
        if (p.humanize > 0) { time += t.rng.next() * p.humanize * 0.015 * this.sr; vel = Math.max(0.1, Math.min(1, vel + (t.rng.next() - 0.5) * p.humanize * 0.3)) }
        let pitch = n.pitch
        if (t.synth && p.chaos > 0 && t.rng.next() < p.chaos * 0.2) pitch += 12
        const len = Math.max(1, n.len * sps - 8)
        const ratchet = p.chaos > 0 && t.rng.next() < p.chaos * 0.2
        this.queue.push({ time, track: ti, pitch, vel, len: ratchet ? len / 2 : len, clip: c.id, step: local, absStep: s })
        if (ratchet) this.queue.push({ time: time + sps / 2, track: ti, pitch, vel: vel * 0.8, len: len / 2, clip: c.id, step: local, absStep: s })
      }
      // density: extra hats on drum tracks
      if (t.pads && p.density > 0) {
        const hasHat = notes.some((n) => n.pitch === 3)
        if (!hasHat && t.rng.next() < p.density * 0.55) this.queue.push({ time: baseTime, track: ti, pitch: 3, vel: 0.35 + t.rng.next() * 0.25, len: 1, clip: c.id, step: local, absStep: s })
        else if (hasHat && t.rng.next() < p.density * 0.3) this.queue.push({ time: baseTime + sps / 2, track: ti, pitch: 3, vel: 0.4, len: 1, clip: c.id, step: local, absStep: s })
      }
    }
  }

  // -------------------------------------------------------------------------- voices
  trigger(ti: number, pitch: number, vel: number, lenSamples: number, delay: number) {
    const t = this.tracks[ti]
    if (!t) return
    if (t.pads) {
      const pad = t.pads[pitch]
      if (!pad) return
      const data = this.samples.get(pad.sample) ?? null
      if (!data) return
      if (pitch === 0) this.duckEnv = 1
      if (pad.choke) for (const v of t.drums) if (v.active && v.choke === pad.choke) v.fadeOut = Math.max(1, Math.round(this.sr * 0.004))
      let v = t.drums.find((x) => !x.active)
      if (!v) { v = t.drums[0]; for (const x of t.drums) if (x.pos > v.pos) v = x }
      const len = data.channels[0].length
      v.active = true
      v.pad = pitch
      v.data = data
      v.pos = 0
      // tiny per-hit variation, like a real player never hitting twice the same
      const jitter = (this.vrng.next() - 0.5)
      v.rate = Math.pow(2, (pad.tune + jitter * 0.08) / 12) * (data.sampleRate / this.sr)
      const g = pad.gain * (0.25 + 0.75 * vel) * (1 + jitter * 0.08)
      const pan = Math.max(-1, Math.min(1, pad.pan))
      v.panL = g * Math.cos(((pan + 1) * Math.PI) / 4)
      v.panR = g * Math.sin(((pan + 1) * Math.PI) / 4)
      v.env = 1
      v.envCoef = pad.decay >= 0.999 ? 1 : Math.exp(-4.6 / Math.max(1, (pad.decay * len) / v.rate))
      v.choke = pad.choke ?? 0
      v.fadeOut = 0
      v.delay = delay
      return
    }
    const sp = t.synth
    if (!sp) return
    let v: SynthVoice | undefined
    if (sp.mono) {
      v = t.voices[0]
      const legato = v.active && v.amp.stage !== 3 && v.amp.stage !== 0
      if (!v.active) v.curNote = pitch
      if (sp.glide <= 0) v.curNote = pitch
      v.pitch = pitch
      v.vel = vel
      v.gate = lenSamples
      v.delay = delay
      v.age = 0
      v.amp.set(sp.ampA, sp.ampD, sp.ampS, sp.ampR, this.sr)
      v.flt.set(sp.fltA, sp.fltD, sp.fltS, sp.fltR, this.sr)
      if (!WAVES.has(sp.osc1) && (!legato || !v.sdata)) this.pickZone(v, sp, pitch)
      v.amp.gate(true, !legato)
      v.flt.gate(true, !legato)
      v.active = true
      t.held.set(pitch, v)
      return
    }
    v = t.voices.find((x) => !x.active)
    if (!v) { v = t.voices[0]; for (const x of t.voices) if (x.age > v.age) v = x }
    v.active = true
    v.pitch = pitch
    v.curNote = pitch
    v.vel = vel
    v.gate = lenSamples
    v.delay = delay
    v.age = 0
    v.ctr = 0
    // free-running oscillators: each note starts at a different phase, like an analog synth
    const ph0 = this.vrng.next()
    for (let u = 0; u < 8; u++) v.phases[u] = (ph0 + u * 0.618) % 1
    v.drPh = this.vrng.next()
    v.drRate = 0.15 + this.vrng.next() * 0.35
    if (!WAVES.has(sp.osc1)) this.pickZone(v, sp, pitch)
    v.ph2 = 0
    v.phSub = 0
    v.fL.reset(); v.fR.reset()
    v.amp.v = 0; v.flt.v = 0
    v.amp.set(sp.ampA, sp.ampD, sp.ampS, sp.ampR, this.sr)
    v.flt.set(sp.fltA, sp.fltD, sp.fltS, sp.fltR, this.sr)
    v.amp.gate(true); v.flt.gate(true)
    if (lenSamples < 0) t.held.set(pitch, v)
  }

  release(ti: number, pitch: number) {
    const t = this.tracks[ti]
    const v = t?.held.get(pitch)
    if (!v) return
    t.held.delete(pitch)
    if (t.synth?.mono && v.pitch !== pitch) return
    v.gate = 0
    v.amp.gate(false); v.flt.gate(false)
  }

  renderSynth(t: TrackState, from: number, to: number) {
    const sp = t.synth!
    const sr = this.sr
    const L = t.bufL, R = t.bufR
    const uni = Math.max(1, Math.min(7, sp.unison | 0))
    const glideCoef = sp.glide > 0 ? 1 - Math.exp(-1 / (sp.glide * sr * 0.3)) : 1
    // track-level LFO (control rate: once per segment)
    const lfo = Math.sin(TAU * t.lfoPh)
    t.lfoPh = (t.lfoPh + (sp.lfoRate * (to - from)) / sr) % 1
    const lfoCut = Math.pow(2, sp.lfoCutoff * 2 * lfo)
    const lfoPitch = Math.pow(2, (sp.lfoPitch * lfo) / 1200)
    const det2 = Math.pow(2, (sp.osc2Semi * 100 + sp.osc2Detune) / 1200)
    const m1 = 1 - sp.oscMix, m2 = sp.oscMix
    const driveAmt = 1 + sp.drive * 4
    const driveNorm = 1 / Math.tanh(driveAmt)
    const uniGain = 1 / Math.sqrt(uni)
    const sampled = !WAVES.has(sp.osc1)
    const stereo = uni > 1 || sampled
    const outGain = sampled ? 0.25 : 0.32
    const driftStep = (16 / sr)
    const detune = this.detune
    for (let u = 0; u < uni; u++) {
      const spread = uni > 1 ? (u / (uni - 1) - 0.5) * 2 : 0
      detune[u] = Math.pow(2, (spread * sp.spread) / 1200)
      this.panW[u] = 0.5 + spread * 0.45
    }
    for (const v of t.voices) {
      if (!v.active) continue
      for (let i = from; i < to; i++) {
        if (v.delay > 0) { v.delay--; continue }
        if (v.gate > 0) { v.gate--; if (v.gate === 0) { v.amp.gate(false); v.flt.gate(false) } }
        v.curNote += (v.pitch - v.curNote) * glideCoef
        const fe = v.flt.next()
        const a = v.amp.next()
        if (v.amp.stage === 0) { v.active = false; break }
        if ((v.ctr++ & 15) === 0) {
          v.drPh += v.drRate * driftStep; if (v.drPh >= 1) v.drPh -= 1
          const drift = sampled ? 1 : Math.pow(2, (DRIFT_CENTS * Math.sin(TAU * v.drPh)) / 1200)
          v.freq = 440 * Math.pow(2, (v.curNote - 69) / 12) * lfoPitch * drift
          if (v.sdata) v.srate = Math.pow(2, (v.curNote - v.sroot) / 12) * lfoPitch * (v.sdata.sampleRate / sr)
          let fc = sp.cutoff * Math.pow(2, sp.keyTrack * (v.curNote - 60) / 12) * Math.pow(2, sp.filterEnv * 4 * fe * (0.6 + 0.4 * v.vel)) * lfoCut
          fc = Math.max(20, Math.min(sr * 0.45, fc))
          v.fL.set(fc, sp.resonance, sr)
          if (stereo) v.fR.set(fc, sp.resonance, sr)
        }
        const freq = v.freq
        const dt2 = (freq * det2) / sr
        v.ph2 += dt2; if (v.ph2 >= 1) v.ph2 -= 1
        const o2 = osc(sp.osc2, v.ph2, dt2)
        const pm = sp.fm > 0 ? sp.fm * 1.5 * o2 : 0
        let l = 0, r = 0
        if (sampled) {
          const d = v.sdata
          if (!d) { v.active = false; break }
          const c0 = d.channels[0], c1 = d.channels[1] ?? c0
          const i0 = v.spos | 0
          if (i0 >= c0.length - 1) { v.active = false; break }
          const fr = v.spos - i0
          l = c0[i0] + (c0[i0 + 1] - c0[i0]) * fr
          r = c1[i0] + (c1[i0 + 1] - c1[i0]) * fr
          v.spos += v.srate
        } else for (let u = 0; u < uni; u++) {
          const dt = (freq * detune[u]) / sr
          let p = v.phases[u] + dt
          if (p >= 1) p -= 1
          v.phases[u] = p
          let pp = p + pm
          pp -= Math.floor(pp)
          const s = osc(sp.osc1, pp, dt)
          if (uni === 1) { l += s; r += s }
          else { const w = this.panW[u]; l += s * (1 - w) * 1.4; r += s * w * 1.4 }
        }
        if (!sampled) { l *= uniGain; r *= uniGain }
        const dts = (freq * 0.5) / sr
        v.phSub += dts; if (v.phSub >= 1) v.phSub -= 1
        const sub = Math.sin(TAU * v.phSub) * sp.sub
        const nz = sp.noise > 0 ? white() * sp.noise : 0
        let xl = l * m1 + o2 * m2 + sub + nz
        let xr = stereo ? r * m1 + o2 * m2 + sub + nz : xl
        if (sp.drive > 0) { xl = Math.tanh(xl * driveAmt) * driveNorm; xr = Math.tanh(xr * driveAmt) * driveNorm }
        const yl = v.fL.lp(xl)
        const yr = stereo ? v.fR.lp(xr) : yl
        const g = a * sp.gain * (0.35 + 0.65 * v.vel) * outGain
        L[i] += yl * g
        R[i] += yr * g
      }
      v.age += to - from
    }
  }

  renderDrums(t: TrackState, from: number, to: number) {
    const L = t.bufL, R = t.bufR
    for (const v of t.drums) {
      if (!v.active || !v.data) continue
      const ch0 = v.data.channels[0]
      const ch1 = v.data.channels[1] ?? ch0
      const n = ch0.length
      for (let i = from; i < to; i++) {
        if (v.delay > 0) { v.delay--; continue }
        const i0 = v.pos | 0
        if (i0 >= n - 1) { v.active = false; break }
        const fr = v.pos - i0
        const sl = ch0[i0] + (ch0[i0 + 1] - ch0[i0]) * fr
        const sr = ch1[i0] + (ch1[i0 + 1] - ch1[i0]) * fr
        let e = v.env
        if (v.fadeOut > 0) { e *= v.fadeOut / (this.sr * 0.004); v.fadeOut--; if (v.fadeOut === 0) { v.active = false; break } }
        L[i] += sl * v.panL * e * 0.8
        R[i] += sr * v.panR * e * 0.8
        v.env *= v.envCoef
        if (v.env < 1e-4) { v.active = false; break }
        v.pos += v.rate
      }
    }
  }

  // -------------------------------------------------------------------------- render
  process(outL: Float32Array, outR: Float32Array, frames: number) {
    for (let off = 0; off < frames; off += this.maxBlock) {
      const n = Math.min(this.maxBlock, frames - off)
      this.processBlock(outL.subarray(off, off + n), outR.subarray(off, off + n), n)
    }
  }

  processBlock(outL: Float32Array, outR: Float32Array, n: number) {
    const sps = this.samplesPerStep
    const blockStart = this.sampleTime
    const blockEnd = blockStart + n
    if (this.playing && !this.songEnded) {
      // schedule every step whose time falls in this block (with a small look-ahead for swing)
      const endStep = this.stepPos + n / sps
      while (this.nextStep < endStep) {
        this.scheduleStep(this.nextStep)
        this.nextStep++
      }
    }
    for (const t of this.tracks) { t.bufL.fill(0, 0, n); t.bufR.fill(0, 0, n) }
    // trigger queued events at their sample offsets
    if (this.queue.length) {
      this.queue.sort((a, b) => a.time - b.time)
      let k = 0
      while (k < this.queue.length && this.queue[k].time < blockEnd) {
        const e = this.queue[k]
        const offset = Math.max(0, Math.floor(e.time - blockStart))
        this.trigger(e.track, e.pitch, e.vel, Math.round(e.len), offset)
        if (this.monitor && this.events.length < 512) {
          const t = this.tracks[e.track]
          if (t) this.events.push({ time: (blockStart + offset) / this.sr, track: t.id, clip: e.clip, step: e.step, pitch: e.pitch, vel: e.vel, absStep: e.absStep })
        }
        k++
      }
      if (k) this.queue.splice(0, k)
    }
    let voices = 0
    for (const t of this.tracks) {
      if (t.synth) {
        this.renderSynth(t, 0, n)
        const ch = t.synth.chorus ?? 0
        if (ch > 0.001 && t.chorus) t.chorus.process(t.bufL, t.bufR, n, ch)
      }
      else if (t.pads) this.renderDrums(t, 0, n)
      for (const v of t.voices) if (v.active) voices++
      for (const v of t.drums) if (v.active) voices++
    }
    this.voicesActive = voices
    // mix
    const mixL = this.mixL, mixR = this.mixR, dl = this.dl, dr = this.dr, rl = this.rl, rr = this.rr
    mixL.fill(0, 0, n); mixR.fill(0, 0, n); dl.fill(0, 0, n); dr.fill(0, 0, n); rl.fill(0, 0, n); rr.fill(0, 0, n)
    const duckRel = Math.exp(-1 / (sps * 2.2))
    const duckStart = this.duckEnv
    for (const t of this.tracks) {
      const p = t.params
      const L = t.bufL, R = t.bufR
      const pan = p.pan
      const tl = Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2
      const tr = Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2
      const drive = p.drive > 0 ? 1 + p.drive * 6 : 0
      const dn = drive ? 1 / Math.tanh(drive) : 1
      const tone = p.tone
      if (Math.abs(tone) > 0.01) {
        const fc = tone < 0 ? 20000 * Math.pow(2, tone * 9.5) : 20 * Math.pow(2, tone * 9)
        t.toneF[0].set(fc, 0.25, this.sr); t.toneF[1].set(fc, 0.25, this.sr)
      }
      let duck = duckStart
      let peak = t.peak
      for (let i = 0; i < n; i++) {
        t.sVol += (p.volume - t.sVol) * 0.002
        t.sPanL += (tl - t.sPanL) * 0.002
        t.sPanR += (tr - t.sPanR) * 0.002
        t.sDelay += (p.sendDelay - t.sDelay) * 0.002
        t.sReverb += (p.sendReverb - t.sReverb) * 0.002
        let l = L[i], r = R[i]
        if (drive) { l = Math.tanh(l * drive) * dn * 0.8; r = Math.tanh(r * drive) * dn * 0.8 }
        if (tone < -0.01) { l = t.toneF[0].lp(l); r = t.toneF[1].lp(r) }
        else if (tone > 0.01) { l = t.toneF[0].hp(l); r = t.toneF[1].hp(r) }
        duck *= duckRel
        const g = t.sVol * (1 - p.duck * duck * 0.85)
        l *= g * t.sPanL; r *= g * t.sPanR
        mixL[i] += l; mixR[i] += r
        dl[i] += l * t.sDelay; dr[i] += r * t.sDelay
        rl[i] += l * t.sReverb; rr[i] += r * t.sReverb
        const a = Math.abs(l) > Math.abs(r) ? Math.abs(l) : Math.abs(r)
        if (a > peak) peak = a
      }
      t.peak = peak
    }
    for (let i = 0; i < n; i++) this.duckEnv *= duckRel
    this.delay.process(dl, dr, mixL, mixR, n, this.master.delayTime * sps, this.master.delayFeedback)
    this.reverb.process(rl, rr, mixL, mixR, n, this.master.reverbSize)
    // master: glue compression, limiter, volume
    const mv = this.master.volume
    const att = Math.exp(-1 / (0.003 * this.sr)), rel = Math.exp(-1 / (0.15 * this.sr))
    const latt = Math.exp(-1 / (0.0008 * this.sr)), lrel = Math.exp(-1 / (0.12 * this.sr))
    let mp = this.masterPeak
    for (let i = 0; i < n; i++) {
      let l = mixL[i] * mv, r = mixR[i] * mv
      const lvl = Math.max(Math.abs(l), Math.abs(r))
      this.compEnv = lvl > this.compEnv ? lvl + (this.compEnv - lvl) * att : lvl + (this.compEnv - lvl) * rel
      const th = 0.35
      const cg = this.compEnv > th ? Math.pow(this.compEnv / th, -0.4) : 1 // ratio ~1.7:1
      l *= cg * 1.15; r *= cg * 1.15
      const pk = Math.max(Math.abs(l), Math.abs(r))
      const target = pk > 0.95 ? 0.95 / pk : 1
      this.limGain = target < this.limGain ? target + (this.limGain - target) * latt : target + (this.limGain - target) * lrel
      l *= this.limGain; r *= this.limGain
      l = l > 1 ? 1 : l < -1 ? -1 : l
      r = r > 1 ? 1 : r < -1 ? -1 : r
      outL[i] = l; outR[i] = r
      const a = Math.abs(l) > Math.abs(r) ? Math.abs(l) : Math.abs(r)
      if (a > mp) mp = a
    }
    this.masterPeak = mp
    if (this.recording) this.recChunks.push([outL.slice(0, n), outR.slice(0, n)])
    this.sampleTime = blockEnd
    if (this.playing) this.stepPos += n / sps
  }

  status(load: number): EngineStatus {
    const playingClips: Record<string, string | null> = {}
    const clipStart: Record<string, number> = {}
    const queued: Record<string, string | null> = {}
    const meters: Record<string, number> = {}
    for (const t of this.tracks) {
      playingClips[t.id] = t.playing
      clipStart[t.id] = t.clipStart
      if (t.queued !== undefined) queued[t.id] = t.queued
      meters[t.id] = t.peak
      t.peak = 0
    }
    meters.master = this.masterPeak
    this.masterPeak = 0
    return {
      type: 'status', playing: this.playing, mode: this.mode, step: this.stepPos, time: this.sampleTime / this.sr,
      playingClips, clipStart, queued, songBlock: this.songBlock, voices: this.voicesActive, load, meters,
      songPending: !!this.pendingSong,
    }
  }

  takeEvents(): PlayedEvent[] | null {
    if (!this.events.length) return null
    const e = this.events
    this.events = []
    return e
  }
}
