import { useEffect, useRef, useState, useCallback } from 'react'
import { automationSSE, type AutomationSSEListener } from '../lib/automationSSE'
import type {
  AutomationSSEEventType,
  AutomationTriggeredEvent,
  AutomationSucceededEvent,
  AutomationFailedEvent,
  AutomationSkippedEvent,
  AutomationStateChangedEvent,
} from '../api/types'

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

/**
 * React hook for real-time automation SSE events.
 * Subscribes to the dedicated /api/v1/automations/events stream.
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
        const next = [event, ...prev]
        return next.length > (optsRef.current.maxEvents ?? 50)
          ? next.slice(0, optsRef.current.maxEvents ?? 50)
          : next
      })

      // Track "firing now" for triggered events — auto-clear after 5s
      if (type === 'automation.triggered') {
        const automationId = (data as AutomationTriggeredEvent).automation_id
        setFiringNow((prev) => {
          const next = new Set(prev)
          next.add(automationId)
          return next
        })

        // Clear existing timer for this automation
        const existing = firingTimers.current.get(automationId)
        if (existing) clearTimeout(existing)

        const timer = window.setTimeout(() => {
          setFiringNow((prev) => {
            const next = new Set(prev)
            next.delete(automationId)
            return next
          })
          firingTimers.current.delete(automationId)
        }, 5000)
        firingTimers.current.set(automationId, timer)
      }

      // Clear firing state on terminal events
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

    automationSSE.subscribe(listener)
    automationSSE.onConnect(onConnect)
    setConnectionState(automationSSE.getState())

    return () => {
      automationSSE.unsubscribe(listener)
      automationSSE.offConnect(onConnect)
      // Clean up all firing timers
      for (const timer of firingTimers.current.values()) {
        clearTimeout(timer)
      }
      firingTimers.current.clear()
    }
  }, [enabled, modeFilter])

  return { events, connectionState, firingNow, clearEvents }
}
