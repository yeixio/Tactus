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
