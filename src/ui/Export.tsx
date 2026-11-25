import { useState } from 'react'
import { useApp } from '../state/store'
import { audio } from '../audio/bridge'
import { compileSong, resolveAll } from '../model/sound'
import { songBars } from '../model/project'
import { exportAudio, reveal, isDesktop } from '../platform'
import ExportWorker from '../engine/export.worker.ts?worker'

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useApp((s) => s.project)
  const path = useApp((s) => s.projectPath)
  const bars = songBars(project)
  const [what, setWhat] = useState<'song' | string>(bars > 0 ? 'song' : project.scenes[0]?.id ?? 'song')
  const [loopBars, setLoopBars] = useState(8)
  const [rate, setRate] = useState(48000)
  const [bits, setBits] = useState<16 | 24>(24)
  const [progress, setProgress] = useState<number | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const go = async () => {
    setError(null); setDone(null); setProgress(0)
    try {
      // macros are performance gestures: export the mix without them
      const neutral = { ...project, macros: project.macros.map((m) => ({ ...m, value: 0 })) }
      const r = resolveAll(neutral)
      const samples = await audio.samplesFor(project, rate)
      const worker = new ExportWorker()
      const wav: ArrayBuffer = await new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
          if (e.data.type === 'progress') setProgress(e.data.value)
          if (e.data.type === 'done') resolve(e.data.wav)
        }
        worker.onerror = (e) => reject(new Error(e.message))
        worker.postMessage({
          song: compileSong(project), tracks: r.tracks, master: r.master, sampleRate: rate, samples, bits,
          mode: what === 'song' ? 'song' : { scene: what, bars: loopBars },
        })
      })
      worker.terminate()
      setProgress(1)
      const sceneName = project.scenes.find((s) => s.id === what)?.name
      const name = `${project.name}${what === 'song' ? '' : ` - ${sceneName}`}.wav`.replace(/[\\/:*?"<>|]/g, '-')
      const saved = await exportAudio(name, wav, path)
      setDone(saved)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Export audio</h3>
        <label className="field"><span>What</span>
          <select value={what} onChange={(e) => setWhat(e.target.value)}>
            <option value="song" disabled={!bars}>Whole song ({bars} bars from the timeline)</option>
            {project.scenes.map((s) => <option key={s.id} value={s.id}>Scene loop: {s.name}</option>)}
          </select>
        </label>
        {what !== 'song' && <label className="field"><span>Bars</span><input type="number" min={1} max={128} value={loopBars} onChange={(e) => setLoopBars(Math.max(1, Number(e.target.value)))} /></label>}
        <label className="field"><span>Sample rate</span>
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))}><option value={44100}>44.1 kHz</option><option value={48000}>48 kHz</option></select>
        </label>
        <label className="field"><span>Bit depth</span>
          <select value={bits} onChange={(e) => setBits(Number(e.target.value) as 16 | 24)}><option value={16}>16-bit</option><option value={24}>24-bit</option></select>
        </label>
        <p className="muted small">Rendered offline with the same engine you hear, faster than real time. Performance macros are left at zero.</p>
        {progress !== null && <div className="progress"><div style={{ width: `${progress * 100}%` }} /></div>}
        {done && <div className="banner ok">Saved {done}. {isDesktop && <button className="ghost small" onClick={() => reveal(done)}>Show in folder</button>}</div>}
        {error && <div className="banner bad">{error}</div>}
        <div className="row end">
          <button className="ghost" onClick={onClose}>Close</button>
          <button className="primary" disabled={progress !== null} onClick={go}>{progress !== null ? 'Rendering…' : 'Export WAV'}</button>
        </div>
      </div>
    </div>
  )
}
