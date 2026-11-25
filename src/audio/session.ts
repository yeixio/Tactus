// The audio session on iPhone and iPad. WebKit gives Web Audio the "ambient" session by default,
// which the ring/silent switch mutes on the built-in speaker (Bluetooth and headphones still play).
// An instrument must play like a music app, so ask for the "playback" session, and for
// "play-and-record" only while the microphone is in use.

type SessionType = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record'
interface AudioSessionApi { type: SessionType }

const session = (): AudioSessionApi | undefined =>
  typeof navigator !== 'undefined' ? (navigator as Navigator & { audioSession?: AudioSessionApi }).audioSession : undefined

const isAppleTouch = () =>
  typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

let unlock: HTMLAudioElement | null = null

/** A silent, looping media element moves older iOS (before 16.4) to the playback session too. */
function silentLoop() {
  if (unlock || typeof document === 'undefined') return
  // 0.1 s of silence, 8 kHz mono 8-bit WAV
  const n = 800
  const bytes = new Uint8Array(44 + n)
  const v = new DataView(bytes.buffer)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true)
  v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true)
  bytes.fill(128, 44)
  const a = document.createElement('audio')
  a.setAttribute('x-webkit-airplay', 'deny')
  a.preload = 'auto'
  a.loop = true
  a.src = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
  unlock = a
  a.play().catch(() => { unlock = null })
}

/** Call from a user gesture, before the AudioContext starts. */
export function usePlaybackSession() {
  const s = session()
  if (s) { if (s.type !== 'playback') s.type = 'playback' }
  else if (isAppleTouch()) silentLoop()
}

/** While recording: the microphone needs play-and-record (WebKit keeps the speaker as the output). */
export function useRecordingSession(on: boolean) {
  const s = session()
  if (s) s.type = on ? 'play-and-record' : 'playback'
}
