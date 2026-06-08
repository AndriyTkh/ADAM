// FE-8: Sensor circles — tier-styled, recolored per pollutant/bucket.
// Uses MapLibre GeoJSON source; updates feature properties (no re-add) on bucket change.

import { useEffect, useRef } from 'react'
import type { GeoJSONSource } from 'maplibre-gl'
import { useMap } from '../MapView'
import { useUiStore, selectCurrentT } from '../../store/uiStore'
import { useSensors, useSensorReadings } from '../../api/queries'

const SOURCE_ID = 'adam-sensors'
const LAYER_ID  = 'adam-sensors-layer'
const LABEL_ID  = 'adam-sensors-label'

// Scale max per pollutant for normalization
const SCALE_MAX: Record<string, number> = {
  aqi: 100, pm25: 75, no2: 400, co: 30,
}

// EAQI color bands (6 bands, 0-1 normalized)
const RAMP: Array<[number, string]> = [
  [0.00, '#50F0E6'],
  [0.20, '#50CCAA'],
  [0.40, '#F0E641'],
  [0.60, '#FF5050'],
  [0.80, '#960032'],
  [1.00, '#7D2181'],
]

function valueToColor(v: number, max: number): string {
  const n = Math.max(0, Math.min(1, v / max))
  for (let i = 0; i < RAMP.length - 1; i++) {
    const [v0, c0] = RAMP[i]
    const [v1, c1] = RAMP[i + 1]
    if (n >= v0 && n <= v1) {
      const t = (n - v0) / (v1 - v0)
      return t < 0.5 ? c0 : c1
    }
  }
  return RAMP[RAMP.length - 1][1]
}

export function SensorsLayer() {
  const map = useMap()
  const pollutant = useUiStore(s => s.pollutant)
  const currentT  = useUiStore(selectCurrentT)
  const { data: sensors } = useSensors()
  const { data: readings } = useSensorReadings(currentT)
  const addedRef = useRef(false)

  // Add source + layers once map is ready
  useEffect(() => {
    if (!map || !sensors || addedRef.current) return
    addedRef.current = true

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: sensors.map(s => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: { id: s.id, name: s.name, tier: s.tier, color: '#888888' },
      })),
    }

    map.addSource(SOURCE_ID, { type: 'geojson', data: geojson })

    map.addLayer({
      id: LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': ['match', ['get', 'tier'], 1, 12, 2, 9, 3, 7, 7],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.9,
        'circle-stroke-width': ['match', ['get', 'tier'], 1, 2, 1],
        'circle-stroke-color': 'rgba(255,255,255,0.5)',
      },
    })

    map.addLayer({
      id: LABEL_ID,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['==', ['get', 'tier'], 1],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 10,
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
      },
      paint: {
        'text-color': '#aaa',
        'text-halo-color': 'rgba(0,0,0,0.7)',
        'text-halo-width': 1,
      },
    })

    return () => {
      if (map.getLayer(LABEL_ID)) map.removeLayer(LABEL_ID)
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
      addedRef.current = false
    }
  }, [map, sensors])

  // Update colors when pollutant or readings change
  useEffect(() => {
    if (!map || !sensors || !addedRef.current) return
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
    if (!source) return

    const max = SCALE_MAX[pollutant] ?? 100

    source.setData({
      type: 'FeatureCollection',
      features: sensors.map(s => {
        const reading = readings?.[s.id]
        const raw = reading?.[pollutant]
        const val = typeof raw === 'number' ? raw : null
        const color = val !== null ? valueToColor(val, max) : '#555555'
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
          properties: { id: s.id, name: s.name, tier: s.tier, color },
        }
      }),
    })
  }, [map, sensors, readings, pollutant])

  return null
}
