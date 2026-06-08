// 10-min bucket utilities + DST-aware Kyiv labels

const BUCKET_MS = 10 * 60_000

export function snapToBucket(date: Date): Date {
  return new Date(Math.floor(date.getTime() / BUCKET_MS) * BUCKET_MS)
}

export function bucketISO(date: Date): string {
  return snapToBucket(date).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function nowBucket(): string {
  return bucketISO(new Date())
}

export function addMinutes(iso: string, minutes: number): string {
  return bucketISO(new Date(new Date(iso).getTime() + minutes * 60_000))
}

// DST-aware Kyiv label. Ukraine = Europe/Kyiv (UTC+2 winter / UTC+3 summer).
export function kyivLabel(iso: string): string {
  return new Date(iso).toLocaleString('uk-UA', {
    timeZone: 'Europe/Kyiv',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function kyivClock(date: Date = new Date()): string {
  return date.toLocaleTimeString('uk-UA', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// Returns UTC offset label for a given instant, e.g. "UTC+3"
export function kyivUtcOffset(iso: string): string {
  const date = new Date(iso)
  const formatted = date.toLocaleString('en', {
    timeZone: 'Europe/Kyiv',
    timeZoneName: 'shortOffset',
  })
  const m = formatted.match(/GMT([+-]\d+)/)
  return m ? `UTC${m[1]}` : 'UTC+3'
}

export const STEP_OPTIONS = [10, 30, 60, 360, 1440] as const
export type StepMinutes = (typeof STEP_OPTIONS)[number]

// Min allowed step per range length (frames ≤ 1500 invariant, STRUCTURE locked table)
export function minAllowedStep(rangeMins: number): StepMinutes {
  return rangeMins > 10 * 24 * 60 ? 30 : 10
}

export function allowedSteps(rangeMins: number): StepMinutes[] {
  const min = minAllowedStep(rangeMins)
  return STEP_OPTIONS.filter(s => s >= min)
}

export function clampStep(step: number, rangeMins: number): StepMinutes {
  const min = minAllowedStep(rangeMins)
  const safe = STEP_OPTIONS.find(s => s >= Math.max(step, min))
  return safe ?? 1440
}

export function rangeMins(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 60_000
}

export function frameCount(from: string, to: string, step: number): number {
  return Math.ceil(rangeMins(from, to) / step)
}
