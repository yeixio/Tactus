export type TokKind = 'ident' | 'number' | 'string' | 'punct' | 'nl' | 'gen' | 'eof'

export interface Tok {
  kind: TokKind
  text: string
  value?: number
  line: number // 1-based
  col: number // 1-based
  offset: number
  end: number
}

export interface Diagnostic {
  file: string
  line: number
  col: number
  from: number
  to: number
  message: string
  severity: 'error' | 'warning'
}

export class ParseError extends Error {
  constructor(message: string, public tok: Tok) {
    super(message)
  }
}

const IDENT = /[A-Za-z_][\w#-]*/y
const NUMBER = /-?(?:\d+\.?\d*|\.\d+)%?/y

export function lex(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  let line = 1
  let lineStart = 0
  const push = (kind: TokKind, text: string, start: number, value?: number) =>
    toks.push({ kind, text, value, line, col: start - lineStart + 1, offset: start, end: start + text.length })
  while (i < src.length) {
    const c = src[i]
    if (c === '\n') {
      push('nl', '\n', i)
      i++
      line++
      lineStart = i
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== '"' && src[j] !== '\n') j++
      if (src[j] !== '"') throw new ParseError('This text is missing its closing quote (")', { kind: 'string', text: src.slice(i, j), line, col: i - lineStart + 1, offset: i, end: j })
      push('string', src.slice(i, j + 1), i)
      i = j + 1
      continue
    }
    if (c === '=') {
      // "= generator(args)" runs to the end of the line, with balanced parentheses.
      let j = i + 1
      let depth = 0
      let inStr = false
      while (j < src.length && src[j] !== '\n') {
        const d = src[j]
        if (d === '"') inStr = !inStr
        else if (!inStr && d === '(') depth++
        else if (!inStr && d === ')') { depth--; if (depth === 0) { j++; break } }
        else if (!inStr && d === '/' && src[j + 1] === '/' && depth === 0) break
        j++
      }
      push('gen', src.slice(i + 1, j).trim(), i)
      toks[toks.length - 1].end = j
      i = j
      continue
    }
    if ('{}:,()'.includes(c)) { push('punct', c, i); i++; continue }
    NUMBER.lastIndex = i
    const n = NUMBER.exec(src)
    if (n && (c === '-' || c === '.' || /\d/.test(c))) {
      let v = parseFloat(n[0])
      if (n[0].endsWith('%')) v /= 100
      push('number', n[0], i, v)
      i += n[0].length
      continue
    }
    IDENT.lastIndex = i
    const m = IDENT.exec(src)
    if (m) { push('ident', m[0], i); i += m[0].length; continue }
    throw new ParseError(`Unexpected character "${c}"`, { kind: 'punct', text: c, line, col: i - lineStart + 1, offset: i, end: i + 1 })
  }
  push('nl', '', i)
  toks.push({ kind: 'eof', text: '', line, col: i - lineStart + 1, offset: i, end: i })
  return toks
}
