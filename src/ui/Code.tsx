import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, highlightActiveLineGutter } from '@codemirror/view'
import { StreamLanguage, HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { autocompletion, closeBrackets, type CompletionContext } from '@codemirror/autocomplete'
import { linter, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint'
import { useApp, useEngine } from '../state/store'
import { audio } from '../audio/bridge'
import { buildProject, type BuildResult, type SourceFile } from '../dsl/build'
import { printProject } from '../dsl/print'
import type { Diagnostic } from '../dsl/lexer'
import { DRUM_KITS, DRUM_LINES, PAD_NAMES, SYNTH_PRESETS } from '../model/presets'
import { GENERATORS } from '../model/generate'
import { SMART_CONTROLS, SCALES } from '../model/types'
import { noteName } from '../model/theory'
import { ClipThumb } from './editors'
import { Icon, Seg } from './controls'
import type { Quantize } from '../engine/protocol'
import { isMac } from '../platform'

// ----------------------------------------------------------------------------- code workspace state

interface CodeState {
  files: SourceFile[]
  active: string
  dirty: boolean // edits not yet applied to the project
  diagnostics: Diagnostic[]
  lastRun: { ok: boolean; at: number; message: string } | null
  live: boolean
  sourceMap: BuildResult['sourceMap']
  printedRevision: number
  printKey: number
}

export const useCode = create<CodeState>(() => ({
  files: [],
  active: 'song.tac',
  dirty: false,
  diagnostics: [],
  lastRun: null,
  live: false,
  sourceMap: {},
  printedRevision: -1,
  printKey: 0,
}))

/** Re-print the code from the project (after visual edits), unless the user has unapplied edits. */
export function syncCodeFromProject(force = false) {
  const app = useApp.getState()
  const cs = useCode.getState()
  if (cs.printedRevision === app.revision && !force) return
  if (cs.dirty && !force) return
  if (app.origin === 'code' && !force && cs.files.length) { useCode.setState({ printedRevision: app.revision }); return }
  const files = printProject(app.project)
  const r = buildProject(files, app.project)
  useCode.setState({
    files,
    active: files.some((f) => f.name === cs.active) ? cs.active : 'song.tac',
    dirty: false,
    diagnostics: [],
    sourceMap: r.sourceMap,
    printedRevision: app.revision,
    printKey: cs.printKey + 1,
  })
}

function run(quantize: Quantize, auto = false) {
  const cs = useCode.getState()
  const app = useApp.getState()
  const r = buildProject(cs.files, app.project)
  const errors = r.diagnostics.filter((d) => d.severity === 'error')
  if (!r.project) {
    useCode.setState({
      diagnostics: r.diagnostics,
      lastRun: auto ? cs.lastRun : { ok: false, at: Date.now(), message: `${errors.length} problem${errors.length === 1 ? '' : 's'}. The music keeps playing the last version that worked.` },
    })
    return false
  }
  app.setProject(r.project, { origin: 'code', keepHistory: true, at: quantize })
  const playing = useEngine.getState().status?.playing
  useCode.setState({
    diagnostics: r.diagnostics,
    dirty: false,
    sourceMap: r.sourceMap,
    printedRevision: useApp.getState().revision,
    lastRun: { ok: true, at: Date.now(), message: playing && quantize !== 'now' ? `Applied. Takes effect on the next ${quantize}.` : 'Applied.' },
  })
  return true
}

// ------------------------------------------------------------------------------------- language

const KEYWORDS = new Set(['tempo', 'bpm', 'key', 'swing', 'master', 'track', 'clip', 'scene', 'arrange', 'pad', 'guardrails', 'bars', 'bar', 'beats', 'steps', 'notes', 'mute', 'solo', 'on', 'off'])
const TYPES = new Set(['synth', 'drums'])
const PARAMS = new Set([...SMART_CONTROLS, 'volume', 'pan', 'reverb', 'delay', 'saturation', 'tone', 'duck', 'color', ...Object.keys(SYNTH_PRESETS[0].params), 'tune', 'decay', 'gain', 'sample', 'echo', 'feedback', 'space'])

const tacLanguage = StreamLanguage.define<{ inGen: boolean }>({
  startState: () => ({ inGen: false }),
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match('//')) { stream.skipToEnd(); return 'comment' }
    if (stream.match(/^"[^"]*"?/)) return 'string'
    if (stream.match(/^-?\d+(\.\d+)?%?/)) return 'number'
    if (stream.match(/^[A-Za-z_][\w#-]*/)) {
      const w = stream.current()
      if (stream.peek() === '(' && w in GENERATORS) return 'function'
      if (KEYWORDS.has(w)) return 'keyword'
      if (TYPES.has(w)) return 'typeName'
      if ((PAD_NAMES as readonly string[]).includes(w)) return 'labelName'
      if (PARAMS.has(w)) return 'propertyName'
      return 'variableName'
    }
    if (stream.match(/^[{}()]/)) return 'bracket'
    stream.next()
    return 'operator'
  },
})

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: '#ff8a5c', fontWeight: '600' },
  { tag: t.typeName, color: '#ffc857' },
  { tag: t.string, color: '#8be0a4' },
  { tag: t.number, color: '#7cc6ff' },
  { tag: t.comment, color: '#6b7180', fontStyle: 'italic' },
  { tag: t.function(t.variableName), color: '#d49cff' },
  { tag: t.labelName, color: '#ffb0d0' },
  { tag: t.propertyName, color: '#9ad5e8' },
  { tag: t.variableName, color: '#e6e6e6' },
  { tag: t.bracket, color: '#9aa0ad' },
])

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px', backgroundColor: 'var(--code-bg)', color: 'var(--text)' },
  '.cm-content': { fontFamily: 'var(--mono)', caretColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: '#5a606c', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.05)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(255,122,69,0.25) !important' },
  '.cm-tooltip': { backgroundColor: '#22242b', border: '1px solid #33363f', color: 'var(--text)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: '#111' },
}, { dark: true })

function complete(ctx: CompletionContext) {
  const word = ctx.matchBefore(/[\w#-]*/)
  if (!word || (word.from === word.to && !ctx.explicit)) return null
  const line = ctx.state.doc.lineAt(ctx.pos).text.slice(0, ctx.pos - ctx.state.doc.lineAt(ctx.pos).from)
  const opts: { label: string; type: string; detail?: string; info?: string; apply?: string }[] = []
  const trimmed = line.trimStart()
  if (/^track\s+\S+\s+synth\s+\S*$/.test(trimmed)) SYNTH_PRESETS.forEach((p) => opts.push({ label: p.name, type: 'constant', detail: p.category, info: p.description }))
  else if (/^track\s+\S+\s+drums\s+\S*$/.test(trimmed)) DRUM_KITS.forEach((k) => opts.push({ label: k.name, type: 'constant', info: k.description }))
  else if (/^track\s+\S+\s+\S*$/.test(trimmed)) ['synth', 'drums'].forEach((k) => opts.push({ label: k, type: 'type' }))
  else if (/^(osc1|osc2)\s+\S*$/.test(trimmed)) ['saw', 'square', 'triangle', 'sine'].forEach((w) => opts.push({ label: w, type: 'constant' }))
  else if (/^(kick|snare|clap|hat|openhat|tom|rim|perc)\s+\S*$/.test(trimmed)) Object.entries(DRUM_LINES).forEach(([k, v]) => opts.push({ label: k, type: 'constant', detail: v }))
  else if (/^key\s/.test(trimmed)) Object.keys(SCALES).forEach((s) => opts.push({ label: s, type: 'constant' }))
  else if (/=\s*\w*$/.test(line)) Object.entries(GENERATORS).forEach(([k, g]) => opts.push({ label: k, type: 'function', detail: g.signature, info: g.doc, apply: `${k}(` }))
  else {
    ;['tempo', 'key', 'swing', 'master', 'track', 'clip', 'scene', 'arrange', 'pad'].forEach((k) => opts.push({ label: k, type: 'keyword' }))
    SMART_CONTROLS.forEach((s) => opts.push({ label: s, type: 'property', detail: 'smart control 0..1' }))
    ;['volume', 'pan', 'reverb', 'delay', 'saturation', 'tone', 'duck'].forEach((s) => opts.push({ label: s, type: 'property', detail: 'mix' }))
    Object.keys(SYNTH_PRESETS[0].params).forEach((s) => opts.push({ label: s, type: 'property', detail: 'synth' }))
    PAD_NAMES.forEach((p) => opts.push({ label: p, type: 'variable', detail: 'drum pad' }))
  }
  return { from: word.from, options: opts, validFor: /^[\w#-]*$/ }
}

function cmDiagnostics(file: string, diags: Diagnostic[], docLen: number): CmDiagnostic[] {
  return diags.filter((d) => d.file === file).map((d) => ({ from: Math.min(d.from, docLen), to: Math.min(Math.max(d.to, d.from + 1), docLen), severity: d.severity, message: d.message }))
}

// ----------------------------------------------------------------------------------- component

export function CodeWorkspace() {
  const files = useCode((s) => s.files)
  const active = useCode((s) => s.active)
  const dirty = useCode((s) => s.dirty)
  const diags = useCode((s) => s.diagnostics)
  const lastRun = useCode((s) => s.lastRun)
  const live = useCode((s) => s.live)
  const printKey = useCode((s) => s.printKey)
  const quantize = useApp((s) => s.quantize)
  const revision = useApp((s) => s.revision)
  const origin = useApp((s) => s.origin)
  const [panel, setPanel] = useState<'problems' | 'events' | 'reference'>('reference')
  const [cursorLine, setCursorLine] = useState(1)
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const liveTimer = useRef<number | undefined>(undefined)

  useEffect(() => { syncCodeFromProject() }, [revision])
  const stale = dirty && origin !== 'code' && useCode.getState().printedRevision !== revision

  const file = files.find((f) => f.name === active) ?? files[0]

  // (re)create the editor for the active file
  useEffect(() => {
    if (!host.current || !file) return
    const extensions: Extension[] = [
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), bracketMatching(), closeBrackets(), indentOnInput(),
      tacLanguage, syntaxHighlighting(highlight), theme, lintGutter(),
      autocompletion({ override: [complete] }),
      keymap.of([
        { key: 'Mod-Enter', run: () => { runNow(); return true } },
        { key: 'Mod-s', run: () => { runNow(); return false } },
        indentWithTab, ...defaultKeymap, ...historyKeymap,
      ]),
      linter((v) => {
        const cs = useCode.getState()
        const fs = cs.files.map((f) => (f.name === cs.active ? { ...f, source: v.state.doc.toString() } : f))
        const r = buildProject(fs, useApp.getState().project)
        useCode.setState({ diagnostics: r.diagnostics })
        return cmDiagnostics(cs.active, r.diagnostics, v.state.doc.length)
      }, { delay: 350 }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          const text = u.state.doc.toString()
          useCode.setState((s) => ({ files: s.files.map((f) => (f.name === s.active ? { ...f, source: text } : f)), dirty: true }))
          if (useCode.getState().live) {
            clearTimeout(liveTimer.current)
            liveTimer.current = window.setTimeout(() => run(useApp.getState().quantize, true), 800)
          }
        }
        if (u.selectionSet || u.docChanged) setCursorLine(u.state.doc.lineAt(u.state.selection.main.head).number)
      }),
    ]
    const v = new EditorView({ state: EditorState.create({ doc: file.source, extensions }), parent: host.current })
    view.current = v
    return () => { v.destroy(); view.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, files.length, printKey])

  // jump to a clip's source when asked from the studio
  const jump = useApp((s) => s.codeJump)
  useEffect(() => {
    if (!jump) return
    syncCodeFromProject()
    const sm = useCode.getState().sourceMap
    const loc = jump.clip ? sm[jump.clip] : jump.file ? { file: jump.file, line: jump.line ?? 1 } : null
    useApp.setState({ codeJump: null })
    if (!loc) return
    useCode.setState({ active: loc.file })
    setTimeout(() => {
      const v = view.current
      if (!v) return
      const line = v.state.doc.line(Math.min(loc.line, v.state.doc.lines))
      v.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
      v.focus()
    }, 30)
  }, [jump])

  function runNow() { run(useApp.getState().quantize) }

  // clip under the cursor (visual feedback for code)
  const project = useApp((s) => s.project)
  const sourceMap = useCode((s) => s.sourceMap)
  const cursorClip = useMemo(() => {
    let best: { id: string; line: number } | null = null
    for (const [id, loc] of Object.entries(sourceMap)) if (loc.file === active && loc.line <= cursorLine && (!best || loc.line > best.line)) best = { id, line: loc.line }
    if (!best) return null
    for (const tr of project.tracks) { const c = tr.clips.find((x) => x.id === best!.id); if (c) return { track: tr, clip: c } }
    return null
  }, [sourceMap, active, cursorLine, project])

  const errors = diags.filter((d) => d.severity === 'error')
  const fileErrors = (name: string) => diags.some((d) => d.file === name && d.severity === 'error')

  return (
    <div className="code-ws">
      <aside className="files">
        <div className="section-title">Project files</div>
        {files.map((f) => (
          <div key={f.name} className={`file ${f.name === active ? 'on' : ''}`} onClick={() => useCode.setState({ active: f.name })}>
            <span>{f.name}</span>
            {fileErrors(f.name) && <span className="err-dot" />}
          </div>
        ))}
        <button className="ghost small" onClick={() => {
          const cs = useCode.getState()
          let n = 1
          while (cs.files.some((f) => f.name === `tracks/new-${n}.tac`)) n++
          const name = `tracks/new-${n}.tac`
          const src = `track "New ${n}" synth pluck {\n  clip main 1 bar {\n    "C4 . E4 . G4 . C5 . G4 . E4 . C4 ~ ~ ."\n  }\n}\n`
          useCode.setState({ files: [...cs.files, { name, source: src }], active: name, dirty: true })
        }}><Icon name="plus" size={11} /> New track file</button>
        <div className="files-note muted small">Each track lives in its own file. song.tac holds tempo, key, scenes and the arrangement.</div>
      </aside>
      <div className="code-main">
        <div className="code-bar">
          <button className="primary" onClick={runNow} title={`Run (${isMac ? '⌘' : 'Ctrl'}+Enter)`}><Icon name="play" size={12} /> Run</button>
          <span className="muted">Apply on</span>
          <Seg small value={quantize} onChange={(q) => useApp.setState({ quantize: q })} options={[{ value: 'now', label: 'Now' }, { value: 'beat', label: 'Beat' }, { value: 'bar', label: 'Bar' }]} />
          <label className="check" title="Apply automatically shortly after you stop typing, when the code has no errors"><input type="checkbox" checked={live} onChange={(e) => useCode.setState({ live: e.target.checked })} /> Live</label>
          <span className="sep" />
          <button className="ghost" onClick={() => audio.play('live')} title="Play the session"><Icon name="play" size={12} /></button>
          <button className="ghost" onClick={() => audio.stop()}><Icon name="stop" size={12} /></button>
          <div className="grow" />
          {dirty && <span className="pill warn">Unapplied changes</span>}
          {lastRun && <span className={`pill ${lastRun.ok ? 'ok' : 'bad'}`}>{lastRun.message}</span>}
          <button className="ghost" onClick={() => syncCodeFromProject(true)} title="Discard edits and reload the code from the project">Reload</button>
        </div>
        {stale && <div className="banner">The project changed in another view while you have unapplied edits. <button onClick={() => syncCodeFromProject(true)}>Load the latest</button> or Run to apply yours.</div>}
        <div className="code-editor" ref={host} />
        <div className="code-panel">
          <div className="code-panel-tabs">
            <Seg small value={panel} onChange={(p) => { setPanel(p); audio.setMonitor(p === 'events') }} options={[
              { value: 'reference', label: 'Reference' },
              { value: 'problems', label: `Problems${errors.length ? ` (${errors.length})` : ''}` },
              { value: 'events', label: 'Event monitor' },
            ]} />
          </div>
          <div className="code-panel-body">
            {panel === 'problems' && <Problems diags={diags} />}
            {panel === 'events' && <Events />}
            {panel === 'reference' && <Reference />}
          </div>
        </div>
      </div>
      <aside className="code-side">
        <div className="section-title">At the cursor</div>
        {cursorClip ? (
          <div className="cursor-clip" style={{ ['--tc' as string]: cursorClip.track.color }}>
            <div><span className="swatch" /> <b>{cursorClip.track.name}</b> / {cursorClip.clip.name}</div>
            <ClipThumb clip={cursorClip.clip} track={cursorClip.track} width={230} height={90} />
            <div className="muted small">{cursorClip.clip.notes.length} notes · {cursorClip.clip.length / 16} bar{cursorClip.clip.length === 16 ? '' : 's'}</div>
            <div className="row">
              <button onClick={() => audio.launchClip(cursorClip.track.id, cursorClip.clip.id, useApp.getState().quantize)}><Icon name="play" size={11} /> Launch</button>
              <button className="ghost" onClick={() => { useApp.getState().select(cursorClip.track.id, cursorClip.clip.id); useApp.getState().setWorkspace('studio') }}>Edit visually</button>
            </div>
          </div>
        ) : <div className="muted small">Move the cursor into a clip to see and hear it.</div>}
        <div className="section-title">How it works</div>
        <div className="muted small">The code and the Studio edit the same song. Change notes in the piano roll and the code updates; run the code and the Studio updates. If the code has an error, the music keeps playing the last working version.</div>
      </aside>
    </div>
  )
}

function Problems({ diags }: { diags: Diagnostic[] }) {
  if (!diags.length) return <div className="muted">No problems.</div>
  return (
    <div className="problems">
      {diags.map((d, i) => (
        <div key={i} className={`problem ${d.severity}`} onClick={() => useApp.setState({ codeJump: { file: d.file, line: d.line } })}>
          <span className="loc">{d.file}:{d.line}:{d.col}</span> {d.message}
        </div>
      ))}
    </div>
  )
}

function Events() {
  const events = useEngine((s) => s.events)
  const project = useApp((s) => s.project)
  const sm = useCode((s) => s.sourceMap)
  const list = events.slice(-60).reverse()
  if (!list.length) return <div className="muted">Press play to see every note the engine plays, with the clip and step that produced it. Click an event to jump to its source.</div>
  return (
    <table className="events">
      <thead><tr><th>Time</th><th>Bar.Beat.Step</th><th>Track</th><th>Clip</th><th>Step</th><th>Note</th><th>Vel</th></tr></thead>
      <tbody>
        {list.map((e, i) => {
          const tr = project.tracks.find((x) => x.id === e.track)
          const c = tr?.clips.find((x) => x.id === e.clip)
          const bar = Math.floor(e.absStep / 16) + 1, beat = Math.floor((e.absStep % 16) / 4) + 1, st = (e.absStep % 4) + 1
          return (
            <tr key={i} onClick={() => sm[e.clip] && useApp.setState({ codeJump: { clip: e.clip } })}>
              <td>{e.time.toFixed(3)}</td><td>{bar}.{beat}.{st}</td>
              <td style={{ color: tr?.color }}>{tr?.name}</td><td>{c?.name}</td><td>{e.step + 1}</td>
              <td>{tr?.kind === 'drums' ? PAD_NAMES[e.pitch] : noteName(e.pitch)}</td><td>{Math.round(e.vel * 100)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Reference() {
  return (
    <div className="reference">
      <div>
        <h4>Song</h4>
        <pre>{`tempo 124
key "A minor"          // any of: ${Object.keys(SCALES).slice(0, 5).join(', ')}…
swing 0.1              // 0 to 0.5
scene Drop { Drums: Groove, Bass: Line }
arrange { Intro 4, Drop 8 }`}</pre>
      </div>
      <div>
        <h4>Tracks and clips</h4>
        <pre>{`track Bass synth analog-bass {
  warmth 0.7      // smart controls 0..1
  cutoff 600      // any synth setting
  reverb 0.2      // mix: volume pan reverb delay
  clip Line 1 bar {
    "A1 ~ . A1 C2 . E2 . | ..."
  }               // note, ~ hold, . rest, A1+C2 chord
}               // A1! accent, A1? soft`}</pre>
      </div>
      <div>
        <h4>Drums</h4>
        <pre>{`track Drums drums punchy {
  pad kick tune -2 decay 0.8
  clip Beat 1 bar {
    kick four-on-floor
    hat  "..x. ..x. ..X. ..xo"
  }               // x hit, X accent, o soft
}`}</pre>
      </div>
      <div>
        <h4>Generators</h4>
        <pre>{Object.entries(GENERATORS).map(([, g]) => `${g.signature}`).join('\n')}{'\n\n'}clip Arp 4 bars = arp("Am F C G", up, 7)</pre>
      </div>
    </div>
  )
}
