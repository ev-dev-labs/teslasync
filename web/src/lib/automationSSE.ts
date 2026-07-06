/**
 * Lightweight SSE client for the automation events stream.
 * Separate from the global sseManager because this connects to
 * /api/v1/automations/events (a dedicated endpoint for automation lifecycle).
 *
 * Handles exponential backoff reconnect and typed event dispatch.
 * Auth is handled via ForwardAuth cookie (same-domain, automatic).
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
  onDisconnect: (listener: ConnectionListener) => void
  offDisconnect: (listener: ConnectionListener) => void
  getState: () => 'connected' | 'reconnecting'
}

const eventListeners = new Set<AutomationSSEListener>()
const connectListeners = new Set<ConnectionListener>()
const disconnectListeners = new Set<ConnectionListener>()
let source: EventSource | null = null
let state: 'connected' | 'reconnecting' = 'reconnecting'
let failCount = 0
let reconnectTimer: number | undefined
let connecting = false

// Capped exponential backoff: 1s → 2s → 4s → 8s → 16s → 32s → 60s (max)
const BASE_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 60000

const EVENT_TYPES: AutomationSSEEventType[] = [
  'automation.triggered',
  'automation.succeeded',
  'automation.failed',
  'automation.skipped',
  'automation.state_changed',
]

function emit(type: AutomationSSEEventType, data: AutomationEventData) {
  for (const fn of eventListeners) {
    try { fn(type, data) } catch (e) { console.error('AutomationSSE listener error:', e) }
  }
}

function notifyDisconnect() {
  for (const fn of disconnectListeners) {
    try { fn() } catch (e) { console.error('AutomationSSE disconnect listener error:', e) }
  }
}

function doConnect() {
  if (connecting) return
  connecting = true

  // A fresh connect supersedes any scheduled backoff reconnect. Without this
  // a subscribe() during the reconnect window races the pending timer and can
  // leave two overlapping EventSources open (the timer fires after we already
  // reconnected, tearing down the healthy stream).
  if (reconnectTimer !== undefined) {
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }

  if (source) {
    source.close()
    source = null
  }

  const es = new EventSource('/api/v1/automations/events')
  source = es

  es.addEventListener('connected', () => {
    state = 'connected'
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

    state = 'reconnecting'
    // Notify subscribers so live "connected" indicators can flip to
    // "reconnecting" during an outage. Without this the state only ever
    // transitions forward to 'connected' (via the 'connected' event) and
    // any status badge stays green through the entire disconnection.
    notifyDisconnect()
    const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, failCount - 1), MAX_BACKOFF_MS)
    reconnectTimer = window.setTimeout(() => {
      doConnect()
    }, backoff)
  }
}

export const automationSSE: AutomationSSEClient = {
  subscribe(listener) {
    eventListeners.add(listener)
    if (!source && !connecting) {
      doConnect()
    }
  },

  unsubscribe(listener) {
    eventListeners.delete(listener)
    // Fully tear down once the last subscriber leaves. This must run even when
    // `source` is null (i.e. we are mid-backoff between attempts): otherwise a
    // pending reconnect timer fires later and opens a zombie stream nobody is
    // listening to. It must also clear the `connecting` latch — a teardown that
    // happens before the server's `connected` event would otherwise leave
    // `connecting === true`, and the next subscribe() (`!source && !connecting`)
    // would never reopen the stream. Resetting `failCount` lets a later
    // subscribe() start the backoff schedule fresh from 1s.
    if (eventListeners.size === 0) {
      if (source) {
        source.close()
        source = null
      }
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      connecting = false
      failCount = 0
      state = 'reconnecting'
    }
  },

  onConnect(listener) {
    connectListeners.add(listener)
  },

  offConnect(listener) {
    connectListeners.delete(listener)
  },

  onDisconnect(listener) {
    disconnectListeners.add(listener)
  },

  offDisconnect(listener) {
    disconnectListeners.delete(listener)
  },

  getState() { return state },
}
