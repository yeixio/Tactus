import { useRef, useState } from 'react'
import { MicError, micAvailable, recordMic, type Recording, type Take } from '../audio/recorder'
import { Icon } from './controls'

/**
 * Record from the microphone. Press to start; the take stops by itself when the sound
 * ends (or press again). The cleaned-up take goes to onTake.
 */
export function RecordButton({ onTake, label = 'Record', maxSeconds = 8, small = true }: { onTake: (t: Take) => void; label?: string; maxSeconds?: number; small?: boolean }) {
  const [state, setState] = useState<'idle' | 'starting' | 'waiting' | 'recording'>('idle')
  const [level, setLevel] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)
  const rec = useRef<Recording | null>(null)
  if (!micAvailable()) return null
  const start = async () => {
    if (rec.current) { rec.current.stop(); return }
    setMsg(null)
    setState('starting')
    try {
      const r = await recordMic({ maxSeconds, onLevel: (pk, heard) => { setLevel(pk); setState(heard ? 'recording' : 'waiting') } })
      rec.current = r
      setState('waiting')
      const take = await r.done
      rec.current = null
      setState('idle')
      setLevel(0)
      if (take) onTake(take)
      else setMsg('Nothing was heard. Try again, a little closer to the mic.')
    } catch (e) {
      rec.current = null
      setState('idle')
      setMsg(e instanceof MicError ? e.message : String((e as Error)?.message ?? e))
    }
  }
  const busy = state !== 'idle'
  return (
    <span className="rec-wrap">
      <button className={`ghost ${small ? 'small' : ''} rec-btn ${busy ? 'on' : ''}`} onClick={start} disabled={state === 'starting'}
        title={busy ? 'Stop recording' : 'Record a sound from the microphone'}>
        <Icon name="rec" size={12} />
        {state === 'idle' || state === 'starting' ? label : state === 'waiting' ? 'Listening…' : 'Stop'}
        {busy && <span className="rec-level" style={{ width: `${Math.min(100, Math.sqrt(level) * 100)}%` }} />}
      </button>
      {msg && <span className="muted small rec-msg">{msg}</span>}
    </span>
  )
}
