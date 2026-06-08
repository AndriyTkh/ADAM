// Fetch wrapper — base URL from env (empty = proxied by Vite dev server)
const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (res.status === 204) return undefined as T
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json() as T
}

// Returns null on 204 (empty/missing bucket)
export async function apiFetchBin(
  path: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer | null> {
  const res = await fetch(`${BASE}${path}`, { signal })
  if (res.status === 204) return null
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.arrayBuffer()
}
