// RAM ring buffer of decoded Uint8 grids — fixed window, evicts oldest.
// Max ~300 buckets ≈ 19MB @ 256² (64KB each), flat regardless of range length.

const MAX_BUCKETS = 300

export class RingBuffer {
  private frames = new Map<string, Uint8Array>() // tISO → grid
  private order: string[] = []                   // insertion order, oldest first

  set(t: string, grid: Uint8Array) {
    if (!this.frames.has(t)) {
      this.order.push(t)
      if (this.order.length > MAX_BUCKETS) {
        const evicted = this.order.shift()!
        this.frames.delete(evicted)
      }
    }
    this.frames.set(t, grid)
  }

  get(t: string): Uint8Array | undefined {
    return this.frames.get(t)
  }

  has(t: string): boolean {
    return this.frames.has(t)
  }

  clear() {
    this.frames.clear()
    this.order = []
  }

  get size() {
    return this.frames.size
  }
}
