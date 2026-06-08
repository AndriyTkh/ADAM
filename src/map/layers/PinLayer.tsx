// Drops a visible marker at the point-picked location (uiStore.pin).
// Without it the PointPanel shows readings but the map gives no hint of WHERE.

import { useEffect, useRef } from 'react'
import maplibregl, { type Marker } from 'maplibre-gl'
import { useMap } from '../MapView'
import { useUiStore } from '../../store/uiStore'

export function PinLayer() {
  const map = useMap()
  const pin = useUiStore(s => s.pin)
  const markerRef = useRef<Marker | null>(null)

  useEffect(() => {
    if (!map) return

    if (!pin) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }

    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ color: '#ff3b30', anchor: 'bottom' })
    }
    markerRef.current.setLngLat([pin.lng, pin.lat]).addTo(map)

    return () => {
      markerRef.current?.remove()
      markerRef.current = null
    }
  }, [map, pin])

  return null
}
