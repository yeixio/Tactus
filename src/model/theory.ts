import { SCALES, type Key, type ScaleName } from './types'

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** MIDI number -> "A1", "C#4". Middle C = C4 = 60. */
export function noteName(midi: number): string {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)
}

/** "A1", "c#4", "Bb2" -> MIDI number, or null. */
export function parseNote(s: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(s)
  if (!m) return null
  let n = LETTER[m[1].toUpperCase()]
  if (m[2] === '#') n++
  if (m[2] === 'b') n--
  return n + (parseInt(m[3], 10) + 1) * 12
}

export function pitchClassName(pc: number): string {
  return NOTE_NAMES[((pc % 12) + 12) % 12]
}

export function parsePitchClass(s: string): number | null {
  const m = /^([A-Ga-g])([#b]?)$/.exec(s.trim())
  if (!m) return null
  let n = LETTER[m[1].toUpperCase()]
  if (m[2] === '#') n++
  if (m[2] === 'b') n--
  return (n + 12) % 12
}

export function keyName(k: Key): string {
  return `${pitchClassName(k.root)} ${k.scale}`
}

/** "A minor", "F# dorian", "C" -> Key */
export function parseKey(s: string): Key | null {
  const parts = s.trim().split(/\s+/)
  const root = parsePitchClass(parts[0] ?? '')
  if (root === null) return null
  const scale = (parts.slice(1).join(' ') || 'major').toLowerCase()
  if (!(scale in SCALES)) return null
  return { root, scale: scale as ScaleName }
}

export function inKey(pitch: number, key: Key): boolean {
  const pc = (((pitch - key.root) % 12) + 12) % 12
  return (SCALES[key.scale] as readonly number[]).includes(pc)
}

/** Nearest in-key pitch (ties resolve downward). */
export function snapToKey(pitch: number, key: Key): number {
  for (let d = 0; d < 12; d++) {
    if (inKey(pitch - d, key)) return pitch - d
    if (inKey(pitch + d, key)) return pitch + d
  }
  return pitch
}

/** Scale degree (0-based, may exceed scale length or be negative) -> MIDI pitch, from a base octave. */
export function degreeToPitch(degree: number, key: Key, octave = 4): number {
  const sc = SCALES[key.scale]
  const n = sc.length
  const oct = Math.floor(degree / n)
  const idx = ((degree % n) + n) % n
  return (octave + 1) * 12 + key.root + sc[idx] + oct * 12
}

const CHORD_QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  '9': [0, 4, 7, 10, 14],
  add9: [0, 4, 7, 14],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
}

export interface Chord {
  root: number // pitch class
  intervals: number[]
  name: string
}

/** "Am", "Fmaj7", "C#m7", "Gsus4" -> Chord */
export function parseChord(s: string): Chord | null {
  const m = /^([A-G][#b]?)(.*)$/.exec(s.trim())
  if (!m) return null
  const root = parsePitchClass(m[1])
  const q = CHORD_QUALITIES[m[2]]
  if (root === null || !q) return null
  return { root, intervals: q, name: s.trim() }
}

export function parseProgression(s: string): Chord[] {
  return s.split(/[\s,|-]+/).filter(Boolean).map(parseChord).filter((c): c is Chord => !!c)
}

/** Voice a chord close to a target center pitch, with simple voice leading from a previous voicing. */
export function voiceChord(ch: Chord, center = 60, prev?: number[]): number[] {
  const base = Math.floor((center - ch.root) / 12) * 12 + ch.root
  let notes = ch.intervals.map((i) => base + i)
  if (prev && prev.length) {
    // Try inversions and keep the one closest to the previous voicing.
    let best = notes
    let bestCost = Infinity
    for (let inv = -3; inv <= 3; inv++) {
      const v = invert(notes, inv)
      const cost = v.reduce((a, p, i) => a + Math.abs(p - (prev[Math.min(i, prev.length - 1)] ?? p)), 0)
      if (cost < bestCost) { bestCost = cost; best = v }
    }
    notes = best
  }
  return notes
}

function invert(notes: number[], n: number): number[] {
  const v = [...notes]
  if (n > 0) for (let i = 0; i < n; i++) { const x = v.shift()!; v.push(x + 12) }
  if (n < 0) for (let i = 0; i < -n; i++) { const x = v.pop()!; v.unshift(x - 12) }
  return v
}

/** Diatonic triads in a key, with roman numerals: used for chord suggestions. */
export function diatonicChords(key: Key): { roman: string; chord: Chord }[] {
  const sc = SCALES[key.scale] as readonly number[]
  if (sc.length !== 7) return []
  const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']
  return sc.map((_, i) => {
    const r = sc[i]
    const third = (sc[(i + 2) % 7] - r + 12) % 12
    const fifth = (sc[(i + 4) % 7] - r + 12) % 12
    let q = ''
    let roman = romans[i]
    if (third === 3 && fifth === 7) { q = 'm'; roman = roman.toLowerCase() }
    else if (third === 3 && fifth === 6) { q = 'dim'; roman = roman.toLowerCase() + '°' }
    else if (third === 4 && fifth === 8) { q = 'aug'; roman += '+' }
    const pc = (key.root + r) % 12
    const name = pitchClassName(pc) + q
    return { roman, chord: parseChord(name)! }
  })
}

/** Musically common progressions expressed as scale-degree indexes (0-based). */
export const PROGRESSIONS: { name: string; degrees: number[] }[] = [
  { name: 'Pop (I–V–vi–IV)', degrees: [0, 4, 5, 3] },
  { name: 'Melancholy (i–VI–III–VII)', degrees: [0, 5, 2, 6] },
  { name: 'Classic (vi–IV–I–V)', degrees: [5, 3, 0, 4] },
  { name: 'Deep (i–iv–VII–III)', degrees: [0, 3, 6, 2] },
  { name: 'Rising (I–ii–iii–IV)', degrees: [0, 1, 2, 3] },
  { name: 'Two-chord vamp (i–VII)', degrees: [0, 6, 0, 6] },
]

export function progressionInKey(key: Key, degrees: number[]): string {
  const dc = diatonicChords(key)
  if (!dc.length) return 'C Am F G'
  return degrees.map((d) => dc[d % 7].chord.name).join(' ')
}
