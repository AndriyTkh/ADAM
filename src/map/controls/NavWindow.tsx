// FE-6: Time navigation — DeepState-style top-left toolbar.
// Single-bucket nav + calendar date picker + range playback.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useUiStore } from '../../store/uiStore'
import { useTimerange } from '../../api/queries'
import {
  nowBucket, addMinutes, bucketISO,
  allowedSteps, clampStep, STEP_OPTIONS,
} from '../../lib/time'

const STEP_LABELS: Record<number, string> = { 10: '10m', 30: '30m', 60: '1h', 360: '6h', 1440: '1d' }
const SPEED_OPTIONS = [1, 2, 4] as const
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Su']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

// ── UTC date helpers (buckets are treated as UTC wall-clock, matching the form) ──
const p2 = (n: number) => String(n).padStart(2, '0')
function ddmmyyyy(iso: string): string {
  const d = new Date(iso)
  return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`
}
function hhmm(iso: string): string {
  const d = new Date(iso)
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
}
function startOfDayUTC(iso: string): number {
  const d = new Date(iso)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
}
function fromDatetimeLocal(val: string): string {
  return new Date(val + 'Z').toISOString().replace(/\.\d{3}Z$/, 'Z')
}
function buildTIndex(from: string, to: string, step: number): string[] {
  const result: string[] = []
  let cur = new Date(from).getTime()
  const end = new Date(to).getTime()
  while (cur <= end) {
    result.push(new Date(cur).toISOString().replace(/\.\d{3}Z$/, 'Z'))
    cur += step * 60_000
  }
  return result
}

// ── Icons ────────────────────────────────────────────────────────────────────
const Icon = {
  Play: () => <svg width="13" height="13" viewBox="0 0 12 12"><path d="M3 2l7 4-7 4z" fill="currentColor" /></svg>,
  Pause: () => <svg width="13" height="13" viewBox="0 0 12 12"><rect x="3" y="2" width="2.4" height="8" fill="currentColor" /><rect x="6.6" y="2" width="2.4" height="8" fill="currentColor" /></svg>,
  Prev: () => <svg width="14" height="14" viewBox="0 0 14 14"><path d="M9 3L5 7l4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  Next: () => <svg width="14" height="14" viewBox="0 0 14 14"><path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  Cal: () => <svg width="15" height="15" viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M2.5 6.2h11M5.5 2.2v2.4M10.5 2.2v2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  Range: () => <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 6h7M6 3.5L9 6 6 8.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M14 10H7M10 7.5L7 10l3 2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>,
}

export function NavWindow() {
  const timeState = useUiStore(s => s.timeState)
  const setTimeState = useUiStore(s => s.setTimeState)
  const bufferState = useUiStore(s => s.bufferState)
  const singlePlaying = useUiStore(s => s.singlePlaying)
  const setSinglePlaying = useUiStore(s => s.setSinglePlaying)
  const singleSpeed = useUiStore(s => s.singleSpeed)
  const setSingleSpeed = useUiStore(s => s.setSingleSpeed)
  const { data: timerange } = useTimerange()

  const mode = timeState.mode
  const nowB = nowBucket()

  const [calOpen, setCalOpen] = useState(false)

  // Resolved current instant (live → now bucket)
  const curT = mode === 'single'
    ? (timeState.t === 'live' ? nowB : timeState.t)
    : timeState.currentT

  // Range setup form state
  const defaultFrom = useMemo(
    () => timerange ? addMinutes(timerange.to, -6 * 60) : addMinutes(nowB, -6 * 60),
    [timerange, nowB],
  )
  const defaultTo = timerange?.to ?? nowB
  const [rfFrom, setRfFrom] = useState(() => mode === 'range' ? timeState.from : defaultFrom)
  const [rfTo, setRfTo] = useState(() => mode === 'range' ? timeState.to : defaultTo)
  const [rfStep, setRfStep] = useState(() => mode === 'range' ? timeState.step : 30)

  const rMins = (new Date(rfTo).getTime() - new Date(rfFrom).getTime()) / 60_000
  const allowed = allowedSteps(rMins)
  const safeStep = clampStep(rfStep, rMins)
  const tIndex = useMemo(() => buildTIndex(rfFrom, rfTo, safeStep), [rfFrom, rfTo, safeStep])

  // ── Single-mode auto-advance ────────────────────────────────────────────────
  // The step advance is NOT timed here — it is driven by VehiclesLayer's leg
  // pacemaker, which advances `t` only once the cars finish driving their
  // sub-point leg (end position == next leg's start, per the DB sync). This
  // keeps the grid/vehicle swap aligned and teleport-free. See VehiclesLayer.

  // Auto-stop single playback whenever we leave single mode
  useEffect(() => {
    if (mode !== 'single' && singlePlaying) setSinglePlaying(false)
  }, [mode, singlePlaying, setSinglePlaying])

  // ── Unified controls ──────────────────────────────────────────────────────
  const playing = mode === 'range' ? timeState.playing : singlePlaying
  const speed = mode === 'range' ? timeState.speed : singleSpeed

  function togglePlay() {
    if (mode === 'range') setTimeState({ ...timeState, playing: !timeState.playing })
    else setSinglePlaying(!singlePlaying)
  }
  function cycleSpeed() {
    const idx = SPEED_OPTIONS.indexOf(speed as 1)
    const nextSpeed = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length]
    if (mode === 'range') setTimeState({ ...timeState, speed: nextSpeed })
    else setSingleSpeed(nextSpeed)
  }

  const currentIdx = mode === 'range' ? Math.max(0, tIndex.indexOf(timeState.currentT)) : 0

  // Single-mode stepping: the date label moves on EVERY click instantly, but the
  // backend fetches (keyed on the committed timeState.t) fire only 1s after clicks
  // stop. optimisticT holds the displayed-but-uncommitted instant during a burst.
  const [optimisticT, setOptimisticT] = useState<string | null>(null)
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function scheduleCommit(t: string) {
    if (commitTimerRef.current !== null) clearTimeout(commitTimerRef.current)
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null
      setTimeState({ mode: 'single', t, step: timeState.mode === 'single' ? timeState.step : 10 })
    }, 1000)
  }
  function cancelCommit() {
    if (commitTimerRef.current !== null) { clearTimeout(commitTimerRef.current); commitTimerRef.current = null }
    setOptimisticT(null)
  }
  // Any committed timeState change (commit, calendar, live, pacemaker) clears the overlay.
  useEffect(() => { setOptimisticT(null) }, [timeState])
  useEffect(() => () => { if (commitTimerRef.current !== null) clearTimeout(commitTimerRef.current) }, [])

  function stepSingle(dir: -1 | 1) {
    if (timeState.mode !== 'single') return
    const base = optimisticT ?? (timeState.t === 'live' ? nowB : timeState.t)
    const next = addMinutes(base, dir * timeState.step)
    if (dir > 0 && next > nowB) return   // never step past live
    setOptimisticT(next)                 // instant label update
    scheduleCommit(next)                 // backend request fires 1s after clicks stop
  }
  function scrub(idx: number) {
    if (mode !== 'range') return
    const clamped = Math.max(0, Math.min(idx, tIndex.length - 1))
    setTimeState({ ...timeState, playing: false, currentT: tIndex[clamped] ?? timeState.currentT })
  }

  function setStep(step: number) {
    cancelCommit()
    if (mode === 'single') setTimeState({ ...timeState, step })
  }
  function goLive() {
    cancelCommit()
    setSinglePlaying(false)
    const step = mode === 'single' ? timeState.step : 10
    setTimeState({ mode: 'single', t: 'live', step })
  }

  // ── Range enter/exit (⇄) ──────────────────────────────────────────────────
  function toggleRange() {
    cancelCommit()
    setCalOpen(false)
    if (mode === 'range') { setTimeState({ mode: 'single', t: 'live', step: 10 }); return }
    setSinglePlaying(false)
    setTimeState({
      mode: 'range', from: rfFrom, to: rfTo, step: safeStep,
      playing: false, speed: 1, currentT: tIndex[0] ?? rfFrom,
    })
  }
  function reloadRange() {
    if (mode !== 'range') return
    setTimeState({
      mode: 'range', from: rfFrom, to: rfTo, step: safeStep,
      playing: false, speed: 1, currentT: tIndex[0] ?? rfFrom,
    })
  }

  // ── Calendar pick ──────────────────────────────────────────────────────────
  function pickDay(y: number, m: number, d: number) {
    cancelCommit()
    const base = new Date(curT)
    const nd = new Date(Date.UTC(y, m, d, base.getUTCHours(), base.getUTCMinutes()))
    const iso = bucketISO(nd)
    setSinglePlaying(false)
    setTimeState({ mode: 'single', t: iso, step: mode === 'single' ? timeState.step : 10 })
    setCalOpen(false)
  }

  const displayT = optimisticT ?? curT   // label follows optimistic step during a burst
  const isLive = optimisticT === null && timeState.mode === 'single' && timeState.t === 'live'

  return (
    <div style={styles.wrap}>
      <div style={styles.bar}>
        <button onClick={togglePlay} style={styles.iconBtn} title={playing ? 'Pause' : 'Play'}>
          <span style={{ color: playing ? '#7aacff' : '#6ad06a' }}>
            {playing ? <Icon.Pause /> : <Icon.Play />}
          </span>
        </button>

        <button onClick={cycleSpeed} style={styles.speedBtn} title="Playback speed">
          {speed}×
        </button>

        <div style={styles.sep} />

        <button onClick={() => mode === 'range' ? scrub(currentIdx - 1) : stepSingle(-1)} style={styles.iconBtn} title="Previous"><Icon.Prev /></button>

        <button
          onClick={() => mode === 'single' && setCalOpen(o => !o)}
          style={{ ...styles.dateBtn, cursor: mode === 'single' ? 'pointer' : 'default' }}
          title={mode === 'single' ? 'Pick date' : undefined}
        >
          <span style={{ ...styles.dateText, color: isLive ? '#6ad06a' : '#e6c98a' }}>{ddmmyyyy(displayT)}</span>
          <span style={styles.timeText}>{hhmm(displayT)}</span>
        </button>

        <button onClick={() => mode === 'range' ? scrub(currentIdx + 1) : stepSingle(1)} style={styles.iconBtn} title="Next"><Icon.Next /></button>

        <div style={styles.sep} />

        <button
          onClick={() => mode === 'single' && setCalOpen(o => !o)}
          style={{ ...styles.iconBtn, ...(calOpen ? styles.iconBtnActive : {}), opacity: mode === 'single' ? 1 : 0.4 }}
          title="Calendar"
        ><Icon.Cal /></button>

        {/* Bulk range-fetch is disabled in the demo (overloads the backend's
            free-tier memory) — only render an exit affordance for anyone who
            lands here via a deep-linked range-mode URL, no entry point. */}
        {mode === 'range' && (
          <button
            onClick={toggleRange}
            style={{ ...styles.iconBtn, ...styles.iconBtnActive }}
            title="Exit range"
          ><Icon.Range /></button>
        )}
      </div>

      {/* ── Range second row ─────────────────────────────────────────────── */}
      {mode === 'range' && (
        <div style={styles.panel}>
          <div style={styles.scrubRow}>
            <input
              type="range" min={0} max={Math.max(0, tIndex.length - 1)} value={currentIdx}
              onChange={e => scrub(Number(e.target.value))} style={styles.scrubber}
            />
            <span style={styles.dim}>→ {ddmmyyyy(timeState.to)} {hhmm(timeState.to)}</span>
          </div>
          <div style={styles.cfgRow}>
            <label style={styles.label}>From</label>
            <input type="datetime-local" value={toDatetimeLocal(rfFrom)}
              min={timerange ? toDatetimeLocal(timerange.from) : undefined} max={toDatetimeLocal(rfTo)}
              onChange={e => setRfFrom(fromDatetimeLocal(e.target.value))} style={styles.input} />
            <label style={styles.label}>To</label>
            <input type="datetime-local" value={toDatetimeLocal(rfTo)}
              min={toDatetimeLocal(rfFrom)} max={timerange ? toDatetimeLocal(timerange.to) : undefined}
              onChange={e => setRfTo(fromDatetimeLocal(e.target.value))} style={styles.input} />
            <select value={rfStep} onChange={e => setRfStep(Number(e.target.value))} style={styles.select}>
              {STEP_OPTIONS.map(s => (
                <option key={s} value={s} disabled={!allowed.includes(s as 10)}>
                  {STEP_LABELS[s]}{!allowed.includes(s as 10) ? ' ✕' : ''}
                </option>
              ))}
            </select>
            <button onClick={reloadRange} style={styles.loadBtn}>Load →</button>
            {bufferState && bufferState.loaded < bufferState.total && (
              <span style={styles.buf}>buf {Math.round((bufferState.loaded / Math.max(bufferState.total, 1)) * 100)}%</span>
            )}
          </div>
        </div>
      )}

      {/* ── Single-mode step selector + Live ─────────────────────────────── */}
      {mode === 'single' && (
        <div style={styles.subBar}>
          <button onClick={goLive} style={{ ...styles.pill, ...(isLive ? styles.pillGreen : {}) }}>Live</button>
          <span style={styles.stepLabel}>Step</span>
          {STEP_OPTIONS.map(s => (
            <button key={s} onClick={() => setStep(s)}
              style={{ ...styles.pill, ...(timeState.step === s ? styles.pillActive : {}) }}>
              {STEP_LABELS[s]}
            </button>
          ))}
        </div>
      )}

      {/* ── Calendar popup ────────────────────────────────────────────────── */}
      {calOpen && mode === 'single' && (
        <Calendar
          valueIso={curT}
          minIso={timerange?.from}
          maxIso={timerange?.to ?? nowB}
          onPick={pickDay}
          onToday={() => pickDay(
            new Date(nowB).getUTCFullYear(), new Date(nowB).getUTCMonth(), new Date(nowB).getUTCDate())}
          onClose={() => setCalOpen(false)}
        />
      )}
    </div>
  )
}

// ── Calendar popup ────────────────────────────────────────────────────────────
function Calendar({ valueIso, minIso, maxIso, onPick, onToday, onClose }: {
  valueIso: string
  minIso?: string
  maxIso?: string
  onPick: (y: number, m: number, d: number) => void
  onToday: () => void
  onClose: () => void
}) {
  const sel = new Date(valueIso)
  const [vy, setVy] = useState(sel.getUTCFullYear())
  const [vm, setVm] = useState(sel.getUTCMonth())

  const today = new Date(nowBucket())
  const lo = minIso ? startOfDayUTC(minIso) : -Infinity
  const hi = maxIso ? startOfDayUTC(maxIso) : Infinity

  const firstDow = (new Date(Date.UTC(vy, vm, 1)).getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(vy, vm + 1, 0)).getUTCDate()
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  function shiftMonth(delta: number) {
    const nm = vm + delta
    setVy(vy + Math.floor(nm / 12))
    setVm(((nm % 12) + 12) % 12)
  }
  const isSel = (d: number) => sel.getUTCFullYear() === vy && sel.getUTCMonth() === vm && sel.getUTCDate() === d
  const isToday = (d: number) => today.getUTCFullYear() === vy && today.getUTCMonth() === vm && today.getUTCDate() === d
  const disabled = (d: number) => { const t = Date.UTC(vy, vm, d); return t < lo || t > hi }

  return (
    <div style={styles.cal}>
      <div style={styles.calHead}>
        <span style={styles.calTitle}>{MONTHS[vm]} <span style={styles.calYear}>{vy}</span></span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => shiftMonth(-1)} style={styles.calNav}>←</button>
          <button onClick={() => shiftMonth(1)} style={styles.calNav}>→</button>
          <button onClick={onClose} style={styles.calNav}>✕</button>
        </div>
      </div>
      <div style={styles.calGrid}>
        {WEEKDAYS.map(w => <div key={w} style={styles.calWd}>{w}</div>)}
        {cells.map((d, i) => d === null
          ? <div key={`e${i}`} />
          : (
            <button
              key={d}
              disabled={disabled(d)}
              onClick={() => onPick(vy, vm, d)}
              style={{
                ...styles.calDay,
                ...(isSel(d) ? styles.calDaySel : {}),
                ...(disabled(d) ? styles.calDayDisabled : {}),
              }}
            >
              {d}
              {isToday(d) && <span style={styles.calDot} />}
            </button>
          ))}
      </div>
      <button onClick={onToday} style={styles.calToday}>Today</button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    position: 'absolute', top: 60, left: 12, zIndex: 10,
    display: 'flex', flexDirection: 'column', gap: 8, width: 'max-content',
  },
  bar: {
    display: 'flex', alignItems: 'center', gap: 2,
    background: 'rgba(20,22,26,0.92)', backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10,
    padding: '5px 6px', boxShadow: '0 4px 18px rgba(0,0,0,0.5)',
  },
  iconBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none', color: '#9aa3ad',
    width: 28, height: 28, borderRadius: 7, cursor: 'pointer', padding: 0,
  },
  iconBtnActive: { background: 'rgba(122,172,255,0.18)', color: '#7aacff' },
  speedBtn: {
    background: 'transparent', border: 'none', color: '#7aacff',
    fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '0 6px', minWidth: 26,
  },
  sep: { width: 1, height: 18, background: 'rgba(255,255,255,0.08)', margin: '0 3px' },
  dateBtn: {
    display: 'flex', alignItems: 'baseline', gap: 6,
    background: 'transparent', border: 'none', padding: '0 4px',
  },
  dateText: { fontSize: 15, fontWeight: 600, letterSpacing: 0.5, fontVariantNumeric: 'tabular-nums' },
  timeText: { fontSize: 12, color: '#6b7480', fontVariantNumeric: 'tabular-nums' },

  subBar: {
    display: 'flex', alignItems: 'center', gap: 4,
    background: 'rgba(20,22,26,0.86)', backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10,
    padding: '5px 8px', width: 'fit-content',
  },
  stepLabel: { color: '#5b636d', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 2px 0 6px' },
  pill: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
    color: '#aab2bb', borderRadius: 6, padding: '3px 9px', fontSize: 12, cursor: 'pointer',
  },
  pillActive: { background: 'rgba(255,255,255,0.16)', color: '#fff', borderColor: 'rgba(255,255,255,0.2)' },
  pillGreen: { background: 'rgba(50,200,80,0.18)', color: '#6ad06a', borderColor: 'rgba(50,200,80,0.3)' },

  panel: {
    display: 'flex', flexDirection: 'column', gap: 8,
    background: 'rgba(20,22,26,0.9)', backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10,
    padding: '8px 10px', minWidth: 340,
  },
  scrubRow: { display: 'flex', alignItems: 'center', gap: 8 },
  scrubber: { flex: 1, accentColor: '#7aacff' },
  cfgRow: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  label: { color: '#5b636d', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 },
  dim: { color: '#5b636d', fontSize: 12, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  input: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#ccc', borderRadius: 5, padding: '3px 6px', fontSize: 11, colorScheme: 'dark',
  },
  select: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#ccc', borderRadius: 5, padding: '3px 6px', fontSize: 12, cursor: 'pointer',
  },
  loadBtn: {
    background: 'rgba(60,120,240,0.28)', border: '1px solid rgba(60,120,240,0.5)',
    color: '#7aacff', borderRadius: 5, padding: '3px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  buf: { color: '#f90', fontSize: 11, whiteSpace: 'nowrap' },

  // Calendar
  cal: {
    background: 'rgba(20,22,26,0.96)', backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12,
    padding: 14, width: 300, boxShadow: '0 8px 28px rgba(0,0,0,0.6)',
  },
  calHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  calTitle: { color: '#e6c98a', fontSize: 17, fontWeight: 700 },
  calYear: { color: '#fff' },
  calNav: {
    background: 'rgba(255,255,255,0.06)', border: 'none', color: '#cbd2da',
    width: 26, height: 26, borderRadius: 7, cursor: 'pointer', fontSize: 14,
  },
  calGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 10 },
  calWd: { color: '#5b636d', fontSize: 11, fontWeight: 700, textAlign: 'center', padding: '4px 0' },
  calDay: {
    position: 'relative', background: 'transparent', border: 'none', color: '#d4dae1',
    aspectRatio: '1', borderRadius: 8, cursor: 'pointer', fontSize: 13,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  calDaySel: { background: 'rgba(255,255,255,0.14)', color: '#fff', fontWeight: 700 },
  calDayDisabled: { color: '#3a4047', cursor: 'not-allowed' },
  calDot: {
    position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)',
    width: 4, height: 4, borderRadius: '50%', background: '#e6554d',
  },
  calToday: {
    width: '100%', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
    color: '#d4dae1', borderRadius: 9, padding: '9px 0', fontSize: 14, cursor: 'pointer',
  },
}
