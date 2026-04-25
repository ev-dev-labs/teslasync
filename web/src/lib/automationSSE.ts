/**
 * Lightweight SSE client for the automation events stream.
 * Separate from the global sseManager because this connects to
 * /api/v1/automations/events (a dedicated endpoint for automation lifecycle).
 *
 * Handles token-based auth (same pattern as sseManager), exponential
 * backoff reconnect, and typed event dispatch.
 */

import type {
  AutomationTriggeredEvent,
  AutomationSucceededEvent,
  AutomationFailedEvent,
  AutomationSkippedEvent,
  AutomationStateChangedEvent,
  AutomationSSEEventType,
} from '../api/types'

type AutomationEventData =
  | AutomationTriggeredEvent
  | AutomationSucceededEvent
  | AutomationFailedEvent
  | AutomationSkippedEvent
  | AutomationStateChangedEvent

export type AutomationSSEListener = (type: AutomationSSEEventType, data: AutomationEventData) => void
type ConnectionListener = () => void

interface AutomationSSEClient {
  subscribe: (listener: AutomationSSEListener) => void
  unsubscribe: (listener: AutomationSSEListener) => void
  onConnect: (listener: ConnectionListener) => void
  offConnect: (listener: ConnectionListener) => void
  getState: () => 'connected' | 'reconnecting' | 'unavailable'
}

const eventListeners = new Set<AutomationSSEListener>()
const connectListeners = new Set<ConnectionListener>()
let source: EventSource | null = null
let state: 'connected' | 'reconnecting' | 'unavailable' = 'reconnecting'
let backoff = 1000
let failCount = 0
let reconnectTimer: number | undefined
let connecting = false

const EVENT_TYPES: AutomationSSEEventType[] = [
  'automation.triggered',
  'automation.succeeded',
  'automation.failed',
  'automation.skipped',
  'automation.state_changed',
]

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

function emit(type: AutomationSSEEventType, data: AutomationEventData) {
  for (const fn of eventListeners) {
    try { fn(type, data) } catch (e) { console.error('AutomationSSE listener error:', e) }
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
  // SECURITY NOTE: Token is passed via query string because the browser EventSource API
  // does not support custom headers. This is a known limitation of SSE.
  // Mitigations:
  // - Tokens are short-lived (scoped to SSE session)
  // - Server logs should be configured to redact query parameters
  // - Consider migrating to WebSocket (which supports headers) if this becomes a concern
  const url = token
    ? `/api/v1/automations/events?token=${encodeURIComponent(token)}`
    : '/api/v1/automations/events'

  const es = new EventSource(url)
  source = es

  es.addEventListener('connected', () => {
    state = 'connected'
    backoff = 1000
    failCount = 0
    connecting = false
    for (const fn of connectListeners) {
      try { fn() } catch (e) { console.error('AutomationSSE connect listener error:', e) }
    }
  })

  for (const eventType of EVENT_TYPES) {
    es.addEventListener(eventType, (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as AutomationEventData
        emit(eventType, data)
      } catch (err) {
        console.error(`AutomationSSE: failed to parse ${eventType}:`, err)
      }
    })
  }

  es.addEventListener('heartbeat', () => {})

  es.onerror = () => {
    es.close()
    source = null
    connecting = false
    failCount++

    if (failCount >= 5) {
      state = 'unavailable'
      return
    }

    state = 'reconnecting'
    backoff = Math.min(backoff * 2, 30000)
    reconnectTimer = window.setTimeout(() => {
      doConnect()
    }, backoff)
  }
}

export const automationSSE: AutomationSSEClient = {
  subscribe(listener) {
    eventListeners.add(listener)
    if (!source && !connecting && state !== 'unavailable') {
      doConnect()
    }
  },

  unsubscribe(listener) {
    eventListeners.delete(listener)
    // Auto-disconnect when no subscribers remain
    if (eventListeners.size === 0 && source) {
      source.close()
      source = null
      state = 'reconnecting'
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  },

  onConnect(listener) {
    connectListeners.add(listener)
  },

  offConnect(listener) {
    connectListeners.delete(listener)
  },

  getState() { return state },
}
