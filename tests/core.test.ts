import { describe, expect, it } from 'vitest'
import { TEMPLATES, projectFromTemplate, blankProject } from '../src/model/project'
import { compileSong, resolveAll } from '../src/model/sound'
import { renderOffline } from '../src/engine/render'
import { printProject } from '../src/dsl/print'
import { buildProject } from '../src/dsl/build'
import { runGen } from '../src/model/generate'
import { Engine } from '../src/engine/core/engine'

const rms = (a: Float32Array, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, to - from)) }

describe('templates', () => {
  for (const tpl of TEMPLATES) {
    it(`${tpl.id} builds and every clip has notes`, () => {
      const p = projectFromTemplate(tpl, { seed: 3 })
      expect(p.tracks.length).toBeGreaterThan(1)
      for (const t of p.tracks) for (const c of t.clips) expect(c.notes.length, `${t.name}/${c.name}`).toBeGreaterThan(0)
      expect(p.arrangement.length).toBeGreaterThan(0)
    })
  }
})

describe('engine', () => {
  it('renders an audible, unclipped mix of a template', () => {
    const p = projectFromTemplate(TEMPLATES[0], { seed: 1 })
    p.arrangement = p.arrangement.slice(0, 3).map((a) => ({ ...a, bars: 2 }))
    const { tracks, master } = resolveAll(p)
    const [L, R] = renderOffline({ song: compileSong(p), tracks, master, sampleRate: 44100, samples: [], mode: 'song', tail: 1 })
    expect(L.length).toBeGreaterThan(44100 * 6)
    const level = rms(L)
    expect(level).toBeGreaterThan(0.02)
    let peak = 0, nan = false
    for (let i = 0; i < L.length; i++) { const a = Math.abs(L[i]); if (a > peak) peak = a; if (Number.isNaN(L[i]) || Number.isNaN(R[i])) nan = true }
    expect(nan).toBe(false)
    expect(peak).toBeLessThanOrEqual(1)
  })

  it('places kicks on the beat at the right tempo', () => {
    const p = blankProject()
    p.bpm = 120
    const drums = p.tracks[0]
    drums.clips[0].notes = runGen('euclid(4, 16, kick)', { key: p.key, length: 16, kind: 'drums' })
    p.tracks = [drums]
    p.scenes[0].slots = { [drums.id]: drums.clips[0].id }
    p.master.reverbSize = 0
    drums.mix.sendReverb = 0
    const { tracks, master } = resolveAll(p)
    const sr = 48000
    const [L] = renderOffline({ song: compileSong(p), tracks, master, sampleRate: sr, samples: [], mode: { scene: p.scenes[0].id, bars: 1 }, tail: 0.1 })
    // at 120 BPM a beat is 0.5 s; each beat window starts loud
    for (let b = 0; b < 4; b++) {
      const at = Math.round(b * 0.5 * sr)
      const hit = rms(L, at, at + 2000)
      const before = rms(L, at - 3000 > 0 ? at - 3000 : 0, at - 1000 > 0 ? at - 1000 : 1)
      expect(hit, `beat ${b}`).toBeGreaterThan(0.1)
      if (b > 0) expect(hit).toBeGreaterThan(before * 2)
    }
  })

  it('swaps a new song in on the next bar without stopping', () => {
    const p = blankProject()
    const bass = p.tracks[1]
    bass.clips[0].notes = [{ step: 0, pitch: 45, len: 4, vel: 0.8 }]
    const e = new Engine(44100)
    const { tracks, master } = resolveAll(p)
    e.handle({ type: 'params', tracks, master })
    e.handle({ type: 'song', song: compileSong(p), at: 'now' })
    e.handle({ type: 'launchScene', scene: p.scenes[0].id, at: 'now' })
    e.handle({ type: 'play', mode: 'live' })
    const L = new Float32Array(128), R = new Float32Array(128)
    for (let i = 0; i < 100; i++) e.process(L, R, 128)
    const p2 = structuredClone(p)
    p2.bpm = 140
    e.handle({ type: 'song', song: compileSong(p2), at: 'bar' })
    expect(e.pendingSong).not.toBeNull()
    for (let i = 0; i < 1000 && e.pendingSong; i++) e.process(L, R, 128)
    expect(e.pendingSong).toBeNull()
    expect(e.song.bpm).toBe(140)
    expect(e.playing).toBe(true)
    expect(Math.round(e.stepPos) % 16).toBeLessThan(2)
  })
})

describe('music language', () => {
  for (const tpl of TEMPLATES) {
    it(`round-trips ${tpl.id} through code`, () => {
      const p = projectFromTemplate(tpl, { seed: 2 })
      p.tracks[0].smart.warmth = 0.7
      p.tracks[0].mix.volume = 0.66
      // make one clip concrete (no generator) to test pattern printing
      const c = p.tracks.find((t) => t.kind === 'synth')!.clips[0]
      c.gen = undefined
      const files = printProject(p)
      const r = buildProject(files, p)
      expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      const q = r.project!
      expect(q.bpm).toBe(p.bpm)
      expect(q.tracks.map((t) => t.id)).toEqual(p.tracks.map((t) => t.id))
      expect(q.tracks[0].smart.warmth).toBeCloseTo(0.7)
      expect(q.tracks[0].mix.volume).toBeCloseTo(0.66)
      for (let i = 0; i < p.tracks.length; i++) {
        for (let j = 0; j < p.tracks[i].clips.length; j++) {
          const a = p.tracks[i].clips[j], b = q.tracks[i].clips[j]
          expect(b.id).toBe(a.id)
          const key = (n: { step: number; pitch: number; len: number }) => `${n.step}:${n.pitch}:${n.len}`
          if (p.tracks[i].kind === 'synth') expect(b.notes.map(key).sort()).toEqual(a.notes.map(key).sort())
          else expect(b.notes.map((n) => `${n.step}:${n.pitch}`).sort()).toEqual(a.notes.map((n) => `${n.step}:${n.pitch}`).sort())
        }
      }
      expect(q.scenes.map((s) => s.slots)).toEqual(p.scenes.map((s) => s.slots))
      expect(q.arrangement).toEqual(p.arrangement)
    })
  }

  it('parses the documented syntax', () => {
    const p = blankProject()
    const src = `tempo 124
key "A minor"
track drums drums punchy {
  clip main 1 bar {
    kick four-on-floor
    snare backbeat
    hat "..x...x...x...x."
  }
}
track bass synth analog-bass {
  warmth 0.7
  cutoff 500
  clip main 1 bar {
    "A1 ~ A1 C2 E2 . . . A1+E2 . . . G1! . . ."
  }
  clip arp 2 bars = arp("Am F", up, 1)
}
scene intro { drums: main }
scene drop { drums: main, bass: main }
arrange { intro 4, drop 8 }
`
    const r = buildProject([{ name: 'song.tac', source: src }], p)
    expect(r.diagnostics).toEqual([])
    const q = r.project!
    expect(q.bpm).toBe(124)
    expect(q.tracks.map((t) => t.name)).toEqual(['drums', 'bass'])
    expect(q.tracks[0].clips[0].notes.filter((n) => n.pitch === 0).length).toBe(4)
    const bass = q.tracks[1]
    expect(bass.synth!.cutoff).toBe(500)
    expect(bass.smart.warmth).toBe(0.7)
    expect(bass.clips[0].notes[0]).toEqual({ step: 0, pitch: 33, len: 2, vel: 0.8 })
    expect(bass.clips[0].notes.filter((n) => n.step === 8).length).toBe(2)
    expect(bass.clips[1].gen).toBe('arp("Am F", up, 1)')
    expect(bass.clips[1].notes.length).toBe(32)
    expect(q.arrangement.map((a) => a.bars)).toEqual([4, 8])
  })

  it('reports errors with positions and does not produce a project', () => {
    const p = blankProject()
    const r = buildProject([{ name: 'song.tac', source: 'tempo 120\ntrack bass synth nope {\n  clip x 1 bar {\n    "A1 Q7"\n  }\n}\nscene s { bass: missing }\n' }], p)
    expect(r.project).toBeNull()
    const msgs = r.diagnostics.map((d) => `${d.line}: ${d.message}`)
    expect(msgs.some((m) => m.startsWith('2:') && m.includes('Unknown synth preset'))).toBe(true)
    expect(msgs.some((m) => m.startsWith('4:') && m.includes('"Q7"'))).toBe(true)
    expect(msgs.some((m) => m.startsWith('7:') && m.includes('no clip named'))).toBe(true)
  })
})

import { migrateProject } from '../src/model/project'

describe('project files', () => {
  it('survives a save and reload as JSON', () => {
    const p = projectFromTemplate(TEMPLATES[2], { seed: 5, mood: 'dark' })
    const q = migrateProject(JSON.parse(JSON.stringify(p)))
    expect(q).toEqual(p)
  })
  it('fills in fields missing from older files', () => {
    const p = projectFromTemplate(TEMPLATES[0], { seed: 1 }) as unknown as Record<string, unknown>
    delete p.macros; delete p.midi
    const q = migrateProject(JSON.parse(JSON.stringify(p)))
    expect(q.macros.length).toBe(4)
    expect(q.midi).toEqual([])
  })
  it('refuses files from a newer version', () => {
    expect(() => migrateProject({ schema: 99, tracks: [] })).toThrow(/newer version/)
  })
})

import { existsSync } from 'node:fs'
import { DRUM_KITS, SYNTH_PRESETS, drumKit, synthPreset } from '../src/model/presets'
import { INSTRUMENTS, SAMPLED_KITS, instrumentSampleIds, soundPath, usedSampleIds } from '../src/model/soundpack'
import type { EngineTrackParams } from '../src/engine/protocol'

const synthTrack = (id: string, preset: string, over: Partial<EngineTrackParams> = {}): EngineTrackParams => ({
  id, kind: 'synth', synth: synthPreset(preset), volume: 1, pan: 0, sendDelay: 0, sendReverb: 0, drive: 0, tone: 0, duck: 0, humanize: 0, chaos: 0, density: 0, ...over,
})
const MASTER = { volume: 0.85, delayTime: 3, delayFeedback: 0.3, reverbSize: 0.5 }
const sine = (hz: number, secs: number, sr = 44100) => { const a = new Float32Array(Math.round(secs * sr)); for (let i = 0; i < a.length; i++) a[i] = Math.sin((2 * Math.PI * hz * i) / sr) * 0.8; return a }
/** Dominant frequency by counting upward zero crossings. */
const pitchOf = (a: Float32Array, from: number, to: number, sr: number) => { let n = 0; for (let i = from + 1; i < to; i++) if (a[i - 1] < 0 && a[i] >= 0) n++; return (n * sr) / (to - from) }

describe('sound pack', () => {
  it('has a file for every pack sample a kit or instrument uses', () => {
    const ids = [...SAMPLED_KITS.flatMap((k) => Object.values(k.pads)), ...Object.keys(INSTRUMENTS).flatMap(instrumentSampleIds)]
    for (const id of ids) {
      if (id.startsWith('factory:')) continue
      expect(existsSync(`public/sounds/${soundPath(id)}`), id).toBe(true)
    }
    expect(existsSync('public/sounds/CREDITS.md')).toBe(true)
  })
  it('lists every recorded kit as a drum kit, and its pads point at the pack', () => {
    for (const k of SAMPLED_KITS) {
      expect(DRUM_KITS.some((d) => d.name === k.name)).toBe(true)
      expect(drumKit(k.name).filter((p) => p.sample.startsWith('sound:')).length).toBeGreaterThanOrEqual(7)
    }
  })
  it('asks the bridge for every piano recording when a track plays the piano', () => {
    const p = blankProject()
    p.tracks[1].synth = synthPreset('grand-piano')
    expect(usedSampleIds(p)).toEqual(expect.arrayContaining(instrumentSampleIds('piano')))
  })
  it('keeps old projects working: presets without chorus get it from migration', () => {
    const p = projectFromTemplate(TEMPLATES[0], { seed: 1 })
    for (const t of p.tracks) if (t.synth) delete (t.synth as unknown as Record<string, unknown>).chorus
    const q = migrateProject(JSON.parse(JSON.stringify(p)))
    for (const t of q.tracks) if (t.synth) expect(typeof t.synth.chorus).toBe('number')
  })
})

describe('sampled instruments', () => {
  it('plays the nearest recording, repitched to the note', () => {
    const sr = 44100
    const e = new Engine(sr)
    // recordings of A3 (220 Hz) and A4 (440 Hz)
    e.handle({ type: 'sample', id: 'sound:piano/57', channels: [sine(220, 2)], sampleRate: sr })
    e.handle({ type: 'sample', id: 'sound:piano/69', channels: [sine(440, 2)], sampleRate: sr })
    const t = synthTrack('k', 'grand-piano')
    t.synth = { ...t.synth!, chorus: 0, cutoff: 18000 }
    e.handle({ type: 'params', tracks: [t], master: { ...MASTER, reverbSize: 0 } })
    e.handle({ type: 'noteOn', track: 'k', pitch: 72, vel: 0.9 }) // C5, nearest recording A4, up 3 semitones
    const L = new Float32Array(sr), R = new Float32Array(sr)
    e.process(L, R, sr)
    const f = pitchOf(L, 4410, 44100, sr)
    expect(f).toBeGreaterThan(515)
    expect(f).toBeLessThan(532) // C5 = 523 Hz
  })
  it('stays silent, without errors, until the recordings arrive', () => {
    const e = new Engine(44100)
    e.handle({ type: 'params', tracks: [synthTrack('k', 'grand-piano')], master: MASTER })
    e.handle({ type: 'noteOn', track: 'k', pitch: 60, vel: 0.9 })
    const L = new Float32Array(4096), R = new Float32Array(4096)
    e.process(L, R, 4096)
    expect(rms(L)).toBe(0)
  })
})

describe('effects', () => {
  it('chorus widens a mono synth into stereo', () => {
    const run = (chorus: number) => {
      const e = new Engine(44100)
      const t = synthTrack('s', 'warm-pad')
      t.synth = { ...t.synth!, chorus, unison: 1, ampA: 0.01, spread: 0 }
      e.handle({ type: 'params', tracks: [t], master: { ...MASTER, reverbSize: 0 } })
      e.handle({ type: 'noteOn', track: 's', pitch: 60, vel: 0.9 })
      const L = new Float32Array(44100), R = new Float32Array(44100)
      e.process(L, R, 44100)
      let d = 0
      for (let i = 0; i < L.length; i++) d += Math.abs(L[i] - R[i])
      return d / L.length
    }
    expect(run(0)).toBeLessThan(1e-6)
    expect(run(0.6)).toBeGreaterThan(0.005)
  })
  it('reverb tail rings out and then decays to silence', () => {
    const e = new Engine(44100)
    const t = synthTrack('s', 'pluck', { sendReverb: 1 })
    e.handle({ type: 'params', tracks: [t], master: { ...MASTER, reverbSize: 0.6, delayFeedback: 0 } })
    e.handle({ type: 'preview', track: 's', pitch: 60, vel: 1, len: 1 })
    const n = 44100 * 8
    const L = new Float32Array(n), R = new Float32Array(n)
    e.process(L, R, n)
    expect(rms(L, 44100, 88200)).toBeGreaterThan(1e-3) // still ringing after a second
    expect(rms(L, n - 44100, n)).toBeLessThan(1e-4)
    for (let i = 0; i < n; i++) expect(Number.isFinite(L[i])).toBe(true)
  })
})

describe('presets', () => {
  it('every synth preset makes sound', () => {
    for (const pr of SYNTH_PRESETS) {
      if (pr.params.osc1 in INSTRUMENTS) continue
      const e = new Engine(44100)
      e.handle({ type: 'params', tracks: [synthTrack('s', pr.name)], master: MASTER })
      e.handle({ type: 'noteOn', track: 's', pitch: 48, vel: 0.9 })
      const L = new Float32Array(44100 * 2), R = new Float32Array(44100 * 2)
      e.process(L, R, L.length)
      expect(rms(L), pr.name).toBeGreaterThan(1e-3)
    }
  })
})
