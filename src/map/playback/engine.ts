// Playback engine: play clock + buffer-ahead queue + texSubImage2D dispatch.
// Decoupled from React — driven by HeatmapLayer via ref.

import type { Map as MapLibreMap } from 'maplibre-gl'
import { RingBuffer } from './ringBuffer'
import type { DoubleBuffer } from './buffer'

export interface EngineCallbacks {
  onFrameChange: (t: string, mixFactor: number) => void
  onBufferProgress: (loaded: number, total: number) => void
  onEnd: () => void
}

const BUFFER_AHEAD = 30
const FRAME_INTERVAL_MS = 500

export class PlaybackEngine {
  private readonly map: MapLibreMap
  private readonly db: DoubleBuffer
  private readonly callbacks: EngineCallbacks
  readonly ring = new RingBuffer()
  private tIndex: string[] = []
  private playheadIdx = 0
  private playing = false
  private speed = 1
  private timer = 0
  private mixRaf = 0
  private mixStart = 0
  private mixDuration = FRAME_INTERVAL_MS

  constructor(map: MapLibreMap, db: DoubleBuffer, callbacks: EngineCallbacks) {
    this.map = map
    this.db = db
    this.callbacks = callbacks
  }

  load(tIndex: string[], frames: Map<string, Uint8Array>) {
    this.tIndex = tIndex
    frames.forEach((grid, t) => this.ring.set(t, grid))
    this.callbacks.onBufferProgress(this.ring.size, tIndex.length)
  }

  addFrame(t: string, grid: Uint8Array) {
    this.ring.set(t, grid)
    this.callbacks.onBufferProgress(this.ring.size, this.tIndex.length)
  }

  play(fromT?: string) {
    if (fromT) {
      const idx = this.tIndex.indexOf(fromT)
      if (idx >= 0) this.playheadIdx = idx
    }
    this.playing = true
    this.scheduleNext()
  }

  pause() {
    this.playing = false
    clearTimeout(this.timer)
    cancelAnimationFrame(this.mixRaf)
  }

  setSpeed(speed: number) {
    this.speed = speed
  }

  seek(t: string) {
    const idx = this.tIndex.indexOf(t)
    if (idx < 0) return
    this.playheadIdx = idx
    this.renderFrame(idx, 0)
  }

  private scheduleNext() {
    if (!this.playing) return
    const interval = FRAME_INTERVAL_MS / this.speed
    this.timer = window.setTimeout(() => this.step(), interval)
  }

  private step() {
    if (!this.playing) return
    const next = this.playheadIdx + 1
    if (next >= this.tIndex.length) {
      this.pause()
      this.callbacks.onEnd()
      return
    }
    const aheadIdx = Math.min(next + BUFFER_AHEAD, this.tIndex.length - 1)
    if (!this.ring.has(this.tIndex[aheadIdx])) {
      this.timer = window.setTimeout(() => this.step(), 200)
      return
    }
    this.playheadIdx = next
    this.renderFrame(next, FRAME_INTERVAL_MS / this.speed)
    this.scheduleNext()
  }

  private renderFrame(idx: number, tweenMs: number) {
    const t = this.tIndex[idx]
    const grid = this.ring.get(t)
    if (!grid) return

    this.db.advance(grid)

    const nextGrid = this.ring.get(this.tIndex[idx + 1] ?? '')
    if (nextGrid) this.db.uploadNext(nextGrid)

    this.animateMix(tweenMs)
    this.callbacks.onFrameChange(t, 0)
    this.map.triggerRepaint()
  }

  private animateMix(durationMs: number) {
    cancelAnimationFrame(this.mixRaf)
    this.mixStart = performance.now()
    this.mixDuration = durationMs

    const tick = (now: number) => {
      const factor = durationMs > 0 ? Math.min((now - this.mixStart) / this.mixDuration, 1) : 1
      this.callbacks.onFrameChange(this.tIndex[this.playheadIdx], factor)
      this.map.triggerRepaint()
      if (factor < 1) this.mixRaf = requestAnimationFrame(tick)
    }
    this.mixRaf = requestAnimationFrame(tick)
  }

  destroy() {
    this.pause()
  }
}
