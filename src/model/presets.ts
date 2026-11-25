import type { DrumPad, SynthParams } from './types'
import { SAMPLED_KITS } from './soundpack'

const BASE: SynthParams = {
  osc1: 'saw', osc2: 'saw', osc2Semi: 0, osc2Detune: 7, oscMix: 0.4, sub: 0, noise: 0,
  unison: 1, spread: 12, fm: 0,
  cutoff: 2400, resonance: 0.2, filterEnv: 0.3, keyTrack: 0.5,
  ampA: 0.005, ampD: 0.3, ampS: 0.7, ampR: 0.25,
  fltA: 0.005, fltD: 0.35, fltS: 0.3, fltR: 0.3,
  lfoRate: 2, lfoCutoff: 0, lfoPitch: 0,
  glide: 0, mono: false, drive: 0.1, gain: 0.8, chorus: 0,
  sample: '', sampleRoot: 60,
}

const p = (o: Partial<SynthParams>): SynthParams => ({ ...BASE, ...o })

export interface SynthPreset {
  name: string
  category: 'bass' | 'lead' | 'pad' | 'keys' | 'pluck' | 'fx'
  description: string
  params: SynthParams
}

export const SYNTH_PRESETS: SynthPreset[] = [
  { name: 'analog-bass', category: 'bass', description: 'Round, punchy two-oscillator bass.',
    params: p({ osc1: 'saw', osc2: 'square', osc2Semi: -12, oscMix: 0.35, sub: 0.4, cutoff: 650, resonance: 0.25, filterEnv: 0.35, ampD: 0.25, ampS: 0.8, ampR: 0.08, fltD: 0.22, fltS: 0.15, mono: true, glide: 0.02, drive: 0.25 }) },
  { name: 'sub-bass', category: 'bass', description: 'Clean sine sub for deep low end.',
    params: p({ osc1: 'sine', osc2: 'triangle', oscMix: 0.15, sub: 0, cutoff: 900, resonance: 0, filterEnv: 0, ampA: 0.004, ampS: 1, ampR: 0.12, mono: true, drive: 0.15, gain: 0.95 }) },
  { name: 'acid', category: 'bass', description: 'Squelchy resonant bassline.',
    params: p({ osc1: 'saw', osc2: 'square', oscMix: 0, cutoff: 380, resonance: 0.78, filterEnv: 0.6, fltD: 0.18, fltS: 0, ampD: 0.2, ampS: 0.6, ampR: 0.05, mono: true, glide: 0.05, drive: 0.45, keyTrack: 0.3 }) },
  { name: 'reese', category: 'bass', description: 'Detuned, moving drum and bass bass.',
    params: p({ osc1: 'saw', osc2: 'saw', osc2Detune: 22, oscMix: 0.5, unison: 3, spread: 18, sub: 0.45, cutoff: 900, resonance: 0.2, filterEnv: 0.05, ampS: 1, ampR: 0.1, lfoRate: 0.3, lfoCutoff: 0.25, mono: true, drive: 0.4 }) },
  { name: 'supersaw', category: 'lead', description: 'Wide, bright detuned lead.',
    params: p({ osc1: 'saw', osc2: 'saw', osc2Semi: 12, osc2Detune: 9, oscMix: 0.3, unison: 7, spread: 28, cutoff: 5200, resonance: 0.15, filterEnv: 0.15, ampA: 0.01, ampS: 0.85, ampR: 0.35, gain: 0.55, chorus: 0.2 }) },
  { name: 'square-lead', category: 'lead', description: 'Hollow, vintage mono lead.',
    params: p({ osc1: 'square', osc2: 'square', osc2Detune: 6, oscMix: 0.5, cutoff: 3200, resonance: 0.3, filterEnv: 0.2, ampS: 0.8, ampR: 0.15, mono: true, glide: 0.06, lfoRate: 5.5, lfoPitch: 6, gain: 0.6 }) },
  { name: 'pluck', category: 'pluck', description: 'Short, bright, percussive pluck.',
    params: p({ osc1: 'saw', osc2: 'square', osc2Semi: 12, oscMix: 0.25, cutoff: 600, resonance: 0.3, filterEnv: 0.55, fltD: 0.16, fltS: 0, ampD: 0.32, ampS: 0, ampR: 0.25, unison: 2, spread: 10, gain: 0.7, chorus: 0.15 }) },
  { name: 'warm-pad', category: 'pad', description: 'Slow, soft and wide chord pad.',
    params: p({ osc1: 'saw', osc2: 'triangle', osc2Semi: 12, oscMix: 0.45, unison: 4, spread: 20, cutoff: 1400, resonance: 0.1, filterEnv: 0.15, fltA: 0.8, fltD: 1.5, fltS: 0.5, ampA: 0.9, ampD: 1, ampS: 0.85, ampR: 1.6, lfoRate: 0.25, lfoCutoff: 0.2, gain: 0.5, chorus: 0.5 }) },
  { name: 'glass-pad', category: 'pad', description: 'Airy, shimmering FM pad.',
    params: p({ osc1: 'sine', osc2: 'sine', osc2Semi: 19, oscMix: 0.2, fm: 0.25, unison: 3, spread: 10, cutoff: 6000, resonance: 0, filterEnv: 0, ampA: 0.6, ampD: 1.5, ampS: 0.7, ampR: 2, lfoRate: 0.4, lfoPitch: 4, gain: 0.55, chorus: 0.35 }) },
  { name: 'e-piano', category: 'keys', description: 'Bell-toned FM electric piano.',
    params: p({ osc1: 'sine', osc2: 'sine', osc2Semi: 0, oscMix: 0.1, fm: 0.35, cutoff: 5000, resonance: 0, filterEnv: 0, ampA: 0.003, ampD: 1.2, ampS: 0.25, ampR: 0.5, lfoRate: 4.5, lfoPitch: 2, gain: 0.7, chorus: 0.35 }) },
  { name: 'grand-piano', category: 'keys', description: 'Recorded Steinway grand piano.',
    params: p({ osc1: 'piano', osc2: 'sine', oscMix: 0, cutoff: 16000, resonance: 0, filterEnv: 0, keyTrack: 0, ampA: 0.001, ampD: 1, ampS: 1, ampR: 0.35, drive: 0, gain: 0.85 }) },
  { name: 'soft-piano', category: 'keys', description: 'Mellow, felted piano that brightens as you play harder.',
    params: p({ osc1: 'piano', osc2: 'sine', oscMix: 0, cutoff: 1600, resonance: 0, filterEnv: 0.3, fltA: 0.001, fltD: 1.2, fltS: 0.35, keyTrack: 0.7, ampA: 0.002, ampD: 1, ampS: 1, ampR: 0.6, drive: 0, gain: 0.95, chorus: 0.15 }) },
  { name: 'lofi-piano', category: 'keys', description: 'Dusty, wobbly tape piano.',
    params: p({ osc1: 'piano', osc2: 'sine', oscMix: 0, cutoff: 2800, resonance: 0.1, filterEnv: 0, keyTrack: 0.4, ampA: 0.002, ampD: 1, ampS: 1, ampR: 0.4, lfoRate: 0.7, lfoPitch: 7, drive: 0.3, gain: 0.85, chorus: 0.4 }) },
  { name: 'sampler', category: 'keys', description: 'Plays your own recording across the keyboard. Record or load a sound in the Instrument Lab.',
    params: p({ osc1: 'sampler', osc2: 'sine', oscMix: 0, cutoff: 18000, resonance: 0, filterEnv: 0, keyTrack: 0, ampA: 0.002, ampD: 1, ampS: 1, ampR: 0.25, drive: 0, gain: 0.9 }) },
  { name: 'organ', category: 'keys', description: 'Drawbar-style organ.',
    params: p({ osc1: 'sine', osc2: 'sine', osc2Semi: 12, oscMix: 0.4, sub: 0.35, cutoff: 7000, resonance: 0, filterEnv: 0, ampA: 0.004, ampS: 1, ampR: 0.08, lfoRate: 6, lfoPitch: 3, drive: 0.2, gain: 0.55, chorus: 0.3 }) },
  { name: 'bell', category: 'pluck', description: 'Metallic FM bell.',
    params: p({ osc1: 'sine', osc2: 'sine', osc2Semi: 7, osc2Detune: 0, oscMix: 0.05, fm: 0.6, cutoff: 8000, filterEnv: 0, ampA: 0.002, ampD: 1.8, ampS: 0, ampR: 1.4, gain: 0.55, chorus: 0.2 }) },
  { name: 'chord-stab', category: 'keys', description: 'Classic house chord stab.',
    params: p({ osc1: 'saw', osc2: 'square', osc2Semi: 12, oscMix: 0.35, unison: 2, spread: 14, cutoff: 900, resonance: 0.35, filterEnv: 0.45, fltD: 0.2, fltS: 0.05, ampD: 0.35, ampS: 0.1, ampR: 0.2, gain: 0.6, chorus: 0.25 }) },
  { name: 'noise-riser', category: 'fx', description: 'Filtered noise sweep for builds.',
    params: p({ osc1: 'sine', oscMix: 0, noise: 0.9, cutoff: 800, resonance: 0.5, filterEnv: 0.6, fltA: 2, fltD: 2, fltS: 1, ampA: 1.5, ampS: 1, ampR: 1, gain: 0.4 }) },
]

export function synthPreset(name: string): SynthParams {
  return structuredClone((SYNTH_PRESETS.find((x) => x.name === name) ?? SYNTH_PRESETS[0]).params)
}

export const PAD_NAMES = ['kick', 'snare', 'clap', 'hat', 'openhat', 'tom', 'rim', 'perc'] as const
export type PadName = (typeof PAD_NAMES)[number]

export interface DrumKitDef {
  name: string
  description: string
}

export const DRUM_KITS: DrumKitDef[] = [
  { name: '808', description: 'Booming electronic kit.' },
  { name: 'punchy', description: 'Tight, modern club kit.' },
  { name: 'lofi', description: 'Dusty, warm, low-fidelity kit.' },
  { name: 'industrial', description: 'Harsh, metallic and distorted.' },
  ...SAMPLED_KITS.map((k) => ({ name: k.name, description: k.description })),
]

export function drumKit(kit: string): DrumPad[] {
  const sampled = SAMPLED_KITS.find((k) => k.name === kit)
  return PAD_NAMES.map((pad) => ({
    name: pad,
    sample: sampled ? sampled.pads[pad] : `factory:${kit}/${pad}`,
    tune: 0,
    decay: 1,
    // recorded kits are normalized a little lower than the synthesized ones
    gain: (pad === 'hat' || pad === 'openhat' ? 0.6 : pad === 'kick' ? 1 : 0.8) * (sampled && !sampled.pads[pad].startsWith('factory:') ? 1.2 : 1),
    pan: pad === 'hat' ? 0.15 : pad === 'openhat' ? 0.2 : pad === 'tom' ? -0.2 : pad === 'perc' ? -0.25 : 0,
    choke: pad === 'hat' || pad === 'openhat' ? 1 : undefined,
  }))
}

/** Named drum lines, usable from code as e.g.  kick four-on-floor */
export const DRUM_LINES: Record<string, string> = {
  'four-on-floor': 'x...x...x...x...',
  backbeat: '....x.......x...',
  offbeat: '..x...x...x...x.',
  sixteenths: 'xxxxxxxxxxxxxxxx',
  eighths: 'x.x.x.x.x.x.x.x.',
  'dnb-kick': 'x.........x.....',
  'dnb-snare': '....x.......x...',
  breakbeat: 'x.....x...x.....',
  'trap-hats': 'x.x.x.x.xxx.x.x.',
  shuffle: 'x..x..x..x..x..x',
  clave: 'x..x..x...x.x...',
  'half-time': '........x.......',
}
