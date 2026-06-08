import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { KYIV_CENTER, KYIV_ZOOM, KYIV_MIN_ZOOM, KYIV_MAX_ZOOM, KYIV_BBOX } from '../lib/geo'
import { useUiStore } from '../store/uiStore'

// CartoDB Dark Matter raster base style
const DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pb',
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      ],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    {
      id: 'carto-dark',
      type: 'raster',
      source: 'carto-dark',
    },
  ],
}

// Map context — lets child layers access the MapLibre instance without prop drilling
export const MapContext = createContext<MapLibreMap | null>(null)
export const useMap = () => useContext(MapContext)

interface MapViewProps {
  children?: ReactNode
}

export function MapView({ children }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)
  const setPin = useUiStore(s => s.setPin)
  const setSelectedVehicle = useUiStore(s => s.setSelectedVehicle)

  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: KYIV_CENTER,
      zoom: KYIV_ZOOM,
      minZoom: KYIV_MIN_ZOOM,
      maxZoom: KYIV_MAX_ZOOM,
      // Hard-lock viewport to heatmap grid bbox
      maxBounds: [
        [KYIV_BBOX[0], KYIV_BBOX[1]],
        [KYIV_BBOX[2], KYIV_BBOX[3]],
      ],
    })

    map.on('load', () => {
      mapRef.current = map
      setReady(true)
      map.resize()
    })

    // Keep canvas matched to container — avoids projection offset when the
    // container size settles after init (CSS/layout) or the window resizes.
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)

    // Single authoritative click handler — one hit-test, one decision, so a
    // click on a moving vehicle marker can't race a separate layer listener.
    //   hit a vehicle → toggle its selection (show/hide trail), no pin.
    //   empty map     → drop pin + clear any vehicle selection (hide trail).
    map.on('click', e => {
      const hits = map.getLayer('adam-vehicles-layer')
        ? map.queryRenderedFeatures(e.point, { layers: ['adam-vehicles-layer'] })
        : []
      const id = hits[0]?.properties?.id as string | undefined
      if (id) {
        const cur = useUiStore.getState().selectedVehicle
        setSelectedVehicle(cur === id ? null : id)
        if (useUiStore.getState().pin) setPin(null)   // drop active pin on vehicle select
        return
      }
      setPin({ lat: e.lngLat.lat, lng: e.lngLat.lng })
      if (useUiStore.getState().selectedVehicle) setSelectedVehicle(null)
    })

    return () => {
      ro.disconnect()
      setReady(false)
      mapRef.current = null
      map.remove()
    }
  }, [setPin, setSelectedVehicle])

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {ready && mapRef.current && (
        <MapContext.Provider value={mapRef.current}>
          {children}
        </MapContext.Provider>
      )}
    </div>
  )
}
