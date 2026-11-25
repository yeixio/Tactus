import { encodeWav, renderOffline, type RenderJob } from './render'

self.onmessage = (e: MessageEvent<RenderJob & { bits: 16 | 24 }>) => {
  const job = e.data
  const ch = renderOffline(job, (f) => self.postMessage({ type: 'progress', value: f }))
  const wav = encodeWav(ch, job.sampleRate, job.bits)
  ;(self as unknown as Worker).postMessage({ type: 'done', wav, seconds: ch[0].length / job.sampleRate }, [wav])
}
