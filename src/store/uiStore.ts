import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { PollutantKey, TimeState } from '../api/types'
import { nowBucket } from '../lib/time'
import { decodeUrlState, pushUrlState } from '../lib/urlState'

interface PinLocation {
  lat: number
  lng: number
}

export interface BufferState {
  loaded: number
  total: number
}

interface UiState {
  pollutant: PollutantKey
  timeState: TimeState
  pin: PinLocation | null
  sidebarOpen: boolean
  bufferState: BufferState | null
  selectedVehicle: string | null
  singlePlaying: boolean
  singleSpeed: number

  setPollutant: (key: PollutantKey) => void
  setTimeState: (ts: TimeState) => void
  setPin: (pin: PinLocation | null) => void
  setSidebarOpen: (open: boolean) => void
  setBufferState: (s: BufferState | null) => void
  setSelectedVehicle: (id: string | null) => void
  setSinglePlaying: (b: boolean) => void
  setSingleSpeed: (n: number) => void
}

function initialState(): Pick<UiState, 'pollutant' | 'timeState' | 'pin' | 'sidebarOpen' | 'bufferState' | 'selectedVehicle' | 'singlePlaying' | 'singleSpeed'> {
  const fromUrl = decodeUrlState(location.search)
  return {
    pollutant: fromUrl.pollutant ?? 'aqi',
    timeState: fromUrl.timeState ?? {
      mode: 'single',
      t: 'live',
      step: 10,
    },
    pin: null,
    sidebarOpen: false,
    bufferState: null,
    selectedVehicle: null,
    singlePlaying: false,
    singleSpeed: 1,
  }
}

export const useUiStore = create<UiState>()(
  subscribeWithSelector((set, get) => ({
    ...initialState(),

    setPollutant(key) {
      set({ pollutant: key })
      pushUrlState({ pollutant: key, timeState: get().timeState })
    },

    setTimeState(ts) {
      set({ timeState: ts })
      pushUrlState({ pollutant: get().pollutant, timeState: ts })
    },

    setPin(pin) {
      set({ pin })
    },

    setSidebarOpen(open) {
      set({ sidebarOpen: open })
    },

    setBufferState(s) {
      set({ bufferState: s })
    },

    setSelectedVehicle(id) {
      set({ selectedVehicle: id })
    },

    setSinglePlaying(b) {
      set({ singlePlaying: b })
    },

    setSingleSpeed(n) {
      set({ singleSpeed: n })
    },
  })),
)

// Helper selectors
export const selectCurrentT = (s: UiState): string =>
  s.timeState.mode === 'single'
    ? s.timeState.t === 'live'
      ? nowBucket()
      : s.timeState.t
    : s.timeState.currentT
