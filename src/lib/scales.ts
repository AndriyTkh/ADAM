// Per-pollutant color ramps (EU EAQI standard + concentration scales)
// Each ramp is [normalizedValue (0-1), r, g, b, a] stops, interpolated to 256-entry RGBA LUT

export interface RampStop {
  v: number  // normalized 0-1 within scaleMin..scaleMax
  r: number
  g: number
  b: number
  a: number
}

// EU EAQI color bands: Good→Fair→Moderate→Poor→VeryPoor→ExtremelyPoor
const EAQI_STOPS: RampStop[] = [
  { v: 0.00, r: 0x50, g: 0xF0, b: 0xE6, a: 200 }, // Good
  { v: 0.20, r: 0x50, g: 0xCC, b: 0xAA, a: 200 }, // Fair
  { v: 0.40, r: 0xF0, g: 0xE6, b: 0x41, a: 210 }, // Moderate
  { v: 0.60, r: 0xFF, g: 0x50, b: 0x50, a: 220 }, // Poor
  { v: 0.80, r: 0x96, g: 0x00, b: 0x32, a: 230 }, // Very Poor
  { v: 1.00, r: 0x7D, g: 0x21, b: 0x81, a: 240 }, // Extremely Poor
]

// PM2.5 concentration (µg/m³), scaleMin=0, scaleMax=75
const PM25_STOPS: RampStop[] = [
  { v: 0.00, r: 0x50, g: 0xF0, b: 0xE6, a: 200 },
  { v: 0.13, r: 0x50, g: 0xCC, b: 0xAA, a: 200 }, // 10
  { v: 0.27, r: 0xF0, g: 0xE6, b: 0x41, a: 210 }, // 20
  { v: 0.33, r: 0xFF, g: 0x80, b: 0x00, a: 220 }, // 25
  { v: 0.67, r: 0xFF, g: 0x50, b: 0x50, a: 230 }, // 50
  { v: 1.00, r: 0x7D, g: 0x21, b: 0x81, a: 240 }, // 75
]

// NO2 concentration (µg/m³), scaleMin=0, scaleMax=400
const NO2_STOPS: RampStop[] = [
  { v: 0.00, r: 0x50, g: 0xF0, b: 0xE6, a: 200 },
  { v: 0.10, r: 0x50, g: 0xCC, b: 0xAA, a: 200 }, // 40
  { v: 0.225, r: 0xF0, g: 0xE6, b: 0x41, a: 210 }, // 90
  { v: 0.30, r: 0xFF, g: 0x80, b: 0x00, a: 220 }, // 120
  { v: 0.60, r: 0xFF, g: 0x50, b: 0x50, a: 230 }, // 240
  { v: 1.00, r: 0x7D, g: 0x21, b: 0x81, a: 240 }, // 400
]

// CO concentration (mg/m³), scaleMin=0, scaleMax=30
const CO_STOPS: RampStop[] = [
  { v: 0.00, r: 0x50, g: 0xF0, b: 0xE6, a: 200 },
  { v: 0.33, r: 0x50, g: 0xCC, b: 0xAA, a: 200 }, // 10
  { v: 0.50, r: 0xF0, g: 0xE6, b: 0x41, a: 210 }, // 15
  { v: 0.67, r: 0xFF, g: 0x50, b: 0x50, a: 230 }, // 20
  { v: 1.00, r: 0x7D, g: 0x21, b: 0x81, a: 240 }, // 30
]

export const RAMPS: Record<string, RampStop[]> = {
  aqi: EAQI_STOPS,
  pm25: PM25_STOPS,
  no2: NO2_STOPS,
  co: CO_STOPS,
}

function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t)
}

// Builds a 256×1 RGBA Uint8Array lookup table from ramp stops
export function buildRampLUT(stops: RampStop[]): Uint8Array {
  const lut = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    const v = i / 255
    let s0 = stops[0]
    let s1 = stops[stops.length - 1]
    for (let j = 0; j < stops.length - 1; j++) {
      if (v >= stops[j].v && v <= stops[j + 1].v) {
        s0 = stops[j]
        s1 = stops[j + 1]
        break
      }
    }
    const t = s1.v === s0.v ? 0 : (v - s0.v) / (s1.v - s0.v)
    const base = i * 4
    lut[base + 0] = lerp(s0.r, s1.r, t)
    lut[base + 1] = lerp(s0.g, s1.g, t)
    lut[base + 2] = lerp(s0.b, s1.b, t)
    lut[base + 3] = lerp(s0.a, s1.a, t)
  }
  return lut
}

// Pre-built LUTs, keyed by ramp id (= pollutant key)
const _lutCache = new Map<string, Uint8Array>()

export function getRampLUT(rampId: string): Uint8Array {
  if (!_lutCache.has(rampId)) {
    const stops = RAMPS[rampId] ?? EAQI_STOPS
    _lutCache.set(rampId, buildRampLUT(stops))
  }
  return _lutCache.get(rampId)!
}

// Physical scaleMax per pollutant (mirrors backend field.SCALE_RANGES upper bound)
export const SCALE_MAX: Record<string, number> = {
  aqi: 100,
  pm25: 75,
  no2: 200,
  co: 10,
}

// Map a physical reading → 'rgba(...)' via the pollutant's ramp LUT.
export function valueToColor(pollutant: string, value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return 'rgba(136,136,136,0.7)'
  const max = SCALE_MAX[pollutant] ?? 100
  const norm = Math.max(0, Math.min(1, value / max))
  const lut = getRampLUT(pollutant)
  const i = Math.min(255, Math.round(norm * 255)) * 4
  return `rgba(${lut[i]},${lut[i + 1]},${lut[i + 2]},${lut[i + 3] / 255})`
}

// Human-readable scale labels for Legend component
export const SCALE_LABELS: Record<string, { label: string; stops: Array<{ value: string; color: string }> }> = {
  aqi: {
    label: 'EU EAQI',
    stops: [
      { value: 'Good', color: '#50F0E6' },
      { value: 'Fair', color: '#50CCAA' },
      { value: 'Moderate', color: '#F0E641' },
      { value: 'Poor', color: '#FF5050' },
      { value: 'Very Poor', color: '#960032' },
      { value: 'Extremely Poor', color: '#7D2181' },
    ],
  },
  pm25: {
    label: 'PM2.5 µg/m³',
    stops: [
      { value: '0', color: '#50F0E6' },
      { value: '10', color: '#50CCAA' },
      { value: '25', color: '#FF8000' },
      { value: '50', color: '#FF5050' },
      { value: '75+', color: '#7D2181' },
    ],
  },
  no2: {
    label: 'NO₂ µg/m³',
    stops: [
      { value: '0', color: '#50F0E6' },
      { value: '40', color: '#50CCAA' },
      { value: '90', color: '#F0E641' },
      { value: '240', color: '#FF5050' },
      { value: '400+', color: '#7D2181' },
    ],
  },
  co: {
    label: 'CO mg/m³',
    stops: [
      { value: '0', color: '#50F0E6' },
      { value: '10', color: '#50CCAA' },
      { value: '20', color: '#FF5050' },
      { value: '30+', color: '#7D2181' },
    ],
  },
}
