// FE-10: Point-pick panel — shows all pollutant readings + nearest sensor for a pinned location.
// AbortController latest-wins: each pin/t change aborts the previous request.

import { useRef } from 'react'
import { useUiStore, selectCurrentT } from '../store/uiStore'
import { usePointReading } from '../api/queries'
import { SCALE_LABELS } from '../lib/scales'

// EAQI band labels for AQI values
const EAQI_BAND = (v: number) => {
  if (v <= 20) return { label: 'Good',            color: '#50F0E6' }
  if (v <= 40) return { label: 'Fair',            color: '#50CCAA' }
  if (v <= 60) return { label: 'Moderate',        color: '#F0E641' }
  if (v <= 80) return { label: 'Poor',            color: '#FF5050' }
  if (v <= 90) return { label: 'Very Poor',       color: '#960032' }
  return           { label: 'Extremely Poor',     color: '#7D2181' }
}

const POLLUTANT_UNITS: Record<string, string> = {
  aqi:  'index',
  pm25: 'µg/m³',
  no2:  'µg/m³',
  co:   'mg/m³',
}

const POLLUTANT_ORDER = ['aqi', 'pm25', 'no2', 'co']

export function PointPanel() {
  const pin      = useUiStore(s => s.pin)
  const setPin   = useUiStore(s => s.setPin)
  const currentT = useUiStore(selectCurrentT)
  const abortRef = useRef<AbortController | null>(null)

  // Create a new AbortController for each render with different pin/t
  abortRef.current?.abort()
  const ctrl = new AbortController()
  abortRef.current = ctrl

  const { data, isLoading, isError } = usePointReading(
    pin?.lat ?? null,
    pin?.lng ?? null,
    currentT,
    ctrl.signal,
  )

  if (!pin) return null

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>Point Reading</div>
          <div style={styles.coords}>
            {pin.lat.toFixed(4)}°N &nbsp; {pin.lng.toFixed(4)}°E
          </div>
        </div>
        <button onClick={() => setPin(null)} style={styles.close}>✕</button>
      </div>

      {isLoading && (
        <div style={styles.loading}>Loading…</div>
      )}

      {isError && (
        <div style={styles.err}>Failed to load</div>
      )}

      {data && !isLoading && (
        <>
          <div style={styles.divider} />
          {POLLUTANT_ORDER.map(key => {
            const raw = data[key]
            if (typeof raw !== 'number') return null
            const val = raw
            const unit = POLLUTANT_UNITS[key] ?? ''
            const scale = SCALE_LABELS[key]
            const band = key === 'aqi' ? EAQI_BAND(val) : null
            return (
              <div key={key} style={styles.row}>
                <span style={styles.pollKey}>{key.toUpperCase()}</span>
                <span style={styles.pollVal}>
                  {val.toFixed(key === 'aqi' ? 0 : 1)}
                </span>
                <span style={styles.pollUnit}>{unit}</span>
                {band && (
                  <span style={{ ...styles.band, color: band.color }}>{band.label}</span>
                )}
                {!band && scale && (
                  <span style={styles.scaleHint}>{scale.label}</span>
                )}
              </div>
            )
          })}

          {data.nearestSensor && (
            <>
              <div style={styles.divider} />
              <div style={styles.metaRow}>
                <span style={styles.metaLabel}>Nearest sensor</span>
                <span style={styles.metaVal}>
                  {data.nearestSensor.id}
                  &nbsp;
                  <span style={styles.dim}>
                    ({(data.nearestSensor.distanceM / 1000).toFixed(1)} km)
                  </span>
                </span>
              </div>
            </>
          )}

          {data.interpolated && (
            <div style={styles.interpolated}>⊕ interpolated</div>
          )}
        </>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 64,
    right: 16,
    width: 240,
    background: 'rgba(18,18,18,0.94)',
    backdropFilter: 'blur(8px)',
    borderRadius: 10,
    padding: '12px 14px',
    zIndex: 10,
    boxShadow: '0 2px 16px rgba(0,0,0,0.6)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    color: '#ddd',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 0.3,
  },
  coords: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  close: {
    background: 'none',
    border: 'none',
    color: '#666',
    fontSize: 16,
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: 1,
  },
  divider: {
    height: 1,
    background: 'rgba(255,255,255,0.08)',
    margin: '4px 0',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    padding: '2px 0',
  },
  pollKey: {
    color: '#888',
    fontSize: 11,
    fontWeight: 700,
    width: 36,
    flexShrink: 0,
  },
  pollVal: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    fontFamily: 'monospace',
  },
  pollUnit: {
    color: '#666',
    fontSize: 11,
  },
  band: {
    fontSize: 11,
    fontWeight: 600,
    marginLeft: 'auto',
  },
  scaleHint: {
    color: '#555',
    fontSize: 10,
    marginLeft: 'auto',
  },
  metaRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  metaLabel: {
    color: '#555',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaVal: {
    color: '#aaa',
    fontSize: 12,
  },
  dim: {
    color: '#555',
  },
  interpolated: {
    color: '#5a8f5a',
    fontSize: 11,
    marginTop: 2,
  },
  loading: {
    color: '#666',
    fontSize: 12,
    padding: '8px 0',
  },
  err: {
    color: '#c44',
    fontSize: 12,
    padding: '8px 0',
  },
}
