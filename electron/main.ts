import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'

const PRODUCT = app.getName()
const EXT = '.tactus'
const userData = () => app.getPath('userData')
const recentFile = () => path.join(userData(), 'recent.json')
const draftFile = () => path.join(userData(), 'draft.json')

async function readRecent(): Promise<{ path: string; name: string; updatedAt: string }[]> {
  try { return JSON.parse(await fs.readFile(recentFile(), 'utf8')) } catch { return [] }
}
async function pushRecent(p: string, name: string) {
  const list = (await readRecent()).filter((r) => r.path !== p)
  list.unshift({ path: p, name, updatedAt: new Date().toISOString() })
  await fs.mkdir(userData(), { recursive: true })
  await fs.writeFile(recentFile(), JSON.stringify(list.slice(0, 12), null, 2))
}

async function loadProject(dir: string) {
  const json = await fs.readFile(path.join(dir, 'project.json'), 'utf8')
  const samples: { name: string; data: ArrayBuffer }[] = []
  const sdir = path.join(dir, 'samples')
  if (existsSync(sdir)) {
    for (const f of await fs.readdir(sdir)) {
      const b = await fs.readFile(path.join(sdir, f))
      samples.push({ name: f, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) })
    }
  }
  const name = JSON.parse(json).name ?? path.basename(dir)
  await pushRecent(dir, name)
  return { path: dir, json, samples }
}

interface SaveArgs {
  path: string | null
  name: string
  json: string
  files: { path: string; content: string }[]
  samples: { name: string; data: ArrayBuffer }[]
}

async function saveProject(a: SaveArgs, win: BrowserWindow | null) {
  let dir = a.path
  if (!dir) {
    const r = await dialog.showSaveDialog(win!, {
      title: 'Save project',
      defaultPath: path.join(app.getPath('music'), a.name.replace(/[\\/:*?"<>|]/g, '-') + EXT),
      buttonLabel: 'Save',
      properties: ['createDirectory'],
    })
    if (r.canceled || !r.filePath) return null
    dir = r.filePath.endsWith(EXT) ? r.filePath : r.filePath + EXT
  }
  await fs.mkdir(path.join(dir, 'src', 'tracks'), { recursive: true })
  await fs.mkdir(path.join(dir, 'samples'), { recursive: true })
  await fs.mkdir(path.join(dir, 'exports'), { recursive: true })
  // write atomically: temp file then rename, so a crash never leaves a half-written project
  const tmp = path.join(dir, 'project.json.tmp')
  await fs.writeFile(tmp, a.json)
  await fs.rename(tmp, path.join(dir, 'project.json'))
  // source mirror (for reading and version control); project.json stays the source of truth
  const srcDir = path.join(dir, 'src')
  const keep = new Set(a.files.map((f) => path.join(srcDir, f.path)))
  for (const f of a.files) await fs.writeFile(path.join(srcDir, f.path), f.content)
  for (const f of await fs.readdir(path.join(srcDir, 'tracks'))) {
    const full = path.join(srcDir, 'tracks', f)
    if (f.endsWith('.tac') && !keep.has(full)) await fs.unlink(full)
  }
  for (const s of a.samples) {
    const target = path.join(dir, 'samples', path.basename(s.name))
    if (!existsSync(target)) await fs.writeFile(target, Buffer.from(s.data))
  }
  const manifest = { format: 'tactus-project', schema: JSON.parse(a.json).schema, app: PRODUCT, version: app.getVersion() }
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await pushRecent(dir, a.name)
  return dir
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#16171b',
    title: PRODUCT,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  })
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  return win
}

app.whenReady().then(() => {
  // Web MIDI (including sysex-free controller input) needs an explicit grant.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'midi' || permission === 'midiSysex' || permission === 'media'))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'midi' || permission === 'midiSysex' || permission === 'media')

  ipcMain.handle('project:openDialog', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = await dialog.showOpenDialog(win!, { title: 'Open project', properties: ['openDirectory', 'openFile'], filters: [{ name: 'Projects', extensions: ['tactus', 'json'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    let p = r.filePaths[0]
    if (p.endsWith('project.json')) p = path.dirname(p)
    return loadProject(p)
  })
  ipcMain.handle('project:openPath', (_e, p: string) => loadProject(p))
  ipcMain.handle('project:save', (e, a: SaveArgs) => saveProject(a, BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle('project:recent', async () => (await readRecent()).filter((r) => existsSync(path.join(r.path, 'project.json'))))
  ipcMain.handle('draft:save', async (_e, json: string) => { await fs.mkdir(userData(), { recursive: true }); await fs.writeFile(draftFile(), json) })
  ipcMain.handle('draft:load', async () => { try { return await fs.readFile(draftFile(), 'utf8') } catch { return null } })
  ipcMain.handle('shell:reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('audio:export', async (e, name: string, data: ArrayBuffer, dir?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = await dialog.showSaveDialog(win!, {
      title: 'Export audio',
      defaultPath: path.join(dir ? path.join(dir, 'exports') : app.getPath('music'), name),
      filters: [{ name: 'WAV audio', extensions: ['wav'] }],
    })
    if (r.canceled || !r.filePath) return null
    await fs.writeFile(r.filePath, Buffer.from(data))
    return r.filePath
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
