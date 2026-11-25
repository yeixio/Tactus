# The Tactus language

Every Tactus project can be read and written as text. The Code workspace shows one file per track plus `song.tac`, which holds the song-level settings, scenes and arrangement. Press **Run** (or <kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd>) and the change lands on the next beat or bar while the music keeps playing. If the code has an error, it is underlined, and the last working version keeps playing.

The Studio and the code edit the same song. Draw a note in the piano roll and the code updates. Run code and the Studio updates. Tracks and clips are matched by name, so renaming a clip in code is treated as a new clip.

## A complete example

```
tempo 122
key "A minor"
swing 0.08
master volume 0.9 echo 3 feedback 0.35 space 0.6

track Bass synth analog-bass {
  warmth 0.6                 // smart controls, 0..1
  cutoff 650                 // any synth setting
  duck 0.45                  // sidechain ducking from the kick
  clip Line 1 bar {
    "A1 ~ . A1 C2 . E2 . | A1+E2 . . G1! . . . ."
  }
  clip Walk 4 bars = bass("Am F C G", walk, 7)
}

track Drums drums punchy {
  pad kick tune -2 decay 0.8
  clip Beat 1 bar {
    kick four-on-floor
    hat  "..x. ..x. ..X. ..xo"
  }
}

scene Groove { Drums: Beat, Bass: Line }
scene Walk   { Drums: Beat, Bass: Walk }
arrange { Groove 8  Walk 8 }
```

Comments start with `//`.

## Song settings

| Statement | Meaning |
| --- | --- |
| `tempo 122` (or `bpm 122`) | Tempo in beats per minute. |
| `key "A minor"` | Root and scale. Scales: `major`, `minor`, `dorian`, `phrygian`, `lydian`, `mixolydian`, `harmonic minor`, `major pentatonic`, `minor pentatonic`, `blues`. |
| `swing 0.08` | Delays every second 16th, from 0 (straight) upward. |
| `guardrails on` | Safe mode: keeps sounds in pleasant ranges and snaps notes to the key. `off` gives full control. |
| `master volume 0.9 echo 3 feedback 0.35 space 0.6` | Master bus: volume, ping-pong delay time in 16th steps, delay feedback, reverb size. |

## Tracks

```
track <Name> <synth|drums> [preset] { ... }
```

Synth presets: `analog-bass`, `sub-bass`, `acid`, `reese`, `supersaw`, `square-lead`, `pluck`, `warm-pad`, `glass-pad`, `e-piano`, `organ`, `bell`, `chord-stab`, `noise-riser`.

Drum kits: `808`, `punchy`, `lofi`, `industrial`.

Inside a track you can set:

- **Smart controls** from 0 to 1: `warmth`, `brightness`, `movement`, `space`, `energy`, `texture`. Each one moves several underlying parameters at once. They are defined in [`src/model/sound.ts`](../src/model/sound.ts).
- **Mix:** `volume`, `pan`, `reverb`, `delay`, `saturation`, `tone` (the DJ filter, negative is low-pass and positive is high-pass), `duck`, plus `mute` and `solo`, and `color "#ff6b4a"`.
- **Synth settings** (synth tracks): `osc1`, `osc2` (`saw`, `square`, `triangle`, `sine`), `osc2Semi`, `osc2Detune`, `oscMix`, `sub`, `noise`, `unison`, `spread`, `fm`, `cutoff`, `resonance`, `filterEnv`, `keyTrack`, `ampA`, `ampD`, `ampS`, `ampR`, `fltA`, `fltD`, `fltS`, `fltR`, `lfoRate`, `lfoCutoff`, `lfoPitch`, `glide`, `mono`, `drive`, `gain`.
- **Pads** (drum tracks): `pad <name> tune -2 decay 0.8 gain 0.9 pan 0.1 sample "my-kick.wav"`. Pad names are `kick`, `snare`, `clap`, `hat`, `openhat`, `tom`, `rim`, `perc`.

## Clips

```
clip <Name> [length] { patterns }
clip <Name> [length] = generator(args)
```

The length is `1 bar` (the default), `2 bars`, `3 beats` or `12 steps`, up to 16 bars. A step is a 16th note.

### Note patterns (synth tracks)

Each token is one step. Bars can be separated with `|` for readability, which does nothing musically.

| Token | Meaning |
| --- | --- |
| `A1`, `C#3`, `Eb4` | Play a note. |
| `~` | Hold the previous note one more step. |
| `.` | Rest. |
| `A1+E2+A2` | A chord. |
| `C3!` | Accent (full velocity). |
| `C3?` | Soft. |
| `C3@0.6` | Exact velocity from 0 to 1. |

### Drum lines (drum tracks)

A drum line is a pad name followed by a pattern string or a named line:

```
kick  four-on-floor
snare "....x.......x..."
hat   "..x. ..x. ..X. ..xo"
```

In patterns, `x` is a hit, `X` an accent, `o` a ghost note and `.` a rest. Spaces are ignored. A line shorter than the clip repeats.

Named lines: `four-on-floor`, `backbeat`, `offbeat`, `sixteenths`, `eighths`, `dnb-kick`, `dnb-snare`, `breakbeat`, `trap-hats`, `shuffle`, `clave`, `half-time`.

## Generators

A clip can be written as a generator call. The call is kept in the code, so the result is reproducible, and changing the seed gives a new idea. Editing a generated clip's notes by hand turns it into a normal clip with the notes written out.

| Generator | Tracks | What it does |
| --- | --- | --- |
| `drums(style, seed)` | drums | A full groove. Styles: `house`, `techno`, `dnb`, `hiphop`, `trap`, `breakbeat`, `garage`, `ambient`. |
| `euclid(hits, steps, note, rotate)` | drums, synth | Spreads hits as evenly as possible. `note` is a pad name or a note like `C2`. |
| `bass(chords, style, seed)` | synth | A bassline that follows a progression. Styles: `root`, `octave`, `offbeat`, `pulse`, `walk`, `acid`. |
| `chords(chords, style)` | synth | Voice-led chords, one per bar. Styles: `pad`, `stab`, `pulse`, `offbeat`. |
| `arp(chords, mode, seed)` | synth | Arpeggiates a progression in 16ths. Modes: `up`, `down`, `updown`, `random`. |
| `melody(seed, density, octave)` | synth | A scale-aware melody in the project key. |

Chord progressions are written as a string of chord names, for example `"Am F C G"` or `"Dm7 G7 Cmaj7"`. Generators live in [`src/model/generate.ts`](../src/model/generate.ts).

## Scenes and the arrangement

```
scene Groove { Drums: Beat, Bass: Line }
arrange { Intro 4  Groove 8  Drop 16 }
```

A scene says which clip each track plays. Tracks left out of a scene are silent in it. The arrangement plays scenes in order for a number of bars, and it is what the Timeline shows and what a whole-song export renders.

## Known limits

- Comments are not kept when the Studio re-prints the code after a visual edit.
- There are no variables, functions or loops yet. "Custom instruments and effects written in code" is on the roadmap.
