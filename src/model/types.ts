// Canonical project representation ("the IR").
// Visual editors, the code editor, the audio engine and export all read and write this one shape.

export const SCHEMA_VERSION = 1
export const STEPS_PER_BEAT = 4
export const STEPS_PER_BAR = 16

export type Wave = 'saw' | 'square' | 'triangle' | 'sine'
/** What oscillator 1 plays: a waveform, or a sampled instrument from the factory sound pack. */
export type Source = Wave | 'piano'

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'major pentatonic': [0, 2, 4, 7, 9],
  'minor pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
} as const
export type ScaleName = keyof typeof SCALES

export interface Key {
  root: number // 0 = C … 11 = B
  scale: ScaleName
}

/** A note on the 16th-note grid. step and len are in 16ths; vel is 0..1. For drum clips, pitch is the pad index. */
export interface Note {
  step: number
  pitch: number
  len: number
  vel: number
}

export interface Clip {
  id: string
  name: string
  length: number // in 16th steps
  notes: Note[]
  /** Generator source (DSL expression). When present, notes are derived from it. Editing notes by hand clears it. */
  gen?: string
}

export interface SynthParams {
  osc1: Source
  osc2: Wave
  osc2Semi: number
  osc2Detune: number // cents
  oscMix: number // 0 = osc1 only, 1 = osc2 only
  sub: number
  noise: number
  unison: number // 1..7 voices on osc1
  spread: number // cents of unison detune
  fm: number // osc2 -> osc1 phase modulation depth 0..1
  cutoff: number // Hz
  resonance: number // 0..1
  filterEnv: number // -1..1, in units of 4 octaves
  keyTrack: number // 0..1
  ampA: number
  ampD: number
  ampS: number
  ampR: number
  fltA: number
  fltD: number
  fltS: number
  fltR: number
  lfoRate: number // Hz
  lfoCutoff: number // 0..1 (up to 2 octaves)
  lfoPitch: number // cents
  glide: number // seconds
  mono: boolean
  drive: number // 0..1
  gain: number // 0..1.5
  chorus: number // 0..1, stereo chorus after the voices
}

export interface DrumPad {
  name: string
  sample: string // "factory:<kit>/<pad>" or "user:<file name>"
  tune: number // semitones
  decay: number // 0..1, 1 = full sample
  gain: number
  pan: number
  choke?: number // pads in the same choke group cut each other off
}

export interface MixParams {
  volume: number // 0..1 (fader)
  pan: number // -1..1
  mute: boolean
  solo: boolean
  sendDelay: number
  sendReverb: number
  drive: number
  tone: number // DJ filter: -1 lowpass … 0 off … 1 highpass
  duck: number // sidechain ducking from kick hits
}

export const SMART_CONTROLS = ['warmth', 'brightness', 'movement', 'space', 'energy', 'texture'] as const
export type SmartName = (typeof SMART_CONTROLS)[number]

export type TrackKind = 'synth' | 'drums'

export interface Track {
  id: string
  name: string
  color: string
  kind: TrackKind
  preset: string // preset or kit name the instrument started from
  synth?: SynthParams
  pads?: DrumPad[]
  smart: Record<SmartName, number> // 0..1, 0.5 = the sound as designed
  mix: MixParams
  clips: Clip[]
}

export interface Scene {
  id: string
  name: string
  slots: Record<string, string | null> // trackId -> clipId (null/missing = silent)
}

export interface ArrangeBlock {
  scene: string // scene id
  bars: number
}

/** Parameter a macro or MIDI control can drive. */
export type MacroParam =
  | 'volume' | 'pan' | 'sendDelay' | 'sendReverb' | 'drive' | 'tone' | 'duck'
  | 'cutoff' | 'resonance' | 'chaos' | 'density'
  | 'master.delayFeedback' | 'master.reverbSize'
  | `smart.${SmartName}`

export interface MacroTarget {
  track: string // track id, or "*" for all tracks, or "master"
  param: MacroParam
  amount: number // -1..1, added at full macro value
}

export interface PerfMacro {
  id: string
  name: string
  value: number // 0..1, 0 = no effect
  targets: MacroTarget[]
}

export interface MidiMapping {
  kind: 'cc' | 'note'
  channel: number // 0..15, -1 = any
  number: number
  target: string // see engine/midi.ts for target syntax
}

export interface MasterParams {
  volume: number
  delayTime: number // in 16th steps (3 = dotted eighth)
  delayFeedback: number
  reverbSize: number
}

export interface Project {
  schema: number
  id: string
  name: string
  bpm: number
  swing: number // 0..0.5
  key: Key
  guardrails: boolean // beginner-safe ranges and scale snapping
  tracks: Track[]
  scenes: Scene[]
  arrangement: ArrangeBlock[]
  macros: PerfMacro[]
  master: MasterParams
  midi: MidiMapping[]
  createdAt: string
  updatedAt: string
}
