// Mirrors FastAPI pydantic models in backend/app/models/schemas.py

export type PollutantKey = 'aqi' | 'pm25' | 'no2' | 'co' | (string & {})

export interface Pollutant {
  key: PollutantKey
  label: string
  unit: string
  group: 'PM' | 'NOx' | 'SOx' | 'carbon' | 'composite'
  scale: string
  available: boolean
}

export interface SensorMeta {
  id: string
  lat: number
  lng: number
  name: string
  tier: 'reference' | 'low-cost'
  provider: string
}

export type PollutantReadings = Record<string, number | undefined>

export interface SensorReading {
  [pollutant: string]: number | string | undefined
  datetimeLast: string
}

export type SensorReadings = Record<string, SensorReading>

export interface Vehicle {
  id: string
  type: 'truck' | 'van' | 'car' | 'bus'
  lat: number
  lng: number
  status: 'active' | 'idle' | 'parked'
  readings: PollutantReadings
  // 40 road-snapped [lng, lat] sub-points for in-bucket animation (single-t only)
  subpoints: [number, number][] | null
}

export interface VehiclePathPoint {
  lat: number
  lng: number
  t: string
  readings: PollutantReadings
}

export interface PointReading {
  [pollutant: string]: number | boolean | { id: string; distanceM: number } | undefined
  nearestSensor: { id: string; distanceM: number }
  interpolated: boolean
}

export interface TimeRange {
  from: string
  to: string
  minStepMinutes: number
  steps: number[]
  buckets: string[]
}

export interface Alert {
  severity: 'info' | 'warning' | 'danger'
  message: string
  time: string
  zone?: unknown
}

// Time navigation modes
export type NavMode = 'single' | 'range'

export interface SingleBucketState {
  mode: 'single'
  t: string        // ISO bucket timestamp or 'live'
  step: number     // minutes: 10|30|60|360|1440
}

export interface RangeState {
  mode: 'range'
  from: string
  to: string
  step: number
  playing: boolean
  speed: number    // 1x 2x 4x
  currentT: string
}

export type TimeState = SingleBucketState | RangeState
