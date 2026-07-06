import { useEffect, useRef, useState, useCallback } from 'react'
import { automationSSE, type AutomationSSEListener } from '../lib/automationSSE'
import type {
  AutomationSSEEventType,
  AutomationTriggeredEvent,
  AutomationSucceededEvent,
  AutomationFailedEvent,
  AutomationSkippedEvent,
  AutomationStateChangedEvent,
} from '@/api/types'

/** A single automation SSE event with its type and receive timestamp. */
export interface AutomationActivityEvent {
  id: string
  type: AutomationSSEEventType
  data:
    | AutomationTriggeredEvent
    | AutomationSucceededEvent
    | AutomationFailedEvent
    | AutomationSkippedEvent
    | AutomationStateChangedEvent
  receivedAt: Date
}

interface UseAutomationEventsOptions {
  /** Maximum number of recent events to keep (default: 50). */
  maxEvents?: number
  /** Whether the hook is active (default: true). */
  enabled?: boolean
  /** Filter to only live or test mode events. Null = all. */
  modeFilter?: 'live' | 'test' | null
}

interface UseAutomationEventsReturn {
  /** Recent automation events in reverse chronological order. */
  events: AutomationActivityEvent[]
  /** SSE connection state. */
  connectionState: 'connected' | 'reconnecting'
  /** Set of automation IDs that have fired recently (within last 5 seconds). */
  firingNow: Set<number>
  /** Clear the event history. */
  clearEvents: () => void
}

let eventCounter = 0

/** Default cap on retained events when the caller doesn't override it. */
const DEFAULT_MAX_EVENTS = 50

/**
 * How long an automation remains in the "firing now" set after a
 * `triggered` event before it auto-clears — unless a terminal event
 * (succeeded / failed / skipped) arrives first.
 */
const FIRING_INDICATOR_TTL_MS = 5000

/**
 * React hook for real-time automation SSE events.
 * Subscribes to the dedicated automation events stream.
 */
export function useAutomationEvents(
  options: UseAutomationEventsOptions = {},
): UseAutomationEventsReturn {
  const { enabled = true, modeFilter = null } = options
  const [events, setEvents] = useState<AutomationActivityEvent[]>([])
  const [connectionState, setConnectionState] = useState<'connected' | 'reconnecting'>(
    () => automationSSE.getState(),
  )
  const [firingNow, setFiringNow] = useState<Set<number>>(new Set())
  const firingTimers = useRef<Map<number, number>>(new Map())
  const optsRef = useRef(options)
  optsRef.current = options

  const clearEvents = useCallback(() => setEvents([]), [])

  useEffect(() => {
    // Reset the transient "firing now" indicators whenever the
    // subscription is (re)configured or torn down. The per-automation
    // auto-clear timers below live for the lifetime of a single
    // subscription and are disposed in cleanup; without this reset a
    // modeFilter change (or disabling the hook) would strand entries in
    // `firingNow` that can never drain — their timers are already gone.
    setFiringNow((prev) => (prev.size === 0 ? prev : new Set()))

    if (!enabled) return

    const listener: AutomationSSEListener = (type, data) => {
      const mode = 'mode' in data ? data.mode : undefined
      if (modeFilter && mode && mode !== modeFilter) return

      const event: AutomationActivityEvent = {
        id: `ae-${++eventCounter}`,
        type,
        data,
        receivedAt: new Date(),
      }

      setEvents((prev) => {
        const max = optsRef.current.maxEvents ?? DEFAULT_MAX_EVENTS
        const next = [event, ...prev]
        return next.length > max ? next.slice(0, max) : next
      })

      // Track "firing now" for triggered events — auto-clear after a TTL.
      if (type === 'automation.triggered') {
        const automationId = (data as AutomationTriggeredEvent).automation_id
        // Guard against malformed payloads: events originate from
        // JSON.parse in automationSSE, so a missing / non-numeric id would
        // otherwise poison the Set and leak an orphan timer.
        if (!Number.isFinite(automationId)) return

        setFiringNow((prev) => {
          if (prev.has(automationId)) return prev
          const next = new Set(prev)
          next.add(automationId)
          return next
        })

        // Reset any in-flight auto-clear timer for this automation.
        const existing = firingTimers.current.get(automationId)
        if (existing) clearTimeout(existing)

        const timer = window.setTimeout(() => {
          setFiringNow((prev) => {
            if (!prev.has(automationId)) return prev
            const next = new Set(prev)
            next.delete(automationId)
            return next
          })
          firingTimers.current.delete(automationId)
        }, FIRING_INDICATOR_TTL_MS)
        firingTimers.current.set(automationId, timer)
        return
      }

      // Clear firing state on terminal events.
      if (
        type === 'automation.succeeded' ||
        type === 'automation.failed' ||
        type === 'automation.skipped'
      ) {
        const automationId = (data as { automation_id: number }).automation_id
        setFiringNow((prev) => {
          if (!prev.has(automationId)) return prev
          const next = new Set(prev)
          next.delete(automationId)
          return next
        })
        const existing = firingTimers.current.get(automationId)
        if (existing) {
          clearTimeout(existing)
          firingTimers.current.delete(automationId)
        }
      }
    }

    const onConnect = () => setConnectionState('connected')
    const onDisconnect = () => setConnectionState('reconnecting')

    automationSSE.subscribe(listener)
    automationSSE.onConnect(onConnect)
    automationSSE.onDisconnect(onDisconnect)
    setConnectionState(automationSSE.getState())

    return () => {
      automationSSE.unsubscribe(listener)
      automationSSE.offConnect(onConnect)
      automationSSE.offDisconnect(onDisconnect)
      // Dispose all in-flight firing timers for this subscription.
      for (const timer of firingTimers.current.values()) {
        clearTimeout(timer)
      }
      firingTimers.current.clear()
    }
  }, [enabled, modeFilter])

  return { events, connectionState, firingNow, clearEvents }
}
