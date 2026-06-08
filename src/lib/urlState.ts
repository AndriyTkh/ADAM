// URL deep-link: encode/decode {pollutant, t, mode, from, to, step} ↔ query string

import type { PollutantKey, TimeState } from '../api/types'

export interface UrlState {
  pollutant: PollutantKey
  timeState: TimeState
}

export function encodeUrlState(state: UrlState): string {
  const p = new URLSearchParams()
  p.set('p', state.pollutant)
  const ts = state.timeState
  if (ts.mode === 'single') {
    p.set('m', 's')
    p.set('t', ts.t)
    p.set('step', String(ts.step))
  } else {
    p.set('m', 'r')
    p.set('from', ts.from)
    p.set('to', ts.to)
    p.set('step', String(ts.step))
    p.set('ct', ts.currentT)
  }
  return p.toString()
}

export function decodeUrlState(search: string): Partial<UrlState> {
  const p = new URLSearchParams(search)
  const pollutant = (p.get('p') ?? 'aqi') as PollutantKey
  const mode = p.get('m')

  if (mode === 'r') {
    const from = p.get('from')
    const to = p.get('to')
    const currentT = p.get('ct')
    if (from && to && currentT) {
      return {
        pollutant,
        timeState: {
          mode: 'range',
          from,
          to,
          step: Number(p.get('step') ?? 10),
          playing: false,
          speed: 1,
          currentT,
        },
      }
    }
  }

  return {
    pollutant,
    timeState: {
      mode: 'single',
      t: p.get('t') ?? 'live',
      step: Number(p.get('step') ?? 10),
    },
  }
}

export function pushUrlState(state: UrlState) {
  const encoded = encodeUrlState(state)
  const url = `${location.pathname}?${encoded}`
  history.replaceState(null, '', url)
}
