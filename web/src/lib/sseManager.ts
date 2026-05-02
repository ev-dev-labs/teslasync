/**
 * Singleton SSE connection manager.
 * Maintains ONE EventSource connection shared across all React hooks.
 * Hooks subscribe/unsubscribe via addEventListener/removeEventListener pattern.
 *
 * In addition to dispatching named events, the manager tracks two pieces of
 * cross-app live-pipe metadata that `useLiveConnection` (web/src/hooks/
 * useLiveConnection.ts) consumes to render `<LiveIndicator>`:
 *   - `lastMessageAt`: the wall-clock time we last received any message
 *     FROM THE SERVER (heartbeat or otherwise). Used to render a "last
 *     update Xs ago" timestamp. Synthetic `disconnected` events do NOT
 *     update this — only real server traffic does.
 *   - `hasEverConnected`: app-wide flag that flips true the first time we
 *     successfully receive a `connected` event. Used so a page that mounts
 *     during an outage shows "disconnected" rather than "unknown" if the
 *     app has been live earlier in the session.
 */

type SSEListener = (data: unknown) => void
type SSEEventType =
  | 'vehicle_update'
  | 'alert'
  | 'export_status'
  | 'achievement_unlocked'
  | 'connected'
  | 'disconnected'
  | 'heartbeat'

interface SSEManager {
  subscribe: (event: SSEEventType, listener: SSEListener) => void
  unsubscribe: (event: SSEEventType, listener: SSEListener) => void
  getState: () => 'connected' | 'reconnecting'
  /** Timestamp (ms epoch) of the last real server message, or null. */
  getLastMessageAt: () => number | null
  /** True once a `connected` event has been received at least once this session. */
  hasEverConnected: () => boolean
  connect: () => void
  disconnect: () => void
}

const listeners = new Map<SSEEventType, Set<SSEListener>>()
let source: EventSource | null = null
let state: 'connected' | 'reconnecting' = 'reconnecting'
let failCount = 0
let reconnectTimer: number | undefined
let connecting = false
let lastMessageAt: number | null = null
let everConnected = false

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

/** Mark that a real server message just arrived (used for freshness). */
function markServerMessage() {
  lastMessageAt = Date.now()
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
    everConnected = true
    markServerMessage()
    const data = JSON.parse(e.data)
    emit('connected', data)
  })

  es.addEventListener('vehicle_update', (e) => {
    markServerMessage()
    emit('vehicle_update', JSON.parse(e.data))
  })

  es.addEventListener('alert', (e) => {
    markServerMessage()
    emit('alert', JSON.parse(e.data))
  })

  es.addEventListener('export_status', (e) => {
    markServerMessage()
    emit('export_status', JSON.parse(e.data))
  })

  // Phase-40 / Prompt 63: real-time achievement unlocks. The lifetime handler
  // broadcasts one event per locked → unlocked transition; consumers fire a
  // celebration toast + confetti animation in response.
  es.addEventListener('achievement_unlocked', (e) => {
    markServerMessage()
    emit('achievement_unlocked', JSON.parse(e.data))
  })

  es.addEventListener('heartbeat', (e) => {
    markServerMessage()
    let payload: unknown = null
    try { payload = e.data ? JSON.parse(e.data) : null } catch { payload = null }
    emit('heartbeat', payload)
  })

  es.onerror = () => {
    es.close()
    source = null
    connecting = false
    failCount++

    state = 'reconnecting'
    // Note: do NOT touch lastMessageAt here — this is a synthetic transition,
    // not a server message. UI consumers ("last update Xs ago") would lie if
    // we bumped it on disconnect.
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
    if (totalSubs === 0) {
      if (source) {
        source.close()
        source = null
      }
      // Reset connection bookkeeping so a future subscribe re-opens cleanly
      // (previously `connecting` could stay true if the last subscriber left
      // mid-connect, leaving the next subscriber unable to reconnect).
      state = 'reconnecting'
      connecting = false
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
    }
  },

  getState() { return state },

  getLastMessageAt() { return lastMessageAt },

  hasEverConnected() { return everConnected },

  connect() {
    if (!source && !connecting) doConnect()
  },

  disconnect() {
    if (source) { source.close(); source = null }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
    state = 'reconnecting'
    connecting = false
  },
}
