// Factory drum samples, synthesized once per kit. The drum instrument is a sampler:
// any pad can instead play a user-supplied audio file.

export interface SampleData {
  channels: Float32Array[]
  sampleRate: number
}

function noise(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return (s / 4294967296) * 2 - 1
  }
}

class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0; x1 = 0; x2 = 0; y1 = 0; y2 = 0
  constructor(type: 'lp' | 'hp' | 'bp', f: number, q: number, sr: number) {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr
    const cs = Math.cos(w)
    const al = Math.sin(w) / (2 * q)
    const a0 = 1 + al
    if (type === 'lp') { this.b0 = (1 - cs) / 2 / a0; this.b1 = (1 - cs) / a0; this.b2 = this.b0 }
    else if (type === 'hp') { this.b0 = (1 + cs) / 2 / a0; this.b1 = -(1 + cs) / a0; this.b2 = this.b0 }
    else { this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0 }
    this.a1 = (-2 * cs) / a0
    this.a2 = (1 - al) / a0
  }
  p(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y
    return y
  }
}

interface KitStyle {
  kick: { f0: number; f1: number; pd: number; ad: number; click: number; drive: number }
  snare: { tone: number; td: number; nd: number; mix: number; bp: number }
  clap: { bp: number; tail: number }
  hat: { ratio: number; cd: number; od: number; hp: number }
  tom: { f0: number; f1: number; ad: number }
  perc: 'cowbell' | 'shaker' | 'clank'
  post: 'clean' | 'lofi' | 'crush'
}

const STYLES: Record<string, KitStyle> = {
  '808': { kick: { f0: 110, f1: 47, pd: 0.06, ad: 0.7, click: 0.15, drive: 0.2 }, snare: { tone: 190, td: 0.12, nd: 0.2, mix: 0.55, bp: 2500 }, clap: { bp: 1100, tail: 0.22 }, hat: { ratio: 1, cd: 0.045, od: 0.4, hp: 7500 }, tom: { f0: 170, f1: 110, ad: 0.4 }, perc: 'cowbell', post: 'clean' },
  punchy: { kick: { f0: 190, f1: 52, pd: 0.032, ad: 0.32, click: 0.6, drive: 0.6 }, snare: { tone: 210, td: 0.08, nd: 0.16, mix: 0.4, bp: 3200 }, clap: { bp: 1400, tail: 0.18 }, hat: { ratio: 1.15, cd: 0.035, od: 0.28, hp: 8500 }, tom: { f0: 200, f1: 120, ad: 0.28 }, perc: 'shaker', post: 'clean' },
  lofi: { kick: { f0: 120, f1: 50, pd: 0.045, ad: 0.4, click: 0.3, drive: 0.5 }, snare: { tone: 180, td: 0.1, nd: 0.18, mix: 0.5, bp: 1800 }, clap: { bp: 900, tail: 0.2 }, hat: { ratio: 0.9, cd: 0.05, od: 0.3, hp: 5500 }, tom: { f0: 150, f1: 100, ad: 0.3 }, perc: 'shaker', post: 'lofi' },
  industrial: { kick: { f0: 230, f1: 44, pd: 0.025, ad: 0.45, click: 0.8, drive: 2.5 }, snare: { tone: 240, td: 0.09, nd: 0.25, mix: 0.3, bp: 4000 }, clap: { bp: 1700, tail: 0.3 }, hat: { ratio: 1.4, cd: 0.04, od: 0.35, hp: 9000 }, tom: { f0: 260, f1: 90, ad: 0.35 }, perc: 'clank', post: 'crush' },
}

const HAT_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800]

export function synthesizeFactorySample(id: string, sr: number): SampleData | null {
  const m = /^factory:([\w-]+)\/(\w+)$/.exec(id)
  if (!m) return null
  const st = STYLES[m[1]] ?? STYLES.punchy
  const pad = m[2]
  const rnd = noise(id.length * 7919 + pad.charCodeAt(0))
  const len = (s: number) => Math.ceil(s * sr)
  let out: Float32Array
  switch (pad) {
    case 'kick': {
      const k = st.kick
      out = new Float32Array(len(k.ad * 2.2))
      let ph = 0
      const clickLp = new Biquad('bp', 3500, 0.8, sr)
      for (let i = 0; i < out.length; i++) {
        const t = i / sr
        const f = k.f1 + (k.f0 - k.f1) * Math.exp(-t / k.pd)
        ph += f / sr
        const amp = Math.exp(-t / (k.ad * 0.45))
        let x = Math.sin(2 * Math.PI * ph) * amp
        x += clickLp.p(rnd()) * k.click * Math.exp(-t / 0.004)
        x = Math.tanh(x * (1 + k.drive)) / Math.tanh(1 + k.drive)
        out[i] = x
      }
      break
    }
    case 'snare': {
      const s = st.snare
      out = new Float32Array(len(Math.max(s.td, s.nd) * 4))
      const bp = new Biquad('bp', s.bp, 0.7, sr)
      const hp = new Biquad('hp', 700, 0.7, sr)
      let p1 = 0, p2 = 0
      for (let i = 0; i < out.length; i++) {
        const t = i / sr
        p1 += (s.tone * (1 + 0.5 * Math.exp(-t / 0.01))) / sr
        p2 += (s.tone * 1.6) / sr
        const tone = (Math.sin(2 * Math.PI * p1) + 0.5 * Math.sin(2 * Math.PI * p2)) * Math.exp(-t / (s.td * 0.5))
        const nz = hp.p(bp.p(rnd())) * 2.5 * Math.exp(-t / (s.nd * 0.45))
        out[i] = Math.tanh(tone * s.mix + nz * (1 - s.mix) * 1.6)
      }
      break
    }
    case 'clap': {
      const c = st.clap
      out = new Float32Array(len(c.tail * 3 + 0.04))
      const bp = new Biquad('bp', c.bp, 1.2, sr)
      for (let i = 0; i < out.length; i++) {
        const t = i / sr
        let env = 0
        for (let b = 0; b < 3; b++) { const tb = t - b * 0.011; if (tb >= 0 && tb < 0.011) env = Math.max(env, Math.exp(-tb / 0.003)) }
        const tt = t - 0.033
        if (tt >= 0) env = Math.max(env, Math.exp(-tt / (c.tail * 0.4)))
        out[i] = bp.p(rnd()) * env * 3
      }
      break
    }
    case 'hat': case 'openhat': {
      const h = st.hat
      const dec = pad === 'hat' ? h.cd : h.od
      out = new Float32Array(len(dec * 5))
      const ph = HAT_FREQS.map(() => 0)
      const hp = new Biquad('hp', h.hp, 0.8, sr)
      const hp2 = new Biquad('hp', h.hp * 0.8, 0.7, sr)
      for (let i = 0; i < out.length; i++) {
        const t = i / sr
        let x = 0
        for (let j = 0; j < 6; j++) { ph[j] = (ph[j] + (HAT_FREQS[j] * h.ratio * 1.7) / sr) % 1; x += ph[j] < 0.5 ? 1 : -1 }
        x = x / 6 + rnd() * 0.35
        out[i] = hp2.p(hp.p(x)) * Math.exp(-t / (dec * 0.6)) * 2
      }
      break
    }
    case 'tom': {
      const tm = st.tom
      out = new Float32Array(len(tm.ad * 3))
      let ph = 0
      for (let i = 0; i < out.length; i++) {
        const t = i / sr
        ph += (tm.f1 + (tm.f0 - tm.f1) * Math.exp(-t / 0.08)) / sr
        out[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t / (tm.ad * 0.5)) + rnd() * 0.05 * Math.exp(-t / 0.01)
      }
      break
    }
    case 'rim': {
      out = new Float32Array(len(0.08))
      const bp = new Biquad('bp', 1700, 3, sr)
      let ph = 0
      for (let i = 0; i < out.length; i++) {
        const t = i / sr
        ph += 1700 / sr
        out[i] = (bp.p(rnd()) * 2 + Math.sin(2 * Math.PI * ph) * 0.6) * Math.exp(-t / 0.012)
      }
      break
    }
    default: {
      // perc
      if (st.perc === 'cowbell') {
        out = new Float32Array(len(0.5))
        const bp = new Biquad('bp', 800, 2, sr)
        let a = 0, b = 0
        for (let i = 0; i < out.length; i++) {
          const t = i / sr
          a = (a + 540 / sr) % 1; b = (b + 800 / sr) % 1
          const x = (a < 0.5 ? 1 : -1) + (b < 0.5 ? 1 : -1)
          out[i] = bp.p(x) * (0.6 * Math.exp(-t / 0.02) + 0.4 * Math.exp(-t / 0.15)) * 1.5
        }
      } else if (st.perc === 'shaker') {
        out = new Float32Array(len(0.14))
        const hp = new Biquad('hp', 5000, 0.7, sr)
        for (let i = 0; i < out.length; i++) {
          const t = i / sr
          const env = t < 0.03 ? t / 0.03 : Math.exp(-(t - 0.03) / 0.03)
          out[i] = hp.p(rnd()) * env * 1.2
        }
      } else {
        out = new Float32Array(len(0.3))
        const ph = [0, 0, 0]
        const fr = [333, 587, 1213]
        for (let i = 0; i < out.length; i++) {
          const t = i / sr
          let x = 0
          for (let j = 0; j < 3; j++) { ph[j] += fr[j] / sr; x += Math.sin(2 * Math.PI * ph[j] + 3 * Math.sin(2 * Math.PI * ph[(j + 1) % 3])) }
          out[i] = Math.tanh(x * 1.5) * Math.exp(-t / 0.07) * 0.6
        }
      }
    }
  }
  // Kit character
  if (st.post === 'lofi') {
    const lp = new Biquad('lp', 5200, 0.7, sr)
    let hold = 0
    for (let i = 0; i < out.length; i++) {
      if (i % 2 === 0) hold = Math.round(out[i] * 48) / 48
      out[i] = lp.p(hold) * 0.95 + rnd() * 0.004
    }
  } else if (st.post === 'crush') {
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 2.2)
  }
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 0) { const g = 0.9 / peak; for (let i = 0; i < out.length; i++) out[i] *= g }
  // tiny fade at the end to avoid clicks
  const fade = Math.min(out.length, Math.ceil(sr * 0.005))
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade
  return { channels: [out], sampleRate: sr }
}
