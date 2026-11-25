import { useEffect, useRef, useState } from 'react'
import { useApp, useEngine } from '../state/store'
import { audio } from '../audio/bridge'
import { editNotes } from './actions'
import { PAD_NAMES } from '../model/presets'
import { inKey, noteName, snapToKey, diatonicChords, voiceChord } from '../model/theory'
import { SCALES, type Clip, type Note, type Track } from '../model/types'

/** Step position of this clip's playhead, or null if it is not playing. */
function usePlayhead(track: Track, clip: Clip) {
  return useEngine((s) => {
    const st = s.status
    if (!st || !st.playing || st.playingClips[track.id] !== clip.id) return null
    const local = st.step - (st.clipStart[track.id] ?? 0)
    return ((Math.floor(local) % clip.length) + clip.length) % clip.length
  })
}

// ------------------------------------------------------------------------------------------ steps

export function StepSequencer({ track, clip }: { track: Track; clip: Clip }) {
  const head = usePlayhead(track, clip)
  const paint = useRef<{ on: boolean; vel: number } | null>(null)
  const len = clip.length
  const cell = len > 32 ? 18 : len > 16 ? 24 : 34
  const has = (pad: number, step: number) => clip.notes.find((n) => n.pitch === pad && n.step === step)
  useEffect(() => {
    const up = () => { paint.current = null }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])
  const setCell = (pad: number, step: number, on: boolean, vel: number) => {
    editNotes(track.id, clip.id, (ns) => {
      const rest = ns.filter((n) => !(n.pitch === pad && n.step === step))
      return on ? [...rest, { step, pitch: pad, len: 1, vel }].sort((a, b) => a.step - b.step || a.pitch - b.pitch) : rest
    }, `steps:${clip.id}`)
  }
  return (
    <div className="steps" style={{ ['--cell' as string]: `${cell}px` }}>
      {PAD_NAMES.map((pad, pi) => (
        <div className="steps-row" key={pad}>
          <button className="steps-pad" onPointerDown={() => audio.preview(track.id, pi, 0.9, 1)} title="Click to hear this pad">{pad}</button>
          <div className="steps-cells">
            {Array.from({ length: len }, (_, s) => {
              const n = has(pi, s)
              const lvl = !n ? 0 : n.vel >= 0.95 ? 3 : n.vel <= 0.6 ? 1 : 2
              return (
                <div key={s}
                  className={`step ${s % 4 === 0 ? 'beat' : ''} ${Math.floor(s / 4) % 2 ? 'alt' : ''} ${head === s ? 'head' : ''}`}
                  data-lvl={lvl}
                  title="Click to toggle. Right-click (or Shift+click) to change accent."
                  onContextMenu={(e) => e.preventDefault()}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    if (e.button === 2 || e.shiftKey) {
                      // cycle velocity: soft -> normal -> accent
                      const next = lvl === 0 ? 0.8 : lvl === 2 ? 1 : lvl === 3 ? 0.5 : 0.8
                      setCell(pi, s, true, next)
                      audio.preview(track.id, pi, next, 1)
                      return
                    }
                    const on = !n
                    paint.current = { on, vel: 0.8 }
                    setCell(pi, s, on, 0.8)
                    if (on) audio.preview(track.id, pi, 0.8, 1)
                  }}
                  onPointerEnter={() => {
                    const p = paint.current
                    if (!p) return
                    if (!!n !== p.on) setCell(pi, s, p.on, p.vel)
                  }}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------------------------- piano roll

const ROW = 14
const LOW = 24 // C1
const HIGH = 96 // C7

type ChordTool = 'note' | 'triad' | 'seventh'

export function PianoRoll({ track, clip }: { track: Track; clip: Clip }) {
  const key = useApp((s) => s.project.key)
  const guard = useApp((s) => s.project.guardrails)
  const [snap, setSnap] = useState(guard)
  const [tool, setTool] = useState<ChordTool>('note')
  const [noteLen, setNoteLen] = useState(2)
  const head = usePlayhead(track, clip)
  const scroller = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: 'move' | 'resize'; idx: number; x: number; y: number; orig: Note; moved: boolean } | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const len = clip.length
  const stepW = len > 32 ? 18 : 26
  const rows = HIGH - LOW + 1

  useEffect(() => {
    // centre the view on the notes (or on the track's natural register)
    const el = scroller.current
    if (!el) return
    const ps = clip.notes.map((n) => n.pitch)
    const center = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : track.synth && track.synth.cutoff < 1000 ? 40 : 62
    el.scrollTop = (HIGH - center) * ROW - el.clientHeight / 2
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id])

  const pitchAt = (clientY: number) => {
    const r = grid.current!.getBoundingClientRect()
    return HIGH - Math.floor((clientY - r.top) / ROW)
  }
  const stepAt = (clientX: number) => {
    const r = grid.current!.getBoundingClientRect()
    return Math.max(0, Math.min(len - 1, Math.floor((clientX - r.left) / stepW)))
  }

  const chordFor = (pitch: number): number[] => {
    if (tool === 'note') return [pitch]
    const sc = SCALES[key.scale] as readonly number[]
    if (sc.length !== 7) return [pitch, pitch + 4, pitch + 7]
    const dc = diatonicChords(key)
    const pc = (((pitch - key.root) % 12) + 12) % 12
    const deg = sc.indexOf(pc)
    if (deg < 0) return [pitch]
    const ch = dc[deg].chord
    const notes = voiceChord(ch, pitch + 4).filter((_, i) => tool === 'seventh' || i < 3)
    if (tool === 'seventh' && notes.length < 4) notes.push(snapToKey(notes[0] + 10, key))
    const shift = pitch - notes[0]
    return notes.map((n) => n + shift)
  }

  const onGridDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== grid.current) return
    let pitch = pitchAt(e.clientY)
    if (snap) pitch = snapToKey(pitch, key)
    const step = stepAt(e.clientX)
    const l = Math.min(noteLen, len - step)
    const add = chordFor(pitch).map((p) => ({ step, pitch: p, len: l, vel: 0.8 }))
    editNotes(track.id, clip.id, (ns) => [...ns, ...add].sort((a, b) => a.step - b.step || a.pitch - b.pitch))
    for (const n of add) audio.preview(track.id, n.pitch, 0.8, Math.min(l, 4))
    setSel(null)
  }

  const onNoteDown = (e: React.PointerEvent, idx: number) => {
    e.stopPropagation()
    if (e.button === 2) {
      editNotes(track.id, clip.id, (ns) => ns.filter((_, i) => i !== idx))
      return
    }
    const n = clip.notes[idx]
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const mode = e.clientX > r.right - 7 ? 'resize' : 'move'
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { mode, idx, x: e.clientX, y: e.clientY, orig: { ...n }, moved: false }
    setSel(idx)
    if (mode === 'move') audio.preview(track.id, n.pitch, n.vel, Math.min(n.len, 4))
  }
  const onNoteMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = Math.round((e.clientX - d.x) / stepW)
    const dy = -Math.round((e.clientY - d.y) / ROW)
    if (!dx && !dy && !d.moved) return
    d.moved = true
    editNotes(track.id, clip.id, (ns) => ns.map((n, i) => {
      if (i !== d.idx) return n
      if (d.mode === 'resize') return { ...n, len: Math.max(1, Math.min(len - n.step, d.orig.len + dx)) }
      let pitch = Math.max(LOW, Math.min(HIGH, d.orig.pitch + dy))
      if (snap) pitch = snapToKey(pitch, key)
      const step = Math.max(0, Math.min(len - n.len, d.orig.step + dx))
      if (pitch !== n.pitch) audio.preview(track.id, pitch, n.vel, 1)
      return { ...n, pitch, step }
    }), `roll:${clip.id}:${d.idx}`)
  }
  const onNoteUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.mode === 'resize') setNoteLen(clip.notes[d.idx]?.len ?? noteLen)
  }

  const setVel = (idx: number, clientY: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const v = Math.max(0.05, Math.min(1, 1 - (clientY - r.top) / r.height))
    editNotes(track.id, clip.id, (ns) => ns.map((n, i) => (i === idx ? { ...n, vel: Math.round(v * 100) / 100 } : n)), `vel:${clip.id}`)
  }

  return (
    <div className="roll">
      <div className="roll-tools">
        <label className="check" title="Keep new and moved notes in the project key"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to key</label>
        <span className="sep" />
        <span className="muted">Draw</span>
        <select value={tool} onChange={(e) => setTool(e.target.value as ChordTool)} title="Draw single notes, or chords that fit the key">
          <option value="note">Notes</option>
          <option value="triad">Chords (in key)</option>
          <option value="seventh">7th chords (in key)</option>
        </select>
        <span className="muted">Length</span>
        <select value={noteLen} onChange={(e) => setNoteLen(Number(e.target.value))}>
          <option value={1}>1/16</option><option value={2}>1/8</option><option value={4}>1/4</option><option value={8}>1/2</option><option value={16}>1 bar</option>
        </select>
        <span className="muted hint">Click to add · drag to move · drag the right edge to resize · right-click to delete</span>
      </div>
      <div className="roll-body" ref={scroller}>
        <div className="roll-inner" style={{ height: rows * ROW }}>
          <div className="roll-keys">
            {Array.from({ length: rows }, (_, i) => {
              const p = HIGH - i
              const black = [1, 3, 6, 8, 10].includes(p % 12)
              return (
                <div key={p} className={`key ${black ? 'black' : ''} ${inKey(p, key) ? 'inkey' : ''} ${p % 12 === key.root ? 'root' : ''}`} style={{ height: ROW }}
                  onPointerDown={() => audio.preview(track.id, p, 0.8, 2)}>
                  {p % 12 === 0 || p % 12 === key.root ? noteName(p) : ''}
                </div>
              )
            })}
          </div>
          <div className="roll-grid" ref={grid} onPointerDown={onGridDown} onContextMenu={(e) => e.preventDefault()}
            style={{ width: len * stepW, ['--step' as string]: `${stepW}px`, ['--row' as string]: `${ROW}px` }}>
            {Array.from({ length: rows }, (_, i) => {
              const p = HIGH - i
              return inKey(p, key) ? null : <div key={p} className="roll-outkey" style={{ top: i * ROW, height: ROW }} />
            })}
            {clip.notes.map((n, i) => (
              <div key={i} className={`note ${sel === i ? 'sel' : ''}`}
                style={{ left: n.step * stepW + 1, top: (HIGH - n.pitch) * ROW + 1, width: n.len * stepW - 2, height: ROW - 2, background: track.color, opacity: 0.45 + n.vel * 0.55 }}
                onPointerDown={(e) => onNoteDown(e, i)} onPointerMove={onNoteMove} onPointerUp={onNoteUp}
                title={`${noteName(n.pitch)} · velocity ${Math.round(n.vel * 100)}`} />
            ))}
            {head !== null && <div className="roll-head" style={{ left: head * stepW }} />}
          </div>
        </div>
      </div>
      <div className="roll-vel" style={{ paddingLeft: 44 }}>
        <div style={{ position: 'relative', width: len * stepW, height: '100%' }}>
          {clip.notes.map((n, i) => (
            <div key={i} className="velbar" style={{ left: n.step * stepW + 2, height: `${n.vel * 100}%`, background: track.color }}
              onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); setVel(i, e.clientY, (e.currentTarget.parentElement as HTMLElement)) }}
              onPointerMove={(e) => { if (e.buttons & 1) setVel(i, e.clientY, e.currentTarget.parentElement as HTMLElement) }} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Small read-only preview of a clip (used in grids, the timeline and the code view). */
export function ClipThumb({ clip, track, width = 120, height = 34 }: { clip: Clip; track: Track; width?: number; height?: number }) {
  if (!clip.notes.length) return <svg width={width} height={height} />
  const drums = track.kind === 'drums'
  const ps = clip.notes.map((n) => n.pitch)
  const lo = drums ? 0 : Math.min(...ps), hi = drums ? 7 : Math.max(...ps)
  const span = Math.max(1, hi - lo + 1)
  const sx = width / clip.length
  const sy = height / span
  return (
    <svg width={width} height={height} className="thumb">
      {clip.notes.map((n, i) => (
        <rect key={i} x={n.step * sx} y={(hi - n.pitch) * sy} width={Math.max(1.5, (drums ? 1 : n.len) * sx - 0.5)} height={Math.max(1.5, sy - 0.5)} fill={track.color} opacity={0.5 + n.vel * 0.5} />
      ))}
    </svg>
  )
}
