import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('tactus', {
  platform: process.platform,
  openProjectDialog: () => ipcRenderer.invoke('project:openDialog'),
  openProjectPath: (path: string) => ipcRenderer.invoke('project:openPath', path),
  saveProject: (args: unknown) => ipcRenderer.invoke('project:save', args),
  exportAudio: (name: string, data: ArrayBuffer, dir?: string) => ipcRenderer.invoke('audio:export', name, data, dir),
  recent: () => ipcRenderer.invoke('project:recent'),
  saveDraft: (json: string) => ipcRenderer.invoke('draft:save', json),
  loadDraft: () => ipcRenderer.invoke('draft:load'),
  reveal: (path: string) => ipcRenderer.invoke('shell:reveal', path),
  readSound: (rel: string) => ipcRenderer.invoke('sound:read', rel),
})
