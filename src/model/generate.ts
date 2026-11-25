// Inspiration engine: deterministic generators for drums, basslines, chords, arps and melodies.
// Each generator is also a code expression (e.g. arp("Am F C G", up, 7)), so every
// generated clip can be reproduced, inspected and edited from the code workspace.

import { DRUM_LINES, PAD_NAMES } from './presets'
import { degreeToPitch, parseNote, parseProgression, snapToKey, voiceChord, progressionInKey, PROGRESSIONS } from './theory'
import type { Key, Note, TrackKind } from './types'
import { SCALES } from './types'

export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface GenContext {
  key: Key
  length: number // steps
  kind: TrackKind
}

export type GenArg = string | number
export interface GenCall {
  name: string
  args: GenArg[]
}

export class GenError extends Error {}

/** Parse `name(arg, "str", 3)` */
export function parseGenCall(src: string): GenCall {
  const m = /^\s*([a-z][\w-]*)\s*\((.*)\)\s*$/is.exec(src)
  if (!m) throw new GenError(`Expected a generator call like arp("Am F C G", up), got: ${src}`)
  const args: GenArg[] = []
  const re = /\s*(?:"([^"]*)"|(-?\d+(?:\.\d+)?)|([a-zA-Z][\w#-]*))\s*(?:,|$)/y
  const body = m[2].trim()
  let i = 0
  while (i < body.length) {
    re.lastIndex = i
    const a = re.exec(body)
    if (!a) throw new GenError(`Could not read the arguments of ${m[1]}(…) near "${body.slice(i)}"`)
    args.push(a[1] !== undefined ? a[1] : a[2] !== undefined ? parseFloat(a[2]) : a[3])
    i = re.lastIndex
  }
  return { name: m[1].toLowerCase(), args }
}

export function formatGenCall(c: GenCall): string {
  return `${c.name}(${c.args.map((a) => (typeof a === 'number' ? String(a) : /^[a-zA-Z][\w#-]*$/.test(a) && !a.includes(' ') ? a : `"${a}"`)).join(', ')})`
}

const str = (a: GenArg | undefined, d: string) => (a === undefined ? d : String(a))
const num = (a: GenArg | undefined, d: number) => (typeof a === 'number' ? a : a === undefined ? d : Number.isFinite(parseFloat(a)) ? parseFloat(a) : d)

export const GENERATORS: Record<string, { kinds: TrackKind[]; signature: string; doc: string }> = {
  drums: { kinds: ['drums'], signature: 'drums(style, seed)', doc: 'A full drum groove. Styles: house, techno, dnb, hiphop, trap, breakbeat, garage, ambient.' },
  euclid: { kinds: ['drums', 'synth'], signature: 'euclid(hits, steps, note, rotate)', doc: 'Spread hits as evenly as possible over steps. note is a pad name (kick…) or a note (C2).' },
  bass: { kinds: ['synth'], signature: 'bass(chords, style, seed)', doc: 'A bassline that follows a progression. Styles: root, octave, offbeat, pulse, walk, acid.' },
  chords: { kinds: ['synth'], signature: 'chords(chords, style)', doc: 'Voice-led chords, one per bar. Styles: pad, stab, pulse, offbeat.' },
  arp: { kinds: ['synth'], signature: 'arp(chords, mode, seed)', doc: 'Arpeggiate a progression in 16ths. Modes: up, down, updown, random.' },
  melody: { kinds: ['synth'], signature: 'melody(seed, density, octave)', doc: 'A scale-aware melody in the project key.' },
}

export function runGen(src: string, ctx: GenContext): Note[] {
  const call = parseGenCall(src)
  const def = GENERATORS[call.name]
  if (!def) throw new GenError(`Unknown generator "${call.name}". Try: ${Object.keys(GENERATORS).join(', ')}`)
  if (!def.kinds.includes(ctx.kind)) throw new GenError(`${call.name}() is for ${def.kinds.join('/')} tracks`)
  const a = call.args
  switch (call.name) {
    case 'drums': return genDrums(str(a[0], 'house'), num(a[1], 1), ctx)
    case 'euclid': return genEuclid(num(a[0], 3), num(a[1], 8), str(a[2], ctx.kind === 'drums' ? 'kick' : 'C3'), num(a[3], 0), ctx)
    case 'bass': return genBass(str(a[0], defaultProg(ctx.key)), str(a[1], 'root'), num(a[2], 1), ctx)
    case 'chords': return genChords(str(a[0], defaultProg(ctx.key)), str(a[1], 'pad'), ctx)
    case 'arp': return genArp(str(a[0], defaultProg(ctx.key)), str(a[1], 'up'), num(a[2], 1), ctx)
    case 'melody': return genMelody(num(a[0], 1), num(a[1], 0.5), num(a[2], 5), ctx)
  }
  return []
}

function defaultProg(key: Key) {
  return progressionInKey(key, key.scale === 'major' ? PROGRESSIONS[0].degrees : PROGRESSIONS[1].degrees)
}

function linePattern(line: string, pad: number, length: number, vel = 0.8): Note[] {
  const out: Note[] = []
  for (let s = 0; s < length; s++) {
    const ch = line[s % line.length]
    if (ch === 'x') out.push({ step: s, pitch: pad, len: 1, vel })
    if (ch === 'X') out.push({ step: s, pitch: pad, len: 1, vel: 1 })
    if (ch === 'o') out.push({ step: s, pitch: pad, len: 1, vel: 0.5 })
  }
  return out
}

const PAD = Object.fromEntries(PAD_NAMES.map((n, i) => [n, i])) as Record<string, number>

const DRUM_STYLES: Record<string, Partial<Record<string, string[]>>> = {
  house: { kick: ['X...x...X...x...'], clap: ['....x.......x...'], hat: ['..x...x...x...x.', '..x.o.x...x.o.x.'], openhat: ['..............x.', '......x.........'], perc: ['...........o....', '.o.......o......'] },
  techno: { kick: ['X...x...X...x...'], hat: ['..x...x...x...x.', 'oxo.oxo.oxo.oxo.'], rim: ['....x.......x..o', '...x..x....x..x.'], openhat: ['..x...x...x...x.'], clap: ['....x.......x...', '................'] },
  dnb: { kick: ['X.........x.....', 'X.........X..x..'], snare: ['....X.......X...', '....X.......X..o'], hat: ['x.x.x.x.x.x.x.x.', 'x.xox.x.x.xox.x.'], perc: ['.......o.......o'] },
  hiphop: { kick: ['X......x..x.....', 'X..x......x....x'], snare: ['....X.......X...'], hat: ['x.x.x.x.x.x.x.x.', 'x.xxx.x.x.x.xx.x'], openhat: ['..............o.'] },
  trap: { kick: ['X......x..x.....', 'X.....x...x..x..'], snare: ['........X.......'], clap: ['........x.......'], hat: ['x.x.x.x.xxx.x.x.', 'x.xxx.x.x.x.xxxx'], perc: ['......o.........'] },
  breakbeat: { kick: ['X.....x...x.....', 'X.x.......x..x..'], snare: ['....X.......X...', '....X..o....X...'], hat: ['x.x.x.x.x.x.x.x.'], openhat: ['......x.........'] },
  garage: { kick: ['X.....x...X.....', 'X......x..X.....'], snare: ['....X.......X...'], hat: ['..x..x.x..x..x.x', '.xx..x.x.xx..x.x'], rim: ['.......x.......x'] },
  ambient: { kick: ['X...............', 'X.......x.......'], rim: ['......o.......o.'], hat: ['..o...o...o...o.', '................'], perc: ['.........o......'] },
}

function genDrums(style: string, seed: number, ctx: GenContext): Note[] {
  const st = DRUM_STYLES[style]
  if (!st) throw new GenError(`Unknown drum style "${style}". Styles: ${Object.keys(DRUM_STYLES).join(', ')}`)
  const r = rng(seed * 7919 + style.length)
  const out: Note[] = []
  const bars = Math.max(1, Math.round(ctx.length / 16))
  for (let b = 0; b < bars; b++) {
    for (const [pad, choices] of Object.entries(st)) {
      if (!choices || !choices.length) continue
      // last bar of a phrase gets a variation more often
      const pick = b === bars - 1 && choices.length > 1 ? choices[choices.length - 1] : choices[Math.floor(r() * choices.length)]
      for (const n of linePattern(pick, PAD[pad], 16)) {
        const step = b * 16 + n.step
        if (step >= ctx.length) continue
        const vel = n.vel === 1 ? 1 : Math.max(0.3, Math.min(1, n.vel + (r() - 0.5) * 0.15))
        out.push({ ...n, step, vel: Math.round(vel * 100) / 100 })
      }
    }
  }
  return out.sort((a, b) => a.step - b.step || a.pitch - b.pitch)
}

function genEuclid(k: number, n: number, note: string, rotate: number, ctx: GenContext): Note[] {
  n = Math.max(1, Math.min(64, Math.round(n)))
  k = Math.max(0, Math.min(n, Math.round(k)))
  let pitch: number | null
  if (ctx.kind === 'drums') pitch = PAD[note] ?? null
  else pitch = parseNote(note)
  if (pitch === null) throw new GenError(ctx.kind === 'drums' ? `Unknown pad "${note}". Pads: ${PAD_NAMES.join(', ')}` : `"${note}" is not a note like C3`)
  const hits: boolean[] = []
  for (let i = 0; i < n; i++) hits.push(Math.floor(((i + rotate) * k) / n) !== Math.floor(((i + rotate - 1) * k) / n) || (k === n))
  const out: Note[] = []
  for (let s = 0; s < ctx.length; s++) if (hits[s % n]) out.push({ step: s, pitch, len: 1, vel: s % n === 0 ? 0.95 : 0.75 })
  return out
}

function chordsFor(prog: string, key: Key) {
  const chords = parseProgression(prog)
  if (!chords.length) throw new GenError(`Could not read chords from "${prog}". Use names like Am F C G.`)
  void key
  return chords
}

function genBass(prog: string, style: string, seed: number, ctx: GenContext): Note[] {
  const chords = chordsFor(prog, ctx.key)
  const r = rng(seed * 104729)
  const out: Note[] = []
  const bars = Math.max(1, Math.ceil(ctx.length / 16))
  for (let b = 0; b < bars; b++) {
    const ch = chords[b % chords.length]
    const root = 36 + ((ch.root - 0 + 12) % 12) // C2..B2
    const r0 = root > 43 ? root - 12 : root
    const fifth = r0 + 7
    const base = b * 16
    const add = (s: number, p: number, len: number, vel = 0.85) => { if (base + s < ctx.length) out.push({ step: base + s, pitch: p, len: Math.min(len, ctx.length - base - s), vel }) }
    switch (style) {
      case 'root': add(0, r0, 3); add(4, r0, 2); add(8, r0, 3); add(11, r0, 1, 0.7); add(12, r0, 2); add(14, fifth, 2, 0.7); break
      case 'octave': for (let s = 0; s < 16; s += 2) add(s, s % 4 === 0 ? r0 : r0 + 12, 1, s % 4 === 0 ? 0.9 : 0.7); break
      case 'offbeat': for (let s = 2; s < 16; s += 4) add(s, r0, 2); break
      case 'pulse': for (let s = 0; s < 16; s++) add(s, r0, 1, s % 4 === 0 ? 0.95 : 0.6); break
      case 'walk': {
        const sc = SCALES[ctx.key.scale] as readonly number[]
        for (let s = 0; s < 16; s += 4) {
          const p = s === 0 ? r0 : snapToKey(r0 + [0, sc[2] ?? 3, sc[4] ?? 7, sc[1] ?? 2][s / 4], ctx.key)
          add(s, p, 3)
        }
        break
      }
      case 'acid': {
        for (let s = 0; s < 16; s++) {
          if (r() < 0.62) {
            const choices = [r0, r0, r0 + 12, fifth, snapToKey(r0 + 3, ctx.key), snapToKey(r0 + 10, ctx.key)]
            const p = choices[Math.floor(r() * choices.length)]
            const slide = r() < 0.25
            add(s, p, slide ? 2 : 1, r() < 0.3 ? 1 : 0.7)
            if (slide) s++
          }
        }
        break
      }
      default: throw new GenError(`Unknown bass style "${style}". Styles: root, octave, offbeat, pulse, walk, acid`)
    }
  }
  return out
}

function genChords(prog: string, style: string, ctx: GenContext): Note[] {
  const chords = chordsFor(prog, ctx.key)
  const out: Note[] = []
  const bars = Math.max(1, Math.ceil(ctx.length / 16))
  let prev: number[] | undefined
  for (let b = 0; b < bars; b++) {
    const v = voiceChord(chords[b % chords.length], 62, prev)
    prev = v
    const base = b * 16
    const hit = (s: number, len: number, vel = 0.75) => { for (const p of v) if (base + s < ctx.length) out.push({ step: base + s, pitch: p, len: Math.min(len, ctx.length - base - s), vel }) }
    switch (style) {
      case 'pad': hit(0, 16, 0.7); break
      case 'stab': hit(0, 2, 0.85); hit(6, 2, 0.75); hit(10, 2, 0.8); break
      case 'pulse': for (let s = 0; s < 16; s += 2) hit(s, 1, s % 4 === 0 ? 0.8 : 0.6); break
      case 'offbeat': for (let s = 2; s < 16; s += 4) hit(s, 2, 0.8); break
      default: throw new GenError(`Unknown chord style "${style}". Styles: pad, stab, pulse, offbeat`)
    }
  }
  return out
}

function genArp(prog: string, mode: string, seed: number, ctx: GenContext): Note[] {
  const chords = chordsFor(prog, ctx.key)
  const r = rng(seed * 31337)
  const out: Note[] = []
  let prev: number[] | undefined
  const bars = Math.max(1, Math.ceil(ctx.length / 16))
  for (let b = 0; b < bars; b++) {
    const v = voiceChord(chords[b % chords.length], 64, prev)
    prev = v
    const tones = [...v, v[0] + 12]
    let seq: number[]
    if (mode === 'up') seq = tones
    else if (mode === 'down') seq = [...tones].reverse()
    else if (mode === 'updown') seq = [...tones, ...tones.slice(1, -1).reverse()]
    else if (mode === 'random') seq = tones
    else throw new GenError(`Unknown arp mode "${mode}". Modes: up, down, updown, random`)
    for (let s = 0; s < 16; s++) {
      const step = b * 16 + s
      if (step >= ctx.length) break
      const p = mode === 'random' ? seq[Math.floor(r() * seq.length)] : seq[s % seq.length]
      out.push({ step, pitch: p, len: 1, vel: s % 4 === 0 ? 0.9 : 0.65 + r() * 0.1 })
    }
  }
  return out.map((n) => ({ ...n, vel: Math.round(n.vel * 100) / 100 }))
}

function genMelody(seed: number, density: number, octave: number, ctx: GenContext): Note[] {
  const r = rng(seed * 2654435761)
  const n = SCALES[ctx.key.scale].length
  const out: Note[] = []
  let deg = 0
  // A 1-bar motif, repeated with a varied answer, keeps the melody memorable.
  const motif: { step: number; d: number; len: number }[] = []
  for (let s = 0; s < 16; ) {
    const len = r() < 0.5 ? 2 : r() < 0.5 ? 1 : 4
    if (r() < Math.max(0.15, Math.min(0.95, density + (s % 4 === 0 ? 0.2 : 0)))) {
      deg += Math.round((r() - 0.5) * 4)
      deg = Math.max(-2, Math.min(n + 3, deg))
      motif.push({ step: s, d: deg, len })
    }
    s += len
  }
  if (!motif.length) motif.push({ step: 0, d: 0, len: 4 })
  const bars = Math.max(1, Math.ceil(ctx.length / 16))
  for (let b = 0; b < bars; b++) {
    const shift = b % 2 === 1 ? [0, 1, -1, 2][Math.floor(r() * 4)] : 0
    for (const m of motif) {
      const step = b * 16 + m.step
      if (step >= ctx.length) continue
      let d = m.d + shift
      if (b === bars - 1 && m === motif[motif.length - 1]) d = 0 // resolve home
      out.push({ step, pitch: degreeToPitch(d, ctx.key, octave), len: Math.min(m.len, ctx.length - step), vel: m.step % 4 === 0 ? 0.85 : 0.7 })
    }
  }
  return out
}

/** Variation of an existing clip: moves a few notes, adds ghost notes, keeps the feel. */
export function variation(notes: Note[], ctx: GenContext, seed: number): Note[] {
  const r = rng(seed * 6007)
  const out: Note[] = []
  for (const n of notes) {
    const x = r()
    if (x < 0.12) continue // drop
    if (ctx.kind === 'synth' && x < 0.3) {
      out.push({ ...n, pitch: snapToKey(n.pitch + (r() < 0.5 ? 2 : -2), ctx.key) })
      continue
    }
    out.push({ ...n })
  }
  const adds = Math.max(1, Math.round(notes.length * 0.15))
  for (let i = 0; i < adds && notes.length; i++) {
    const src = notes[Math.floor(r() * notes.length)]
    const step = Math.floor(r() * ctx.length)
    if (out.some((n) => n.step === step && n.pitch === src.pitch)) continue
    out.push({ step, pitch: src.pitch, len: 1, vel: 0.5 })
  }
  return out.sort((a, b) => a.step - b.step || a.pitch - b.pitch)
}

export { DRUM_LINES, linePattern }
