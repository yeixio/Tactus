// Offline rendering, shared by audio export and tests.
import { Engine } from './core/engine'
import type { EngineMaster, EngineSong, EngineTrackParams } from './protocol'

export interface RenderJob {
  song: EngineSong
  tracks: EngineTrackParams[]
  master: EngineMaster
  sampleRate: number
  samples: { id: string; channels: Float32Array[]; sampleRate: number }[]
  /** Render the arrangement (song) or a number of bars of the given scene (loop). */
  mode: 'song' | { scene: string; bars: number }
  tail?: number // seconds of release tail
}

export function renderOffline(job: RenderJob, onProgress?: (f: number) => void): Float32Array[] {
  const e = new Engine(job.sampleRate, () => {}, 512)
  for (const s of job.samples) e.handle({ type: 'sample', ...s })
  e.handle({ type: 'params', tracks: job.tracks, master: job.master })
  e.handle({ type: 'song', song: job.song, at: 'now' })
  const sps = (job.sampleRate * 60) / job.song.bpm / 4
  let totalSteps: number
  if (job.mode === 'song') {
    e.loopSong = false
    totalSteps = job.song.arrangement.reduce((a, b) => a + b.bars * 16, 0)
    e.handle({ type: 'play', mode: 'song' })
  } else {
    e.handle({ type: 'launchScene', scene: job.mode.scene, at: 'now' })
    e.handle({ type: 'play', mode: 'live' })
    totalSteps = job.mode.bars * 16
  }
  const body = Math.ceil(totalSteps * sps)
  const tail = Math.ceil((job.tail ?? 2.5) * job.sampleRate)
  const L = new Float32Array(body + tail)
  const R = new Float32Array(body + tail)
  const block = 512
  for (let i = 0; i < body + tail; i += block) {
    const n = Math.min(block, body + tail - i)
    if (i >= body && e.playing) e.handle({ type: 'stop' })
    e.process(L.subarray(i, i + n), R.subarray(i, i + n), n)
    if (onProgress && (i / block) % 200 === 0) onProgress(i / (body + tail))
  }
  // trim trailing silence in the tail
  let end = L.length
  while (end > body && Math.abs(L[end - 1]) < 1e-5 && Math.abs(R[end - 1]) < 1e-5) end--
  return [L.slice(0, end), R.slice(0, end)]
}

export function encodeWav(ch: Float32Array[], sampleRate: number, bits: 16 | 24 = 24): ArrayBuffer {
  const n = ch[0].length
  const nc = ch.length
  const bps = bits / 8
  const buf = new ArrayBuffer(44 + n * nc * bps)
  const v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * nc * bps, true); w(8, 'WAVE')
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nc * bps, true); v.setUint16(32, nc * bps, true); v.setUint16(34, bits, true)
  w(36, 'data'); v.setUint32(40, n * nc * bps, true)
  let o = 44
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const x = Math.max(-1, Math.min(1, ch[c][i]))
      if (bits === 16) { v.setInt16(o, Math.round(x * 32767), true); o += 2 }
      else { const s = Math.round(x * 8388607); v.setUint8(o, s & 255); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, (s >> 16) & 255); o += 3 }
    }
  }
  return buf
}
