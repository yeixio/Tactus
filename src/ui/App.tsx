import { useEffect, useRef, useState } from 'react'
import { useApp, useEngine, type Workspace } from '../state/store'
import { audio } from '../audio/bridge'
import { initMidi } from '../audio/midi'
import { saveDraft, saveProject, exportAudio, isMac } from '../platform'
import { NOTE_NAMES, keyName } from '../model/theory'
import { SCALES, type ScaleName } from '../model/types'
import { APP_NAME } from '../brand'
import { Icon, NumberDrag } from './controls'
import { Home } from './Home'
import { Studio } from './Studio'
import { CodeWorkspace } from './Code'
import { Lab } from './Lab'
import { Perform } from './Perform'
import { ExportDialog } from './Export'

const TABS: { id: Workspace; label: string; key: string }[] = [
  { id: 'home', label: 'Home', key: '' },
  { id: 'studio', label: 'Studio', key: 'F1' },
  { id: 'code', label: 'Code', key: 'F2' },
  { id: 'lab', label: 'Instrument Lab', key: 'F3' },
  { id: 'perform', label: 'Perform', key: 'F4' },
]

export function App() {
  const ws = useApp((s) => s.workspace)
  const [exporting, setExporting] = useState(false)
  useGlobalKeys()
  useAutosave()
  useLearnCapture()
  useEffect(() => {
    initMidi()
    // the audio context may only start after a user gesture
    const start = () => audio.ensure()
    window.addEventListener('pointerdown', start, { once: true })
    window.addEventListener('keydown', start, { once: true })
    audio.onRecorded = async (wav) => {
      const p = useApp.getState().project
      await exportAudio(`${p.name} - performance ${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.wav`, wav, useApp.getState().projectPath)
    }
  }, [])
  return (
    <div className={`app ws-${ws} ${isMac ? 'mac' : ''}`}>
      <TopBar onExport={() => setExporting(true)} />
      <main className="workspace">
        {ws === 'home' && <Home />}
        {ws === 'studio' && <Studio />}
        {ws === 'code' && <CodeWorkspace />}
        {ws === 'lab' && <Lab />}
        {ws === 'perform' && <Perform />}
      </main>
      <StatusBar />
      <Tips />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  )
}

function TopBar({ onExport }: { onExport: () => void }) {
  const ws = useApp((s) => s.workspace)
  const p = useApp((s) => s.project)
  const canUndo = useApp((s) => s.past.length > 0)
  const canRedo = useApp((s) => s.future.length > 0)
  const status = useEngine((s) => s.status)
  const recording = useEngine((s) => s.recording)
  const dirty = useApp((s) => s.dirty)
  const savedAt = useApp((s) => s.savedAt)
  const path = useApp((s) => s.projectPath)
  const st = useApp.getState()
  const playing = !!status?.playing
  const step = status?.step ?? 0
  const pos = `${Math.floor(step / 16) + 1}.${Math.floor((step % 16) / 4) + 1}.${Math.floor(step % 4) + 1}`
  const [editName, setEditName] = useState(false)
  return (
    <header className="topbar">
      <div className="brand" onClick={() => st.setWorkspace('home')}>{APP_NAME}</div>
      {editName ? (
        <input className="proj-name" autoFocus defaultValue={p.name} onBlur={(e) => { const v = e.target.value.trim(); if (v) st.update((d) => { d.name = v }); setEditName(false) }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      ) : <div className="proj-name" title="Click to rename" onClick={() => setEditName(true)}>{p.name}<span className="save-state">{path ? (dirty ? ' · saving…' : ' · saved') : savedAt || dirty ? ' · draft' : ''}</span></div>}
      <nav className="tabs">
        {TABS.map((t) => <button key={t.id} className={ws === t.id ? 'on' : ''} onClick={() => st.setWorkspace(t.id)} title={t.key}>{t.label}</button>)}
      </nav>
      <div className="transport">
        <button className={`tbtn ${playing && status?.mode === 'live' ? 'on' : ''}`} title="Play the session: clips and scenes (Space)" onClick={() => audio.play('live')}><Icon name="play" /></button>
        <button className={`tbtn ${playing && status?.mode === 'song' ? 'on' : ''}`} title="Play the arranged song from the start" onClick={() => audio.play('song')}><Icon name="song" /></button>
        <button className="tbtn" title="Stop (Space)" onClick={() => audio.stop()}><Icon name="stop" /></button>
        <button className={`tbtn rec ${recording ? 'on' : ''}`} title={recording ? 'Stop recording and save a WAV' : 'Record what you hear to a WAV'} onClick={() => audio.record(!recording)}><Icon name="rec" /></button>
        <div className="pos mono">{pos}</div>
        <div className="tfield"><span>BPM</span><NumberDrag value={p.bpm} min={40} max={240} onChange={(v) => st.update((d) => { d.bpm = v }, { key: 'bpm', at: 'beat' })} width={42} /></div>
        <div className="tfield"><span>Key</span>
          <select value={p.key.root} onChange={(e) => st.update((d) => { d.key.root = Number(e.target.value) })}>{NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}</select>
          <select value={p.key.scale} onChange={(e) => st.update((d) => { d.key.scale = e.target.value as ScaleName })} title={keyName(p.key)}>{Object.keys(SCALES).map((s) => <option key={s}>{s}</option>)}</select>
        </div>
        <div className="tfield" title="Swing: delays every other 16th"><span>Swing</span><NumberDrag value={Math.round(p.swing * 100)} min={0} max={50} onChange={(v) => st.update((d) => { d.swing = v / 100 }, { key: 'swing' })} suffix="%" width={40} /></div>
      </div>
      <div className="grow" />
      <label className="check safe" title="Safe mode keeps sounds in pleasant ranges and snaps notes to the key. Turn it off for full control.">
        <input type="checkbox" checked={p.guardrails} onChange={(e) => st.update((d) => { d.guardrails = e.target.checked })} /> Safe mode
      </label>
      <button className="ghost" disabled={!canUndo} onClick={() => st.undo()} title={`Undo (${isMac ? '⌘' : 'Ctrl'}+Z)`}><Icon name="undo" /></button>
      <button className="ghost" disabled={!canRedo} onClick={() => st.redo()} title={`Redo (${isMac ? '⌘⇧' : 'Ctrl+Shift+'}Z)`}><Icon name="redo" /></button>
      <button className="ghost" onClick={() => save(true)} title="Save the project to a folder">Save</button>
      <button className="primary" onClick={onExport}>Export</button>
    </header>
  )
}

async function save(saveAs = false) {
  const st = useApp.getState()
  try {
    const path = await saveProject(st.project, st.projectPath, saveAs || !st.projectPath)
    if (path && path !== 'browser') useApp.setState({ projectPath: path, dirty: false, savedAt: Date.now() })
    else if (path) useApp.setState({ dirty: false, savedAt: Date.now() })
  } catch (e) {
    st.tip({ id: `save-error-${Date.now()}`, text: `Could not save: ${(e as Error).message}` })
  }
}

function StatusBar() {
  const status = useEngine((s) => s.status)
  const ready = useEngine((s) => s.ready)
  const err = useEngine((s) => s.error)
  const sr = useEngine((s) => s.sampleRate)
  const lat = useEngine((s) => s.latencyMs)
  const midi = useEngine((s) => s.midiInputs)
  const pending = status?.songPending
  const load = status?.load ?? 0
  return (
    <footer className="statusbar">
      {err ? <span className="bad">Audio error: {err}</span> : !ready ? <span className="muted">Click anywhere to start audio</span> : (
        <>
          <span>DSP <b className={load > 0.7 ? 'bad' : ''}>{Math.round(load * 100)}%</b></span>
          <span>Voices <b>{status?.voices ?? 0}</b></span>
          <span>{(sr / 1000).toFixed(1)} kHz · {lat} ms output latency</span>
          <span className="meter-inline"><MasterMeter /></span>
          {pending && <span className="pill warn">Code change waiting for the next boundary</span>}
        </>
      )}
      <div className="grow" />
      <span className="muted">{midi.length ? `MIDI: ${midi.join(', ')}` : 'No MIDI device'}</span>
      <SampleRatePicker />
    </footer>
  )
}

function MasterMeter() {
  const v = useEngine((s) => s.status?.meters.master ?? 0)
  const db = v > 0 ? 20 * Math.log10(v) : -60
  return <><span className="mini-meter"><span style={{ width: `${Math.max(0, Math.min(1, (db + 48) / 48)) * 100}%` }} className={v > 0.97 ? 'hot' : ''} /></span><span className="mono small">{db > -59 ? `${db.toFixed(1)} dB` : '−∞'}</span></>
}

function SampleRatePicker() {
  const sr = useEngine((s) => s.sampleRate)
  if (!sr) return null
  return (
    <select className="small" value={sr === 44100 || sr === 48000 ? sr : ''} onChange={(e) => audio.setSampleRate(Number(e.target.value))} title="Audio sample rate">
      {sr !== 44100 && sr !== 48000 && <option value="">{sr} Hz</option>}
      <option value={44100}>44.1 kHz</option><option value={48000}>48 kHz</option>
    </select>
  )
}

function Tips() {
  const tips = useApp((s) => s.tips)
  const dismiss = useApp((s) => s.dismissTip)
  if (!tips.length) return null
  return (
    <div className="tips">
      {tips.map((t) => (
        <div key={t.id} className="tip">
          <span>{t.text}</span>
          <div className="row end">
            {t.action && <button className="primary small" onClick={() => { t.action!.run(); dismiss(t.id) }}>{t.action.label}</button>}
            <button className="ghost small" onClick={() => dismiss(t.id)}>Got it</button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------------------------------ hooks

const KEYMAP: Record<string, number> = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14 }

function useGlobalKeys() {
  const octave = useRef(4)
  useEffect(() => {
    const down = new Map<string, { track: string; pitch: number }>()
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      return el.closest('.cm-editor') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
    }
    const kd = (e: KeyboardEvent) => {
      const st = useApp.getState()
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); return }
      if (mod && e.key.toLowerCase() === 'z' && !(e.target as HTMLElement).closest('.cm-editor')) {
        e.preventDefault()
        if (e.shiftKey) st.redo(); else st.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y' && !(e.target as HTMLElement).closest('.cm-editor')) { e.preventDefault(); st.redo(); return }
      if (e.key.startsWith('F') && ['F1', 'F2', 'F3', 'F4'].includes(e.key)) { e.preventDefault(); st.setWorkspace((['studio', 'code', 'lab', 'perform'] as Workspace[])[Number(e.key[1]) - 1]); return }
      if (typing(e) || mod || e.altKey) return
      if (e.key === ' ') {
        e.preventDefault()
        if (useEngine.getState().status?.playing) audio.stop(); else audio.play('live')
        return
      }
      if (/^[1-9]$/.test(e.key) && (st.workspace === 'perform' || st.workspace === 'studio')) {
        const sc = st.project.scenes[Number(e.key) - 1]
        if (sc) audio.launchScene(sc.id, st.quantize)
        return
      }
      if (e.repeat) return
      const k = e.key.toLowerCase()
      if (k === 'z') { octave.current = Math.max(0, octave.current - 1); return }
      if (k === 'x') { octave.current = Math.min(8, octave.current + 1); return }
      if (k in KEYMAP && (st.workspace === 'lab' || st.workspace === 'studio' || st.workspace === 'perform') && st.selectedTrack) {
        const t = st.project.tracks.find((x) => x.id === st.selectedTrack)
        if (!t) return
        if (t.kind === 'drums') { audio.preview(t.id, KEYMAP[k] % 8, 0.9, 1); return }
        const pitch = (octave.current + 1) * 12 + KEYMAP[k]
        down.set(k, { track: t.id, pitch })
        audio.noteOn(t.id, pitch, 0.85)
      }
    }
    const ku = (e: KeyboardEvent) => {
      const d = down.get(e.key.toLowerCase())
      if (d) { audio.noteOff(d.track, d.pitch); down.delete(e.key.toLowerCase()) }
    }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) }
  }, [])
}

function useAutosave() {
  useEffect(() => {
    let timer: number | undefined
    const unsub = useApp.subscribe((s, prev) => {
      if (s.project === prev.project) return
      clearTimeout(timer)
      timer = window.setTimeout(async () => {
        const st = useApp.getState()
        if (st.projectPath) {
          try { await saveProject(st.project, st.projectPath); useApp.setState({ dirty: false, savedAt: Date.now() }) } catch { /* retried on next change */ }
        } else {
          await saveDraft(st.project)
          useApp.setState({ savedAt: Date.now() })
        }
      }, 1500)
    })
    const flush = () => { saveDraft(useApp.getState().project) }
    window.addEventListener('beforeunload', flush)
    return () => { unsub(); window.removeEventListener('beforeunload', flush) }
  }, [])
}

function useLearnCapture() {
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const st = useApp.getState()
      if (!st.learn) return
      const el = (e.target as HTMLElement).closest('[data-learn]') as HTMLElement | null
      if (!el || !el.dataset.learn) return
      e.preventDefault()
      e.stopPropagation()
      useApp.setState({ learnTarget: el.dataset.learn })
    }
    window.addEventListener('click', h, true)
    window.addEventListener('pointerdown', (e) => { if (useApp.getState().learn && (e.target as HTMLElement).closest('[data-learn]')) e.stopPropagation() }, true)
    return () => window.removeEventListener('click', h, true)
  }, [])
}
