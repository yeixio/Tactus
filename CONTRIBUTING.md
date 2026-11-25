# Contributing to Tactus

Thanks for wanting to help! Tactus is young, so there is plenty of room to shape it. Contributions of every size are welcome: a typo fix, a preset, a drum kit, a starting template, a generator, a bug report, or a song you made with it.

New here? Look for issues labeled [good first issue](https://github.com/yeixio/Tactus/issues?q=is%3Aopen+label%3A%22good+first+issue%22) or [help wanted](https://github.com/yeixio/Tactus/issues?q=is%3Aopen+label%3A%22help+wanted%22), or ask in [Discussions](https://github.com/yeixio/Tactus/discussions).

## Setup

You need Node.js 20 or newer.

```bash
git clone https://github.com/yeixio/Tactus.git
cd Tactus
npm install
npm run web        # the app in your browser at http://localhost:5173 (fastest loop)
npm run dev        # the desktop app with hot reload
```

| Script | What it does |
| --- | --- |
| `npm run web` | Vite dev server with the whole app in a browser. |
| `npm run dev` | Electron and Vite with hot reload. |
| `npm test` | Engine, language, generator and project tests (vitest). |
| `npm run typecheck` | Strict TypeScript check. |
| `npm run build` | Typecheck, web build and Electron build. |
| `npm run dist:mac` / `dist:win` / `dist:linux` | Build an installer into `release/`. |

## Finding your way around

Read [docs/architecture.md](docs/architecture.md) first. In short:

| Folder | What lives there |
| --- | --- |
| `src/model/` | The song (`types.ts`), presets, theory, generators, smart controls and macros (`sound.ts`), templates (`project.ts`) |
| `src/dsl/` | The music language: lexer, parser, builder, printer |
| `src/engine/` | The audio engine (pure TypeScript), the message protocol, the AudioWorklet, offline rendering |
| `src/audio/` | The bridge from app state to the engine, and MIDI |
| `src/state/` | The store, undo/redo, autosave |
| `src/ui/` | React workspaces |
| `electron/` | The desktop shell |
| `tests/` | Tests |

## Common contributions

### Add a synth preset

Add an entry to `SYNTH_PRESETS` in [`src/model/presets.ts`](src/model/presets.ts) with a `name` (kebab-case, used in code as `track Lead synth my-preset`), a `category`, a one-line `description` and its `params`. Start from a similar preset. Try it with each smart control at both ends, and keep it below clipping at full Energy.

### Add a drum kit

Factory kits are synthesized in [`src/engine/core/samples.ts`](src/engine/core/samples.ts), so they need no audio files. Add the kit to `DRUM_KITS` in `presets.ts` and a recipe for each of the 8 pads in `samples.ts`.

### Add a starting template

Templates are in `TEMPLATES` in [`src/model/project.ts`](src/model/project.ts). A template lists tracks, clips (usually generator calls, so moods and seeds can vary them) and scenes. A good template plays something musical within a second of being picked and has at least two scenes. The tests build and round-trip every template automatically.

### Add a generator

Generators are in [`src/model/generate.ts`](src/model/generate.ts). Add an entry to `GENERATORS` (its signature and doc string show up in the editor's autocomplete), a case in `runGen`, and a function that returns notes. Generators must give the same result for the same seed and must keep notes inside the clip. Add a test.

### Add a language feature

1. Tokens are in [`lexer.ts`](src/dsl/lexer.ts) and syntax is in [`parser.ts`](src/dsl/parser.ts).
2. [`build.ts`](src/dsl/build.ts) turns the parse tree into the project. Report problems as diagnostics with a token so the editor can underline them, rather than throwing.
3. [`print.ts`](src/dsl/print.ts) must print the feature back, so code survives a visual edit.
4. Add a round-trip test (print, parse, build, compare) and document the feature in [docs/language.md](docs/language.md).

### Work on the engine

The engine runs on the real-time audio thread, so code in the audio loop must not allocate, block or throw. Keep it free of browser APIs so it also runs in the export worker and the tests. Render a heavy template offline before and after your change to check that it still runs well faster than real time.

## Pull requests

1. Fork the repository and branch from `main`.
2. Keep each pull request to one change. For a large change, open an issue or discussion first so nobody's work is wasted.
3. Run `npm run typecheck` and `npm test`.
4. For UI changes, add a screenshot or a short clip to the pull request.
5. Fill in the pull request template.

CI runs the checks and builds installers for every platform on each pull request.

## Releasing

Maintainers release from GitHub: **Actions → Release → Run workflow**. It picks the next version, checks that `main` passed Build, tags it, builds the installers and publishes the GitHub Release. A stable release needs its notes in `docs/release-notes/<tag>.md` on `main` first, for example `docs/release-notes/v0.1.1.md`.

Branches are deleted automatically when their pull request closes.

## Code style

- TypeScript in strict mode. Outside the engine, prefer plain functions and data over classes.
- Match the formatting around you: 2 spaces, no semicolons, single quotes. `.editorconfig` covers the basics.
- UI text is short, plain and friendly. Explain musical ideas without jargon where you can.

## Reporting bugs and ideas

Use the [issue forms](https://github.com/yeixio/Tactus/issues/new/choose). For a bug, the most useful thing you can attach is the project folder or the code that shows it.

## Code of Conduct

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
