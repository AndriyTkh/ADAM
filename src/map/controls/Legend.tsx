// FE-7: Per-pollutant scale legend (top-right, collapsible, reads active pollutant's scale)
import { useState } from 'react'
import { usePollutants } from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import { SCALE_LABELS } from '../../lib/scales'

export function Legend() {
  const { data: pollutants } = usePollutants()
  const pollutant = useUiStore(s => s.pollutant)
  const [open, setOpen] = useState(true)

  const scale = pollutants?.find(p => p.key === pollutant)?.scale ?? pollutant
  const info = SCALE_LABELS[scale] ?? SCALE_LABELS[pollutant]
  if (!info) return null

  return (
    <div style={styles.box}>
      <button onClick={() => setOpen(o => !o)} style={{ ...styles.header, marginBottom: open ? 8 : 0 }}>
        <span style={styles.label}>{info.label}</span>
        <span style={styles.chevron}>{open ? '▾' : '▸'}</span>
      </button>
      {open && info.stops.map(stop => (
        <div key={stop.value} style={styles.row}>
          <span style={{ ...styles.swatch, background: stop.color }} />
          <span style={styles.text}>{stop.value}</span>
        </div>
      ))}
    </div>
  )
}

const styles = {
  box: {
    position: 'absolute' as const,
    top: 60,
    right: 12,
    background: 'rgba(20,20,20,0.85)',
    borderRadius: 8,
    padding: '10px 12px',
    backdropFilter: 'blur(6px)',
    zIndex: 10,
    minWidth: 120,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    background: 'transparent',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
  },
  label: {
    color: '#aaa',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  chevron: {
    color: '#aaa',
    fontSize: 16,
    lineHeight: 1,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 3,
    flexShrink: 0,
  },
  text: {
    color: '#ddd',
    fontSize: 12,
  },
}
