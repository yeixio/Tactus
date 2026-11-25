# Tactus

A music development environment: compose, code, design sounds and perform, all on one live audio engine.

*Tactus* is the working name. The name lives in `src/brand.ts`, `package.json` (`name`, `productName`, `build.appId`), `index.html` and `electron/main.ts` (the `.tactus` folder extension), so it is quick to change.

## Run it

You need Node.js 20 or newer.

```bash
npm install
npm run dev        # desktop app with hot reload (Electron + Vite)
npm run web        # same app in your browser at http://localhost:5173
npm test           # engine, language and project tests
npm run dist:mac   # build a .dmg (also dist:win, dist:linux)
```

Every push to `main` also builds macOS, Windows and Linux installers in GitHub Actions (see the run's artifacts). The macOS build is unsigned, so the first launch needs right-click → Open.

## What's in the MVP

| Plan (Section 12) | Where it lives |
| --- | --- |
| Cross-platform desktop app | Electron shell (`electron/`), installers via electron-builder |
| Native low-latency audio engine | `src/engine/core/engine.ts`, running on the real-time audio thread in an AudioWorklet |
| Multiple synchronized tracks | Sample-accurate scheduler inside the engine; the UI thread never times notes |
| Built-in synthesizer and sampler | 2-oscillator subtractive/FM synth with unison, sub, noise, filter, 2 envelopes, LFO, glide; 8-pad drum sampler with 4 factory kits and drag-and-drop user samples |
| Basic effects | Per track: drive, DJ filter, sidechain duck, echo and reverb sends. Master: ping-pong delay, reverb, glue compressor, limiter |
| Step sequencer, piano roll | Studio → clip editor (scale highlighting, snap to key, in-key chord drawing, velocity lane) |
| Timeline | Studio → Timeline: scenes arranged into a song |
| Scene system | Studio → Clips & scenes, and Perform |
| Smart macro controls | Warmth, Brightness, Movement, Space, Energy, Texture per track; Build, Drop, Atmosphere, Chaos performance macros (editable) |
| Basic music DSL | Code workspace; one file per track plus `song.tac` |
| Live code updates | Run applies on the next beat or bar while playing; errors keep the last working version playing |
| MIDI controller support | Notes play the selected track; MIDI learn for knobs, faders, scenes, clips, mute |
| Project persistence | Project folders with autosave, undo/redo |
| Audio export | WAV (16/24-bit, 44.1/48 kHz), whole song or a scene loop, rendered offline by the same engine; plus live performance recording |

Also included: a home screen with genre and mood starting points that play immediately, an inspiration engine (grooves, basslines, chords, arps, melodies, variations that never overwrite the original), safe mode (musical guardrails), contextual tips including a bass/kick masking warning, an event monitor that shows which clip and step produced each note, and DSP load, voice count and latency in the status bar.

## Architecture

```
src/model/     the canonical song representation (types.ts), presets, music theory,
               generators, smart-control mappings, templates
src/dsl/       the music language: lexer, parser, builder (code -> song), printer (song -> code)
src/engine/    the audio engine core (pure TypeScript), its message protocol, the AudioWorklet
               wrapper, and offline rendering for export
src/audio/     the bridge between app state and the engine, and MIDI
src/ui/        React workspaces: Home, Studio, Code, Instrument Lab, Perform
electron/      the desktop shell: file system, dialogs, MIDI permission
```

Everything edits one representation (`Project` in `src/model/types.ts`). The Studio edits it directly. The Code workspace prints it as code and parses code back into it, keeping track and clip identities by name, so the music does not restart when you run code. The engine receives a compiled copy over the message protocol in `src/engine/protocol.ts`. The engine core has no browser dependencies, so the same code runs on the audio thread, in the export worker and in the tests. A native engine (for example JUCE) can replace it later by implementing the same protocol.

## The language

```
tempo 122
key "A minor"
swing 0.08

track Bass synth analog-bass {
  warmth 0.6                 // smart controls, 0..1
  cutoff 650                 // any synth setting
  duck 0.45                  // mix: volume pan reverb delay saturation tone duck
  clip Line 1 bar {
    "A1 ~ . A1 C2 . E2 . | A1+E2 . . G1! . . . ."
  }                          // notes, ~ hold, . rest, + chord, ! accent, ? soft, @0.6 velocity
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
arrange { Groove 8 }
```

Generators: `drums(style, seed)`, `euclid(hits, steps, note, rotate)`, `bass(chords, style, seed)`, `chords(chords, style)`, `arp(chords, mode, seed)`, `melody(seed, density, octave)`. A generated clip keeps its expression; editing its notes by hand turns it into a normal clip.

## Project folders

```
My Song.tactus/
  project.json     the song (source of truth, versioned schema)
  manifest.json
  src/             the song as code, one file per track (for reading and version control)
  samples/         audio files used by drum pads
  exports/
```

## Known limits

- The audio engine is TypeScript on the Web Audio real-time thread rather than native C++. Buffer size is chosen by the operating system (typically 128 frames plus device latency); there is no audio device picker yet.
- No plugin hosting (VST3/CLAP), audio tracks or audio recording into clips.
- MIDI clock sync, OSC and Ableton Link are not in this version.
- Code comments are not kept when the Studio re-prints the code after a visual edit.
