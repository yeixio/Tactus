// Turns parsed code into the canonical project, keeping the ids of tracks, clips and scenes
// that still exist (matched by name) so playback and selection carry over on live updates.

import type { Diagnostic, Tok } from './lexer'
import { parseFile, type PClip, type PSong, type PTrack } from './parser'
import { INSTRUMENTS } from '../model/soundpack'
import { DRUM_LINES, PAD_NAMES, SYNTH_PRESETS, drumKit, synthPreset, DRUM_KITS } from '../model/presets'
import { GenError, runGen, parseGenCall, formatGenCall } from '../model/generate'
import { parseKey, parseNote } from '../model/theory'
import { SMART_CONTROLS, type Clip, type Note, type Project, type SmartName, type SynthParams, type Track } from '../model/types'
import { defaultMix, makeTrack, uid, TRACK_COLORS } from '../model/project'
import { neutralSmart } from '../model/sound'

export interface SourceFile {
  name: string
  source: string
}

export interface BuildResult {
  project: Project | null
  diagnostics: Diagnostic[]
  /** For each clip id, where it is defined in the code (for "reveal source"). */
  sourceMap: Record<string, { file: string; line: number }>
}

const SYNTH_KEYS = Object.keys(SYNTH_PRESETS[0].params) as (keyof SynthParams)[]
const WAVES = ['saw', 'square', 'triangle', 'sine']
export const MIX_KEYS: Record<string, keyof Track['mix']> = {
  volume: 'volume', pan: 'pan', reverb: 'sendReverb', delay: 'sendDelay', saturation: 'drive', tone: 'tone', duck: 'duck',
}

/** Parse one step pattern for a synth clip: "A1 ~ . C2! E2@0.6 A1+C2+E2 |" */
export function parseSynthPattern(pat: string, length: number, onError: (msg: string) => void): Note[] {
  const toks = pat.split(/\s+/).filter((t) => t && t !== '|')
  const out: Note[] = []
  let last: Note[] = []
  toks.forEach((t, step) => {
    if (step >= length) return
    if (t === '.' || t === '-') { last = []; return }
    if (t === '~' || t === '_') { for (const n of last) n.len++; return }
    const notes: Note[] = []
    for (const part of t.split('+')) {
      const m = /^([A-Ga-g][#b]?-?\d)([!?]|@(\d*\.?\d+))?$/.exec(part)
      const pitch = m ? parseNote(m[1]) : null
      if (!m || pitch === null) { onError(`"${part}" is not a note. Use names like A1, C#3, rests (.) or ties (~).`); continue }
      const vel = m[2] === '!' ? 1 : m[2] === '?' ? 0.5 : m[3] ? Math.min(1, parseFloat(m[3])) : 0.8
      notes.push({ step, pitch, len: 1, vel })
    }
    out.push(...notes)
    last = notes
  })
  if (toks.length > length) onError(`This pattern has ${toks.length} steps but the clip is ${length} steps long; extra steps are ignored.`)
  return out
}

export function parseDrumLine(pat: string, pad: number, length: number): Note[] {
  const line = (DRUM_LINES[pat] ?? pat).replace(/[\s|]/g, '')
  const out: Note[] = []
  for (let s = 0; s < length; s++) {
    const ch = line[s % line.length]
    if (ch === 'x') out.push({ step: s, pitch: pad, len: 1, vel: 0.8 })
    else if (ch === 'X') out.push({ step: s, pitch: pad, len: 1, vel: 1 })
    else if (ch === 'o') out.push({ step: s, pitch: pad, len: 1, vel: 0.5 })
  }
  return out
}

export function buildProject(files: SourceFile[], prev: Project): BuildResult {
  const diagnostics: Diagnostic[] = []
  const sourceMap: BuildResult['sourceMap'] = {}
  const merged: PSong = { settings: [], master: [], tracks: [], scenes: [] }
  const fileOf = new Map<Tok, string>()
  for (const f of files) {
    const r = parseFile(f.name, f.source)
    diagnostics.push(...r.diagnostics)
    for (const k of ['settings', 'master', 'tracks', 'scenes'] as const) {
      for (const item of r.song[k] as { tok: Tok }[]) fileOf.set(item.tok, f.name);
      (merged[k] as unknown[]).push(...(r.song[k] as unknown[]))
    }
    if (r.song.arrange) {
      if (merged.arrange) diagnostics.push(err(f.name, r.song.arrangeTok!, 'The song already has an arrange block in another file.'))
      merged.arrange = r.song.arrange
      merged.arrangeTok = r.song.arrangeTok
      fileOf.set(r.song.arrangeTok!, f.name)
    }
  }
  const p: Project = structuredClone(prev)
  const fileFor = (t: Tok, fallback = files[0]?.name ?? 'song.tac') => fileOf.get(t) ?? fallback
  const warn = (file: string, t: Tok, msg: string) => diagnostics.push({ ...err(file, t, msg), severity: 'warning' })

  // Song settings (missing ones keep their current value).
  for (const s of merged.settings) {
    const f = fileFor(s.tok)
    if (s.name === 'tempo') {
      const v = Number(s.value)
      if (v < 30 || v > 300) diagnostics.push(err(f, s.tok, 'Tempo must be between 30 and 300 BPM'))
      else p.bpm = v
    } else if (s.name === 'swing') {
      const v = Number(s.value)
      if (v < 0 || v > 0.5) diagnostics.push(err(f, s.tok, 'Swing runs from 0 to 0.5 (or 0% to 50%)'))
      else p.swing = v
    } else if (s.name === 'key') {
      const k = parseKey(String(s.value))
      if (!k) diagnostics.push(err(f, s.tok, `"${s.value}" is not a key. Try "A minor", "C major" or "F# dorian".`))
      else p.key = k
    } else if (s.name === 'guardrails') p.guardrails = s.value !== 'off'
  }
  for (const m of merged.master) {
    const f = fileFor(m.tok)
    const v = Number(m.value)
    if (m.name === 'volume') p.master.volume = v
    else if (m.name === 'echo') p.master.delayTime = v
    else if (m.name === 'feedback') p.master.delayFeedback = v
    else if (m.name === 'space') p.master.reverbSize = v
    else diagnostics.push(err(f, m.tok, `Unknown master setting "${m.name}". Use volume, echo, feedback or space.`))
  }

  // Tracks
  const seen = new Set<string>()
  const tracks: Track[] = []
  merged.tracks.forEach((pt, i) => {
    const f = pt.file
    if (seen.has(pt.name)) { diagnostics.push(err(f, pt.tok, `There are two tracks named "${pt.name}"`)); return }
    seen.add(pt.name)
    const old = prev.tracks.find((t) => t.name === pt.name)
    tracks.push(buildTrack(pt, old, i, p, f, diagnostics, sourceMap))
  })
  p.tracks = tracks

  // Scenes
  const sceneNames = new Set<string>()
  p.scenes = merged.scenes.flatMap((ps) => {
    const f = fileFor(ps.tok)
    if (sceneNames.has(ps.name)) { diagnostics.push(err(f, ps.tok, `There are two scenes named "${ps.name}"`)); return [] }
    sceneNames.add(ps.name)
    const old = prev.scenes.find((s) => s.name === ps.name)
    const slots: Record<string, string | null> = {}
    for (const t of tracks) slots[t.id] = null
    for (const sl of ps.slots) {
      const t = tracks.find((x) => x.name === sl.track)
      if (!t) { diagnostics.push(err(f, sl.tok, `No track named "${sl.track}"`)); continue }
      const c = t.clips.find((x) => x.name === sl.clip)
      if (!c) { diagnostics.push(err(f, sl.tok, `Track "${t.name}" has no clip named "${sl.clip}"`)); continue }
      slots[t.id] = c.id
    }
    return [{ id: old?.id ?? uid('scn'), name: ps.name, slots }]
  })

  if (merged.arrange) {
    const f = fileFor(merged.arrangeTok!)
    p.arrangement = merged.arrange.flatMap((a) => {
      const s = p.scenes.find((x) => x.name === a.scene)
      if (!s) { diagnostics.push(err(f, a.tok, `No scene named "${a.scene}"`)); return [] }
      if (a.bars < 1 || a.bars > 256) { diagnostics.push(err(f, a.tok, 'A section must be 1 to 256 bars long')); return [] }
      return [{ scene: s.id, bars: a.bars }]
    })
  } else {
    p.arrangement = p.arrangement.filter((a) => p.scenes.some((s) => s.id === a.scene))
  }
  void warn

  const hasErrors = diagnostics.some((d) => d.severity === 'error')
  return { project: hasErrors ? null : p, diagnostics, sourceMap }
}

function err(file: string, t: Tok, message: string): Diagnostic {
  return { file, line: t.line, col: t.col, from: t.offset, to: Math.max(t.end, t.offset + 1), message, severity: 'error' }
}

function buildTrack(pt: PTrack, old: Track | undefined, index: number, p: Project, f: string, diags: Diagnostic[], sourceMap: BuildResult['sourceMap']): Track {
  const kind = pt.kind as 'synth' | 'drums'
  if (kind === 'synth' && !SYNTH_PRESETS.some((x) => x.name === pt.preset)) diags.push(err(f, pt.tok, `Unknown synth preset "${pt.preset}". Presets: ${SYNTH_PRESETS.map((x) => x.name).join(', ')}`))
  if (kind === 'drums' && !DRUM_KITS.some((x) => x.name === pt.preset)) diags.push(err(f, pt.tok, `Unknown drum kit "${pt.preset}". Kits: ${DRUM_KITS.map((x) => x.name).join(', ')}`))
  const t = makeTrack(kind, pt.preset, pt.name, index)
  if (old) { t.id = old.id; t.color = old.color }
  t.mix = defaultMix(kind)
  t.smart = neutralSmart()
  t.synth = kind === 'synth' ? synthPreset(pt.preset) : undefined
  t.pads = kind === 'drums' ? drumKit(pt.preset) : undefined
  for (const prm of pt.params) {
    const v = prm.value
    const num = typeof v === 'number' ? v : NaN
    if (prm.name === 'color') { t.color = String(v); continue }
    if (prm.name === 'mute' || prm.name === 'solo') { t.mix[prm.name] = v !== 'off'; continue }
    if (prm.name in MIX_KEYS) {
      if (Number.isNaN(num)) { diags.push(err(f, prm.tok, `${prm.name} needs a number`)); continue }
      ;(t.mix as unknown as Record<string, number>)[MIX_KEYS[prm.name]] = num
      continue
    }
    if ((SMART_CONTROLS as readonly string[]).includes(prm.name)) {
      if (Number.isNaN(num) || num < 0 || num > 1) { diags.push(err(f, prm.tok, `${prm.name} runs from 0 to 1`)); continue }
      t.smart[prm.name as SmartName] = num
      continue
    }
    if (kind === 'synth' && (SYNTH_KEYS as string[]).includes(prm.name)) {
      const key = prm.name as keyof SynthParams
      const cur = t.synth![key]
      if (key === 'osc1' || key === 'osc2') {
        const allowed = key === 'osc1' ? [...WAVES, ...Object.keys(INSTRUMENTS), 'sampler'] : WAVES
        if (!allowed.includes(String(v))) { diags.push(err(f, prm.tok, `${key === 'osc1' ? 'Source' : 'Waveform'} must be one of ${allowed.join(', ')}`)); continue }
        ;(t.synth as unknown as Record<string, unknown>)[key] = String(v)
      } else if (key === 'sample') {
        ;(t.synth as unknown as Record<string, unknown>)[key] = String(v)
      } else if (typeof cur === 'boolean') {
        ;(t.synth as unknown as Record<string, unknown>)[key] = v === 'on' || v === 'true' || v === 1
      } else {
        if (Number.isNaN(num)) { diags.push(err(f, prm.tok, `${prm.name} needs a number`)); continue }
        ;(t.synth as unknown as Record<string, unknown>)[key] = num
      }
      continue
    }
    diags.push(err(f, prm.tok, `Unknown setting "${prm.name}" for a ${kind} track`))
  }
  for (const pp of pt.pads) {
    const pad = t.pads?.find((x) => x.name === pp.pad)
    if (!pad) { diags.push(err(f, pp.tok, kind === 'drums' ? `Unknown pad "${pp.pad}". Pads: ${PAD_NAMES.join(', ')}` : 'Only drum tracks have pads')); continue }
    for (const prm of pp.params) {
      if (prm.name === 'sample') { pad.sample = String(prm.value); continue }
      if (!['tune', 'decay', 'gain', 'pan'].includes(prm.name) || typeof prm.value !== 'number') { diags.push(err(f, prm.tok, `Pads take tune, decay, gain, pan or sample`)); continue }
      ;(pad as unknown as Record<string, number>)[prm.name] = prm.value
    }
  }
  const names = new Set<string>()
  t.clips = pt.clips.flatMap((pc) => {
    if (names.has(pc.name)) { diags.push(err(f, pc.tok, `Track "${pt.name}" has two clips named "${pc.name}"`)); return [] }
    names.add(pc.name)
    const c = buildClip(pc, kind, old?.clips.find((x) => x.name === pc.name), p, f, diags)
    sourceMap[c.id] = { file: f, line: pc.tok.line }
    return [c]
  })
  return t
}

function buildClip(pc: PClip, kind: 'synth' | 'drums', old: Clip | undefined, p: Project, f: string, diags: Diagnostic[]): Clip {
  const clip: Clip = { id: old?.id ?? uid('clp'), name: pc.name, length: pc.length, notes: [] }
  if (pc.gen !== undefined) {
    try {
      clip.gen = formatGenCall(parseGenCall(pc.gen))
      clip.notes = runGen(pc.gen, { key: p.key, length: pc.length, kind })
    } catch (e) {
      if (e instanceof GenError) diags.push(err(f, pc.genTok!, e.message))
      else throw e
    }
    return clip
  }
  for (const ln of pc.lines) {
    if (kind === 'drums') {
      const pad = PAD_NAMES.indexOf((ln.head ?? '') as (typeof PAD_NAMES)[number])
      if (pad < 0) { diags.push(err(f, ln.tok, ln.head ? `Unknown pad "${ln.head}". Pads: ${PAD_NAMES.join(', ')}` : 'Drum lines start with a pad name, like: kick "x...x..."')); continue }
      if (!DRUM_LINES[ln.pattern] && /[^xXo.\s|]/.test(ln.pattern)) { diags.push(err(f, ln.tok, `Drum patterns use x (hit), X (accent), o (soft) and . (rest), or a named line: ${Object.keys(DRUM_LINES).join(', ')}`)); continue }
      clip.notes.push(...parseDrumLine(ln.pattern, pad, pc.length))
    } else {
      if (ln.head && ln.head !== 'notes') { diags.push(err(f, ln.tok, 'Synth clip lines are note patterns in quotes, like "A1 . C2 E2"')); continue }
      clip.notes.push(...parseSynthPattern(ln.pattern, pc.length, (m) => diags.push(err(f, ln.tok, m))))
    }
  }
  clip.notes.sort((a, b) => a.step - b.step || a.pitch - b.pitch)
  return clip
}

export { TRACK_COLORS }
