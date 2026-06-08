// WS LiveConnection — alerts only. Demoted; optional in demo.
import type { Alert } from './types'

const BASE_WS = import.meta.env.VITE_API_BASE_URL?.replace(/^http/, 'ws') ?? ''

export type AlertListener = (alert: Alert) => void

export class LiveConnection {
  private ws: WebSocket | null = null
  private listeners = new Set<AlertListener>()
  private reconnectTimer = 0

  connect() {
    if (this.ws) return
    this.ws = new WebSocket(`${BASE_WS}/v1/ws/alerts`)
    this.ws.onmessage = e => {
      try {
        const alert: Alert = JSON.parse(e.data as string)
        this.listeners.forEach(fn => fn(alert))
      } catch {
        // ignore malformed frames
      }
    }
    this.ws.onclose = () => {
      this.ws = null
      this.reconnectTimer = window.setTimeout(() => this.connect(), 5000)
    }
  }

  disconnect() {
    clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
  }

  subscribe(fn: AlertListener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

export const liveConnection = new LiveConnection()
