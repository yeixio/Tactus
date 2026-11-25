import { useState } from 'react'
import { useApp } from '../state/store'
import { audio } from '../audio/bridge'
import { DRUM_KITS, PAD_NAMES, SYNTH_PRESETS, drumKit, synthPreset } from '../model/presets'
import { SMART_DEFS } from '../model/sound'
import type { SynthParams, Track, Wave } from '../model/types'
import { Icon, Knob, Seg } from './controls'
import { SmartKnobs, pct } from './Studio'
import * as A from './actions'
import { userSampleBytes } from '../platform'
import { INSTRUMENTS } from '../model/soundpack'
import { noteName } from '../model/theory'

export function Lab() {
  const project = useApp((s) => s.project)
  const track = useApp((s) => s.project.tracks.find((t) => t.id === s.selectedTrack) ?? s.project.tracks[0] ?? null)
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple')
  if (!track) return <div className="empty">Add a track in the Studio first.</div>
  return (
    <div className="lab">
      <div className="lab-tracks">
        {project.tracks.map((t) => (
          <button key={t.id} className={`lab-track ${t.id === track.id ? 'on' : ''}`} style={{ ['--tc' as string]: t.color }} onClick={() => useApp.getState().select(t.id)}>
            <span className="swatch" /> {t.name} <span className="muted small">{t.preset}</span>
          </button>
        ))}
      </div>
      <div className="lab-main">
        <div className="panel-head">
          <h2 style={{ color: track.color }}>{track.name}</h2>
          <span className="muted">{track.kind === 'drums' ? 'Drum sampler' : 'Subtractive / FM synthesizer'}</span>
          <div className="grow" />
          <Seg value={mode} onChange={setMode} options={[{ value: 'simple', label: 'Smart' }, { value: 'advanced', label: 'Full control' }]} />
        </div>
        {mode === 'simple' ? <SimpleLab track={track} /> : track.kind === 'synth' ? <SynthPanel track={track} /> : null}
        {track.kind === 'drums' && <PadPanel track={track} />}
        {track.kind === 'synth' && <MiniKeys track={track} />}
      </div>
      <Presets track={track} />
    </div>
  )
}

function SimpleLab({ track }: { track: Track }) {
  return (
    <div className="lab-simple">
      <div className="lab-card">
        <div className="section-title">Smart controls</div>
        <p className="muted small">Each knob moves several settings at once, tuned for this instrument. The middle position is the sound as designed. Double-click to reset.</p>
        <SmartKnobs track={track} size={72} />
      </div>
      <div className="lab-card">
        <div className="section-title">What each control moves</div>
        <table className="mapping">
          <tbody>
            {SMART_DEFS.map((d) => (
              <tr key={d.name}>
                <td><b>{d.label}</b><div className="muted small">{d.hint}</div></td>
                <td>{(track.kind === 'synth' ? d.synth : d.drums).map((m, i) => (
                  <span key={i} className="map-chip" title={`${m.curve === 'oct' ? `${m.amount > 0 ? '+' : ''}${m.amount} octaves` : `${m.amount > 0 ? '+' : ''}${m.amount}`} across the knob`}>
                    {m.target.replace(/^(synth|mix|perf)\./, '').replace(/^pads\./, 'pad ')} {m.amount > 0 ? '↑' : '↓'}
                  </span>
                ))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SynthPanel({ track }: { track: Track }) {
  const sp = track.synth!
  const st = useApp.getState()
  const set = (k: keyof SynthParams) => (v: number | string | boolean) =>
    st.update((d) => { (A.findTrack(d, track.id)!.synth as unknown as Record<string, unknown>)[k] = v }, { key: `syn:${track.id}:${k}` })
  const K = (k: keyof SynthParams, label: string, min: number, max: number, o: { log?: boolean; fmt?: (v: number) => string; step?: number } = {}) => (
    <Knob size={46} label={label} value={sp[k] as number} min={min} max={max} log={o.log} def={synthPreset(track.preset)[k] as number} color={track.color}
      onChange={(v) => set(k)(o.step ? Math.round(v / o.step) * o.step : v)} format={o.fmt ?? ((v) => v.toFixed(2))} />
  )
  const waves = (['saw', 'square', 'triangle', 'sine'] as Wave[]).map((w) => ({ value: w as string, label: <WaveIcon w={w} />, title: w }))
  const wave = (k: 'osc1' | 'osc2') => (
    <Seg small value={sp[k]} onChange={(v) => set(k)(v)}
      options={k === 'osc1' ? [...waves, ...Object.values(INSTRUMENTS).map((i) => ({ value: i.name, label: <span className="small">{i.name}</span>, title: i.description }))] : waves} />
  )
  const sec = (s: number) => (s < 1 ? `${Math.round(s * 1000)}ms` : `${s.toFixed(2)}s`)
  return (
    <div className="synth-panel">
      <div className="lab-card">
        <div className="section-title">Oscillators</div>
        <div className="row wrap">
          <div className="col"><span className="muted small">Osc 1</span>{wave('osc1')}</div>
          <div className="col"><span className="muted small">Osc 2</span>{wave('osc2')}</div>
          {K('osc2Semi', 'Osc 2 pitch', -24, 24, { step: 1, fmt: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} st` })}
          {K('osc2Detune', 'Detune', -50, 50, { fmt: (v) => `${Math.round(v)}c` })}
          {K('oscMix', 'Mix 1↔2', 0, 1, { fmt: pct })}
          {K('sub', 'Sub', 0, 1, { fmt: pct })}
          {K('noise', 'Noise', 0, 1, { fmt: pct })}
          {K('fm', 'FM', 0, 1, { fmt: pct })}
          {K('unison', 'Unison', 1, 7, { step: 1, fmt: (v) => `${Math.round(v)}×` })}
          {K('spread', 'Spread', 0, 60, { fmt: (v) => `${Math.round(v)}c` })}
          {K('chorus', 'Chorus', 0, 1, { fmt: pct })}
        </div>
      </div>
      <div className="lab-card">
        <div className="section-title">Filter</div>
        <div className="row wrap">
          <FilterCurve cutoff={sp.cutoff} res={sp.resonance} color={track.color} />
          {K('cutoff', 'Cutoff', 40, 18000, { log: true, fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`) })}
          {K('resonance', 'Resonance', 0, 0.98, { fmt: pct })}
          {K('filterEnv', 'Env amount', -1, 1, { fmt: (v) => `${Math.round(v * 100)}` })}
          {K('keyTrack', 'Key track', 0, 1, { fmt: pct })}
          {K('drive', 'Drive', 0, 1, { fmt: pct })}
        </div>
      </div>
      <div className="lab-card">
        <div className="section-title">Envelopes</div>
        <div className="row wrap">
          <EnvCurve a={sp.ampA} d={sp.ampD} s={sp.ampS} r={sp.ampR} color={track.color} label="Amp" />
          {K('ampA', 'Attack', 0.001, 4, { log: true, fmt: sec })}
          {K('ampD', 'Decay', 0.01, 4, { log: true, fmt: sec })}
          {K('ampS', 'Sustain', 0, 1, { fmt: pct })}
          {K('ampR', 'Release', 0.01, 6, { log: true, fmt: sec })}
        </div>
        <div className="row wrap">
          <EnvCurve a={sp.fltA} d={sp.fltD} s={sp.fltS} r={sp.fltR} color={track.color} label="Filter" />
          {K('fltA', 'Attack', 0.001, 4, { log: true, fmt: sec })}
          {K('fltD', 'Decay', 0.01, 4, { log: true, fmt: sec })}
          {K('fltS', 'Sustain', 0, 1, { fmt: pct })}
          {K('fltR', 'Release', 0.01, 6, { log: true, fmt: sec })}
        </div>
      </div>
      <div className="lab-card">
        <div className="section-title">Modulation and voice</div>
        <div className="row wrap">
          {K('lfoRate', 'LFO rate', 0.05, 20, { log: true, fmt: (v) => `${v.toFixed(2)}Hz` })}
          {K('lfoCutoff', 'LFO → cutoff', 0, 1, { fmt: pct })}
          {K('lfoPitch', 'LFO → pitch', 0, 50, { fmt: (v) => `${Math.round(v)}c` })}
          {K('glide', 'Glide', 0, 0.5, { fmt: sec })}
          {K('gain', 'Level', 0, 1.5, { fmt: pct })}
          <label className="check"><input type="checkbox" checked={sp.mono} onChange={(e) => set('mono')(e.target.checked)} /> Mono (legato)</label>
        </div>
      </div>
    </div>
  )
}

function WaveIcon({ w }: { w: Wave }) {
  const d = { saw: 'M1 12 L9 3 L9 12 L17 3', square: 'M1 12 L1 3 L9 3 L9 12 L17 12 L17 3', triangle: 'M1 12 L5 3 L13 12 L17 3', sine: 'M1 7.5 C4 -1 6 -1 9 7.5 S14 16 17 7.5' }[w]
  return <svg width="18" height="15" viewBox="0 0 18 15"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
}

function FilterCurve({ cutoff, res, color }: { cutoff: number; res: number; color: string }) {
  const W = 160, H = 60
  const pts: string[] = []
  for (let i = 0; i <= 80; i++) {
    const f = 20 * Math.pow(1000, i / 80)
    const x = f / cutoff
    const q = 0.5 + res * 8
    const mag = 1 / Math.sqrt((1 - x * x) ** 2 + (x / q) ** 2)
    const db = Math.max(-36, Math.min(18, 20 * Math.log10(mag)))
    pts.push(`${(i / 80) * W},${H - ((db + 36) / 54) * H}`)
  }
  return <svg width={W} height={H} className="curve"><polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" /></svg>
}

function EnvCurve({ a, d, s, r, color, label }: { a: number; d: number; s: number; r: number; color: string; label: string }) {
  const W = 160, H = 60
  const tot = a + d + 0.4 + r
  const x = (t: number) => (t / tot) * W
  const path = `M0,${H} L${x(a)},4 L${x(a + d)},${H - s * (H - 4)} L${x(a + d + 0.4)},${H - s * (H - 4)} L${W},${H}`
  return <div className="col"><span className="muted small">{label}</span><svg width={W} height={H} className="curve"><path d={path} fill="none" stroke={color} strokeWidth="2" /></svg></div>
}

function PadPanel({ track }: { track: Track }) {
  const st = useApp.getState()
  const pads = track.pads!
  const base = drumKit(track.preset)
  const set = (i: number, k: 'tune' | 'decay' | 'gain' | 'pan', v: number) => st.update((d) => { A.findTrack(d, track.id)!.pads![i][k] = v }, { key: `pad:${track.id}:${i}:${k}` })
  const load = async (i: number, file: File) => {
    let name = file.name.replace(/[^\w.-]+/g, '_')
    if (userSampleBytes.has(name)) name = `${Date.now().toString(36)}-${name}`
    userSampleBytes.set(name, await file.arrayBuffer())
    st.update((d) => { A.findTrack(d, track.id)!.pads![i].sample = `user:${name}` })
    setTimeout(() => audio.preview(track.id, i, 0.9, 1), 150)
  }
  return (
    <div className="lab-card">
      <div className="section-title">Pads <span className="muted small">Click to play. Drop an audio file (WAV, MP3, AIFF) onto a pad to sample it.</span></div>
      <div className="pads">
        {pads.map((p, i) => (
          <div key={i} className="pad" style={{ ['--tc' as string]: track.color }}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drop') }}
            onDragLeave={(e) => e.currentTarget.classList.remove('drop')}
            onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drop'); const f = e.dataTransfer.files[0]; if (f) load(i, f) }}>
            <button className="pad-hit" onPointerDown={() => audio.preview(track.id, i, 0.95, 1)}>
              <b>{PAD_NAMES[i]}</b>
              <span className="muted small">{p.sample.startsWith('user:') ? p.sample.slice(5) : p.sample.replace(/^(factory:|sound:drums\/)/, '')}</span>
            </button>
            <div className="row">
              <Knob size={34} label="Tune" value={p.tune} min={-24} max={24} def={0} bipolar color={track.color} onChange={(v) => set(i, 'tune', Math.round(v))} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}`} />
              <Knob size={34} label="Decay" value={p.decay} min={0.02} max={1} def={1} color={track.color} onChange={(v) => set(i, 'decay', v)} format={pct} />
              <Knob size={34} label="Level" value={p.gain} min={0} max={1.5} def={base[i].gain} color={track.color} onChange={(v) => set(i, 'gain', v)} format={pct} />
              <Knob size={34} label="Pan" value={p.pan} min={-1} max={1} def={0} bipolar color={track.color} onChange={(v) => set(i, 'pan', v)} format={(v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)} />
            </div>
            <div className="row small">
              <label className="ghost small filebtn">Load…<input type="file" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(i, f) }} /></label>
              {p.sample.startsWith('user:') && <button className="ghost small" onClick={() => st.update((d) => { A.findTrack(d, track.id)!.pads![i].sample = base[i].sample })}>Factory</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MiniKeys({ track }: { track: Track }) {
  const [oct, setOct] = useState(track.synth && track.synth.cutoff < 1000 ? 2 : 4)
  const keys = Array.from({ length: 25 }, (_, i) => (oct + 1) * 12 + i)
  return (
    <div className="lab-card">
      <div className="section-title">Play <span className="muted small">or use your computer keyboard (A–K, W E T Y U), Z / X for octave, or a MIDI keyboard</span></div>
      <div className="row">
        <button className="ghost" onClick={() => setOct(Math.max(0, oct - 1))}>−</button>
        <span className="muted">C{oct}</span>
        <button className="ghost" onClick={() => setOct(Math.min(7, oct + 1))}>+</button>
        <div className="minikeys">
          {keys.map((p) => {
            const black = [1, 3, 6, 8, 10].includes(p % 12)
            return <div key={p} className={`mk ${black ? 'black' : ''}`} title={noteName(p)}
              onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); audio.noteOn(track.id, p, 0.85) }}
              onPointerUp={() => audio.noteOff(track.id, p)} onPointerCancel={() => audio.noteOff(track.id, p)} />
          })}
        </div>
      </div>
    </div>
  )
}

function Presets({ track }: { track: Track }) {
  const cats = track.kind === 'drums' ? null : [...new Set(SYNTH_PRESETS.map((p) => p.category))]
  return (
    <aside className="presets">
      <div className="section-title">{track.kind === 'drums' ? 'Kits' : 'Presets'}</div>
      {track.kind === 'drums'
        ? DRUM_KITS.map((k) => (
          <button key={k.name} className={`preset ${track.preset === k.name ? 'on' : ''}`} onClick={() => { A.setPreset(track.id, k.name); setTimeout(() => audio.preview(track.id, 0, 0.9, 1), 80) }}>
            <b>{k.name}</b><span className="muted small">{k.description}</span>
          </button>
        ))
        : cats!.map((c) => (
          <div key={c}>
            <div className="preset-cat">{c}</div>
            {SYNTH_PRESETS.filter((p) => p.category === c).map((p) => (
              <button key={p.name} className={`preset ${track.preset === p.name ? 'on' : ''}`} onClick={() => {
                A.setPreset(track.id, p.name)
                const pitch = c === 'bass' ? 36 : 60
                setTimeout(() => { audio.preview(track.id, pitch, 0.85, 6); if (c === 'pad' || c === 'keys') { audio.preview(track.id, pitch + 3, 0.8, 6); audio.preview(track.id, pitch + 7, 0.8, 6) } }, 80)
              }}>
                <b>{p.name}</b><span className="muted small">{p.description}</span>
              </button>
            ))}
          </div>
        ))}
      <div className="muted small" style={{ marginTop: 12 }}><Icon name="wand" size={11} /> Picking a preset resets the instrument's settings. Smart controls and the mix stay as they are.</div>
    </aside>
  )
}
