// The message protocol between the control side (UI) and the audio engine.
// The engine runs on the audio thread (AudioWorklet) or offline (export worker, tests).
// A native engine (e.g. JUCE) can implement the same protocol later.

import type { DrumPad, SynthParams } from '../model/types'

export interface EngineNote {
  step: number
  pitch: number
  len: number
  vel: number
}

export interface EngineClip {
  id: string
  length: number
  notes: EngineNote[] // sorted by step
}

/** Resolved, ready-to-play sound parameters for one track (smart controls and macros already applied). */
export interface EngineTrackParams {
  id: string
  kind: 'synth' | 'drums'
  synth?: SynthParams
  pads?: DrumPad[]
  volume: number // linear gain, 0..1.2
  pan: number
  sendDelay: number
  sendReverb: number
  drive: number
  tone: number
  duck: number
  humanize: number
  chaos: number
  density: number
}

export interface EngineMaster {
  volume: number
  delayTime: number // 16th steps
  delayFeedback: number
  reverbSize: number
}

export interface EngineSong {
  bpm: number
  swing: number
  tracks: { id: string; clips: EngineClip[] }[]
  scenes: { id: string; slots: Record<string, string | null> }[]
  arrangement: { scene: string; bars: number }[]
}

export type Quantize = 'now' | 'beat' | 'bar'

export type ToEngine =
  | { type: 'song'; song: EngineSong; at: Quantize }
  | { type: 'params'; tracks: EngineTrackParams[]; master: EngineMaster }
  | { type: 'sample'; id: string; channels: Float32Array[]; sampleRate: number }
  | { type: 'play'; mode: 'live' | 'song'; fromBar?: number }
  | { type: 'stop' }
  | { type: 'launchScene'; scene: string; at: Quantize }
  | { type: 'launchClip'; track: string; clip: string | null; at: Quantize }
  | { type: 'noteOn'; track: string; pitch: number; vel: number }
  | { type: 'noteOff'; track: string; pitch: number }
  | { type: 'preview'; track: string; pitch: number; vel: number; len: number }
  | { type: 'monitor'; events: boolean }
  | { type: 'record'; on: boolean }
  | { type: 'loopBars'; bars: number | null } // live-mode: none; song-mode loop region not used in MVP

export interface PlayedEvent {
  time: number // engine seconds
  track: string
  clip: string
  step: number // step within clip
  pitch: number
  vel: number
  absStep: number
}

export interface EngineStatus {
  type: 'status'
  playing: boolean
  mode: 'live' | 'song'
  step: number // absolute transport position in 16ths
  time: number
  playingClips: Record<string, string | null>
  clipStart: Record<string, number> // absolute step the playing clip started
  queued: Record<string, string | null> // pending launches
  songBlock: number // index into arrangement (song mode)
  voices: number
  load: number // 0..1 approximate DSP load
  meters: Record<string, number> // peak per track, plus "master"
  songPending: boolean
}

export type FromEngine =
  | EngineStatus
  | { type: 'events'; events: PlayedEvent[] }
  | { type: 'recorded'; channels: Float32Array[] }
  | { type: 'songEnded' }
