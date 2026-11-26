import { useRef, useState, type ReactNode } from 'react'
import { useApp, useEngine } from '../state/store'
import type { TemplateIcon } from '../model/project'
import {
  Building2, ChevronDown, ChevronUp, Circle, CodeXml, Coffee, Copy, Dices, Disc3, FilePlus2, ListMusic, MoonStar, Play, Plus,
  Redo2, Square, SquareTerminal, Sunset, Undo2, WandSparkles, X, Zap, type LucideIcon,
} from 'lucide-react'

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

const ICONS = {
  play: Play, stop: Square, song: ListMusic, rec: Circle, plus: Plus, undo: Undo2, redo: Redo2, x: X,
  dice: Dices, code: CodeXml, copy: Copy, up: ChevronUp, down: ChevronDown, wand: WandSparkles,
} satisfies Record<string, LucideIcon>
/** Transport glyphs read better solid; everything else uses the outline style. */
const SOLID = new Set(['play', 'stop', 'rec'])

export type IconName = keyof typeof ICONS
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const C = ICONS[name]
  return <C size={size} strokeWidth={2} absoluteStrokeWidth={size < 16} fill={SOLID.has(name) ? 'currentColor' : 'none'} aria-hidden />
}

const STYLE_ICONS = {
  sunset: Sunset, night: MoonStar, bolt: Zap, coffee: Coffee, disc: Disc3, city: Building2, terminal: SquareTerminal, blank: FilePlus2,
} satisfies Record<TemplateIcon | 'blank', LucideIcon>

/** The tile that marks a starting point on the Start screen. */
export function StyleIcon({ name, size = 22 }: { name: TemplateIcon | 'blank'; size?: number }) {
  const C = STYLE_ICONS[name]
  return <span className={`style-icon si-${name}`} aria-hidden><C size={size} strokeWidth={1.75} /></span>
}
