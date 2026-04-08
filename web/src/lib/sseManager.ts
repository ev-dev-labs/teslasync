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
  getState: () => 'connected' | 'reconnecting' | 'unavailable'
  connect: () => void
  disconnect: () => void
}

const listeners = new Map<SSEEventType, Set<SSEListener>>()
let source: EventSource | null = null
let state: 'connected' | 'reconnecting' | 'unavailable' = 'reconnecting'
let backoff = 1000
let failCount = 0
let reconnectTimer: number | undefined
let connecting = false

async function fetchSSEToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/v1/sse-token')
    if (!res.ok) return null
    const data = await res.json()
    return data.token || null
  } catch {
    return null
  }
}

function emit(event: SSEEventType, data?: unknown) {
  const subs = listeners.get(event)
  if (subs) {
    for (const fn of subs) {
      try { fn(data) } catch (e) { console.error('SSE listener error:', e) }
    }
  }
}

async function doConnect() {
  if (connecting) return
  connecting = true

  if (source) {
    source.close()
    source = null
  }

  const token = await fetchSSEToken()
  const url = token ? `/api/v1/events?token=${encodeURIComponent(token)}` : '/api/v1/events'

  const es = new EventSource(url)
  source = es

  es.addEventListener('connected', (e) => {
    state = 'connected'
    backoff = 1000
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

    if (failCount >= 5) {
      state = 'unavailable'
      emit('disconnected')
      return
    }

    state = 'reconnecting'
    emit('disconnected')

    backoff = Math.min(backoff * 2, 30000)
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
    if (!source && !connecting && state !== 'unavailable') {
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
