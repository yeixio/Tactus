import { useRef, useState, type ReactNode } from 'react'
import { useApp, useEngine } from '../state/store'

interface KnobProps {
  value: number
  min?: number
  max?: number
  def?: number
  label?: string
  onChange: (v: number) => void
  onStart?: () => void
  size?: number
  color?: string
  format?: (v: number) => string
  learn?: string
  log?: boolean
  title?: string
  bipolar?: boolean
}

export function Knob({ value, min = 0, max = 1, def, label, onChange, onStart, size = 44, color = 'var(--accent)', format, learn, log, title, bipolar }: KnobProps) {
  const drag = useRef<{ y: number; v: number } | null>(null)
  const toN = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min))
  const fromN = (n: number) => { n = Math.min(1, Math.max(0, n)); return log ? min * Math.pow(max / min, n) : min + n * (max - min) }
  const n = Math.min(1, Math.max(0, toN(value)))
  const learnTarget = useApp((s) => s.learnTarget)
  const learning = useApp((s) => s.learn)
  const mapped = useApp((s) => (learn ? s.project.midi.some((m) => m.target === learn) : false))
  const a0 = -135, a1 = 135
  const ang = a0 + n * (a1 - a0)
  const r = size / 2 - 4
  const arc = (from: number, to: number) => {
    const p = (a: number) => [size / 2 + r * Math.sin((a * Math.PI) / 180), size / 2 - r * Math.cos((a * Math.PI) / 180)]
    const [x0, y0] = p(from), [x1, y1] = p(to)
    return `M${x0},${y0} A${r},${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} ${to > from ? 1 : 0} ${x1},${y1}`
  }
  const start = bipolar ? 0 : a0
  return (
    <div className={`knob ${learning ? 'learnable' : ''} ${learnTarget === learn && learn ? 'learning' : ''}`} data-learn={learn} title={title}
      onWheel={(e) => { e.preventDefault(); onStart?.(); onChange(fromN(n - Math.sign(e.deltaY) * 0.02)) }}>
      <svg width={size} height={size}
        onPointerDown={(e) => {
          if (learning) return
          ;(e.target as Element).setPointerCapture(e.pointerId)
          drag.current = { y: e.clientY, v: n }
          onStart?.()
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const d = (drag.current.y - e.clientY) / (e.shiftKey ? 600 : 150)
          onChange(fromN(drag.current.v + d))
        }}
        onPointerUp={() => { drag.current = null }}
        onDoubleClick={() => def !== undefined && onChange(def)}
        style={{ touchAction: 'none', cursor: 'ns-resize' }}>
        <path d={arc(a0, a1)} stroke="var(--knob-track)" strokeWidth={4} fill="none" strokeLinecap="round" />
        {Math.abs(ang - start) > 0.5 && <path d={ang > start ? arc(start, ang) : arc(ang, start)} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" />}
        <circle cx={size / 2} cy={size / 2} r={r - 6} fill="var(--knob-face)" />
        <line x1={size / 2} y1={size / 2} x2={size / 2 + (r - 9) * Math.sin((ang * Math.PI) / 180)} y2={size / 2 - (r - 9) * Math.cos((ang * Math.PI) / 180)} stroke="var(--text)" strokeWidth={2.5} strokeLinecap="round" />
      </svg>
      {label && <div className="knob-label">{label}{mapped && <span className="midi-dot" title="Mapped to MIDI" />}</div>}
      <div className="knob-value">{format ? format(value) : value.toFixed(2)}</div>
    </div>
  )
}

export function Fader({ value, onChange, onStart, height = 120, learn, meter }: { value: number; onChange: (v: number) => void; onStart?: () => void; height?: number; learn?: string; meter?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const learning = useApp((s) => s.learn)
  const learnTarget = useApp((s) => s.learnTarget)
  const set = (clientY: number) => {
    const r = ref.current!.getBoundingClientRect()
    onChange(Math.min(1, Math.max(0, 1 - (clientY - r.top) / r.height)))
  }
  return (
    <div className={`fader ${learning ? 'learnable' : ''} ${learnTarget === learn && learn ? 'learning' : ''}`} data-learn={learn} style={{ height }}>
      {meter && <Meter id={meter} vertical />}
      <div ref={ref} className="fader-track"
        onPointerDown={(e) => { if (learning) return; (e.target as Element).setPointerCapture(e.pointerId); onStart?.(); set(e.clientY) }}
        onPointerMove={(e) => { if (e.buttons & 1 && !learning) set(e.clientY) }}
        onDoubleClick={() => onChange(0.8)}>
        <div className="fader-fill" style={{ height: `${value * 100}%` }} />
        <div className="fader-cap" style={{ bottom: `calc(${value * 100}% - 6px)` }} />
        <div className="fader-unity" style={{ bottom: '80%' }} />
      </div>
    </div>
  )
}

export function Meter({ id, vertical }: { id: string; vertical?: boolean }) {
  const v = useEngine((s) => s.status?.meters[id] ?? 0)
  const db = v > 0 ? 20 * Math.log10(v) : -60
  const n = Math.max(0, Math.min(1, (db + 48) / 48))
  return (
    <div className={`meter ${vertical ? 'vertical' : ''}`}>
      <div className="meter-fill" style={vertical ? { height: `${n * 100}%` } : { width: `${n * 100}%` }} data-hot={v > 0.97 ? '1' : '0'} />
    </div>
  )
}

export function Seg<T extends string>({ value, options, onChange, small }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div className={`seg ${small ? 'small' : ''}`}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function NumberDrag({ value, min, max, step = 1, onChange, suffix, width = 54 }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string; width?: number }) {
  const [editing, setEditing] = useState(false)
  const drag = useRef<{ y: number; v: number; moved: boolean } | null>(null)
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  if (editing) {
    return <input className="numdrag" autoFocus defaultValue={value} style={{ width }}
      onBlur={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(clamp(v)); setEditing(false) }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false) }} />
  }
  return (
    <div className="numdrag" style={{ width }} title="Drag or click to type"
      onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = { y: e.clientY, v: value, moved: false } }}
      onPointerMove={(e) => { if (!drag.current) return; const d = drag.current.y - e.clientY; if (Math.abs(d) > 2) drag.current.moved = true; onChange(clamp(drag.current.v + Math.round(d / 4) * step)) }}
      onPointerUp={() => { if (drag.current && !drag.current.moved) setEditing(true); drag.current = null }}>
      {Number.isInteger(step) ? value : value.toFixed(2)}{suffix}
    </div>
  )
}

export function Icon({ name, size = 16 }: { name: 'play' | 'stop' | 'song' | 'rec' | 'plus' | 'undo' | 'redo' | 'x' | 'dice' | 'code' | 'copy' | 'up' | 'down' | 'wand'; size?: number }) {
  const s = { width: size, height: size, viewBox: '0 0 16 16', fill: 'currentColor' }
  switch (name) {
    case 'play': return <svg {...s}><path d="M4 2.5v11l9-5.5z" /></svg>
    case 'stop': return <svg {...s}><rect x="3.5" y="3.5" width="9" height="9" rx="1" /></svg>
    case 'song': return <svg {...s}><path d="M2 3h8v2H2zM2 7h12v2H2zM2 11h6v2H2z" /></svg>
    case 'rec': return <svg {...s}><circle cx="8" cy="8" r="5" /></svg>
    case 'plus': return <svg {...s}><path d="M7 2h2v5h5v2H9v5H7V9H2V7h5z" /></svg>
    case 'undo': return <svg {...s} fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 4L2 7l3 3M2.5 7H10a4 4 0 010 8H8" /></svg>
    case 'redo': return <svg {...s} fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M11 4l3 3-3 3M13.5 7H6a4 4 0 000 8h2" /></svg>
    case 'x': return <svg {...s} fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4l8 8M12 4l-8 8" /></svg>
    case 'dice': return <svg {...s}><rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="5.5" cy="5.5" r="1.2" /><circle cx="10.5" cy="10.5" r="1.2" /><circle cx="8" cy="8" r="1.2" /></svg>
    case 'code': return <svg {...s} fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 4L1.5 8 5 12M11 4l3.5 4-3.5 4" /></svg>
    case 'copy': return <svg {...s} fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5" /><path d="M3 10.5V3.5A1 1 0 014 2.5h6.5" /></svg>
    case 'up': return <svg {...s}><path d="M8 4l5 6H3z" /></svg>
    case 'down': return <svg {...s}><path d="M8 12L3 6h10z" /></svg>
    case 'wand': return <svg {...s}><path d="M2 12.5l8-8 1.5 1.5-8 8zM11 1l.7 1.6L13.3 3l-1.6.7L11 5.3l-.7-1.6L8.7 3l1.6-.4zM14 6l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z" /></svg>
  }
}
