import { create } from 'zustand'
import { produce, type Draft, freeze } from 'immer'
import type { Project } from '../model/types'
import type { EngineStatus, PlayedEvent, Quantize } from '../engine/protocol'
import { blankProject } from '../model/project'

export type Workspace = 'home' | 'studio' | 'code' | 'lab' | 'perform'

export interface Tip {
  id: string
  text: string
  action?: { label: string; run: () => void }
}

export interface UpdateOpts {
  /** Changes with the same key within a short window merge into one undo step (knob drags). */
  key?: string
  origin?: 'visual' | 'code'
  history?: boolean
  /** How the audio engine should pick up a structural change. Visual edits default to now. */
  at?: Quantize
}

interface AppState {
  project: Project
  past: Project[]
  future: Project[]
  lastKey: string | null
  lastTime: number
  origin: 'visual' | 'code' | 'load'
  applyAt: Quantize
  revision: number
  workspace: Workspace
  selectedTrack: string | null
  selectedClip: string | null
  quantize: Quantize
  projectPath: string | null
  dirty: boolean
  savedAt: number | null
  learn: boolean
  learnTarget: string | null
  tips: Tip[]
  codeJump: { clip?: string; file?: string; line?: number } | null
  update: (recipe: (p: Draft<Project>) => void, opts?: UpdateOpts) => void
  setProject: (p: Project, opts?: { path?: string | null; origin?: 'code' | 'load'; keepHistory?: boolean; at?: Quantize }) => void
  undo: () => void
  redo: () => void
  select: (track: string | null, clip?: string | null) => void
  setWorkspace: (w: Workspace) => void
  tip: (t: Tip) => void
  dismissTip: (id: string) => void
}

const HISTORY = 200

const dismissed = (() => {
  try { return new Set<string>(JSON.parse(localStorage.getItem('tips.dismissed') ?? '[]')) } catch { return new Set<string>() }
})()

export const useApp = create<AppState>((set, get) => ({
  project: freeze(blankProject(), true),
  past: [],
  future: [],
  lastKey: null,
  lastTime: 0,
  origin: 'load',
  applyAt: 'now',
  revision: 0,
  workspace: 'home',
  selectedTrack: null,
  selectedClip: null,
  quantize: 'bar',
  projectPath: null,
  dirty: false,
  savedAt: null,
  learn: false,
  learnTarget: null,
  tips: [],
  codeJump: null,

  update: (recipe, opts = {}) => {
    const s = get()
    const next = produce(s.project, (d) => { recipe(d); d.updatedAt = new Date().toISOString() })
    if (next === s.project) return
    const now = Date.now()
    const merge = opts.key && opts.key === s.lastKey && now - s.lastTime < 1200
    const recordHistory = opts.history !== false
    set({
      project: next,
      past: recordHistory && !merge ? [...s.past.slice(-HISTORY + 1), s.project] : s.past,
      future: recordHistory ? [] : s.future,
      lastKey: opts.key ?? null,
      lastTime: now,
      origin: opts.origin ?? 'visual',
      applyAt: opts.at ?? 'now',
      revision: s.revision + 1,
      dirty: true,
    })
  },

  setProject: (p, opts = {}) => {
    const s = get()
    const frozen = freeze(p, true)
    const first = p.tracks[0]
    const keepSel = p.tracks.some((t) => t.id === s.selectedTrack)
    set({
      project: frozen,
      past: opts.keepHistory ? [...s.past.slice(-HISTORY + 1), s.project] : [],
      future: [],
      lastKey: null,
      origin: opts.origin ?? 'load',
      applyAt: opts.at ?? 'now',
      revision: s.revision + 1,
      projectPath: opts.path === undefined ? s.projectPath : opts.path,
      dirty: opts.origin === 'code',
      selectedTrack: keepSel ? s.selectedTrack : first?.id ?? null,
      selectedClip: keepSel ? s.selectedClip : first?.clips[0]?.id ?? null,
    })
  },

  undo: () => {
    const s = get()
    const prev = s.past[s.past.length - 1]
    if (!prev) return
    set({ project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], lastKey: null, origin: 'visual', applyAt: 'now', revision: s.revision + 1, dirty: true })
  },
  redo: () => {
    const s = get()
    const next = s.future[0]
    if (!next) return
    set({ project: next, past: [...s.past, s.project], future: s.future.slice(1), lastKey: null, origin: 'visual', applyAt: 'now', revision: s.revision + 1, dirty: true })
  },

  select: (track, clip) => {
    const p = get().project
    const t = p.tracks.find((x) => x.id === track)
    set({ selectedTrack: track, selectedClip: clip !== undefined ? clip : t?.clips[0]?.id ?? null })
  },
  setWorkspace: (w) => set({ workspace: w }),
  tip: (t) => {
    if (dismissed.has(t.id) || get().tips.some((x) => x.id === t.id)) return
    set({ tips: [...get().tips.slice(-2), t] })
    // tips are brief: they fade on their own unless they offer an action
    if (!t.action) setTimeout(() => set({ tips: get().tips.filter((x) => x.id !== t.id) }), 14000)
  },
  dismissTip: (id) => {
    dismissed.add(id)
    try { localStorage.setItem('tips.dismissed', JSON.stringify([...dismissed])) } catch { /* storage unavailable */ }
    set({ tips: get().tips.filter((t) => t.id !== id) })
  },
}))

interface EngineState {
  status: EngineStatus | null
  events: PlayedEvent[]
  ready: boolean
  error: string | null
  latencyMs: number
  sampleRate: number
  midiInputs: string[]
  lastMidi: string | null
  recording: boolean
}

export const useEngine = create<EngineState>(() => ({
  status: null,
  events: [],
  ready: false,
  error: null,
  latencyMs: 0,
  sampleRate: 0,
  midiInputs: [],
  lastMidi: null,
  recording: false,
}))

export const currentTrack = (s: { project: Project; selectedTrack: string | null }) => s.project.tracks.find((t) => t.id === s.selectedTrack) ?? null
