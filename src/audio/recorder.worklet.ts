// AudioWorklet that forwards microphone input to the main thread in chunks, as mono PCM.
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

const CHUNK = 2048

class RecorderProcessor extends AudioWorkletProcessor {
  buf = new Float32Array(CHUNK)
  n = 0
  on = true
  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<{ type: 'stop' }>) => {
      if (e.data.type === 'stop') { this.flush(); this.on = false }
    }
  }
  flush() {
    if (this.n) this.port.postMessage(this.buf.slice(0, this.n))
    this.n = 0
  }
  process(inputs: Float32Array[][]) {
    const input = inputs[0]
    if (!this.on) return false
    if (!input || !input.length) return true
    const chans = input.length
    const len = input[0].length
    for (let i = 0; i < len; i++) {
      let x = 0
      for (let c = 0; c < chans; c++) x += input[c][i]
      this.buf[this.n++] = x / chans
      if (this.n === CHUNK) { this.port.postMessage(this.buf.slice()); this.n = 0 }
    }
    return true
  }
}

registerProcessor('tactus-recorder', RecorderProcessor)
