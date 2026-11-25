// Cleaning up a microphone take: pure functions, so they run in tests too.

export interface Take {
  samples: Float32Array
  sampleRate: number
}

/**
 * Trim silence from both ends, normalize to -1 dBFS and fade the edges.
 * Returns null when the take holds no sound worth keeping.
 */
export function cleanTake(take: Take, opts: { gateDb?: number; tailDb?: number } = {}): Take | null {
  const { samples: x, sampleRate: sr } = take
  let peak = 0
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a }
  if (peak < 0.003) return null // about -50 dBFS: nothing was recorded
  const gate = peak * Math.pow(10, (opts.gateDb ?? -30) / 20)
  const tail = peak * Math.pow(10, (opts.tailDb ?? -48) / 20)
  let start = 0
  while (start < x.length && Math.abs(x[start]) < gate) start++
  start = Math.max(0, start - Math.round(sr * 0.004)) // keep the attack
  // the end is where a 10 ms window last rises above the tail level
  const win = Math.max(1, Math.round(sr * 0.01))
  let end = x.length
  for (let i = x.length - win; i > start; i -= win) {
    let m = 0
    for (let k = i; k < i + win; k++) { const a = Math.abs(x[k]); if (a > m) m = a }
    if (m >= tail) { end = Math.min(x.length, i + win * 2); break }
  }
  const out = x.slice(start, end)
  const g = Math.pow(10, -1 / 20) / peak
  const fadeIn = Math.min(out.length, Math.round(sr * 0.002))
  const fadeOut = Math.min(out.length, Math.round(sr * 0.015))
  for (let i = 0; i < out.length; i++) {
    let e = g
    if (i < fadeIn) e *= i / fadeIn
    const r = out.length - 1 - i
    if (r < fadeOut) e *= (r / fadeOut) ** 2
    out[i] *= e
  }
  return { samples: out, sampleRate: sr }
}

/**
 * Estimate the pitch of a take as a MIDI note (fractional), by autocorrelation over a
 * stable stretch after the attack. Returns null for unpitched sounds such as claps.
 */
export function detectPitch(take: Take): number | null {
  const { samples: x, sampleRate: sr } = take
  const from = Math.min(x.length, Math.round(sr * 0.05))
  const n = Math.min(x.length - from, Math.round(sr * 0.2))
  if (n < sr * 0.04) return null
  const minLag = Math.floor(sr / 1500), maxLag = Math.min(Math.floor(sr / 50), n >> 1)
  let energy = 0
  for (let i = 0; i < n; i++) energy += x[from + i] * x[from + i]
  if (energy <= 0) return null
  const corr = (lag: number) => {
    let s = 0, e1 = 0, e2 = 0
    for (let i = 0; i + lag < n; i++) { const a = x[from + i], b = x[from + i + lag]; s += a * b; e1 += a * a; e2 += b * b }
    return s / Math.sqrt(e1 * e2 || 1)
  }
  const c = new Float64Array(maxLag + 2)
  for (let lag = minLag; lag <= maxLag + 1; lag++) c[lag] = corr(lag)
  // the first lag whose correlation is close to the best one avoids octave errors
  let best = 0
  for (let lag = minLag; lag <= maxLag; lag++) if (c[lag] > best) best = c[lag]
  if (best < 0.8) return null
  let lag = minLag
  for (; lag <= maxLag; lag++) if (c[lag] >= best * 0.95 && c[lag] >= c[lag - 1] && c[lag] >= c[lag + 1]) break
  // parabolic interpolation around the peak
  const a = c[lag - 1], b = c[lag], d = c[lag + 1]
  const shift = (a - d) / (2 * (a - 2 * b + d) || 1)
  const hz = sr / (lag + (Number.isFinite(shift) ? shift : 0))
  return 69 + 12 * Math.log2(hz / 440)
}
