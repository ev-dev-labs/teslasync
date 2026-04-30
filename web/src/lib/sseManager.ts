/**
 * Singleton SSE connection manager.
 * Maintains ONE EventSource connection shared across all React hooks.
 * Hooks subscribe/unsubscribe via addEventListener/removeEventListener pattern.
 */

type SSEListener = (data: unknown) => void
type SSEEventType = 'vehicle_update' | 'alert' | 'export_status' | 'connected' | 'disconnected'

interface SSEManager {
  subscribe: (event: SSEEventType, listener: SSEListener) => void
  unsubscribe: (event: SSEEventType, listener: SSEListener) => void
  getState: () => 'connected' | 'reconnecting'
  connect: () => void
  disconnect: () => void
}

const listeners = new Map<SSEEventType, Set<SSEListener>>()
let source: EventSource | null = null
let state: 'connected' | 'reconnecting' = 'reconnecting'
let failCount = 0
let reconnectTimer: number | undefined
let connecting = false

// Capped exponential backoff: 1s → 2s → 4s → 8s → 16s → 32s → 60s (max)
const BASE_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 60000

function emit(event: SSEEventType, data?: unknown) {
  const subs = listeners.get(event)
  if (subs) {
    for (const fn of subs) {
      try { fn(data) } catch (e) { console.error('SSE listener error:', e) }
    }
  }
}

function doConnect() {
  if (connecting) return
  connecting = true

  if (source) {
    source.close()
    source = null
  }

  const es = new EventSource('/api/v1/events')
  source = es

  es.addEventListener('connected', (e) => {
    state = 'connected'
    failCount = 0
    connecting = false
    const data = JSON.parse(e.data)
    emit('connected', data)
  })

  es.addEventListener('vehicle_update', (e) => {
    emit('vehicle_update', JSON.parse(e.data))
  })

  es.addEventListener('alert', (e) => {
    emit('alert', JSON.parse(e.data))
  })

  es.addEventListener('export_status', (e) => {
    emit('export_status', JSON.parse(e.data))
  })

  es.addEventListener('heartbeat', () => {})

  es.onerror = () => {
    es.close()
    source = null
    connecting = false
    failCount++

    state = 'reconnecting'
    emit('disconnected')

    const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, failCount - 1), MAX_BACKOFF_MS)
    reconnectTimer = window.setTimeout(() => {
      doConnect()
    }, backoff)
  }
}

export const sseManager: SSEManager = {
  subscribe(event, listener) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event)!.add(listener)
    // Auto-connect on first subscriber
    if (!source && !connecting) {
      doConnect()
    }
  },

  unsubscribe(event, listener) {
    listeners.get(event)?.delete(listener)
    // Auto-disconnect when no subscribers remain
    const totalSubs = Array.from(listeners.values()).reduce((sum, s) => sum + s.size, 0)
    if (totalSubs === 0 && source) {
      source.close()
      source = null
      state = 'reconnecting'
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  },

  getState() { return state },

  connect() {
    if (!source && !connecting) doConnect()
  },

  disconnect() {
    if (source) { source.close(); source = null }
    if (reconnectTimer) clearTimeout(reconnectTimer)
    state = 'reconnecting'
    connecting = false
  },
}
