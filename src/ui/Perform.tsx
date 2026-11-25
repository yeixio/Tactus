import { useState } from 'react'
import { useApp, useEngine } from '../state/store'
import { audio } from '../audio/bridge'
import { Fader, Icon, Knob, Seg } from './controls'
import * as A from './actions'
import { toneFmt } from './Studio'
import { SMART_CONTROLS, type MacroParam, type PerfMacro, type Project } from '../model/types'
import { uid } from '../model/project'
import { describeTarget } from '../audio/midi'

export function Perform() {
  const project = useApp((s) => s.project)
  const quantize = useApp((s) => s.quantize)
  const status = useEngine((s) => s.status)
  const [editing, setEditing] = useState<string | null>(null)
  const up = useApp.getState().update
  const activeScene = project.scenes.find((s) => project.tracks.length > 0 && project.tracks.every((t) => (s.slots[t.id] ?? null) === (status?.playingClips[t.id] ?? null)))
  return (
    <div className="perform">
      <div className="perf-scenes">
        {project.scenes.map((s, i) => {
          const queued = status && project.tracks.some((t) => status.queued[t.id] !== undefined && status.queued[t.id] === (s.slots[t.id] ?? null)) && activeScene?.id !== s.id
          return (
            <button key={s.id} data-learn={`scene:${s.id}`} className={`perf-scene ${activeScene?.id === s.id && status?.playing ? 'on' : ''} ${queued ? 'queued' : ''}`} onClick={() => audio.launchScene(s.id, quantize)}>
              <span className="perf-key">{i < 9 ? i + 1 : ''}</span>
              <span>{s.name}</span>
            </button>
          )
        })}
        <button className="perf-scene stopall" onClick={() => { for (const t of project.tracks) audio.launchClip(t.id, null, quantize) }}><Icon name="stop" /> <span>Stop clips</span></button>
      </div>
      <div className="perf-body">
        <div className="perf-tracks">
          {project.tracks.map((t) => {
            const playing = status?.playingClips[t.id]
            return (
              <div key={t.id} className="perf-track" style={{ ['--tc' as string]: t.color }}>
                <div className="perf-track-name">{t.name}</div>
                <div className="perf-clips">
                  {t.clips.map((c) => (
                    <button key={c.id} data-learn={`clip:${t.id}:${c.id}`} className={`perf-clip ${playing === c.id ? 'on' : ''} ${status?.queued[t.id] === c.id ? 'queued' : ''}`} onClick={() => audio.launchClip(t.id, c.id, quantize)}>{c.name}</button>
                  ))}
                  <button className="perf-clip stop" onClick={() => audio.launchClip(t.id, null, quantize)}><Icon name="stop" size={10} /></button>
                </div>
                <Knob size={42} label="Filter" value={t.mix.tone} min={-1} max={1} def={0} bipolar color={t.color} learn={`mix:${t.id}:tone`} onChange={(v) => up((d) => { A.findTrack(d, t.id)!.mix.tone = v }, { key: `tone:${t.id}` })} format={toneFmt} />
                <Fader value={t.mix.volume} meter={t.id} learn={`mix:${t.id}:volume`} onChange={(v) => up((d) => { A.findTrack(d, t.id)!.mix.volume = v }, { key: `vol:${t.id}` })} height={120} />
                <button className={`ms wide ${t.mix.mute ? 'on mute' : ''}`} data-learn={`mute:${t.id}`} onClick={() => up((d) => { const x = A.findTrack(d, t.id)!; x.mix.mute = !x.mix.mute })}>{t.mix.mute ? 'Muted' : 'Mute'}</button>
              </div>
            )
          })}
        </div>
        <div className="perf-macros">
          <div className="section-title">Performance macros</div>
          <div className="macro-grid">
            {project.macros.map((m) => (
              <div key={m.id} className="macro">
                <Knob size={84} label={m.name} value={m.value} def={0} learn={`macro:${m.id}`} color="var(--accent)" onChange={(v) => up((d) => { d.macros.find((x) => x.id === m.id)!.value = v }, { key: `macro:${m.id}`, history: false })} format={(v) => `${Math.round(v * 100)}`} />
                <button className="ghost small" onClick={() => setEditing(editing === m.id ? null : m.id)}>{editing === m.id ? 'Done' : 'Edit'}</button>
              </div>
            ))}
            <div className="macro add">
              <button className="ghost" onClick={() => { const id = uid('mac'); up((d) => { d.macros.push({ id, name: `Macro ${d.macros.length + 1}`, value: 0, targets: [{ track: '*', param: 'sendReverb', amount: 0.5 }] }) }); setEditing(id) }}><Icon name="plus" /> New macro</button>
              <button className="ghost small" onClick={() => up((d) => { for (const m of d.macros) m.value = 0 })}>Reset all</button>
            </div>
          </div>
          {editing && project.macros.find((m) => m.id === editing) && <MacroEditor macro={project.macros.find((m) => m.id === editing)!} project={project} onClose={() => setEditing(null)} />}
          <PerfFooter />
        </div>
      </div>
    </div>
  )
}

const PARAMS: { value: MacroParam; label: string }[] = [
  { value: 'tone', label: 'DJ filter' }, { value: 'cutoff', label: 'Synth cutoff' }, { value: 'resonance', label: 'Resonance' },
  { value: 'sendReverb', label: 'Reverb send' }, { value: 'sendDelay', label: 'Echo send' }, { value: 'drive', label: 'Drive' },
  { value: 'volume', label: 'Volume' }, { value: 'duck', label: 'Duck' }, { value: 'pan', label: 'Pan' },
  { value: 'density', label: 'Rhythmic density (drums)' }, { value: 'chaos', label: 'Chaos' },
  ...SMART_CONTROLS.map((s) => ({ value: `smart.${s}` as MacroParam, label: `Smart: ${s}` })),
  { value: 'master.delayFeedback', label: 'Master echo feedback' }, { value: 'master.reverbSize', label: 'Master room size' },
]

function MacroEditor({ macro, project, onClose }: { macro: PerfMacro; project: Project; onClose: () => void }) {
  const up = useApp.getState().update
  const edit = (fn: (m: PerfMacro) => void) => up((d) => { const m = d.macros.find((x) => x.id === macro.id); if (m) fn(m as PerfMacro) }, { key: `medit:${macro.id}` })
  return (
    <div className="macro-editor">
      <div className="row">
        <input value={macro.name} onChange={(e) => edit((m) => { m.name = e.target.value })} />
        <span className="muted small">At full turn this macro moves:</span>
        <div className="grow" />
        <button className="ghost danger small" onClick={() => { up((d) => { d.macros = d.macros.filter((x) => x.id !== macro.id) }); onClose() }}>Delete macro</button>
      </div>
      {macro.targets.map((tg, i) => (
        <div key={i} className="row target">
          <select value={tg.track} onChange={(e) => edit((m) => { m.targets[i].track = e.target.value })}>
            <option value="*">All tracks</option><option value="*drums">All drum tracks</option><option value="*synth">All instruments</option><option value="master">Master</option>
            {project.tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={tg.param} onChange={(e) => edit((m) => { m.targets[i].param = e.target.value as MacroParam })}>
            {PARAMS.filter((p) => (tg.track === 'master') === p.value.startsWith('master.')).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <input type="range" min={-1} max={1} step={0.01} value={tg.amount} onChange={(e) => edit((m) => { m.targets[i].amount = Number(e.target.value) })} />
          <span className="mono small" style={{ width: 40 }}>{tg.amount > 0 ? '+' : ''}{Math.round(tg.amount * 100)}</span>
          <button className="ghost tiny" onClick={() => edit((m) => { m.targets.splice(i, 1) })}><Icon name="x" size={10} /></button>
        </div>
      ))}
      <button className="ghost small" onClick={() => edit((m) => { m.targets.push({ track: '*', param: 'sendDelay', amount: 0.3 }) })}><Icon name="plus" size={10} /> Add target</button>
    </div>
  )
}

function PerfFooter() {
  const learn = useApp((s) => s.learn)
  const midi = useApp((s) => s.project.midi)
  const inputs = useEngine((s) => s.midiInputs)
  const last = useEngine((s) => s.lastMidi)
  const quantize = useApp((s) => s.quantize)
  return (
    <div className="perf-footer">
      <div className="row">
        <span className="muted">Launch on</span>
        <Seg small value={quantize} onChange={(q) => useApp.setState({ quantize: q })} options={[{ value: 'now', label: 'Now' }, { value: 'beat', label: 'Beat' }, { value: 'bar', label: 'Bar' }]} />
        <button className={learn ? 'primary' : ''} onClick={() => useApp.setState({ learn: !learn, learnTarget: null })}>{learn ? 'Finish MIDI learn' : 'MIDI learn'}</button>
      </div>
      <div className="muted small">
        {inputs.length ? `MIDI: ${inputs.join(', ')}` : 'No MIDI controller found. Plug one in and it will appear here.'}
        {last && <> · last: {last}</>}
      </div>
      {learn && <div className="banner">Click any knob, fader, scene or clip button, then move a control or press a pad on your controller.</div>}
      {midi.length > 0 && (
        <div className="mappings">
          {midi.map((m, i) => (
            <div key={i} className="row small">
              <span className="mono">{m.kind === 'cc' ? `CC ${m.number}` : `Note ${m.number}`}</span> → <span>{describeTarget(m.target)}</span>
              <button className="ghost tiny" onClick={() => useApp.getState().update((d) => { d.midi.splice(i, 1) })}><Icon name="x" size={9} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="muted small">Keys: 1–9 launch scenes · Space play/stop · the mappings save with the project.</div>
    </div>
  )
}
