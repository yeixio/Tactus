// The factory sound pack: recorded drum kits and sampled instruments, shipped as
// FLAC files in public/sounds (credits and licenses in public/sounds/CREDITS.md).
// A sample id "sound:<path>" is the file public/sounds/<path>.flac.

import type { PadName } from './presets'
import type { Project } from './types'

export interface SampledKit {
  name: string
  description: string
  /** Sample id per pad. A pad can borrow a synthesized "factory:" sample when the pack has none. */
  pads: Record<PadName, string>
}

const kit = (name: string, description: string, synthClap?: string): SampledKit => ({
  name,
  description,
  pads: {
    kick: `sound:drums/${name}/kick`,
    snare: `sound:drums/${name}/snare`,
    clap: synthClap ? `factory:${synthClap}/clap` : `sound:drums/${name}/clap`,
    hat: `sound:drums/${name}/hat`,
    openhat: `sound:drums/${name}/openhat`,
    tom: `sound:drums/${name}/tom`,
    rim: `sound:drums/${name}/rim`,
    perc: `sound:drums/${name}/perc`,
  },
})

export const SAMPLED_KITS: SampledKit[] = [
  kit('studio', 'Recorded acoustic kit: real kick, snare, toms and cymbals.'),
  kit('house', 'Recorded club kit for house and disco.', 'punchy'),
  kit('boom-bap', 'Fat, dusty hip-hop kit.'),
  kit('electro', 'Recorded electronic kit with snappy, filtered hits.'),
  kit('trap', 'Long booming kick, crisp hats.', '808'),
]

export interface SampledInstrument {
  name: string
  description: string
  /** MIDI notes that have a recording. Other notes play the nearest one, repitched. */
  roots: number[]
}

export const INSTRUMENTS: Record<string, SampledInstrument> = {
  piano: {
    name: 'piano',
    description: 'Steinway grand, recorded (Splendid Grand Piano, public domain).',
    roots: [23, 27, 29, 31, 35, 38, 41, 43, 47, 50, 53, 56, 59, 62, 65, 67, 71, 74, 77, 80, 83, 86, 89, 92, 95, 98, 101, 104, 107],
  },
}

export const isInstrument = (osc: string): boolean => osc in INSTRUMENTS

export function instrumentSampleIds(name: string): string[] {
  const inst = INSTRUMENTS[name]
  return inst ? inst.roots.map((r) => `sound:${name}/${r}`) : []
}

/** Path of a pack sample inside public/sounds, or null for other ids. */
export function soundPath(id: string): string | null {
  const m = /^sound:([\w-]+(?:\/[\w-]+)*)$/.exec(id)
  return m ? `${m[1]}.flac` : null
}

/** Every sample a project plays: drum pads, and the recordings behind sampled synth sources. */
export function usedSampleIds(p: Project): string[] {
  const ids = new Set<string>()
  for (const t of p.tracks) {
    for (const pad of t.pads ?? []) ids.add(pad.sample)
    if (t.synth && isInstrument(t.synth.osc1)) for (const id of instrumentSampleIds(t.synth.osc1)) ids.add(id)
    if (t.synth?.osc1 === 'sampler' && t.synth.sample) ids.add(t.synth.sample)
  }
  return [...ids]
}
