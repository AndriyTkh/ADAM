// FE-9: Vehicle markers with sub-bucket road animation (Vehicle Probe Model display).
//
//  - Marker per vehicle (circle layer, WebGL) coloured by active-pollutant reading.
//  - Sub-bucket animation: rAF moves each marker along its 40 road-snapped
//    sub-points (from /v1/vehicles?t=) over a display cycle — cars visibly drive
//    on the road, no teleport / straight-lerp. Driven outside React via setData.
//  - Comet tail: last ~2 min of sub-points behind the marker (short colored line).
//  - Full trail (whole route) shown only for the SELECTED vehicle, segment-coloured
//    by reading (red where it spiked), via /v1/vehicles/{id}/path.

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { GeoJSONSource } from 'maplibre-gl'
import { useMap } from '../MapView'
import { useUiStore, selectCurrentT } from '../../store/uiStore'
import { useVehicles, useVehiclePath } from '../../api/queries'
import { apiFetch } from '../../api/client'
import { addMinutes, nowBucket } from '../../lib/time'
import { valueToColor } from '../../lib/scales'
import type { Vehicle } from '../../api/types'

const V_SOURCE = 'adam-vehicles'
const V_LAYER = 'adam-vehicles-layer'
const TAIL_SOURCE = 'adam-vehicle-tails'
const TAIL_LAYER = 'adam-vehicle-tails-layer'
const TRAIL_SOURCE = 'adam-trail'
const TRAIL_LAYER = 'adam-trail-layer'

const ANIM_MS = 24_000     // idle free-loop: visual time to drive one leg
const PLAY_LEG_MS = 6_000  // play mode: visual time to drive one leg at 1× (÷ speed)
const TAIL_PTS = 8         // ~2 min of 15 s sub-points behind the marker
const TAIL_BUF = 40        // frame-position history kept across step changes
const FRAME_MS = 1000 / 30

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

// Position + recent tail for a vehicle at animation progress p∈[0,1].
//
// loop=true (idle): sub-points treated as a closed cycle — the last segment
//   wraps end→start and is hidden (snap, no tail) so cars loop forever.
// loop=false (play): one-shot leg, sub-points[0]→sub-points[n-1] over p∈[0,1].
//   At p=1 the car sits exactly on its end position, which the DB syncs to be
//   the next leg's start — so the step advance is a seamless hand-off.
function animate(v: Vehicle, p: number, loop: boolean): { pos: [number, number]; tail: [number, number][] } {
  const sp = v.subpoints
  if (!sp || sp.length < 2 || v.status === 'parked') {
    return { pos: [v.lng, v.lat], tail: [] }
  }
  const n = sp.length

  if (loop) {
    const f = p * n
    const i0 = Math.floor(f) % n
    const frac = f - Math.floor(f)
    // Last segment wraps end→start: snap instantly, no straight-line lerp, no tail.
    if (i0 === n - 1) {
      return { pos: sp[n - 1], tail: [] }
    }
    const i1 = i0 + 1
    const pos: [number, number] = [
      lerp(sp[i0][0], sp[i1][0], frac),
      lerp(sp[i0][1], sp[i1][1], frac),
    ]
    const tail: [number, number][] = []
    for (let k = TAIL_PTS - 1; k >= 0; k--) {
      const idx = i0 - k
      if (idx < 0) continue   // don't wrap past route start after position reset
      tail.push(sp[idx])
    }
    tail.push(pos)
    return { pos, tail }
  }

  // Non-looping leg: every segment visible, ends exactly on sp[n-1].
  const f = Math.min(Math.max(p, 0), 1) * (n - 1)
  const i0 = Math.min(Math.floor(f), n - 2)
  const frac = f - i0
  const i1 = i0 + 1
  const pos: [number, number] = [
    lerp(sp[i0][0], sp[i1][0], frac),
    lerp(sp[i0][1], sp[i1][1], frac),
  ]
  const tail: [number, number][] = []
  for (let k = TAIL_PTS - 1; k >= 0; k--) {
    const idx = i0 - k
    if (idx < 0) continue
    tail.push(sp[idx])
  }
  tail.push(pos)
  return { pos, tail }
}

export function VehiclesLayer() {
  const map = useMap()
  const currentT = useUiStore(selectCurrentT)
  const pollutant = useUiStore(s => s.pollutant)
  const selectedVehicle = useUiStore(s => s.selectedVehicle)
  const timeState = useUiStore(s => s.timeState)
  const singlePlaying = useUiStore(s => s.singlePlaying)
  const queryClient = useQueryClient()
  const addedRef = useRef(false)
  const vehiclesRef = useRef<Vehicle[]>([])
  const vehiclesTRef = useRef<string>('')    // t for which vehiclesRef.current has data
  const pollutantRef = useRef(pollutant)
  const legStartRef = useRef(0)   // play-mode leg start timestamp (0 = not started)
  const pendingTRef = useRef<string | null>(null)  // t we're waiting for before starting next leg
  const tailBufferRef = useRef<Map<string, [number, number][]>>(new Map())

  const { data: vehicles } = useVehicles(currentT)

  // selected-vehicle full trail window: 2h ending currentT
  const trailFrom = new Date(
    (currentT === 'live' ? Date.now() : Date.parse(currentT)) - 2 * 3600_000,
  ).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const trailTo = currentT === 'live'
    ? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    : currentT
  const { data: trailPts } = useVehiclePath(
    selectedVehicle ?? '', trailFrom, trailTo, !!selectedVehicle,
  )

  // Only update vehiclesTRef when we actually have data for currentT (not stale/loading)
  if (vehicles) {
    vehiclesRef.current = vehicles
    vehiclesTRef.current = currentT
  }
  pollutantRef.current = pollutant

  // Add sources + layers once
  useEffect(() => {
    if (!map || addedRef.current) return
    addedRef.current = true
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

    map.addSource(TRAIL_SOURCE, { type: 'geojson', data: empty })
    map.addLayer({
      id: TRAIL_LAYER, type: 'line', source: TRAIL_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.85 },
    })

    map.addSource(TAIL_SOURCE, { type: 'geojson', data: empty })
    map.addLayer({
      id: TAIL_LAYER, type: 'line', source: TAIL_SOURCE,
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.45 },
    })

    map.addSource(V_SOURCE, { type: 'geojson', data: empty })
    map.addLayer({
      id: V_LAYER, type: 'circle', source: V_SOURCE,
      paint: {
        'circle-radius': [
          'match', ['get', 'type'], 'truck', 8, 'bus', 8, 'van', 6.5, 'car', 5.5, 6,
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.95,
        'circle-stroke-width': ['case', ['get', 'selected'], 3, 1.5],
        'circle-stroke-color': ['case', ['get', 'selected'], '#ffffff', 'rgba(255,255,255,0.5)'],
      },
    })

    // Marker click → selection is owned by MapView's single click handler
    // (one hit-test, no race). Here we only set the hover cursor.
    map.on('mouseenter', V_LAYER, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', V_LAYER, () => { map.getCanvas().style.cursor = '' })

    return () => {
      for (const l of [V_LAYER, TAIL_LAYER, TRAIL_LAYER]) if (map.getLayer(l)) map.removeLayer(l)
      for (const s of [V_SOURCE, TAIL_SOURCE, TRAIL_SOURCE]) if (map.getSource(s)) map.removeSource(s)
      addedRef.current = false
    }
  }, [map])

  // rAF animation loop — drives markers + comet tails along sub-points.
  //
  // Idle: cars free-loop their current leg (closed cycle, ANIM_MS).
  // Play (single mode): cars drive the leg ONCE over PLAY_LEG_MS/speed; when a
  // leg finishes (p≥1, cars on their end position) we advance `t` by one step.
  // Because the DB syncs each car's end position to its next-leg start, the
  // grid + vehicle swap is a seamless hand-off — no teleport.
  useEffect(() => {
    if (!map || !addedRef.current) return
    let raf = 0
    let last = 0

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < FRAME_MS) return
      last = now
      const vSrc = map.getSource(V_SOURCE) as GeoJSONSource | undefined
      const tSrc = map.getSource(TAIL_SOURCE) as GeoJSONSource | undefined
      if (!vSrc || !tSrc) return

      const st = useUiStore.getState()
      const ts = st.timeState

      let p: number
      let loop: boolean
      const useTrailBuffer = ts.mode === 'single' && st.singlePlaying && ts.step <= 10
      if (ts.mode === 'single' && st.singlePlaying) {
        loop = false
        const legMs = PLAY_LEG_MS / Math.max(st.singleSpeed, 1)

        // New vehicles data arrived for the pending t → kick off the new leg
        if (pendingTRef.current !== null && vehiclesTRef.current === pendingTRef.current) {
          legStartRef.current = now
          pendingTRef.current = null
        }

        if (pendingTRef.current !== null) {
          // Waiting for fresh vehicles — hold cars at end of completed leg
          p = 1
        } else {
          if (legStartRef.current === 0) legStartRef.current = now
          p = (now - legStartRef.current) / legMs
          if (p >= 1) {
            // Leg complete → cars on their end position. Advance one step.
            p = 1
            const t = ts.t === 'live' ? nowBucket() : ts.t
            const next = addMinutes(t, ts.step)
            if (next >= nowBucket()) {
              st.setSinglePlaying(false)   // don't roll into the live bucket
            } else {
              st.setTimeState({ ...ts, t: next })
              pendingTRef.current = next   // wait for fresh vehicles before animating
              legStartRef.current = 0
              if (ts.step > 10) tailBufferRef.current.clear()
            }
          }
        }
      } else {
        loop = true
        legStartRef.current = 0          // reset so the next play starts a fresh leg
        pendingTRef.current = null
        tailBufferRef.current.clear()    // idle / paused — no cross-step persistence
        p = (now % ANIM_MS) / ANIM_MS
      }

      const sel = st.selectedVehicle
      const poll = pollutantRef.current
      const markers: GeoJSON.Feature[] = []
      const tails: GeoJSON.Feature[] = []

      for (const v of vehiclesRef.current) {
        const { pos, tail: animTail } = animate(v, p, loop)
        const color = valueToColor(poll, v.readings[poll] as number | undefined)
        markers.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: pos },
          properties: { id: v.id, type: v.type, status: v.status, color, selected: v.id === sel },
        })

        let tail: [number, number][]
        if (useTrailBuffer) {
          const buf = tailBufferRef.current.get(v.id) ?? []
          buf.push(pos)
          if (buf.length > TAIL_BUF) buf.splice(0, buf.length - TAIL_BUF)
          tailBufferRef.current.set(v.id, buf)
          tail = buf.slice()
        } else {
          tail = animTail
        }

        if (tail.length >= 2) {
          tails.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: tail },
            properties: { color },
          })
        }
      }
      vSrc.setData({ type: 'FeatureCollection', features: markers })
      tSrc.setData({ type: 'FeatureCollection', features: tails })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [map])

  // Prefetch the next bucket's vehicles while playing so the leg hand-off swaps
  // instantly (no brief replay of the prior leg's route under keepPreviousData).
  useEffect(() => {
    if (timeState.mode !== 'single' || !singlePlaying) return
    const next = addMinutes(currentT, timeState.step)
    if (next >= nowBucket()) return
    queryClient.prefetchQuery({
      queryKey: ['vehicles', next],
      queryFn: () => apiFetch<Vehicle[]>(`/v1/vehicles?t=${encodeURIComponent(next)}`),
      staleTime: 30_000,
    })
  }, [currentT, singlePlaying, timeState, queryClient])

  // Selected vehicle → full road trail, segment-coloured by reading
  useEffect(() => {
    if (!map || !addedRef.current) return
    const src = map.getSource(TRAIL_SOURCE) as GeoJSONSource | undefined
    if (!src) return
    if (!selectedVehicle || !trailPts || trailPts.length < 2) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    const features: GeoJSON.Feature[] = []
    for (let i = 0; i < trailPts.length - 1; i++) {
      const a = trailPts[i]
      const b = trailPts[i + 1]
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] },
        properties: { color: valueToColor(pollutant, a.readings[pollutant] as number | undefined) },
      })
    }
    src.setData({ type: 'FeatureCollection', features })
  }, [map, selectedVehicle, trailPts, pollutant])

  return null
}
