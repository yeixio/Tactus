import { DEFAULT_MACROS, neutralSmart } from './sound'
import { drumKit, synthPreset } from './presets'
import { formatGenCall, parseGenCall, runGen } from './generate'
import { parseKey, progressionInKey, PROGRESSIONS } from './theory'
import type { Clip, Key, MixParams, Project, Scene, SmartName, Track, TrackKind } from './types'
import { SCHEMA_VERSION } from './types'

let counter = 0
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e6
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
}

export const TRACK_COLORS = ['#ff6b4a', '#ffb627', '#3ec7a1', '#4aa8ff', '#b07cff', '#ff5fa2', '#9bd94a', '#59d2e8']

export const defaultMix = (kind: TrackKind): MixParams => ({
  volume: 0.8, pan: 0, mute: false, solo: false,
  sendDelay: kind === 'synth' ? 0.1 : 0, sendReverb: kind === 'synth' ? 0.15 : 0.05,
  drive: 0, tone: 0, duck: 0,
})

export function makeTrack(kind: TrackKind, preset: string, name: string, index: number): Track {
  return {
    id: uid('trk'),
    name,
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    kind,
    preset,
    synth: kind === 'synth' ? synthPreset(preset) : undefined,
    pads: kind === 'drums' ? drumKit(preset) : undefined,
    smart: neutralSmart(),
    mix: defaultMix(kind),
    clips: [],
  }
}

export function makeClip(name: string, bars = 1): Clip {
  return { id: uid('clp'), name, length: bars * 16, notes: [] }
}

export function emptyProject(name = 'Untitled'): Project {
  const now = new Date().toISOString()
  return {
    schema: SCHEMA_VERSION,
    id: uid('prj'),
    name,
    bpm: 120,
    swing: 0,
    key: { root: 9, scale: 'minor' },
    guardrails: true,
    tracks: [],
    scenes: [],
    arrangement: [],
    macros: DEFAULT_MACROS(),
    master: { volume: 0.85, delayTime: 3, delayFeedback: 0.35, reverbSize: 0.6 },
    midi: [],
    createdAt: now,
    updatedAt: now,
  }
}

// ---------------------------------------------------------------------------------------------
// Starting points

interface TplTrack {
  name: string
  kind: TrackKind
  preset: string
  smart?: Partial<Record<SmartName, number>>
  mix?: Partial<MixParams>
  clips: { name: string; bars: number; gen: string }[]
}

export interface Template {
  id: string
  title: string
  blurb: string
  emoji: string
  bpm: number
  key: string
  swing?: number
  codeFirst?: boolean
  tracks: (k: Key, seed: number) => TplTrack[]
  scenes: { name: string; clips: Record<string, string> }[]
  arrangement: [string, number][]
}

const P = (k: Key, i: number) => progressionInKey(k, PROGRESSIONS[i].degrees)

export const TEMPLATES: Template[] = [
  {
    id: 'deep-house', title: 'Deep house', blurb: 'Warm chords, rolling bass, four-on-the-floor.', emoji: '🌇', bpm: 122, key: 'A minor', swing: 0.08,
    tracks: (k, s) => [
      { name: 'Drums', kind: 'drums', preset: 'punchy', clips: [
        { name: 'Groove', bars: 2, gen: `drums(house, ${s})` },
        { name: 'Kick only', bars: 1, gen: 'euclid(4, 16, kick)' },
      ] },
      { name: 'Bass', kind: 'synth', preset: 'analog-bass', mix: { duck: 0.45 }, smart: { warmth: 0.6 }, clips: [
        { name: 'Offbeat', bars: 4, gen: `bass("${P(k, 3)}", offbeat, ${s})` },
        { name: 'Rolling', bars: 4, gen: `bass("${P(k, 3)}", root, ${s})` },
      ] },
      { name: 'Chords', kind: 'synth', preset: 'chord-stab', mix: { duck: 0.3, sendDelay: 0.25 }, clips: [
        { name: 'Stabs', bars: 4, gen: `chords("${P(k, 3)}", stab)` },
        { name: 'Pad', bars: 4, gen: `chords("${P(k, 3)}", pad)` },
      ] },
      { name: 'Keys', kind: 'synth', preset: 'e-piano', mix: { sendReverb: 0.3, volume: 0.65 }, clips: [
        { name: 'Melody', bars: 4, gen: `melody(${s}, 0.4, 5)` },
      ] },
    ],
    scenes: [
      { name: 'Intro', clips: { Drums: 'Kick only', Chords: 'Pad' } },
      { name: 'Groove', clips: { Drums: 'Groove', Bass: 'Offbeat', Chords: 'Pad' } },
      { name: 'Main', clips: { Drums: 'Groove', Bass: 'Rolling', Chords: 'Stabs', Keys: 'Melody' } },
      { name: 'Breakdown', clips: { Chords: 'Pad', Keys: 'Melody' } },
    ],
    arrangement: [['Intro', 4], ['Groove', 8], ['Main', 8], ['Breakdown', 4], ['Main', 8]],
  },
  {
    id: 'ambient', title: 'Ambient soundscape', blurb: 'Slow pads, glassy bells, lots of space.', emoji: '🌌', bpm: 80, key: 'D major',
    tracks: (k, s) => [
      { name: 'Pad', kind: 'synth', preset: 'warm-pad', smart: { space: 0.75, movement: 0.65 }, mix: { sendReverb: 0.45 }, clips: [
        { name: 'Drift', bars: 4, gen: `chords("${P(k, 4)}", pad)` },
      ] },
      { name: 'Bells', kind: 'synth', preset: 'bell', smart: { space: 0.8 }, mix: { sendDelay: 0.45, volume: 0.6 }, clips: [
        { name: 'Sparse', bars: 4, gen: `melody(${s}, 0.2, 5)` },
        { name: 'Arp', bars: 4, gen: `arp("${P(k, 4)}", random, ${s})` },
      ] },
      { name: 'Sub', kind: 'synth', preset: 'sub-bass', clips: [
        { name: 'Roots', bars: 4, gen: `bass("${P(k, 4)}", walk, ${s})` },
      ] },
      { name: 'Pulse', kind: 'drums', preset: 'lofi', smart: { space: 0.8 }, mix: { volume: 0.6 }, clips: [
        { name: 'Heartbeat', bars: 2, gen: `drums(ambient, ${s})` },
      ] },
    ],
    scenes: [
      { name: 'Dawn', clips: { Pad: 'Drift' } },
      { name: 'Bloom', clips: { Pad: 'Drift', Bells: 'Sparse', Sub: 'Roots' } },
      { name: 'Glow', clips: { Pad: 'Drift', Bells: 'Arp', Sub: 'Roots', Pulse: 'Heartbeat' } },
    ],
    arrangement: [['Dawn', 4], ['Bloom', 8], ['Glow', 8], ['Bloom', 4], ['Dawn', 4]],
  },
  {
    id: 'dnb', title: 'Drum and bass groove', blurb: 'Fast breaks and a moving reese bass.', emoji: '⚡', bpm: 172, key: 'F minor',
    tracks: (k, s) => [
      { name: 'Drums', kind: 'drums', preset: 'punchy', smart: { energy: 0.65 }, clips: [
        { name: 'Break', bars: 2, gen: `drums(dnb, ${s})` },
        { name: 'Halftime', bars: 2, gen: `drums(breakbeat, ${s})` },
      ] },
      { name: 'Reese', kind: 'synth', preset: 'reese', mix: { duck: 0.25 }, clips: [
        { name: 'Long', bars: 4, gen: `bass("${P(k, 3)}", walk, ${s})` },
        { name: 'Busy', bars: 4, gen: `bass("${P(k, 3)}", acid, ${s})` },
      ] },
      { name: 'Pads', kind: 'synth', preset: 'glass-pad', smart: { space: 0.7 }, clips: [
        { name: 'Atmos', bars: 4, gen: `chords("${P(k, 3)}", pad)` },
      ] },
      { name: 'Lead', kind: 'synth', preset: 'square-lead', mix: { volume: 0.6, sendDelay: 0.3 }, clips: [
        { name: 'Hook', bars: 4, gen: `melody(${s}, 0.55, 5)` },
      ] },
    ],
    scenes: [
      { name: 'Intro', clips: { Pads: 'Atmos', Drums: 'Halftime' } },
      { name: 'Roller', clips: { Drums: 'Break', Reese: 'Long', Pads: 'Atmos' } },
      { name: 'Drop', clips: { Drums: 'Break', Reese: 'Busy', Lead: 'Hook' } },
    ],
    arrangement: [['Intro', 8], ['Roller', 8], ['Drop', 16], ['Intro', 4], ['Drop', 8]],
  },
  {
    id: 'lofi', title: 'Lo-fi beat', blurb: 'Dusty drums, mellow keys, lazy swing.', emoji: '☕', bpm: 84, key: 'E minor', swing: 0.2,
    tracks: (k, s) => [
      { name: 'Drums', kind: 'drums', preset: 'lofi', smart: { warmth: 0.75 }, clips: [
        { name: 'Boom bap', bars: 2, gen: `drums(hiphop, ${s})` },
      ] },
      { name: 'Keys', kind: 'synth', preset: 'e-piano', smart: { warmth: 0.7 }, mix: { sendReverb: 0.3 }, clips: [
        { name: 'Chords', bars: 4, gen: `chords("${P(k, 2)}", pad)` },
      ] },
      { name: 'Bass', kind: 'synth', preset: 'sub-bass', clips: [
        { name: 'Walk', bars: 4, gen: `bass("${P(k, 2)}", walk, ${s})` },
      ] },
      { name: 'Melody', kind: 'synth', preset: 'pluck', mix: { volume: 0.6, sendDelay: 0.35 }, clips: [
        { name: 'Line', bars: 4, gen: `melody(${s}, 0.35, 5)` },
      ] },
    ],
    scenes: [
      { name: 'Keys only', clips: { Keys: 'Chords' } },
      { name: 'Beat', clips: { Drums: 'Boom bap', Keys: 'Chords', Bass: 'Walk' } },
      { name: 'Full', clips: { Drums: 'Boom bap', Keys: 'Chords', Bass: 'Walk', Melody: 'Line' } },
    ],
    arrangement: [['Keys only', 4], ['Beat', 8], ['Full', 8], ['Beat', 4]],
  },
  {
    id: 'techno', title: 'Hypnotic techno', blurb: 'Driving kick, acid line, rumble.', emoji: '🔩', bpm: 132, key: 'G minor',
    tracks: (k, s) => [
      { name: 'Drums', kind: 'drums', preset: 'industrial', clips: [
        { name: 'Drive', bars: 2, gen: `drums(techno, ${s})` },
        { name: 'Kick', bars: 1, gen: 'euclid(4, 16, kick)' },
      ] },
      { name: 'Acid', kind: 'synth', preset: 'acid', mix: { sendDelay: 0.2, duck: 0.3 }, clips: [
        { name: 'Line', bars: 2, gen: `bass("${P(k, 5)}", acid, ${s})` },
      ] },
      { name: 'Rumble', kind: 'synth', preset: 'sub-bass', mix: { duck: 0.7, volume: 0.7 }, clips: [
        { name: 'Pulse', bars: 1, gen: `bass("${P(k, 5)}", offbeat, ${s})` },
      ] },
      { name: 'Stab', kind: 'synth', preset: 'chord-stab', smart: { space: 0.75 }, clips: [
        { name: 'Hits', bars: 4, gen: `chords("${P(k, 5)}", offbeat)` },
      ] },
    ],
    scenes: [
      { name: 'Kick', clips: { Drums: 'Kick', Rumble: 'Pulse' } },
      { name: 'Groove', clips: { Drums: 'Drive', Rumble: 'Pulse' } },
      { name: 'Acid', clips: { Drums: 'Drive', Rumble: 'Pulse', Acid: 'Line' } },
      { name: 'Peak', clips: { Drums: 'Drive', Rumble: 'Pulse', Acid: 'Line', Stab: 'Hits' } },
    ],
    arrangement: [['Kick', 8], ['Groove', 8], ['Acid', 16], ['Peak', 16], ['Groove', 8]],
  },
  {
    id: 'synthwave', title: 'Synthwave drive', blurb: 'Neon arps, big pads, gated drums.', emoji: '🌆', bpm: 104, key: 'C minor',
    tracks: (k, s) => [
      { name: 'Drums', kind: 'drums', preset: '808', smart: { space: 0.65 }, clips: [
        { name: 'Beat', bars: 2, gen: `drums(breakbeat, ${s})` },
      ] },
      { name: 'Arp', kind: 'synth', preset: 'pluck', mix: { sendDelay: 0.35 }, clips: [
        { name: 'Up', bars: 4, gen: `arp("${P(k, 1)}", up, ${s})` },
      ] },
      { name: 'Pad', kind: 'synth', preset: 'supersaw', mix: { volume: 0.55 }, smart: { warmth: 0.7 }, clips: [
        { name: 'Wall', bars: 4, gen: `chords("${P(k, 1)}", pad)` },
      ] },
      { name: 'Bass', kind: 'synth', preset: 'analog-bass', clips: [
        { name: 'Eighths', bars: 4, gen: `bass("${P(k, 1)}", octave, ${s})` },
      ] },
    ],
    scenes: [
      { name: 'Intro', clips: { Arp: 'Up', Pad: 'Wall' } },
      { name: 'Drive', clips: { Drums: 'Beat', Arp: 'Up', Bass: 'Eighths' } },
      { name: 'Chorus', clips: { Drums: 'Beat', Arp: 'Up', Bass: 'Eighths', Pad: 'Wall' } },
    ],
    arrangement: [['Intro', 4], ['Drive', 8], ['Chorus', 8], ['Drive', 4], ['Chorus', 8]],
  },
  {
    id: 'algorithm', title: 'Write a musical algorithm', blurb: 'Start in code: generators, euclidean rhythms, live updates.', emoji: '⌨️', bpm: 118, key: 'C dorian', codeFirst: true,
    tracks: (_k, s) => [
      { name: 'Perc', kind: 'drums', preset: 'punchy', clips: [
        { name: 'Euclid', bars: 1, gen: 'euclid(5, 16, kick)' },
      ] },
      { name: 'Seq', kind: 'synth', preset: 'pluck', clips: [
        { name: 'Pattern', bars: 2, gen: `melody(${s}, 0.6, 4)` },
      ] },
    ],
    scenes: [{ name: 'Loop', clips: { Perc: 'Euclid', Seq: 'Pattern' } }],
    arrangement: [['Loop', 8]],
  },
]

export const MOODS: { id: string; label: string; apply: (key: Key, bpm: number) => { key: Key; bpm: number; space: number } }[] = [
  { id: 'none', label: 'As designed', apply: (key, bpm) => ({ key, bpm, space: 0.5 }) },
  { id: 'dreamy', label: 'Dreamy', apply: (key, bpm) => ({ key: { root: key.root, scale: key.scale === 'major' ? 'lydian' : 'dorian' }, bpm: bpm - 4, space: 0.75 }) },
  { id: 'dark', label: 'Dark', apply: (key, bpm) => ({ key: { root: key.root, scale: 'phrygian' }, bpm, space: 0.55 }) },
  { id: 'uplifting', label: 'Uplifting', apply: (key, bpm) => ({ key: { root: key.root, scale: 'major' }, bpm: bpm + 4, space: 0.55 }) },
  { id: 'energetic', label: 'Energetic', apply: (key, bpm) => ({ key, bpm: bpm + 8, space: 0.4 }) },
  { id: 'chill', label: 'Chill', apply: (key, bpm) => ({ key, bpm: bpm - 10, space: 0.65 }) },
]

export function projectFromTemplate(tpl: Template, opts: { mood?: string; seed?: number } = {}): Project {
  const p = emptyProject(tpl.title)
  const seed = opts.seed ?? 1
  const baseKey = parseKey(tpl.key) ?? p.key
  const mood = MOODS.find((m) => m.id === (opts.mood ?? 'none')) ?? MOODS[0]
  const { key, bpm, space } = mood.apply(baseKey, tpl.bpm)
  p.key = key
  p.bpm = bpm
  p.swing = tpl.swing ?? 0
  const defs = tpl.tracks(key, seed)
  p.tracks = defs.map((d, i) => {
    const t = makeTrack(d.kind, d.preset, d.name, i)
    Object.assign(t.smart, d.smart ?? {})
    if (space !== 0.5) t.smart.space = Math.min(1, Math.max(0, t.smart.space + (space - 0.5)))
    Object.assign(t.mix, d.mix ?? {})
    t.clips = d.clips.map((c) => {
      const clip = makeClip(c.name, c.bars)
      const gen = formatGenCall(parseGenCall(c.gen))
      clip.gen = gen
      clip.notes = runGen(gen, { key, length: clip.length, kind: d.kind })
      return clip
    })
    return t
  })
  const byName = (track: string, clip: string) => {
    const t = p.tracks.find((x) => x.name === track)
    return t ? { t: t.id, c: t.clips.find((c) => c.name === clip)?.id ?? null } : null
  }
  p.scenes = tpl.scenes.map((s): Scene => {
    const slots: Record<string, string | null> = {}
    for (const t of p.tracks) slots[t.id] = null
    for (const [tn, cn] of Object.entries(s.clips)) {
      const r = byName(tn, cn)
      if (r) slots[r.t] = r.c
    }
    return { id: uid('scn'), name: s.name, slots }
  })
  p.arrangement = tpl.arrangement
    .map(([name, bars]) => ({ scene: p.scenes.find((s) => s.name === name)?.id ?? '', bars }))
    .filter((a) => a.scene)
  return p
}

export function blankProject(): Project {
  const p = emptyProject('Untitled')
  const drums = makeTrack('drums', 'punchy', 'Drums', 0)
  drums.clips = [makeClip('Beat', 1)]
  const bass = makeTrack('synth', 'analog-bass', 'Bass', 1)
  bass.clips = [makeClip('Line', 2)]
  const keys = makeTrack('synth', 'e-piano', 'Keys', 2)
  keys.clips = [makeClip('Chords', 4)]
  p.tracks = [drums, bass, keys]
  p.scenes = [{ id: uid('scn'), name: 'Scene 1', slots: { [drums.id]: drums.clips[0].id, [bass.id]: bass.clips[0].id, [keys.id]: keys.clips[0].id } }]
  p.arrangement = [{ scene: p.scenes[0].id, bars: 8 }]
  return p
}

/** Upgrade older/partial project files to the current schema. */
export function migrateProject(raw: unknown): Project {
  const p = raw as Project
  if (!p || typeof p !== 'object' || !Array.isArray(p.tracks)) throw new Error('This file is not a project.')
  if ((p.schema ?? 0) > SCHEMA_VERSION) throw new Error(`This project was made by a newer version (schema ${p.schema}).`)
  const base = emptyProject(p.name)
  const out: Project = { ...base, ...p, schema: SCHEMA_VERSION }
  out.master = { ...base.master, ...(p.master ?? {}) }
  out.macros = p.macros?.length ? p.macros : base.macros
  out.midi = p.midi ?? []
  for (const t of out.tracks) {
    t.smart = { ...neutralSmart(), ...(t.smart ?? {}) }
    t.mix = { ...defaultMix(t.kind), ...(t.mix ?? {}) }
    if (t.kind === 'synth') t.synth = { ...synthPreset(t.preset), ...(t.synth ?? {}) }
    if (t.kind === 'drums' && !t.pads) t.pads = drumKit(t.preset)
  }
  return out
}

/** Total arrangement length in bars. */
export function songBars(p: Project): number {
  return p.arrangement.reduce((a, b) => a + b.bars, 0)
}
