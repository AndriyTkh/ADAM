import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MapView } from './map/MapView'
import { HeatmapLayer } from './map/layers/HeatmapLayer'
// import { SensorsLayer } from './map/layers/SensorsLayer'  // hidden for now
import { VehiclesLayer } from './map/layers/VehiclesLayer'
import { PinLayer } from './map/layers/PinLayer'
import { PollutantTabs } from './map/controls/PollutantTabs'
import { NavWindow } from './map/controls/NavWindow'
import { Legend } from './map/controls/Legend'
import { TopBar } from './ui/TopBar'
import { PointPanel } from './ui/PointPanel'
import { useUiStore } from './store/uiStore'

function PlaybackBadge() {
  const timeState = useUiStore(s => s.timeState)
  const singlePlaying = useUiStore(s => s.singlePlaying)
  const singleSpeed = useUiStore(s => s.singleSpeed)
  if (timeState.mode !== 'single') return null
  const isLive = timeState.t === 'live'
  const label = singlePlaying
    ? `▶ Play · ${singleSpeed}× speed · ${timeState.step} min/step`
    : isLive
      ? `Loop · live`
      : `Loop · ${timeState.step} min/step`
  return (
    <div style={{
      position: 'absolute', bottom: 74, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(20,20,20,0.75)', backdropFilter: 'blur(6px)',
      borderRadius: 6, padding: '3px 10px',
      fontSize: 11, color: singlePlaying ? '#7dd3fc' : 'rgba(255,255,255,0.45)',
      letterSpacing: '0.03em', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 10,
    }}>
      {label}
    </div>
  )
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#111' }}>
        <TopBar />
        <div style={{ position: 'absolute', inset: 0, top: 48 }}>
          <MapView>
            <HeatmapLayer />
            {/* <SensorsLayer /> hidden for now */}
            <VehiclesLayer />
            <PinLayer />
          </MapView>
        </div>
        <PlaybackBadge />
        <PollutantTabs />
        <NavWindow />
        <Legend />
        <PointPanel />
      </div>
    </QueryClientProvider>
  )
}
