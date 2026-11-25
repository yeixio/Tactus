// MIDI controller support: notes play the selected track, mapped controls drive
// macros, smart controls, mixer and scene launching. Mappings are saved with the project.
import { audio } from './bridge'
import { useApp, useEngine } from '../state/store'
import { SMART_CONTROLS, type MidiMapping, type SmartName } from '../model/types'

const MIX_TARGETS = ['volume', 'pan', 'tone', 'sendReverb', 'sendDelay', 'drive', 'duck'] as const

/** Human-readable name for a mapping target. */
export function describeTarget(target: string): string {
  const p = useApp.getState().project
  const [kind, a, b] = target.split(':')
  const track = p.tracks.find((t) => t.id === a)
  switch (kind) {
    case 'macro': return `Macro ${p.macros.find((m) => m.id === a)?.name ?? a}`
    case 'smart': return `${track?.name ?? '?'} ${b}`
    case 'mix': return `${track?.name ?? '?'} ${b}`
    case 'mute': return `${track?.name ?? '?'} mute`
    case 'scene': return `Launch ${p.scenes.find((s) => s.id === a)?.name ?? 'scene'}`
    case 'clip': return `Launch ${track?.name ?? '?'} / ${track?.clips.find((c) => c.id === b)?.name ?? '?'}`
    case 'master': return 'Master volume'
    case 'transport': return a === 'play' ? 'Play' : 'Stop'
  }
  return target
}

/** Apply a 0..1 control value (or a trigger, for buttons) to a target. */
export function applyTarget(target: string, v: number, isTrigger = false) {
  const st = useApp.getState()
  const [kind, a, b] = target.split(':')
  switch (kind) {
    case 'macro':
      st.update((d) => { const m = d.macros.find((x) => x.id === a); if (m) m.value = v }, { key: target, history: false })
      break
    case 'smart':
      if ((SMART_CONTROLS as readonly string[]).includes(b)) st.update((d) => { const t = d.tracks.find((x) => x.id === a); if (t) t.smart[b as SmartName] = v }, { key: target })
      break
    case 'mix':
      if ((MIX_TARGETS as readonly string[]).includes(b)) st.update((d) => {
        const t = d.tracks.find((x) => x.id === a)
        if (!t) return
        const val = b === 'pan' || b === 'tone' ? v * 2 - 1 : v
        ;(t.mix as unknown as Record<string, number>)[b] = val
      }, { key: target })
      break
    case 'master':
      st.update((d) => { d.master.volume = v }, { key: target })
      break
    case 'mute':
      if (isTrigger || v > 0.5) st.update((d) => { const t = d.tracks.find((x) => x.id === a); if (t) t.mix.mute = !t.mix.mute })
      break
    case 'scene':
      if (isTrigger || v > 0.5) audio.launchScene(a, st.quantize)
      break
    case 'clip':
      if (isTrigger || v > 0.5) audio.launchClip(a, b, st.quantize)
      break
    case 'transport':
      if (isTrigger || v > 0.5) { if (a === 'play') audio.play('live'); else audio.stop() }
      break
  }
}

let access: MIDIAccess | null = null

export async function initMidi() {
  const nav = navigator as Navigator & { requestMIDIAccess?: (o?: MIDIOptions) => Promise<MIDIAccess> }
  if (!nav.requestMIDIAccess) return
  try {
    access = await nav.requestMIDIAccess({ sysex: false })
  } catch {
    return
  }
  const bind = () => {
    const names: string[] = []
    access!.inputs.forEach((input) => {
      names.push(input.name ?? 'MIDI input')
      input.onmidimessage = (e) => handle(e.data!)
    })
    useEngine.setState({ midiInputs: names })
  }
  bind()
  access.onstatechange = bind
}

const held = new Map<number, string>() // pitch -> track that received the note on

export function handle(data: Uint8Array) {
  const status = data[0] & 0xf0
  const ch = data[0] & 0x0f
  const st = useApp.getState()
  if (status === 0xb0) {
    const cc = data[1], val = data[2]
    useEngine.setState({ lastMidi: `CC ${cc} = ${val} (ch ${ch + 1})` })
    if (st.learn && st.learnTarget) return learn({ kind: 'cc', channel: ch, number: cc, target: st.learnTarget })
    for (const m of st.project.midi) if (m.kind === 'cc' && m.number === cc && (m.channel === -1 || m.channel === ch)) applyTarget(m.target, val / 127)
    return
  }
  if (status === 0x90 || status === 0x80) {
    const note = data[1]
    const vel = data[2]
    const on = status === 0x90 && vel > 0
    if (on) useEngine.setState({ lastMidi: `Note ${note} vel ${vel} (ch ${ch + 1})` })
    if (on && st.learn && st.learnTarget) return learn({ kind: 'note', channel: ch, number: note, target: st.learnTarget })
    const mapped = st.project.midi.filter((m) => m.kind === 'note' && m.number === note && (m.channel === -1 || m.channel === ch))
    if (mapped.length) { if (on) for (const m of mapped) applyTarget(m.target, 1, true); return }
    if (on) {
      const track = st.selectedTrack
      if (!track) return
      held.set(note, track)
      const t = st.project.tracks.find((x) => x.id === track)
      // drum tracks: map notes from C1 (36) upward onto pads (GM-ish layout fallback)
      const pitch = t?.kind === 'drums' ? drumPadFor(note) : note
      if (t?.kind === 'drums') audio.preview(track, pitch, vel / 127, 1)
      else audio.noteOn(track, pitch, vel / 127)
    } else {
      const track = held.get(note)
      held.delete(note)
      if (track) audio.noteOff(track, note)
    }
  }
}

const GM: Record<number, number> = { 35: 0, 36: 0, 38: 1, 40: 1, 39: 2, 42: 3, 44: 3, 46: 4, 41: 5, 43: 5, 45: 5, 47: 5, 37: 6, 56: 7, 54: 7, 70: 7 }
function drumPadFor(note: number) {
  return GM[note] ?? ((note - 36) % 8 + 8) % 8
}

function learn(m: MidiMapping) {
  const st = useApp.getState()
  st.update((d) => {
    d.midi = d.midi.filter((x) => x.target !== m.target && !(x.kind === m.kind && x.number === m.number && x.channel === m.channel))
    d.midi.push(m)
  })
  useApp.setState({ learnTarget: null })
}
