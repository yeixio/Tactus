import { useApp } from '../state/store'
import { makeClip, makeTrack, uid } from '../model/project'
import { formatGenCall, runGen, variation, rng } from '../model/generate'
import { progressionInKey, PROGRESSIONS } from '../model/theory'
import { drumKit, synthPreset } from '../model/presets'
import type { Note, Project, Track, TrackKind } from '../model/types'
import type { Draft } from 'immer'

const st = () => useApp.getState()

export function findTrack(p: Project | Draft<Project>, id: string | null) {
  return p.tracks.find((t) => t.id === id)
}

export function addTrack(kind: TrackKind, preset: string, name?: string) {
  const p = st().project
  const base = name ?? (kind === 'drums' ? 'Drums' : preset.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '))
  let n = base
  for (let i = 2; p.tracks.some((t) => t.name === n); i++) n = `${base} ${i}`
  const t = makeTrack(kind, preset, n, p.tracks.length)
  t.clips = [makeClip('Clip 1', kind === 'drums' ? 1 : 2)]
  st().update((d) => {
    d.tracks.push(t as Draft<Track>)
    for (const s of d.scenes) s.slots[t.id] = null
  })
  st().select(t.id, t.clips[0].id)
  return t
}

export function deleteTrack(id: string) {
  st().update((d) => {
    d.tracks = d.tracks.filter((t) => t.id !== id)
    for (const s of d.scenes) delete s.slots[id]
    d.midi = d.midi.filter((m) => !m.target.includes(id))
  })
  const p = st().project
  st().select(p.tracks[0]?.id ?? null)
}

export function duplicateTrack(id: string) {
  const p = st().project
  const t = findTrack(p, id)
  if (!t) return
  const copy: Track = structuredClone(t) as Track
  copy.id = uid('trk')
  copy.name = t.name + ' copy'
  const idMap = new Map<string, string>()
  copy.clips = copy.clips.map((c) => { const nid = uid('clp'); idMap.set(c.id, nid); return { ...c, id: nid } })
  st().update((d) => {
    const i = d.tracks.findIndex((x) => x.id === id)
    d.tracks.splice(i + 1, 0, copy as Draft<Track>)
    for (const s of d.scenes) { const c = s.slots[id]; s.slots[copy.id] = c ? idMap.get(c) ?? null : null }
  })
}

export function moveTrack(id: string, dir: -1 | 1) {
  st().update((d) => {
    const i = d.tracks.findIndex((x) => x.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= d.tracks.length) return
    const [t] = d.tracks.splice(i, 1)
    d.tracks.splice(j, 0, t)
  })
}

export function setPreset(trackId: string, preset: string) {
  st().update((d) => {
    const t = findTrack(d, trackId)
    if (!t) return
    t.preset = preset
    if (t.kind === 'synth') t.synth = synthPreset(preset)
    else {
      // keep user-loaded samples, swap factory ones
      const kit = drumKit(preset)
      t.pads = kit.map((pad, i) => (t.pads?.[i]?.sample.startsWith('user:') ? { ...pad, sample: t.pads[i].sample } : pad))
    }
  })
}

export function addClip(trackId: string, bars?: number): string | null {
  const t = findTrack(st().project, trackId)
  if (!t) return null
  let n = t.clips.length + 1
  while (t.clips.some((c) => c.name === `Clip ${n}`)) n++
  const c = makeClip(`Clip ${n}`, bars ?? (t.kind === 'drums' ? 1 : 2))
  st().update((d) => { findTrack(d, trackId)?.clips.push(c) })
  st().select(trackId, c.id)
  return c.id
}

export function duplicateClip(trackId: string, clipId: string) {
  const t = findTrack(st().project, trackId)
  const c = t?.clips.find((x) => x.id === clipId)
  if (!t || !c) return
  let name = `${c.name} copy`
  for (let i = 2; t.clips.some((x) => x.name === name); i++) name = `${c.name} ${i}`
  const copy = { ...structuredClone(c), id: uid('clp'), name }
  st().update((d) => {
    const tt = findTrack(d, trackId)!
    const i = tt.clips.findIndex((x) => x.id === clipId)
    tt.clips.splice(i + 1, 0, copy)
  })
  st().select(trackId, copy.id)
  return copy.id
}

export function deleteClip(trackId: string, clipId: string) {
  st().update((d) => {
    const t = findTrack(d, trackId)
    if (!t) return
    t.clips = t.clips.filter((c) => c.id !== clipId)
    for (const s of d.scenes) if (s.slots[trackId] === clipId) s.slots[trackId] = null
  })
  const t = findTrack(st().project, trackId)
  st().select(trackId, t?.clips[0]?.id ?? null)
}

/** Edit a clip's notes by hand. This makes the clip concrete (drops its generator). */
export function editNotes(trackId: string, clipId: string, fn: (notes: Note[]) => Note[], key?: string) {
  st().update((d) => {
    const c = findTrack(d, trackId)?.clips.find((x) => x.id === clipId)
    if (!c) return
    c.notes = fn(c.notes.map((n) => ({ ...n })))
    delete c.gen
  }, { key })
}

export function setClipLength(trackId: string, clipId: string, length: number) {
  st().update((d) => {
    const c = findTrack(d, trackId)?.clips.find((x) => x.id === clipId)
    if (!c) return
    const old = c.length
    c.length = length
    if (length > old && old > 0 && c.notes.length) {
      // repeat the existing material to fill the new length
      const src = c.notes.filter((n) => n.step < old)
      const out = [...src]
      for (let off = old; off < length; off += old) for (const n of src) if (n.step + off < length) out.push({ ...n, step: n.step + off })
      c.notes = out
      if (c.gen) delete c.gen
    } else c.notes = c.notes.filter((n) => n.step < length)
  })
}

export type Inspiration = 'drums' | 'bass' | 'chords' | 'arp' | 'melody' | 'variation'

/**
 * Generate into a new clip next to the current one, so the original is always preserved.
 * Returns the new clip id.
 */
export function inspire(trackId: string, kind: Inspiration, fromClip?: string): string | null {
  const p = st().project
  const t = findTrack(p, trackId)
  if (!t) return null
  const seed = Math.floor(Math.random() * 9000) + 1
  const src = t.clips.find((c) => c.id === fromClip)
  const length = src?.length ?? (t.kind === 'drums' ? 32 : 64)
  const ctx = { key: p.key, length, kind: t.kind }
  const r = rng(seed)
  const prog = progressionInKey(p.key, PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)].degrees)
  let gen: string | undefined
  let notes: Note[]
  let label: string
  switch (kind) {
    case 'drums': {
      const styles = ['house', 'techno', 'dnb', 'hiphop', 'trap', 'breakbeat', 'garage']
      const style = styles[Math.floor(r() * styles.length)]
      gen = formatGenCall({ name: 'drums', args: [style, seed] }); label = `${style[0].toUpperCase()}${style.slice(1)} groove`; break
    }
    case 'bass': {
      const styles = ['root', 'octave', 'offbeat', 'walk', 'acid', 'pulse']
      const style = styles[Math.floor(r() * styles.length)]
      gen = formatGenCall({ name: 'bass', args: [prog, style, seed] }); label = `Bass ${style}`; break
    }
    case 'chords': {
      const styles = ['pad', 'stab', 'pulse', 'offbeat']
      const style = styles[Math.floor(r() * styles.length)]
      gen = formatGenCall({ name: 'chords', args: [prog, style] }); label = `Chords ${style}`; break
    }
    case 'arp': {
      const modes = ['up', 'down', 'updown', 'random']
      const mode = modes[Math.floor(r() * modes.length)]
      gen = formatGenCall({ name: 'arp', args: [prog, mode, seed] }); label = `Arp ${mode}`; break
    }
    case 'melody':
      gen = formatGenCall({ name: 'melody', args: [seed, Math.round((0.3 + r() * 0.4) * 100) / 100, t.synth && t.synth.cutoff < 900 ? 3 : 5] }); label = 'Melody'; break
    case 'variation':
      if (!src) return null
      label = `${src.name} var`
      break
  }
  if (kind === 'variation') notes = variation(src!.notes, ctx, seed)
  else notes = runGen(gen!, ctx)
  let name = label
  for (let i = 2; t.clips.some((c) => c.name === name); i++) name = `${label} ${i}`
  const clip = { id: uid('clp'), name, length, notes, gen: kind === 'variation' ? undefined : gen }
  st().update((d) => {
    const tt = findTrack(d, trackId)!
    const i = src ? tt.clips.findIndex((c) => c.id === src.id) + 1 : tt.clips.length
    tt.clips.splice(i, 0, clip)
  })
  st().select(trackId, clip.id)
  return clip.id
}

export function addScene() {
  const p = st().project
  const id = uid('scn')
  let n = p.scenes.length + 1
  while (p.scenes.some((s) => s.name === `Scene ${n}`)) n++
  // new scene starts as a copy of what is assigned in the last scene
  const last = p.scenes[p.scenes.length - 1]
  st().update((d) => {
    const slots: Record<string, string | null> = {}
    for (const t of d.tracks) slots[t.id] = last?.slots[t.id] ?? null
    d.scenes.push({ id, name: `Scene ${n}`, slots })
  })
  return id
}

export function setSlot(sceneId: string, trackId: string, clipId: string | null) {
  st().update((d) => { const s = d.scenes.find((x) => x.id === sceneId); if (s) s.slots[trackId] = clipId })
}

export function deleteScene(id: string) {
  st().update((d) => {
    d.scenes = d.scenes.filter((s) => s.id !== id)
    d.arrangement = d.arrangement.filter((a) => a.scene !== id)
    d.midi = d.midi.filter((m) => m.target !== `scene:${id}`)
  })
}

/** Capture what is playing right now as a new scene (live performance -> arrangement). */
export function captureScene(playing: Record<string, string | null>) {
  const p = st().project
  let n = p.scenes.length + 1
  while (p.scenes.some((s) => s.name === `Scene ${n}`)) n++
  st().update((d) => {
    const slots: Record<string, string | null> = {}
    for (const t of d.tracks) slots[t.id] = playing[t.id] ?? null
    d.scenes.push({ id: uid('scn'), name: `Scene ${n}`, slots })
  })
}
