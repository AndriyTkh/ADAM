// FE-11: TopBar — logo, AQI badge, UTC+3 clock, staleness indicator
import { useEffect, useState } from 'react'
import { useUiStore, selectCurrentT } from '../store/uiStore'
import { useAlerts } from '../api/queries'
import { kyivClock, kyivLabel, nowBucket } from '../lib/time'

export function TopBar() {
  const currentT = useUiStore(selectCurrentT)
  const timeState = useUiStore(s => s.timeState)
  const { data: alerts } = useAlerts(currentT)

  const [clock, setClock] = useState(() => kyivClock())
  useEffect(() => {
    const id = setInterval(() => setClock(kyivClock()), 1000)
    return () => clearInterval(id)
  }, [])

  // Staleness: live bucket older than 10 min
  const isLive = timeState.mode === 'single' && timeState.t === 'live'
  const bucketAge = isLive
    ? Date.now() - new Date(nowBucket()).getTime()
    : null
  const stale = bucketAge !== null && bucketAge > 10 * 60_000

  const dangerCount = alerts?.filter(a => a.severity === 'danger').length ?? 0

  return (
    <div style={styles.bar}>
      <div style={styles.logo}>
        <span style={styles.logoText}>ADAM</span>
        <span style={styles.city}>Kyiv</span>
      </div>

      {dangerCount > 0 && (
        <div style={styles.alertBadge}>
          {dangerCount} alert{dangerCount > 1 ? 's' : ''}
        </div>
      )}

      <div style={styles.right}>
        {stale && (
          <span style={styles.stale}>data as of {kyivLabel(currentT)}</span>
        )}
        <span style={styles.clock}>{clock}</span>
        <span style={styles.tz}>UTC+3</span>
      </div>
    </div>
  )
}

const styles = {
  bar: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    height: 48,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    background: 'rgba(10,10,10,0.9)',
    backdropFilter: 'blur(8px)',
    zIndex: 20,
    gap: 12,
  },
  logo: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  },
  logoText: {
    color: '#fff',
    fontWeight: 800,
    fontSize: 18,
    letterSpacing: 2,
  },
  city: {
    color: '#888',
    fontSize: 13,
  },
  alertBadge: {
    background: '#c00',
    color: '#fff',
    borderRadius: 12,
    padding: '2px 10px',
    fontSize: 12,
    fontWeight: 700,
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  stale: {
    color: '#f90',
    fontSize: 12,
  },
  clock: {
    color: '#ccc',
    fontSize: 14,
    fontFamily: 'monospace',
  },
  tz: {
    color: '#555',
    fontSize: 12,
  },
}
