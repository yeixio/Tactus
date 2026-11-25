// Prints the canonical project as code. Visual edits re-print; code edits re-parse (see build.ts).

import { PAD_NAMES, drumKit, synthPreset } from '../model/presets'
import { keyName, noteName } from '../model/theory'
import type { Clip, Project, SynthParams, Track } from '../model/types'
import { SMART_CONTROLS } from '../model/types'
import { defaultMix } from '../model/project'
import { MIX_KEYS, type SourceFile } from './build'

const KEYWORDS = new Set(['track', 'clip', 'scene', 'arrange', 'tempo', 'key', 'swing', 'master', 'pad', 'synth', 'drums', 'bars', 'bar', 'steps', 'beats'])

export function q(name: string): string {
  return /^[A-Za-z_][\w-]*$/.test(name) && !KEYWORDS.has(name) ? name : `"${name.replace(/"/g, "'")}"`
}

export const fmt = (n: number) => String(Math.round(n * 1000) / 1000)

export function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'track'
}

export function trackFileName(t: Track, all: Track[]): string {
  const base = slug(t.name)
  const same = all.filter((x) => slug(x.name) === base)
  return same.length > 1 ? `tracks/${base}-${same.indexOf(t) + 1}.tac` : `tracks/${base}.tac`
}

export function printProject(p: Project): SourceFile[] {
  return [{ name: 'song.tac', source: printSong(p) }, ...p.tracks.map((t) => ({ name: trackFileName(t, p.tracks), source: printTrack(t) }))]
}

export function printSong(p: Project): string {
  const L: string[] = []
  L.push(`// ${p.name}`)
  L.push('// Run with Ctrl+Enter (Cmd+Enter on Mac). Changes land on the next bar while the music plays.')
  L.push('')
  L.push(`tempo ${fmt(p.bpm)}`)
  L.push(`key "${keyName(p.key)}"`)
  if (p.swing) L.push(`swing ${fmt(p.swing)}`)
  if (!p.guardrails) L.push('guardrails off')
  L.push(`master volume ${fmt(p.master.volume)} echo ${fmt(p.master.delayTime)} feedback ${fmt(p.master.delayFeedback)} space ${fmt(p.master.reverbSize)}`)
  if (p.scenes.length) L.push('')
  for (const s of p.scenes) {
    const parts = p.tracks.flatMap((t) => {
      const cid = s.slots[t.id]
      const c = cid ? t.clips.find((x) => x.id === cid) : undefined
      return c ? [`${q(t.name)}: ${q(c.name)}`] : []
    })
    L.push(`scene ${q(s.name)} { ${parts.join(', ')} }`)
  }
  if (p.arrangement.length) {
    L.push('')
    L.push('arrange {')
    for (const a of p.arrangement) {
      const s = p.scenes.find((x) => x.id === a.scene)
      if (s) L.push(`  ${q(s.name)} ${a.bars}`)
    }
    L.push('}')
  }
  return L.join('\n') + '\n'
}

export function printTrack(t: Track): string {
  const L: string[] = []
  L.push(`track ${q(t.name)} ${t.kind} ${q(t.preset)} {`)
  const dm = defaultMix(t.kind)
  for (const [word, key] of Object.entries(MIX_KEYS)) {
    const v = t.mix[key] as number
    if (Math.abs(v - (dm[key] as number)) > 1e-4) L.push(`  ${word} ${fmt(v)}`)
  }
  if (t.mix.mute) L.push('  mute')
  if (t.mix.solo) L.push('  solo')
  for (const s of SMART_CONTROLS) if (Math.abs(t.smart[s] - 0.5) > 1e-4) L.push(`  ${s} ${fmt(t.smart[s])}`)
  if (t.kind === 'synth' && t.synth) {
    const base = synthPreset(t.preset)
    for (const k of Object.keys(base) as (keyof SynthParams)[]) {
      const v = t.synth[k]
      const b = base[k]
      if (typeof v === 'number' ? Math.abs(v - (b as number)) > 1e-4 : v !== b) L.push(`  ${k} ${typeof v === 'number' ? fmt(v) : typeof v === 'boolean' ? (v ? 'on' : 'off') : v}`)
    }
  }
  if (t.kind === 'drums' && t.pads) {
    const base = drumKit(t.preset)
    t.pads.forEach((pad, i) => {
      const b = base[i]
      const parts: string[] = []
      for (const k of ['tune', 'decay', 'gain', 'pan'] as const) if (Math.abs(pad[k] - b[k]) > 1e-4) parts.push(`${k} ${fmt(pad[k])}`)
      if (pad.sample !== b.sample) parts.push(`sample "${pad.sample}"`)
      if (parts.length) L.push(`  pad ${pad.name} ${parts.join(' ')}`)
    })
  }
  for (const c of t.clips) L.push(...printClip(c, t))
  L.push('}')
  return L.join('\n') + '\n'
}

function lengthWord(len: number) {
  if (len % 16 === 0) return `${len / 16} ${len === 16 ? 'bar' : 'bars'}`
  if (len % 4 === 0) return `${len / 4} beats`
  return `${len} steps`
}

export function printClip(c: Clip, t: Track): string[] {
  const head = `  clip ${q(c.name)} ${lengthWord(c.length)}`
  if (c.gen) return [`${head} = ${c.gen}`]
  if (!c.notes.length) return [`${head} {`, '  }']
  const L = [`${head} {`]
  if (t.kind === 'drums') {
    const used = [...new Set(c.notes.map((n) => n.pitch))].sort((a, b) => a - b)
    const w = Math.max(...used.map((u) => (PAD_NAMES[u] ?? 'perc').length))
    for (const pad of used) {
      const chars: string[] = []
      for (let s = 0; s < c.length; s++) {
        const n = c.notes.find((x) => x.step === s && x.pitch === pad)
        chars.push(!n ? '.' : n.vel >= 0.95 ? 'X' : n.vel <= 0.6 ? 'o' : 'x')
      }
      L.push(`    ${(PAD_NAMES[pad] ?? 'perc').padEnd(w)} "${groupDrums(chars)}"`)
    }
  } else {
    for (const layer of layers(c)) L.push(`    "${layer}"`)
  }
  L.push('  }')
  return L
}

function groupDrums(chars: string[]) {
  const out: string[] = []
  for (let i = 0; i < chars.length; i += 4) out.push(chars.slice(i, i + 4).join(''))
  // a bar separator every 4 beats
  return out.map((g, i) => (i > 0 && i % 4 === 0 ? '| ' + g : g)).join(' ')
}

function noteTok(n: { pitch: number; vel: number }) {
  const v = n.vel
  return noteName(n.pitch) + (Math.abs(v - 0.8) < 0.03 ? '' : v >= 0.99 ? '!' : Math.abs(v - 0.5) < 0.03 ? '?' : `@${fmt(v)}`)
}

/** Split notes into monophonic layers; chords that start and end together share a token (A1+C2+E2). */
function layers(c: Clip): string[] {
  // group identical (step,len) into chords
  const groups = new Map<string, { step: number; len: number; notes: typeof c.notes }>()
  for (const n of c.notes) {
    const len = Math.max(1, Math.min(n.len, c.length - n.step))
    const k = `${n.step}:${len}`
    if (!groups.has(k)) groups.set(k, { step: n.step, len, notes: [] })
    groups.get(k)!.notes.push(n)
  }
  const sorted = [...groups.values()].sort((a, b) => a.step - b.step || b.len - a.len)
  const lanes: { end: number; toks: string[] }[] = []
  for (const g of sorted) {
    let lane = lanes.find((l) => l.end <= g.step)
    if (!lane) { lane = { end: 0, toks: [] }; lanes.push(lane) }
    while (lane.toks.length < g.step) lane.toks.push('.')
    lane.toks.push(g.notes.sort((a, b) => a.pitch - b.pitch).map(noteTok).join('+'))
    for (let i = 1; i < g.len; i++) lane.toks.push('~')
    lane.end = g.step + g.len
  }
  return lanes.map((l) => {
    while (l.toks.length < c.length) l.toks.push('.')
    const out: string[] = []
    l.toks.forEach((t, i) => { if (i > 0 && i % 16 === 0) out.push('|'); out.push(t) })
    return out.join(' ')
  })
}
