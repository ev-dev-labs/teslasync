import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { useVehicles } from '@/api/hooks/useVehicles'
import {
  isTaskOnboardingOptedOut,
  markHintShown,
  markTaskCompleted,
  markTaskDismissed,
  selectOnboardingTask,
  setTaskOnboardingOptedOut,
  trackFirstUse,
  type OnboardingTaskContext,
  type OnboardingTaskDefinition,
} from '@/lib/onboardingTasks'
import { useCachedOnboardingEvidence } from './useCachedOnboardingEvidence'

/**
 * Opt-in, task-specific onboarding (HELP-01).
 *
 * Two design decisions worth stating explicitly:
 *
 * **1. The context is read from the query CACHE, never fetched.**
 * A hint that issues its own requests would make onboarding a background load
 * on every route, for every user, forever — including the experienced users it
 * is supposed to leave alone. Reading only what the current page has already
 * loaded also gives the "relevant state" requirement for free: on
 * `/automations` the automations list is loaded because the page needs it, so
 * the automation task can evaluate; on `/battery` it cannot, and the task
 * simply does not fire. Unknown state never produces a hint.
 *
 * The cache read is a live subscription (see `useCachedOnboardingEvidence`),
 * not a one-shot memo. The page's queries resolve well after the shell renders,
 * so a memo keyed on stable dependencies froze every count at "nothing
 * observed" and four of the five tasks could never fire.
 *
 * **2. Nothing is modal.** The hook returns a task; the host renders an inline
 * card. There is no focus steal, no backdrop, no step counter, and no way for
 * this surface to block what the user came here to do.
 */

export interface UseTaskOnboardingResult {
  /** The single task to surface, or null. */
  task: OnboardingTaskDefinition | null
  /** Marks the task done — the user followed the action. */
  complete: () => void
  /** Marks the task dismissed — the user is not interested. */
  dismiss: () => void
  /** Turns off every automatic hint, permanently. */
  optOut: () => void
  optedOut: boolean
}

export function useTaskOnboarding(): UseTaskOnboardingResult {
  const location = useLocation()
  const { data: vehicles } = useVehicles()
  const evidence = useCachedOnboardingEvidence()

  const [optedOut, setOptedOut] = useState(() => isTaskOnboardingOptedOut())
  const [resolvedVersion, setResolvedVersion] = useState(0)
  const [daysSinceFirstUse] = useState(() => trackFirstUse())
  // Id of the hint currently rendered, so the cooldown does not retract it on
  // the next cache update. Held in a ref rather than state: it is read during
  // selection and written from an effect, and promoting it to state would add
  // a render pass without changing any output.
  const currentTaskIdRef = useRef<string | null>(null)

  const ctx: OnboardingTaskContext = useMemo(
    () => ({
      pathname: location.pathname,
      // `-1` is the "not observed" sentinel for vehicles: it satisfies neither
      // `=== 0` (link-vehicle) nor `> 0` (every downstream task), so an
      // unresolved fleet query suppresses everything rather than guessing.
      vehicleCount: vehicles?.length ?? -1,
      driveCount: evidence.driveCount,
      chargingSessionCount: evidence.chargingSessionCount,
      automationCount: evidence.automationCount,
      notificationChannelCount: evidence.notificationChannelCount,
      hasLiveTelemetry: evidence.hasLiveTelemetry,
      hasElectricityTariff: evidence.hasElectricityTariff,
      daysSinceFirstUse,
      completedTourCount: 0,
    }),
    [location.pathname, vehicles?.length, evidence, daysSinceFirstUse],
  )

  const task = useMemo(() => {
    if (optedOut) return null
    // `resolvedVersion` is a deliberate dependency: completing or dismissing a
    // task writes to localStorage, which useMemo cannot observe on its own.
    void resolvedVersion
    return selectOnboardingTask({ ctx, currentTaskId: currentTaskIdRef.current })
  }, [ctx, optedOut, resolvedVersion])

  // Record the impression so the cooldown applies to the NEXT hint, not this
  // one. Keyed on the task id: re-running for the same task on every render
  // would reset the cooldown continuously and defeat it.
  const shownTaskId = task?.id ?? null
  useEffect(() => {
    currentTaskIdRef.current = shownTaskId
    if (shownTaskId) markHintShown()
  }, [shownTaskId])

  const complete = useCallback(() => {
    if (!task) return
    markTaskCompleted(task.id, task.version)
    setResolvedVersion((n) => n + 1)
  }, [task])

  const dismiss = useCallback(() => {
    if (!task) return
    markTaskDismissed(task.id, task.version)
    setResolvedVersion((n) => n + 1)
  }, [task])

  const optOut = useCallback(() => {
    setTaskOnboardingOptedOut(true)
    setOptedOut(true)
  }, [])

  return { task, complete, dismiss, optOut, optedOut }
}
