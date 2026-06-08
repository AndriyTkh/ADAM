/// <reference lib="webworker" />
// Delta-decode range blob frames. Brotli handled by browser at fetch layer.
// Protocol: receive DecodeRequest → post DecodeResponse with transferable Uint8Arrays.

import { decodeRangeMeta } from './binaryHeader'

interface DecodeRequest {
  type: 'decode'
  id: number
  buf: ArrayBuffer
}

interface DecodeResponse {
  type: 'decoded'
  id: number
  frames: ArrayBuffer[]
  tIndex: string[]
  frameTypes: number[]
  error?: never
}

interface DecodeErrorResponse {
  type: 'error'
  id: number
  error: string
}

self.onmessage = (e: MessageEvent<DecodeRequest>) => {
  const { id, buf } = e.data
  try {
    const meta = decodeRangeMeta(buf)
    const frameSize = meta.header.dimsW * meta.header.dimsH
    const count = meta.tIndex.length
    const frames: ArrayBuffer[] = []
    let prevFrame: Uint8Array | null = null
    let off = meta.payloadOffset

    const src = new Uint8Array(buf)
    const srcSigned = new Int8Array(buf)

    for (let i = 0; i < count; i++) {
      const out = new Uint8Array(frameSize)
      if (meta.frameTypes[i] === 0) {
        // keyframe — copy raw bytes
        out.set(src.subarray(off, off + frameSize))
      } else {
        // delta frame — signed-byte deltas applied to previous present frame
        if (!prevFrame) throw new Error(`delta frame ${i} has no prior keyframe`)
        for (let j = 0; j < frameSize; j++) {
          out[j] = Math.max(0, Math.min(255, prevFrame[j] + srcSigned[off + j]))
        }
      }
      off += frameSize
      prevFrame = out
      frames.push(out.buffer)
    }

    const resp: DecodeResponse = {
      type: 'decoded',
      id,
      frames,
      tIndex: meta.tIndex,
      frameTypes: Array.from(meta.frameTypes),
    }
    self.postMessage(resp, { transfer: frames })
  } catch (err) {
    const resp: DecodeErrorResponse = {
      type: 'error',
      id,
      error: String(err),
    }
    self.postMessage(resp)
  }
}
