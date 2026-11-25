// Smart controls and performance macros: musical controls that each move several
// underlying parameters. The mappings are data, so the Instrument Lab can show them.

import type { EngineMaster, EngineSong, EngineTrackParams } from '../engine/protocol'
import type { DrumPad, MacroParam, PerfMacro, Project, SmartName, SynthParams, Track } from './types'
import { SMART_CONTROLS } from './types'

export interface SmartMapping {
  /** "synth.<param>", "mix.<param>", "perf.<humanize|chaos|density>", "pads.<pad|*>.<param>" */
  target: string
  amount: number
  /** "lin" adds amount × s, "oct" multiplies by 2^(amount × s), "int" adds a rounded amount × s. s runs -1..1 across the knob. */
  curve: 'lin' | 'oct' | 'int'
}

export interface SmartControlDef {
  name: SmartName
  label: string
  hint: string
  synth: SmartMapping[]
  drums: SmartMapping[]
}

export const SMART_DEFS: SmartControlDef[] = [
  {
    name: 'warmth', label: 'Warmth', hint: 'Rounder and fuller: softens highs, adds body and gentle saturation.',
    synth: [
      { target: 'synth.cutoff', amount: -1.2, curve: 'oct' },
      { target: 'synth.sub', amount: 0.35, curve: 'lin' },
      { target: 'synth.drive', amount: 0.3, curve: 'lin' },
      { target: 'synth.resonance', amount: -0.12, curve: 'lin' },
    ],
    drums: [
      { target: 'mix.tone', amount: -0.3, curve: 'lin' },
      { target: 'mix.drive', amount: 0.3, curve: 'lin' },
      { target: 'pads.hat.gain', amount: -0.2, curve: 'lin' },
      { target: 'pads.kick.decay', amount: 0.2, curve: 'lin' },
    ],
  },
  {
    name: 'brightness', label: 'Brightness', hint: 'Opens the filter and adds sparkle at the top.',
    synth: [
      { target: 'synth.cutoff', amount: 2, curve: 'oct' },
      { target: 'synth.resonance', amount: 0.12, curve: 'lin' },
      { target: 'synth.filterEnv', amount: 0.15, curve: 'lin' },
    ],
    drums: [
      { target: 'mix.tone', amount: 0.25, curve: 'lin' },
      { target: 'pads.hat.gain', amount: 0.25, curve: 'lin' },
      { target: 'pads.openhat.gain', amount: 0.2, curve: 'lin' },
      { target: 'pads.*.tune', amount: 2, curve: 'lin' },
    ],
  },
  {
    name: 'movement', label: 'Movement', hint: 'Adds rhythmic variation and modulation, so the part breathes.',
    synth: [
      { target: 'synth.lfoCutoff', amount: 0.45, curve: 'lin' },
      { target: 'synth.lfoRate', amount: 1.5, curve: 'oct' },
      { target: 'synth.filterEnv', amount: 0.2, curve: 'lin' },
      { target: 'synth.lfoPitch', amount: 4, curve: 'lin' },
    ],
    drums: [
      { target: 'perf.humanize', amount: 0.7, curve: 'lin' },
      { target: 'perf.density', amount: 0.25, curve: 'lin' },
      { target: 'pads.openhat.decay', amount: 0.25, curve: 'lin' },
    ],
  },
  {
    name: 'space', label: 'Space', hint: 'Places the sound further away with reverb, echo and longer tails.',
    synth: [
      { target: 'mix.sendReverb', amount: 0.45, curve: 'lin' },
      { target: 'mix.sendDelay', amount: 0.3, curve: 'lin' },
      { target: 'synth.ampR', amount: 1.5, curve: 'oct' },
      { target: 'synth.spread', amount: 10, curve: 'lin' },
    ],
    drums: [
      { target: 'mix.sendReverb', amount: 0.35, curve: 'lin' },
      { target: 'mix.sendDelay', amount: 0.15, curve: 'lin' },
    ],
  },
  {
    name: 'energy', label: 'Energy', hint: 'Punchier, louder and more driven.',
    synth: [
      { target: 'mix.drive', amount: 0.35, curve: 'lin' },
      { target: 'synth.ampA', amount: -2, curve: 'oct' },
      { target: 'synth.filterEnv', amount: 0.25, curve: 'lin' },
      { target: 'synth.gain', amount: 0.12, curve: 'lin' },
    ],
    drums: [
      { target: 'mix.drive', amount: 0.4, curve: 'lin' },
      { target: 'pads.kick.gain', amount: 0.2, curve: 'lin' },
      { target: 'pads.snare.gain', amount: 0.15, curve: 'lin' },
      { target: 'perf.density', amount: 0.3, curve: 'lin' },
    ],
  },
  {
    name: 'texture', label: 'Texture', hint: 'Grit, width and complexity in the tone.',
    synth: [
      { target: 'synth.noise', amount: 0.2, curve: 'lin' },
      { target: 'synth.unison', amount: 3, curve: 'int' },
      { target: 'synth.spread', amount: 14, curve: 'lin' },
      { target: 'synth.fm', amount: 0.25, curve: 'lin' },
    ],
    drums: [
      { target: 'pads.*.decay', amount: 0.25, curve: 'lin' },
      { target: 'perf.chaos', amount: 0.25, curve: 'lin' },
      { target: 'pads.perc.gain', amount: 0.2, curve: 'lin' },
    ],
  },
]

const SYNTH_RANGES: Partial<Record<keyof SynthParams, [number, number, number, number]>> = {
  // [guarded min, guarded max, free min, free max]
  cutoff: [60, 14000, 20, 20000],
  resonance: [0, 0.85, 0, 0.98],
  drive: [0, 0.75, 0, 1],
  sub: [0, 0.8, 0, 1],
  noise: [0, 0.6, 0, 1],
  fm: [0, 0.8, 0, 1],
  filterEnv: [-1, 1, -1, 1],
  lfoCutoff: [0, 0.8, 0, 1],
  lfoRate: [0.05, 12, 0.01, 40],
  lfoPitch: [0, 25, 0, 1200],
  ampA: [0.001, 4, 0.0005, 10],
  ampR: [0.01, 6, 0.005, 12],
  spread: [0, 45, 0, 100],
  unison: [1, 7, 1, 7],
  gain: [0, 1.2, 0, 2],
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))

interface Working {
  synth?: SynthParams
  pads?: DrumPad[]
  mix: { volume: number; pan: number; sendDelay: number; sendReverb: number; drive: number; tone: number; duck: number }
  perf: { humanize: number; chaos: number; density: number }
}

function applyMapping(w: Working, m: SmartMapping, s: number) {
  const parts = m.target.split('.')
  const apply = (obj: Record<string, unknown>, key: string) => {
    const cur = obj[key]
    if (typeof cur !== 'number') return
    if (m.curve === 'oct') obj[key] = cur * Math.pow(2, m.amount * s)
    else if (m.curve === 'int') obj[key] = cur + Math.round(m.amount * s)
    else obj[key] = cur + m.amount * s
  }
  if (parts[0] === 'synth' && w.synth) apply(w.synth as unknown as Record<string, unknown>, parts[1])
  else if (parts[0] === 'mix') apply(w.mix, parts[1])
  else if (parts[0] === 'perf') apply(w.perf, parts[1])
  else if (parts[0] === 'pads' && w.pads) {
    for (const pad of w.pads) if (parts[1] === '*' || pad.name === parts[1]) apply(pad as unknown as Record<string, unknown>, parts[2])
  }
}

function macroMatches(target: string, t: Track): boolean {
  return target === '*' || target === t.id || (target === '*drums' && t.kind === 'drums') || (target === '*synth' && t.kind === 'synth')
}

/** Sum of active performance-macro offsets for one track parameter. */
function macroOffset(macros: PerfMacro[], t: Track, param: MacroParam): number {
  let o = 0
  for (const m of macros) {
    if (m.value <= 0) continue
    for (const tg of m.targets) if (tg.param === param && macroMatches(tg.track, t)) o += tg.amount * m.value
  }
  return o
}

/** Apply smart controls, performance macros and guardrails to get playable parameters. */
export function resolveTrack(project: Project, t: Track, anySolo: boolean): EngineTrackParams {
  const guarded = project.guardrails
  const w: Working = {
    synth: t.synth ? { ...t.synth } : undefined,
    pads: t.pads ? t.pads.map((p) => ({ ...p })) : undefined,
    mix: { volume: t.mix.volume, pan: t.mix.pan, sendDelay: t.mix.sendDelay, sendReverb: t.mix.sendReverb, drive: t.mix.drive, tone: t.mix.tone, duck: t.mix.duck },
    perf: { humanize: 0, chaos: 0, density: 0 },
  }
  for (const def of SMART_DEFS) {
    const v = clamp(t.smart[def.name] + macroOffset(project.macros, t, `smart.${def.name}`), 0, 1)
    const s = (v - 0.5) * 2
    if (s === 0) continue
    for (const m of t.kind === 'synth' ? def.synth : def.drums) applyMapping(w, m, s)
  }
  for (const k of ['volume', 'pan', 'sendDelay', 'sendReverb', 'drive', 'tone', 'duck'] as const) {
    w.mix[k] += macroOffset(project.macros, t, k)
  }
  w.perf.chaos += macroOffset(project.macros, t, 'chaos')
  w.perf.density += macroOffset(project.macros, t, 'density')
  if (w.synth) {
    w.synth.cutoff *= Math.pow(2, macroOffset(project.macros, t, 'cutoff') * 4)
    w.synth.resonance += macroOffset(project.macros, t, 'resonance')
    for (const [k, r] of Object.entries(SYNTH_RANGES) as [keyof SynthParams, number[]][]) {
      const v = w.synth[k]
      if (typeof v === 'number') (w.synth as unknown as Record<string, number>)[k] = clamp(v, guarded ? r[0] : r[2], guarded ? r[1] : r[3])
    }
    w.synth.unison = Math.round(w.synth.unison)
  }
  if (w.pads) for (const p of w.pads) { p.gain = clamp(p.gain, 0, 1.5); p.decay = clamp(p.decay, 0.02, 1); p.tune = clamp(p.tune, -24, 24) }
  const audible = !t.mix.mute && (!anySolo || t.mix.solo)
  // Fader law: perceptual curve, unity at 0.8.
  const fader = clamp(w.mix.volume, 0, 1)
  const gain = audible ? Math.pow(fader / 0.8, 2) : 0
  return {
    id: t.id,
    kind: t.kind,
    synth: w.synth,
    pads: w.pads,
    volume: clamp(gain, 0, guarded ? 1.3 : 2),
    pan: clamp(w.mix.pan, -1, 1),
    sendDelay: clamp(w.mix.sendDelay, 0, 1),
    sendReverb: clamp(w.mix.sendReverb, 0, 1),
    drive: clamp(w.mix.drive, 0, 1),
    tone: clamp(w.mix.tone, -1, 1),
    duck: clamp(w.mix.duck, 0, 1),
    humanize: clamp(w.perf.humanize, 0, 1),
    chaos: clamp(w.perf.chaos, 0, 1),
    density: clamp(w.perf.density, 0, 1),
  }
}

export function resolveMaster(project: Project): EngineMaster {
  let fb = project.master.delayFeedback
  let size = project.master.reverbSize
  for (const m of project.macros) {
    if (m.value <= 0) continue
    for (const tg of m.targets) {
      if (tg.track !== 'master') continue
      if (tg.param === 'master.delayFeedback') fb += tg.amount * m.value
      if (tg.param === 'master.reverbSize') size += tg.amount * m.value
    }
  }
  return {
    volume: clamp(project.master.volume, 0, 1.2),
    delayTime: project.master.delayTime,
    delayFeedback: clamp(fb, 0, project.guardrails ? 0.85 : 0.97),
    reverbSize: clamp(size, 0, 1),
  }
}

export function resolveAll(project: Project): { tracks: EngineTrackParams[]; master: EngineMaster } {
  const anySolo = project.tracks.some((t) => t.mix.solo)
  return { tracks: project.tracks.map((t) => resolveTrack(project, t, anySolo)), master: resolveMaster(project) }
}

export function compileSong(project: Project): EngineSong {
  return {
    bpm: project.bpm,
    swing: project.swing,
    tracks: project.tracks.map((t) => ({
      id: t.id,
      clips: t.clips.map((c) => ({
        id: c.id,
        length: Math.max(1, c.length),
        notes: [...c.notes].filter((n) => n.step < c.length).sort((a, b) => a.step - b.step),
      })),
    })),
    scenes: project.scenes.map((s) => ({ id: s.id, slots: { ...s.slots } })),
    arrangement: project.arrangement.map((a) => ({ ...a })),
  }
}

export const DEFAULT_MACROS = (): PerfMacro[] => [
  {
    id: 'build', name: 'Build', value: 0,
    targets: [
      { track: '*', param: 'tone', amount: 0.45 },
      { track: '*', param: 'sendReverb', amount: 0.35 },
      { track: 'master', param: 'master.delayFeedback', amount: 0.3 },
      { track: '*drums', param: 'density', amount: 0.8 },
      { track: '*synth', param: 'cutoff', amount: 0.4 },
    ],
  },
  {
    id: 'drop', name: 'Drop', value: 0,
    targets: [
      { track: '*', param: 'sendReverb', amount: -0.3 },
      { track: '*synth', param: 'duck', amount: 0.5 },
      { track: '*drums', param: 'smart.energy', amount: 0.4 },
      { track: '*synth', param: 'smart.warmth', amount: 0.25 },
    ],
  },
  {
    id: 'atmosphere', name: 'Atmosphere', value: 0,
    targets: [
      { track: '*', param: 'sendReverb', amount: 0.5 },
      { track: '*', param: 'sendDelay', amount: 0.4 },
      { track: '*synth', param: 'smart.movement', amount: 0.4 },
      { track: 'master', param: 'master.reverbSize', amount: 0.35 },
    ],
  },
  {
    id: 'chaos', name: 'Chaos', value: 0,
    targets: [
      { track: '*', param: 'chaos', amount: 0.8 },
      { track: '*synth', param: 'smart.texture', amount: 0.35 },
    ],
  },
]

export const neutralSmart = (): Record<SmartName, number> =>
  Object.fromEntries(SMART_CONTROLS.map((n) => [n, 0.5])) as Record<SmartName, number>
