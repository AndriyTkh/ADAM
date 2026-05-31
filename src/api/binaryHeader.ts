/**
 * Binary header decoder — mirrors backend/app/core/binary.py (SETUP-3).
 * Little-endian. Golden .bin fixtures asserted by both py and ts suites.
 * Spec: STRUCTURE -> "Binary header spec". Frontend REJECTS mismatched ver.
 */

export const MAGIC = 0x4d414441 // 'A','D','A','M' little-endian
export const VER = 1
export const HEADER_SIZE = 34

export interface GridHeader {
  ver: number
  dimsW: number
  dimsH: number
  bbox: [number, number, number, number] // west, south, east, north
  scaleMin: number
  scaleMax: number
}

export function decodeHeader(buf: ArrayBuffer | DataView): GridHeader {
  const dv = buf instanceof DataView ? buf : new DataView(buf)
  const magic = dv.getUint32(0, true)
  if (magic !== MAGIC) throw new Error(`bad magic 0x${magic.toString(16)}`)
  const ver = dv.getUint16(4, true)
  if (ver !== VER) throw new Error(`unsupported ver ${ver}`)
  return {
    ver,
    dimsW: dv.getUint16(6, true),
    dimsH: dv.getUint16(8, true),
    bbox: [
      dv.getFloat32(10, true),
      dv.getFloat32(14, true),
      dv.getFloat32(18, true),
      dv.getFloat32(22, true),
    ],
    scaleMin: dv.getFloat32(26, true),
    scaleMax: dv.getFloat32(30, true),
  }
}

/** Single-bucket .bin (BE-3): header + Uint8 grid payload. */
export function decodeGrid(buf: ArrayBuffer): { header: GridHeader; grid: Uint8Array } {
  const header = decodeHeader(buf)
  const grid = new Uint8Array(buf, HEADER_SIZE, header.dimsW * header.dimsH)
  return { header, grid }
}

export interface RangeMeta {
  header: GridHeader
  tIndex: string[]
  frameTypes: Uint8Array // 0=keyframe, 1=delta
  payloadOffset: number // byte offset where frame payloads begin
}

/** Range-blob meta block (BE-4): header + bucketCount + tIndex[] + frameType[]. */
export function decodeRangeMeta(buf: ArrayBuffer): RangeMeta {
  const dv = new DataView(buf)
  const header = decodeHeader(dv)
  let off = HEADER_SIZE
  const count = dv.getUint32(off, true)
  off += 4
  const dec = new TextDecoder()
  const tIndex: string[] = []
  for (let i = 0; i < count; i++) {
    const len = dv.getUint16(off, true)
    off += 2
    tIndex.push(dec.decode(new Uint8Array(buf, off, len)))
    off += len
  }
  const frameTypes = new Uint8Array(buf, off, count).slice()
  off += count
  return { header, tIndex, frameTypes, payloadOffset: off }
}
