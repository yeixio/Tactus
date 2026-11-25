# Changelog

All notable changes to Tactus are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- README with screenshots and a demo, docs for the language and the architecture, contributing guide, code of conduct, security policy, issue and pull request templates, and an app icon.
- A Release workflow: one button tags `main`, builds the installers and publishes the GitHub Release.
- Branches are deleted automatically when their pull request closes.

## [0.1.0] - 2026-11-25

The first version: the whole creative loop works end to end.

### Added

- Real-time audio engine on the AudioWorklet thread with sample-accurate scheduling, a subtractive and FM synth, an 8-pad drum sampler with four factory kits, per-track effects and a master bus.
- Studio with clips and scenes, a piano roll, a drum step sequencer, a timeline and a mixer.
- Code workspace with the Tactus language, live updates on the next beat or bar, inline errors and an event monitor.
- Instrument Lab with smart controls and the full synth.
- Perform view with scene launchers, faders, performance macros and recording to WAV.
- Inspiration engine: generators for drums, euclidean rhythms, basslines, chords, arpeggios, melodies and variations.
- MIDI input and MIDI learn.
- Project folders with autosave and undo/redo.
- WAV export at 16 or 24-bit and 44.1 or 48 kHz.
- Installers for macOS, Windows and Linux built in CI.

[Unreleased]: https://github.com/yeixio/Tactus/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yeixio/Tactus/releases/tag/v0.1.0
