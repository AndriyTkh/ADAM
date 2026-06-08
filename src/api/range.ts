// Range batch fetch: splits into day-chunks, ≤4 parallel, streams to worker
import { apiFetchBin } from './client'

const MAX_PARALLEL = 4
const DAY_MS = 24 * 60 * 60_000

function dayChunks(from: string, to: string): Array<[string, string]> {
  const chunks: Array<[string, string]> = []
  let cursor = new Date(from).getTime()
  const end = new Date(to).getTime()
  while (cursor < end) {
    const next = Math.min(cursor + DAY_MS, end)
    chunks.push([new Date(cursor).toISOString(), new Date(next).toISOString()])
    cursor = next
  }
  return chunks
}

async function runPool<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  onResult: (r: T) => void,
): Promise<void> {
  const queue = [...tasks]
  const active = new Set<Promise<void>>()

  function next() {
    if (queue.length === 0) return
    const task = queue.shift()!
    const p: Promise<void> = task().then(r => {
      onResult(r)
      active.delete(p)
      next()
    })
    active.add(p)
  }

  for (let i = 0; i < Math.min(concurrency, tasks.length); i++) next()
  while (active.size > 0) await Promise.race(active)
}

export async function fetchRange(
  pollutant: string,
  from: string,
  to: string,
  step: number,
  onChunk: (buf: ArrayBuffer) => void,
  signal?: AbortSignal,
): Promise<void> {
  const chunks = dayChunks(from, to)
  const tasks = chunks.map(([f, t]) => () =>
    apiFetchBin(
      `/v1/grid/${pollutant}/range?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}&step=${step}`,
      signal,
    ).then(buf => buf ?? new ArrayBuffer(0)),
  )
  await runPool(tasks, MAX_PARALLEL, buf => {
    if (buf.byteLength > 0) onChunk(buf)
  })
}
