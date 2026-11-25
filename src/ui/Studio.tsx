import { useEffect, useState } from 'react'
import { useApp, useEngine } from '../state/store'
import { audio } from '../audio/bridge'
import { DRUM_KITS, SYNTH_PRESETS } from '../model/presets'
import { SMART_DEFS } from '../model/sound'
import { songBars } from '../model/project'
import type { Clip, Project, Track } from '../model/types'
import { Fader, Icon, Knob, Meter, NumberDrag, Seg } from './controls'
import { ClipThumb, PianoRoll, StepSequencer } from './editors'
import * as A from './actions'
import { describeTarget } from '../audio/midi'

type View = 'clips' | 'timeline' | 'mixer'

export function Studio() {
  const [view, setView] = useState<View>('clips')
  const project = useApp((s) => s.project)
  const track = useApp((s) => s.project.tracks.find((t) => t.id === s.selectedTrack) ?? null)
  const clip = track?.clips.find((c) => c.id === useApp.getState().selectedClip) ?? null
  useApp((s) => s.selectedClip)
  useGuidance(project)
  return (
    <div className="studio">
      <div className="studio-main">
        <div className="panel-head">
          <Seg value={view} onChange={setView} options={[{ value: 'clips', label: 'Clips & scenes' }, { value: 'timeline', label: 'Timeline' }, { value: 'mixer', label: 'Mixer' }]} />
          <div className="grow" />
          <AddTrackMenu />
        </div>
        <div className="studio-view">
          {view === 'clips' && <Session project={project} />}
          {view === 'timeline' && <Timeline project={project} />}
          {view === 'mixer' && <Mixer project={project} />}
        </div>
        <div className="editor">
          {track && clip ? <ClipEditor track={track} clip={clip} /> : <div className="empty">{track ? 'This track has no clips yet. ' : 'Select a track. '}
            {track && <button onClick={() => A.addClip(track.id)}><Icon name="plus" /> New clip</button>}</div>}
        </div>
      </div>
      <Inspector track={track} />
    </div>
  )
}

function AddTrackMenu() {
  const [open, setOpen] = useState(false)
  return (
    <div className="menu-wrap">
      <button className="primary" onClick={() => setOpen(!open)}><Icon name="plus" /> Add track</button>
      {open && (
        <div className="menu" onMouseLeave={() => setOpen(false)}>
          <div className="menu-title">Drums</div>
          {DRUM_KITS.map((k) => <button key={k.name} onClick={() => { A.addTrack('drums', k.name); setOpen(false) }}><b>{k.name}</b> <span className="muted">{k.description}</span></button>)}
          <div className="menu-title">Instruments</div>
          {SYNTH_PRESETS.map((p) => <button key={p.name} onClick={() => { A.addTrack('synth', p.name); setOpen(false) }}><b>{p.name}</b> <span className="muted">{p.description}</span></button>)}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------- session

function Session({ project }: { project: Project }) {
  const status = useEngine((s) => s.status)
  const quantize = useApp((s) => s.quantize)
  const sel = useApp((s) => s.selectedClip)
  const [renaming, setRenaming] = useState<string | null>(null)
  return (
    <div className="session">
      <div className="session-grid" style={{ gridTemplateColumns: `260px repeat(${project.scenes.length}, minmax(120px, 1fr)) 110px` }}>
        <div className="sg-corner">
          <span className="muted">Tracks</span>
        </div>
        {project.scenes.map((s, si) => (
          <div key={s.id} className="sg-scene">
            <button className="launch" data-learn={`scene:${s.id}`} title={`Launch this scene (key ${si + 1})`} onClick={() => audio.launchScene(s.id, quantize)}><Icon name="play" size={12} /></button>
            {renaming === s.id ? (
              <input autoFocus defaultValue={s.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && !project.scenes.some((x) => x.name === v && x.id !== s.id)) useApp.getState().update((d) => { d.scenes.find((x) => x.id === s.id)!.name = v }); setRenaming(null) }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            ) : <span className="sg-scene-name" onDoubleClick={() => setRenaming(s.id)} title="Double-click to rename">{s.name}</span>}
            <button className="ghost tiny" title="Delete scene" onClick={() => A.deleteScene(s.id)}><Icon name="x" size={10} /></button>
          </div>
        ))}
        <div className="sg-scene add">
          <button className="ghost" onClick={() => A.addScene()}><Icon name="plus" size={12} /> Scene</button>
        </div>
        {project.tracks.map((t) => (
          <SessionRow key={t.id} track={t} project={project} playing={status?.playingClips[t.id] ?? null} queued={status?.queued[t.id]} selClip={sel} />
        ))}
      </div>
      {!project.tracks.length && <div className="empty">No tracks yet. Use <b>Add track</b> to pick a drum kit or an instrument.</div>}
      {status?.playing && (
        <div className="capture">
          <button className="ghost" title="Save the clips playing now as a new scene" onClick={() => A.captureScene(status.playingClips)}>Capture playing clips as a scene</button>
        </div>
      )}
    </div>
  )
}

function SessionRow({ track: t, project, playing, queued, selClip }: { track: Track; project: Project; playing: string | null; queued: string | null | undefined; selClip: string | null }) {
  const st = useApp.getState()
  const quantize = useApp((s) => s.quantize)
  const selected = useApp((s) => s.selectedTrack === t.id)
  const [rename, setRename] = useState(false)
  return (
    <>
      <div className={`sg-track ${selected ? 'sel' : ''}`} style={{ ['--tc' as string]: t.color }} onClick={() => !selected && st.select(t.id)}>
        <div className="sg-track-top">
          <span className="swatch" />
          {rename ? <input autoFocus defaultValue={t.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && !project.tracks.some((x) => x.name === v && x.id !== t.id)) st.update((d) => { A.findTrack(d, t.id)!.name = v }); setRename(false) }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            : <span className="sg-track-name" onDoubleClick={() => setRename(true)} title="Double-click to rename">{t.name}</span>}
          <span className="muted small">{t.preset}</span>
          <div className="grow" />
          <button className={`ms ${t.mix.mute ? 'on mute' : ''}`} data-learn={`mute:${t.id}`} title="Mute" onClick={(e) => { e.stopPropagation(); st.update((d) => { const x = A.findTrack(d, t.id)!; x.mix.mute = !x.mix.mute }) }}>M</button>
          <button className={`ms ${t.mix.solo ? 'on solo' : ''}`} title="Solo" onClick={(e) => { e.stopPropagation(); st.update((d) => { const x = A.findTrack(d, t.id)!; x.mix.solo = !x.mix.solo }) }}>S</button>
          <button className="ms" title="Stop this track" onClick={(e) => { e.stopPropagation(); audio.launchClip(t.id, null, quantize) }}><Icon name="stop" size={10} /></button>
        </div>
        <div className="chips">
          {t.clips.map((c) => (
            <div key={c.id} className={`chip ${c.id === selClip && selected ? 'sel' : ''} ${playing === c.id ? 'playing' : ''} ${queued === c.id ? 'queued' : ''}`}
              onClick={(e) => { e.stopPropagation(); st.select(t.id, c.id) }}>
              <button className="chip-play" data-learn={`clip:${t.id}:${c.id}`} title="Launch this clip" onClick={(e) => { e.stopPropagation(); audio.launchClip(t.id, c.id, quantize) }}><Icon name="play" size={9} /></button>
              <span>{c.name}</span>
              {c.gen && <span className="gen-dot" title={`Generated: ${c.gen}`}>ƒ</span>}
            </div>
          ))}
          <button className="chip add" title="New clip" onClick={(e) => { e.stopPropagation(); A.addClip(t.id) }}><Icon name="plus" size={10} /></button>
        </div>
        <Meter id={t.id} />
      </div>
      {project.scenes.map((s) => {
        const cid = s.slots[t.id] ?? null
        const c = t.clips.find((x) => x.id === cid)
        return (
          <div key={s.id} className={`sg-cell ${c && playing === c.id ? 'playing' : ''}`} style={{ ['--tc' as string]: t.color }}>
            {c && <div className="sg-thumb" onClick={() => st.select(t.id, c.id)}><ClipThumb clip={c} track={t} width={100} height={26} /></div>}
            <select value={cid ?? ''} onChange={(e) => A.setSlot(s.id, t.id, e.target.value || null)} title="Which clip this track plays in this scene">
              <option value="">—</option>
              {t.clips.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
        )
      })}
      <div className="sg-cell end" />
    </>
  )
}

// ------------------------------------------------------------------------------------- timeline

function Timeline({ project }: { project: Project }) {
  const status = useEngine((s) => s.status)
  const BAR = 22
  const total = songBars(project)
  const song = status?.playing && status.mode === 'song'
  const up = useApp.getState().update
  let acc = 0
  const starts = project.arrangement.map((a) => { const s = acc; acc += a.bars; return s })
  return (
    <div className="timeline">
      <div className="tl-scroll">
        <div className="tl-inner" style={{ width: 200 + Math.max(total, 1) * BAR + 160 }}>
          <div className="tl-row tl-head">
            <div className="tl-label"><span className="muted">{total} bars · {fmtTime((total * 4 * 60) / project.bpm)}</span></div>
            {project.arrangement.map((a, i) => (
              <div key={i} className={`tl-block ${song && status?.songBlock === i ? 'on' : ''}`} style={{ width: a.bars * BAR }}>
                <div className="tl-block-top">
                  <button className="ghost tiny" title="Play from here" onClick={() => audio.play('song', starts[i])}><Icon name="play" size={10} /></button>
                  <select value={a.scene} onChange={(e) => up((d) => { d.arrangement[i].scene = e.target.value })}>
                    {project.scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="tl-block-bottom">
                  <NumberDrag value={a.bars} min={1} max={128} onChange={(v) => up((d) => { d.arrangement[i].bars = v }, { key: `bars:${i}` })} suffix=" bars" width={62} />
                  <button className="ghost tiny" title="Move earlier" disabled={i === 0} onClick={() => up((d) => { const [x] = d.arrangement.splice(i, 1); d.arrangement.splice(i - 1, 0, x) })}>‹</button>
                  <button className="ghost tiny" title="Move later" disabled={i === project.arrangement.length - 1} onClick={() => up((d) => { const [x] = d.arrangement.splice(i, 1); d.arrangement.splice(i + 1, 0, x) })}>›</button>
                  <button className="ghost tiny" title="Remove section" onClick={() => up((d) => { d.arrangement.splice(i, 1) })}><Icon name="x" size={9} /></button>
                </div>
              </div>
            ))}
            <div className="tl-add">
              <button className="ghost" disabled={!project.scenes.length} onClick={() => up((d) => { d.arrangement.push({ scene: d.arrangement[d.arrangement.length - 1]?.scene ?? d.scenes[0].id, bars: 8 }) })}><Icon name="plus" size={12} /> Section</button>
            </div>
          </div>
          {project.tracks.map((t) => (
            <div key={t.id} className="tl-row">
              <div className="tl-label" style={{ ['--tc' as string]: t.color }} onClick={() => useApp.getState().select(t.id)}><span className="swatch" />{t.name}</div>
              {project.arrangement.map((a, i) => {
                const sc = project.scenes.find((s) => s.id === a.scene)
                const c = t.clips.find((x) => x.id === sc?.slots[t.id])
                return (
                  <div key={i} className="tl-cell" style={{ width: a.bars * BAR, ['--tc' as string]: t.color }} onClick={() => c && useApp.getState().select(t.id, c.id)}>
                    {c && <RepeatThumb clip={c} track={t} bars={a.bars} barW={BAR} />}
                  </div>
                )
              })}
            </div>
          ))}
          {song && <div className="tl-playhead" style={{ left: 200 + (status!.step / 16) * BAR }} />}
        </div>
      </div>
      {!project.arrangement.length && <div className="empty">The timeline arranges scenes into a song. Add a section to start.</div>}
    </div>
  )
}

function RepeatThumb({ clip, track, bars, barW }: { clip: Clip; track: Track; bars: number; barW: number }) {
  const clipBars = clip.length / 16
  const reps = Math.ceil(bars / clipBars)
  return (
    <div className="tl-reps">
      {Array.from({ length: reps }, (_, i) => {
        const w = Math.min(clipBars, bars - i * clipBars) * barW
        return <div key={i} className="tl-rep" style={{ width: w }}><div style={{ width: clipBars * barW, overflow: 'hidden' }}><ClipThumb clip={clip} track={track} width={clipBars * barW - 2} height={30} /></div></div>
      })}
    </div>
  )
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

// ---------------------------------------------------------------------------------------- mixer

export function Mixer({ project }: { project: Project }) {
  const up = useApp.getState().update
  const m = project.master
  return (
    <div className="mixer">
      {project.tracks.map((t) => (
        <div key={t.id} className="strip" style={{ ['--tc' as string]: t.color }}>
          <div className="strip-name" onClick={() => useApp.getState().select(t.id)}>{t.name}</div>
          <div className="strip-knobs">
            <Knob size={34} label="Pan" value={t.mix.pan} min={-1} max={1} def={0} bipolar learn={`mix:${t.id}:pan`} onChange={(v) => up((d) => { A.findTrack(d, t.id)!.mix.pan = v }, { key: `pan:${t.id}` })} format={(v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)} />
            <Knob size={34} label="Echo" value={t.mix.sendDelay} def={0} learn={`mix:${t.id}:sendDelay`} onChange={(v) => up((d) => { A.findTrack(d, t.id)!.mix.sendDelay = v }, { key: `sd:${t.id}` })} format={pct} />
            <Knob size={34} label="Reverb" value={t.mix.sendReverb} def={0} learn={`mix:${t.id}:sendReverb`} onChange={(v) => up((d) => { A.findTrack(d, t.id)!.mix.sendReverb = v }, { key: `sr:${t.id}` })} format={pct} />
            <Knob size={34} label="Drive" value={t.mix.drive} def={0} learn={`mix:${t.id}:drive`} onChange={(v) => up((d) => { A.findTrack(d, t.id)!.mix.drive = v }, { key: `dr:${t.id}` })} format={pct} />
            <Knob size={34} label="Filter" value={t.mix.tone} min={-1} max={1} def={0} bipolar learn={`mix:${t.id}:tone`} onChange={(v) => up((d) => { A.findTrack(d, t.id)!.mix.tone = v }, { key: `tone:${t.id}` })} format={toneFmt} title="DJ filter: left is low-pass, right is high-pass" />
            <Knob size={34} label="Duck" value={t.mix.duck} def={0} learn={`mix:${t.id}:duck`} onChange={(v) => up((d) => { A.findTrack(d, t.id)!.mix.duck = v }, { key: `duck:${t.id}` })} format={pct} title="Dips this track on every kick (sidechain)" />
          </div>
          <Fader value={t.mix.volume} meter={t.id} learn={`mix:${t.id}:volume`} onChange={(v) => up((d) => { A.findTrack(d, t.id)!.mix.volume = v }, { key: `vol:${t.id}` })} height={150} />
          <div className="strip-btns">
            <button className={`ms ${t.mix.mute ? 'on mute' : ''}`} onClick={() => up((d) => { const x = A.findTrack(d, t.id)!; x.mix.mute = !x.mix.mute })}>M</button>
            <button className={`ms ${t.mix.solo ? 'on solo' : ''}`} onClick={() => up((d) => { const x = A.findTrack(d, t.id)!; x.mix.solo = !x.mix.solo })}>S</button>
          </div>
        </div>
      ))}
      <div className="strip master">
        <div className="strip-name">Master</div>
        <div className="strip-knobs">
          <Knob size={34} label="Echo time" value={m.delayTime} min={1} max={8} def={3} onChange={(v) => up((d) => { d.master.delayTime = Math.round(v) }, { key: 'dt' })} format={(v) => ({ 1: '1/16', 2: '1/8', 3: '3/16', 4: '1/4', 5: '5/16', 6: '3/8', 7: '7/16', 8: '1/2' } as Record<number, string>)[Math.round(v)]} />
          <Knob size={34} label="Feedback" value={m.delayFeedback} def={0.35} onChange={(v) => up((d) => { d.master.delayFeedback = v }, { key: 'fb' })} format={pct} />
          <Knob size={34} label="Room" value={m.reverbSize} def={0.6} onChange={(v) => up((d) => { d.master.reverbSize = v }, { key: 'rs' })} format={pct} />
        </div>
        <Fader value={m.volume} meter="master" learn="master:volume" onChange={(v) => up((d) => { d.master.volume = v }, { key: 'mv' })} height={150} />
        <div className="strip-btns muted small">Limiter on</div>
      </div>
    </div>
  )
}

export const pct = (v: number) => `${Math.round(v * 100)}%`
export const toneFmt = (v: number) => (Math.abs(v) < 0.02 ? 'Off' : v < 0 ? `LP ${Math.round(-v * 100)}` : `HP ${Math.round(v * 100)}`)

// ----------------------------------------------------------------------------------- clip editor

function ClipEditor({ track, clip }: { track: Track; clip: Clip }) {
  const st = useApp.getState()
  const [rename, setRename] = useState(false)
  const sourceLine = () => {
    st.setWorkspace('code')
    useApp.setState({ codeJump: { clip: clip.id } })
  }
  return (
    <div className="clip-editor">
      <div className="ce-bar" style={{ ['--tc' as string]: track.color }}>
        <span className="swatch" />
        <b>{track.name}</b>
        <span className="muted">/</span>
        {rename ? <input autoFocus defaultValue={clip.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && !track.clips.some((c) => c.name === v && c.id !== clip.id)) st.update((d) => { A.findTrack(d, track.id)!.clips.find((c) => c.id === clip.id)!.name = v }); setRename(false) }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          : <span className="ce-name" onDoubleClick={() => setRename(true)} title="Double-click to rename">{clip.name}</span>}
        <select value={clip.length} onChange={(e) => A.setClipLength(track.id, clip.id, Number(e.target.value))} title="Clip length">
          {[4, 8, 16, 32, 48, 64, 128].map((l) => <option key={l} value={l}>{l < 16 ? `${l / 4} beat${l > 4 ? 's' : ''}` : `${l / 16} bar${l > 16 ? 's' : ''}`}</option>)}
        </select>
        <button className="ghost" onClick={() => audio.launchClip(track.id, clip.id, st.quantize)} title="Launch"><Icon name="play" size={12} /></button>
        <span className="sep" />
        <span className="muted">Inspire</span>
        {track.kind === 'drums' ? (
          <button onClick={() => A.inspire(track.id, 'drums', clip.id)} title="Generate a new drum groove in a new clip"><Icon name="dice" size={13} /> Groove</button>
        ) : (
          <>
            <button onClick={() => A.inspire(track.id, 'bass', clip.id)} title="Generate a bassline (new clip)"><Icon name="dice" size={13} /> Bass</button>
            <button onClick={() => A.inspire(track.id, 'chords', clip.id)} title="Generate chords in key (new clip)"><Icon name="dice" size={13} /> Chords</button>
            <button onClick={() => A.inspire(track.id, 'arp', clip.id)} title="Generate an arpeggio (new clip)"><Icon name="dice" size={13} /> Arp</button>
            <button onClick={() => A.inspire(track.id, 'melody', clip.id)} title="Generate a melody in key (new clip)"><Icon name="dice" size={13} /> Melody</button>
          </>
        )}
        <button onClick={() => A.inspire(track.id, 'variation', clip.id)} disabled={!clip.notes.length} title="A variation of this clip (new clip; the original is kept)"><Icon name="wand" size={13} /> Variation</button>
        <div className="grow" />
        {clip.gen && <span className="gen-badge" title="This clip is generated by code. Editing notes by hand turns it into a normal clip.">ƒ {clip.gen}</span>}
        <button className="ghost" onClick={sourceLine} title="Show this clip's source code"><Icon name="code" size={13} /> Code</button>
        <button className="ghost" onClick={() => A.duplicateClip(track.id, clip.id)} title="Duplicate clip"><Icon name="copy" size={13} /></button>
        <button className="ghost" onClick={() => A.editNotes(track.id, clip.id, () => [])} title="Clear all notes">Clear</button>
        <button className="ghost" onClick={() => A.deleteClip(track.id, clip.id)} title="Delete clip"><Icon name="x" size={12} /></button>
      </div>
      <div className="ce-body">
        {track.kind === 'drums' ? <StepSequencer track={track} clip={clip} /> : <PianoRoll track={track} clip={clip} />}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------ inspector

export function SmartKnobs({ track, size = 52 }: { track: Track; size?: number }) {
  const st = useApp.getState()
  return (
    <div className="smart">
      {SMART_DEFS.map((d) => (
        <Knob key={d.name} size={size} label={d.label} value={track.smart[d.name]} def={0.5} bipolar color={track.color} title={d.hint} learn={`smart:${track.id}:${d.name}`}
          onStart={() => st.tip({ id: `smart-${d.name}`, text: `${d.label}: ${d.hint} Double-click a knob to reset it.` })}
          onChange={(v) => st.update((x) => { A.findTrack(x, track.id)!.smart[d.name] = v }, { key: `smart:${track.id}:${d.name}` })}
          format={(v) => `${Math.round(v * 100)}`} />
      ))}
    </div>
  )
}

function Inspector({ track }: { track: Track | null }) {
  const st = useApp.getState()
  const midi = useApp((s) => s.project.midi)
  if (!track) return <aside className="inspector"><div className="empty">Select a track to shape its sound.</div></aside>
  const presets = track.kind === 'drums' ? DRUM_KITS.map((k) => k.name) : SYNTH_PRESETS.map((p) => p.name)
  return (
    <aside className="inspector">
      <div className="insp-head" style={{ ['--tc' as string]: track.color }}>
        <span className="swatch big" />
        <div>
          <div className="insp-name">{track.name}</div>
          <div className="muted small">{track.kind === 'drums' ? 'Drum sampler' : 'Synthesizer'}</div>
        </div>
      </div>
      <label className="field">
        <span>{track.kind === 'drums' ? 'Kit' : 'Preset'}</span>
        <select value={track.preset} onChange={(e) => A.setPreset(track.id, e.target.value)}>
          {presets.map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      <div className="section-title">Smart controls</div>
      <SmartKnobs track={track} size={50} />
      <div className="section-title">Mix</div>
      <div className="insp-mix">
        <Fader value={track.mix.volume} meter={track.id} learn={`mix:${track.id}:volume`} onChange={(v) => st.update((d) => { A.findTrack(d, track.id)!.mix.volume = v }, { key: `vol:${track.id}` })} height={110} />
        <div className="insp-mix-knobs">
          <Knob size={36} label="Reverb" value={track.mix.sendReverb} def={0} learn={`mix:${track.id}:sendReverb`} onChange={(v) => st.update((d) => { A.findTrack(d, track.id)!.mix.sendReverb = v }, { key: `sr:${track.id}` })} format={pct} />
          <Knob size={36} label="Echo" value={track.mix.sendDelay} def={0} learn={`mix:${track.id}:sendDelay`} onChange={(v) => st.update((d) => { A.findTrack(d, track.id)!.mix.sendDelay = v }, { key: `sd:${track.id}` })} format={pct} />
          <Knob size={36} label="Filter" value={track.mix.tone} min={-1} max={1} def={0} bipolar learn={`mix:${track.id}:tone`} onChange={(v) => st.update((d) => { A.findTrack(d, track.id)!.mix.tone = v }, { key: `tone:${track.id}` })} format={toneFmt} />
          <Knob size={36} label="Duck" value={track.mix.duck} def={0} learn={`mix:${track.id}:duck`} onChange={(v) => st.update((d) => { A.findTrack(d, track.id)!.mix.duck = v }, { key: `duck:${track.id}` })} format={pct} />
        </div>
      </div>
      <div className="insp-actions">
        <button onClick={() => st.setWorkspace('lab')}>Open in Instrument Lab</button>
        <button className="ghost" onClick={() => A.duplicateTrack(track.id)}>Duplicate</button>
        <button className="ghost" onClick={() => A.moveTrack(track.id, -1)} title="Move up"><Icon name="up" size={12} /></button>
        <button className="ghost" onClick={() => A.moveTrack(track.id, 1)} title="Move down"><Icon name="down" size={12} /></button>
        <button className="ghost danger" onClick={() => A.deleteTrack(track.id)}>Delete</button>
      </div>
      {midi.some((m) => m.target.includes(track.id)) && (
        <>
          <div className="section-title">MIDI mappings</div>
          {midi.filter((m) => m.target.includes(track.id)).map((m, i) => <div key={i} className="small muted">{m.kind === 'cc' ? `CC ${m.number}` : `Note ${m.number}`} → {describeTarget(m.target)}</div>)}
        </>
      )}
    </aside>
  )
}

// ------------------------------------------------------------------------------------- guidance

function useGuidance(p: Project) {
  const tip = useApp((s) => s.tip)
  useEffect(() => {
    // Frequency masking: a bass part that plays alongside a kick without any ducking.
    const kickTrack = p.tracks.find((t) => t.kind === 'drums' && t.clips.some((c) => c.notes.some((n) => n.pitch === 0)))
    const bass = p.tracks.find((t) => t.kind === 'synth' && SYNTH_PRESETS.find((x) => x.name === t.preset)?.category === 'bass' && t.mix.duck < 0.1 && !t.mix.mute)
    if (kickTrack && bass && p.scenes.some((s) => s.slots[kickTrack.id] && s.slots[bass.id])) {
      tip({
        id: `mask-${bass.id}`,
        text: `Your ${bass.name} is competing with the kick drum. Ducking it a little on each kick makes both clearer.`,
        action: { label: 'Duck the bass', run: () => useApp.getState().update((d) => { A.findTrack(d, bass.id)!.mix.duck = 0.45 }) },
      })
    }
  }, [p.tracks, p.scenes, tip])
}
