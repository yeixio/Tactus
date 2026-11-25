// File system access: Electron (desktop) when available, browser fallbacks otherwise.

import { migrateProject } from './model/project'
import type { Project } from './model/types'
import { printProject } from './dsl/print'
import { PROJECT_EXT } from './brand'

interface DesktopApi {
  platform: string
  openProjectDialog(): Promise<{ path: string; json: string; samples: { name: string; data: ArrayBuffer }[] } | null>
  openProjectPath(path: string): Promise<{ path: string; json: string; samples: { name: string; data: ArrayBuffer }[] }>
  saveProject(a: { path: string | null; name: string; json: string; files: { path: string; content: string }[]; samples: { name: string; data: ArrayBuffer }[] }): Promise<string | null>
  exportAudio(name: string, data: ArrayBuffer, dir?: string): Promise<string | null>
  recent(): Promise<{ path: string; name: string; updatedAt: string }[]>
  saveDraft(json: string): Promise<void>
  loadDraft(): Promise<string | null>
  reveal(path: string): Promise<void>
  readSound?(rel: string): Promise<ArrayBuffer>
}

const desktop: DesktopApi | undefined = (globalThis as unknown as { tactus?: DesktopApi }).tactus
export const isDesktop = !!desktop
export const isMac = desktop ? desktop.platform === 'darwin' : /Mac/.test(navigator.platform)

/** Read a file of the factory sound pack (public/sounds), e.g. "piano/60.flac". */
export async function loadSound(rel: string): Promise<ArrayBuffer> {
  if (desktop?.readSound && location.protocol === 'file:') return desktop.readSound(rel)
  const r = await fetch(new URL(`sounds/${rel}`, document.baseURI))
  if (!r.ok) throw new Error(`Missing sound ${rel}`)
  return r.arrayBuffer()
}

/** Raw bytes of user samples, by file name. Decoded by the audio bridge. */
export const userSampleBytes = new Map<string, ArrayBuffer>()

export interface Loaded {
  project: Project
  path: string | null
}

export async function openProject(): Promise<Loaded | null> {
  if (desktop) {
    const r = await desktop.openProjectDialog()
    if (!r) return null
    return fromDesktop(r)
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      try { resolve({ project: migrateProject(JSON.parse(await f.text())), path: null }) } catch (e) { reject(e) }
    }
    input.click()
  })
}

export async function openRecent(path: string): Promise<Loaded> {
  if (!desktop) throw new Error('Recent projects need the desktop app')
  return fromDesktop(await desktop.openProjectPath(path))
}

function fromDesktop(r: { path: string; json: string; samples: { name: string; data: ArrayBuffer }[] }): Loaded {
  for (const s of r.samples) userSampleBytes.set(s.name, s.data)
  return { project: migrateProject(JSON.parse(r.json)), path: r.path }
}

function usedSamples(p: Project) {
  const names = new Set<string>()
  for (const t of p.tracks) {
    for (const pad of t.pads ?? []) if (pad.sample.startsWith('user:')) names.add(pad.sample.slice(5))
    if (t.synth?.sample?.startsWith('user:')) names.add(t.synth.sample.slice(5))
  }
  return [...names].flatMap((n) => (userSampleBytes.has(n) ? [{ name: n, data: userSampleBytes.get(n)! }] : []))
}

/** Save to the project folder. Returns the folder path (desktop), or null if cancelled. In the browser it downloads a file. */
export async function saveProject(p: Project, path: string | null, saveAs = false): Promise<string | null> {
  const json = JSON.stringify(p, null, 1)
  if (desktop) {
    const files = printProject(p).map((f) => ({ path: f.name, content: f.source }))
    return desktop.saveProject({ path: saveAs ? null : path, name: p.name, json, files, samples: usedSamples(p) })
  }
  download(new Blob([json], { type: 'application/json' }), `${p.name}.${PROJECT_EXT}.json`)
  saveDraft(p)
  return 'browser'
}

export async function saveDraft(p: Project) {
  const json = JSON.stringify(p)
  if (desktop) return desktop.saveDraft(json)
  try { localStorage.setItem('draft', json) } catch { /* storage full or unavailable */ }
}

export async function loadDraft(): Promise<Project | null> {
  try {
    const json = desktop ? await desktop.loadDraft() : localStorage.getItem('draft')
    return json ? migrateProject(JSON.parse(json)) : null
  } catch { return null }
}

export async function recentProjects() {
  return desktop ? desktop.recent() : []
}

export async function exportAudio(name: string, wav: ArrayBuffer, projectPath: string | null): Promise<string | null> {
  if (desktop) return desktop.exportAudio(name, wav, projectPath ?? undefined)
  download(new Blob([wav], { type: 'audio/wav' }), name)
  return name
}

export function reveal(path: string) { desktop?.reveal(path) }

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
