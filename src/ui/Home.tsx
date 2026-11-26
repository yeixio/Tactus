import { useEffect, useState } from 'react'
import { useApp } from '../state/store'
import { audio } from '../audio/bridge'
import { MOODS, TEMPLATES, blankProject, projectFromTemplate, type Template } from '../model/project'
import { loadDraft, openProject, openRecent, recentProjects, isDesktop } from '../platform'
import type { Project } from '../model/types'
import { APP_NAME } from '../brand'
import { Icon, StyleIcon } from './controls'

export function Home() {
  const [mood, setMood] = useState('none')
  const [draft, setDraft] = useState<Project | null>(null)
  const [recent, setRecent] = useState<{ path: string; name: string; updatedAt: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const current = useApp((s) => s.project)
  const hasCurrent = useApp((s) => s.revision > 0 && s.project.tracks.length > 0)

  useEffect(() => {
    loadDraft().then(setDraft)
    recentProjects().then(setRecent)
  }, [])

  const start = async (tpl: Template, m = mood, seed = Math.floor(Math.random() * 9999) + 1) => {
    const p = projectFromTemplate(tpl, { mood: m, seed })
    const st = useApp.getState()
    st.setProject(p, { path: null })
    st.setWorkspace(tpl.codeFirst ? 'code' : 'studio')
    // play straight away: the second scene is usually the first full groove
    const scene = p.scenes[Math.min(1, p.scenes.length - 1)]
    await audio.ensure()
    if (scene) { audio.launchScene(scene.id, 'now'); audio.play('live') }
    st.tip({ id: 'first-play', text: 'It is playing. Launch other scenes with the play buttons, turn the smart controls on the right, or click a clip to edit it. Everything you change is heard immediately.' })
  }
  const load = (p: Project, path: string | null) => {
    useApp.getState().setProject(p, { path })
    useApp.getState().setWorkspace('studio')
  }

  return (
    <div className="home">
      <div className="home-hero">
        <div className="logo-big">{APP_NAME}</div>
        <h1>What do you want to make?</h1>
        <p className="muted">Pick a starting point and it starts playing. Shape it with smart controls, edit the patterns, write code, or perform it live. It is all one song.</p>
      </div>
      <div className="moods">
        <span className="muted">Mood</span>
        {MOODS.map((m) => <button key={m.id} className={`mood ${mood === m.id ? 'on' : ''}`} onClick={() => setMood(m.id)}>{m.label}</button>)}
        <button className="mood surprise" onClick={() => {
          const tpls = TEMPLATES.filter((t) => !t.codeFirst)
          start(tpls[Math.floor(Math.random() * tpls.length)], MOODS[Math.floor(Math.random() * MOODS.length)].id)
        }}><Icon name="dice" size={13} /> Surprise me</button>
      </div>
      <div className="templates">
        {TEMPLATES.map((t) => (
          <button key={t.id} className={`tpl ${t.codeFirst ? 'code' : ''}`} onClick={() => start(t)}>
            <StyleIcon name={t.icon} />
            <b>{t.title}</b>
            <span className="muted small">{t.blurb}</span>
            <span className="tpl-meta">{t.bpm} BPM · {t.key}</span>
          </button>
        ))}
        <button className="tpl blank" onClick={() => { load(blankProject(), null) }}>
          <StyleIcon name="blank" />
          <b>Blank project</b>
          <span className="muted small">Drums, bass and keys with empty clips.</span>
        </button>
      </div>
      <div className="home-row">
        <div className="home-col">
          <div className="section-title">Continue</div>
          {hasCurrent && <button className="recent" onClick={() => useApp.getState().setWorkspace('studio')}><b>{current.name}</b><span className="muted small">open now</span></button>}
          {draft && draft.id !== current.id && <button className="recent" onClick={() => load(draft, null)}><b>{draft.name}</b><span className="muted small">last session · {new Date(draft.updatedAt).toLocaleString()}</span></button>}
          {recent.map((r) => (
            <button key={r.path} className="recent" onClick={async () => { try { const l = await openRecent(r.path); load(l.project, l.path) } catch (e) { setError(String(e)) } }}>
              <b>{r.name}</b><span className="muted small">{r.path}</span>
            </button>
          ))}
          <button className="ghost" onClick={async () => { try { const l = await openProject(); if (l) load(l.project, l.path) } catch (e) { setError(String((e as Error).message ?? e)) } }}>Open project…</button>
          {!isDesktop && <div className="muted small">Running in a browser: projects save as downloads and your last session is kept in this browser.</div>}
          {error && <div className="banner bad">{error}</div>}
        </div>
        <div className="home-col">
          <div className="section-title">Get going in a minute</div>
          <ol className="steps-guide">
            <li><b>Pick a starting point</b> above. It starts playing.</li>
            <li><b>Turn a smart control</b> (Warmth, Space, Energy…) in the Studio. Every knob is safe to push.</li>
            <li><b>Launch scenes</b> to move between intro, groove and drop.</li>
            <li><b>Edit a clip</b>: click steps in the drum grid, draw notes in the piano roll, or hit an Inspire button.</li>
            <li><b>Open Code</b> to see the same song as text. Change it and press Run while it plays.</li>
            <li><b>Perform</b>: big scene buttons, macros and MIDI learn. Then <b>Export</b> a WAV.</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
