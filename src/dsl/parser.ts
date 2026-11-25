import { lex, ParseError, type Diagnostic, type Tok } from './lexer'

export interface PParam { name: string; value: number | string; tok: Tok }
export interface PLine { head?: string; pattern: string; tok: Tok }
export interface PClip { name: string; length: number; gen?: string; genTok?: Tok; lines: PLine[]; tok: Tok }
export interface PPad { pad: string; params: PParam[]; tok: Tok }
export interface PTrack { name: string; kind: string; preset: string; params: PParam[]; pads: PPad[]; clips: PClip[]; tok: Tok; file: string }
export interface PScene { name: string; slots: { track: string; clip: string; tok: Tok }[]; tok: Tok }
export interface PSong {
  settings: PParam[] // tempo, key, swing, guardrails
  master: PParam[]
  tracks: PTrack[]
  scenes: PScene[]
  arrange?: { scene: string; bars: number; tok: Tok }[]
  arrangeTok?: Tok
}

const unq = (t: Tok) => (t.kind === 'string' ? t.text.slice(1, -1) : t.text)

class Parser {
  i = 0
  diags: Diagnostic[] = []
  constructor(public toks: Tok[], public file: string) {}

  peek(o = 0) { return this.toks[Math.min(this.i + o, this.toks.length - 1)] }
  next() { return this.toks[this.i++] }
  at(kind: Tok['kind'], text?: string) { const t = this.peek(); return t.kind === kind && (text === undefined || t.text === text) }
  eat(kind: Tok['kind'], text?: string) { if (this.at(kind, text)) return this.next(); return null }
  expect(kind: Tok['kind'], text: string | undefined, what: string) {
    const t = this.peek()
    if (t.kind === kind && (text === undefined || t.text === text)) return this.next()
    throw new ParseError(`Expected ${what}${t.kind === 'eof' ? ' before the end of the file' : `, found "${t.text === '\n' ? 'end of line' : t.text}"`}`, t)
  }
  skipNl() { while (this.at('nl') || this.at('punct', ',')) this.next() }
  endOfStatement() {
    if (this.at('nl') || this.at('eof') || this.at('punct', '}')) { this.eat('nl'); return }
    const t = this.peek()
    throw new ParseError(`Unexpected "${t.text}". Each setting goes on its own line.`, t)
  }
  error(e: unknown) {
    if (e instanceof ParseError) {
      this.diags.push({ file: this.file, line: e.tok.line, col: e.tok.col, from: e.tok.offset, to: Math.max(e.tok.end, e.tok.offset + 1), message: e.message, severity: 'error' })
    } else throw e
  }
  /** Skip to the start of the next line, staying inside the current block. */
  recover() {
    while (!this.at('eof') && !this.at('nl')) {
      if (this.at('punct', '{')) this.skipBlock()
      else this.next()
    }
    this.eat('nl')
  }
  skipBlock() {
    let depth = 0
    while (!this.at('eof')) {
      const t = this.next()
      if (t.kind === 'punct' && t.text === '{') depth++
      if (t.kind === 'punct' && t.text === '}') { depth--; if (depth <= 0) return }
    }
  }

  name(what: string) {
    const t = this.peek()
    if (t.kind === 'string' || t.kind === 'ident') { this.next(); return unq(t) }
    throw new ParseError(`Expected ${what}`, t)
  }
  value(): number | string {
    const t = this.peek()
    if (t.kind === 'number') { this.next(); return t.value! }
    if (t.kind === 'string' || t.kind === 'ident') { this.next(); return unq(t) }
    throw new ParseError('Expected a value', t)
  }

  song(): PSong {
    const s: PSong = { settings: [], master: [], tracks: [], scenes: [] }
    this.skipNl()
    while (!this.at('eof')) {
      const start = this.i
      try {
        this.statement(s)
      } catch (e) {
        this.error(e)
        if (this.i === start) this.next()
        this.recover()
      }
      this.skipNl()
    }
    return s
  }

  statement(s: PSong) {
    const t = this.peek()
    if (t.kind !== 'ident') throw new ParseError(`Expected a statement such as tempo, key, track, scene or arrange; found "${t.text}"`, t)
    switch (t.text) {
      case 'tempo': case 'bpm': case 'swing': {
        this.next()
        const v = this.expect('number', undefined, 'a number')
        s.settings.push({ name: t.text === 'bpm' ? 'tempo' : t.text, value: v.value!, tok: v })
        return this.endOfStatement()
      }
      case 'key': {
        this.next()
        const parts: string[] = []
        const first = this.peek()
        while (this.at('ident') || this.at('string')) parts.push(unq(this.next()))
        if (!parts.length) throw new ParseError('Expected a key such as "A minor"', first)
        s.settings.push({ name: 'key', value: parts.join(' '), tok: first })
        return this.endOfStatement()
      }
      case 'guardrails': {
        this.next()
        const v = this.expect('ident', undefined, 'on or off')
        s.settings.push({ name: 'guardrails', value: v.text, tok: v })
        return this.endOfStatement()
      }
      case 'master': {
        this.next()
        while (this.at('ident')) {
          const k = this.next()
          const v = this.expect('number', undefined, `a number for ${k.text}`)
          s.master.push({ name: k.text, value: v.value!, tok: k })
        }
        return this.endOfStatement()
      }
      case 'track': return this.track(s)
      case 'scene': return this.scene(s)
      case 'arrange': return this.arrange(s)
    }
    throw new ParseError(`Unknown statement "${t.text}". Use tempo, key, swing, master, track, scene or arrange.`, t)
  }

  track(s: PSong) {
    const tok = this.next()
    const name = this.name('a track name, like "Bass"')
    const kindTok = this.expect('ident', undefined, 'an instrument type: synth or drums')
    if (kindTok.text !== 'synth' && kindTok.text !== 'drums') throw new ParseError('Instrument type must be synth or drums', kindTok)
    const preset = this.at('string') || this.at('ident') ? this.name('a preset') : kindTok.text === 'synth' ? 'analog-bass' : 'punchy'
    const tr: PTrack = { name, kind: kindTok.text, preset, params: [], pads: [], clips: [], tok, file: this.file }
    s.tracks.push(tr)
    if (!this.eat('punct', '{')) return this.endOfStatement()
    this.skipNl()
    while (!this.at('punct', '}')) {
      if (this.at('eof')) throw new ParseError(`Track "${name}" is missing its closing }`, tok)
      const start = this.i
      try {
        this.trackItem(tr)
      } catch (e) {
        this.error(e)
        if (this.i === start) this.next()
        this.recover()
      }
      this.skipNl()
    }
    this.next()
  }

  trackItem(tr: PTrack) {
    const t = this.expect('ident', undefined, 'a setting, pad or clip')
    if (t.text === 'clip') return this.clip(tr, t)
    if (t.text === 'pad') {
      const pad = this.expect('ident', undefined, 'a pad name')
      const pp: PPad = { pad: pad.text, params: [], tok: pad }
      while (this.at('ident')) {
        const k = this.next()
        pp.params.push({ name: k.text, value: this.value(), tok: k })
      }
      tr.pads.push(pp)
      return this.endOfStatement()
    }
    if (t.text === 'mute' || t.text === 'solo') {
      const v = this.at('ident') ? this.next().text : 'on'
      tr.params.push({ name: t.text, value: v, tok: t })
      return this.endOfStatement()
    }
    tr.params.push({ name: t.text, value: this.value(), tok: t })
    this.endOfStatement()
  }

  clip(tr: PTrack, tok: Tok) {
    const name = this.name('a clip name')
    let length = 16
    if (this.at('number')) {
      const n = this.next()
      const unit = this.at('ident') ? this.next().text : 'bars'
      if (/^bars?$/.test(unit)) length = Math.round(n.value! * 16)
      else if (/^steps?$/.test(unit)) length = Math.round(n.value!)
      else if (/^beats?$/.test(unit)) length = Math.round(n.value! * 4)
      else throw new ParseError('Clip length unit must be bars, beats or steps', n)
      if (length < 1 || length > 256) throw new ParseError('Clip length must be between 1 step and 16 bars', n)
    }
    const c: PClip = { name, length, lines: [], tok }
    tr.clips.push(c)
    const g = this.eat('gen')
    if (g) {
      c.gen = g.text
      c.genTok = g
      return this.endOfStatement()
    }
    if (!this.eat('punct', '{')) return this.endOfStatement()
    this.skipNl()
    while (!this.at('punct', '}')) {
      if (this.at('eof')) throw new ParseError(`Clip "${name}" is missing its closing }`, tok)
      const lt = this.peek()
      if (lt.kind === 'string') {
        this.next()
        c.lines.push({ pattern: unq(lt), tok: lt })
      } else if (lt.kind === 'ident') {
        this.next()
        const pt = this.peek()
        if (pt.kind === 'string' || pt.kind === 'ident') { this.next(); c.lines.push({ head: lt.text, pattern: unq(pt), tok: pt }) }
        else throw new ParseError(`Expected a pattern after ${lt.text}, like "x...x..."`, pt)
      } else throw new ParseError('Expected a pattern line', lt)
      this.endOfStatement()
      this.skipNl()
    }
    this.next()
  }

  scene(s: PSong) {
    const tok = this.next()
    const name = this.name('a scene name')
    const sc: PScene = { name, slots: [], tok }
    s.scenes.push(sc)
    if (!this.eat('punct', '{')) return this.endOfStatement()
    this.skipNl()
    while (!this.at('punct', '}')) {
      const tt = this.peek()
      const track = this.name('a track name')
      this.expect('punct', ':', '":" between track and clip')
      const clip = this.name('a clip name')
      sc.slots.push({ track, clip, tok: tt })
      this.skipNl()
    }
    this.next()
  }

  arrange(s: PSong) {
    s.arrangeTok = this.next()
    s.arrange = []
    this.expect('punct', '{', '{')
    this.skipNl()
    while (!this.at('punct', '}')) {
      const tt = this.peek()
      const scene = this.name('a scene name')
      const n = this.expect('number', undefined, 'a number of bars')
      s.arrange.push({ scene, bars: Math.round(n.value!), tok: tt })
      this.skipNl()
    }
    this.next()
  }
}

export interface ParsedFile {
  file: string
  song: PSong
  diagnostics: Diagnostic[]
}

export function parseFile(file: string, src: string): ParsedFile {
  let toks: Tok[]
  try {
    toks = lex(src)
  } catch (e) {
    if (e instanceof ParseError) {
      return { file, song: { settings: [], master: [], tracks: [], scenes: [] }, diagnostics: [{ file, line: e.tok.line, col: e.tok.col, from: e.tok.offset, to: e.tok.end + 1, message: e.message, severity: 'error' }] }
    }
    throw e
  }
  const p = new Parser(toks, file)
  const song = p.song()
  return { file, song, diagnostics: p.diags }
}
