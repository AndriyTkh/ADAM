/**
 * Header decode parity (SETUP-3 / QA-2). Asserts the ts decoder reads the
 * SAME golden .bin the py suite asserts on encode — cross-worktree drift guard.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeGrid, decodeHeader, decodeRangeMeta, HEADER_SIZE } from './binaryHeader'

function load(name: string): ArrayBuffer {
  const b = readFileSync(join(__dirname, '__fixtures__', name))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

describe('binary header parity', () => {
  it('header size locked at 34', () => {
    expect(HEADER_SIZE).toBe(34)
  })

  it('decodes golden grid header + payload', () => {
    const { header, grid } = decodeGrid(load('grid_golden.bin'))
    expect(header.dimsW).toBe(4)
    expect(header.dimsH).toBe(4)
    expect(header.ver).toBe(1)
    expect(header.scaleMax).toBe(500)
    expect(header.bbox[0]).toBeCloseTo(30.24)
    expect(Array.from(grid)).toEqual([...Array(16).keys()])
  })

  it('rejects bad magic', () => {
    expect(() => decodeHeader(new ArrayBuffer(HEADER_SIZE))).toThrow(/bad magic/)
  })

  it('decodes golden range meta', () => {
    const { tIndex, frameTypes } = decodeRangeMeta(load('range_meta_golden.bin'))
    expect(tIndex).toEqual(['2026-05-31T12:00', '2026-05-31T12:10'])
    expect(Array.from(frameTypes)).toEqual([0, 1])
  })
})
