// FE-7: Dynamic pollutant tabs from /v1/pollutants, grouped by sensor method
import { usePollutants } from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import type { Pollutant } from '../../api/types'

const GROUP_ORDER = ['PM', 'NOx', 'SOx', 'carbon'] as const

export function PollutantTabs() {
  const { data: pollutants, isLoading } = usePollutants()
  const pollutant = useUiStore(s => s.pollutant)
  const setPollutant = useUiStore(s => s.setPollutant)

  if (isLoading || !pollutants) return null

  const available = pollutants.filter(p => p.available)
  const aqi = available.find(p => p.key === 'aqi')
  const grouped = GROUP_ORDER.map(g => ({
    group: g,
    items: available.filter(p => p.group === g),
  })).filter(g => g.items.length > 0)

  return (
    <div style={styles.bar}>
      {aqi && (
        <span style={styles.group}>
          <Tab p={aqi} active={aqi.key === pollutant} onSelect={() => setPollutant(aqi.key)} />
        </span>
      )}
      {grouped.map(({ group, items }) => (
        <span key={group} style={styles.group}>
          {items.map(p => (
            <Tab key={p.key} p={p} active={p.key === pollutant} onSelect={() => setPollutant(p.key)} />
          ))}
        </span>
      ))}
    </div>
  )
}

function Tab({ p, active, onSelect }: { p: Pollutant; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      style={{
        ...styles.tab,
        background: active ? '#fff' : 'rgba(255,255,255,0.08)',
        color: active ? '#111' : '#ccc',
        fontWeight: active ? 700 : 400,
      }}
      title={`${p.label} (${p.unit})`}
    >
      {p.key === 'aqi' ? 'AQI' : p.label}
    </button>
  )
}

const styles = {
  bar: {
    position: 'absolute' as const,
    bottom: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: 4,
    background: 'rgba(20,20,20,0.85)',
    borderRadius: 8,
    padding: '6px 10px',
    backdropFilter: 'blur(6px)',
    zIndex: 10,
  },
  group: {
    display: 'flex',
    gap: 2,
    borderRight: '1px solid rgba(255,255,255,0.1)',
    paddingRight: 6,
    marginRight: 2,
  },
  tab: {
    border: 'none',
    borderRadius: 5,
    padding: '5px 10px',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  },
}
