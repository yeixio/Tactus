// AudioWorklet entry: runs the engine on the real-time audio thread.
import { Engine } from './core/engine'
import type { ToEngine } from './protocol'

declare const sampleRate: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

class TactusProcessor extends AudioWorkletProcessor {
  engine: Engine
  frames = 0
  busyMs = 0
  wallStart = Date.now()
  load = 0
  constructor() {
    super()
    this.engine = new Engine(sampleRate, (m, t) => this.port.postMessage(m, t ?? []), 128)
    this.port.onmessage = (e: MessageEvent<ToEngine>) => this.engine.handle(e.data)
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]
    const L = out[0]
    const R = out[1] ?? out[0]
    const t0 = Date.now()
    this.engine.process(L, R, L.length)
    this.busyMs += Date.now() - t0
    this.frames += L.length
    // report ~30 times a second
    if (this.frames >= sampleRate / 30) {
      const audioMs = (this.frames / sampleRate) * 1000
      const inst = this.busyMs / audioMs
      this.load = this.load * 0.8 + inst * 0.2
      this.frames = 0
      this.busyMs = 0
      this.port.postMessage(this.engine.status(Math.min(1, this.load)))
      const ev = this.engine.takeEvents()
      if (ev) this.port.postMessage({ type: 'events', events: ev })
    }
    return true
  }
}

registerProcessor('tactus-engine', TactusProcessor)
