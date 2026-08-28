import { describe, it, expect, beforeEach } from 'vitest'

import {
  EXPERIENCED_USER_THRESHOLDS,
  ONBOARDING_TASKS,
  TASK_HINT_COOLDOWN_MS,
  __resetOnboardingTasksForTests,
  getOnboardingTask,
  getTaskStatus,
  isExperiencedUser,
  isTaskResolved,
  markTaskCompleted,
  markTaskDismissed,
  matchesTaskRoute,
  selectOnboardingTask,
  setTaskOnboardingOptedOut,
  trackFirstUse,
  type OnboardingTaskContext,
} from '../onboardingTasks'
import { ROUTE_REGISTRY } from '../routeRegistry'

/**
 * HELP-01. These tests exist to make "never interrupts" a property of the
 * code rather than an intention: the suppression rules are the contract, and
 * a regression in any one of them is a user being interrupted.
 */

/** A brand-new install sitting on the dashboard with nothing configured. */
function newUserCtx(overrides: Partial<OnboardingTaskContext> = {}): OnboardingTaskContext {
  return {
    pathname: '/',
    vehicleCount: 0,
    driveCount: 0,
    chargingSessionCount: 0,
    automationCount: 0,
    notificationChannelCount: 0,
    hasLiveTelemetry: false,
    hasElectricityTariff: false,
    daysSinceFirstUse: 0,
    completedTourCount: 0,
    ...overrides,
  }
}

/**
 * A healthy, fully-configured install owned by a NEW user (so the experience
 * gate cannot be what suppresses the hints). Every task's precondition is
 * satisfied: vehicles linked, telemetry streaming, tariff set, automations and
 * channels present. Nothing here is outstanding, so nothing may fire.
 */
function configuredUserCtx(
  overrides: Partial<OnboardingTaskContext> = {},
): OnboardingTaskContext {
  return {
    pathname: '/',
    vehicleCount: 2,
    driveCount: 3,
    chargingSessionCount: 4,
    automationCount: 2,
    notificationChannelCount: 1,
    hasLiveTelemetry: true,
    hasElectricityTariff: true,
    daysSinceFirstUse: 0,
    completedTourCount: 0,
    ...overrides,
  }
}

/** Every route any task declares, so the invariant can be swept exhaustively. */
const TASK_ROUTES = ['/', '/signals', '/charging', '/automations'] as const

describe('onboarding task registry — governance', () => {
  it('gives every task a unique id and a positive version', () => {
    const ids = ONBOARDING_TASKS.map((task) => task.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const task of ONBOARDING_TASKS) {
      expect(Number.isInteger(task.version)).toBe(true)
      expect(task.version).toBeGreaterThan(0)
    }
  })

  it('gives every task exactly one action pointing at a declared route', () => {
    const known = new Set(ROUTE_REGISTRY.map((route) => route.path))
    for (const task of ONBOARDING_TASKS) {
      expect(typeof task.action.to).toBe('string')
      expect(known.has(task.action.to)).toBe(true)
    }
  })

  it('states a prerequisite and a body for every task', () => {
    for (const task of ONBOARDING_TASKS) {
      expect(task.prerequisiteFallback.length).toBeGreaterThan(10)
      expect(task.bodyFallback.length).toBeGreaterThan(10)
      expect(task.titleFallback.length).toBeGreaterThan(5)
    }
  })

  it('resolves ids through getOnboardingTask and returns null for unknown ids', () => {
    expect(getOnboardingTask('link-vehicle')?.id).toBe('link-vehicle')
    expect(getOnboardingTask('does-not-exist')).toBeNull()
  })

  // ── The fully-configured-install invariant ───────────────────────────────
  //
  // Documented in `docs/features/help-and-onboarding.md`: "an `isRelevant`
  // predicate that is false for a fully-configured install". Without this
  // sweep the invariant was prose. It caught a real defect: the charging-cost
  // task fired for anyone who had ever charged, including users who had
  // already set an electricity price — i.e. exactly the users for whom the
  // task was already complete.

  it('has no eligible task on ANY route for a fully-configured install', () => {
    for (const pathname of TASK_ROUTES) {
      const task = selectOnboardingTask({
        ctx: configuredUserCtx({ pathname }),
        optedOut: false,
        lastShownAt: null,
        isResolved: () => false,
      })
      expect(task, `${pathname} should surface nothing on a configured install`).toBeNull()
    }
  })

  it('every isRelevant predicate individually returns false on a configured install', () => {
    for (const pathname of TASK_ROUTES) {
      const ctx = configuredUserCtx({ pathname })
      for (const task of ONBOARDING_TASKS) {
        expect(task.isRelevant(ctx), `${task.id} @ ${pathname}`).toBe(false)
      }
    }
  })

  it('has no eligible task anywhere when every observation is unknown', () => {
    // The "app just booted, nothing has loaded" state. Unknown must never be
    // read as zero — that would fire "create your first automation" at a user
    // with fifty automations while their list is still in flight.
    const unknownCtx: OnboardingTaskContext = {
      pathname: '/',
      vehicleCount: -1,
      driveCount: undefined,
      chargingSessionCount: undefined,
      automationCount: undefined,
      notificationChannelCount: undefined,
      hasLiveTelemetry: undefined,
      hasElectricityTariff: undefined,
      daysSinceFirstUse: 0,
      completedTourCount: 0,
    }
    for (const pathname of TASK_ROUTES) {
      expect(
        selectOnboardingTask({
          ctx: { ...unknownCtx, pathname },
          optedOut: false,
          lastShownAt: null,
          isResolved: () => false,
        }),
        pathname,
      ).toBeNull()
    }
  })
})

describe('matchesTaskRoute', () => {
  const task = getOnboardingTask('link-vehicle')!

  it('treats "/" as an exact match only', () => {
    expect(matchesTaskRoute(task, '/')).toBe(true)
    expect(matchesTaskRoute(task, '/vehicles')).toBe(false)
  })

  it('matches nested paths for prefix routes', () => {
    const automations = getOnboardingTask('first-automation')!
    expect(matchesTaskRoute(automations, '/automations')).toBe(true)
    expect(matchesTaskRoute(automations, '/automations/new')).toBe(true)
    expect(matchesTaskRoute(automations, '/automationsomething')).toBe(false)
  })

  it('returns false for an empty or non-string pathname without throwing', () => {
    expect(matchesTaskRoute(task, '')).toBe(false)
    expect(matchesTaskRoute(task, undefined as unknown as string)).toBe(false)
  })
})

describe('isExperiencedUser — the interruption guard', () => {
  it('is false for a genuinely new install', () => {
    expect(isExperiencedUser(newUserCtx())).toBe(false)
  })

  it('is true past the tenure threshold alone', () => {
    expect(
      isExperiencedUser(
        newUserCtx({ daysSinceFirstUse: EXPERIENCED_USER_THRESHOLDS.daysSinceFirstUse }),
      ),
    ).toBe(true)
  })

  it('is true past the usage threshold alone', () => {
    expect(
      isExperiencedUser(newUserCtx({ driveCount: EXPERIENCED_USER_THRESHOLDS.driveCount })),
    ).toBe(true)
  })

  it('is true once the user has sat through two tours', () => {
    expect(
      isExperiencedUser(
        newUserCtx({ completedTourCount: EXPERIENCED_USER_THRESHOLDS.completedTourCount }),
      ),
    ).toBe(true)
  })

  it('fails closed for a missing context — unknown means do not interrupt', () => {
    expect(isExperiencedUser(undefined as unknown as OnboardingTaskContext)).toBe(true)
  })
})

describe('selectOnboardingTask', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetOnboardingTasksForTests()
  })

  it('offers the vehicle-linking task to a new user on the dashboard', () => {
    const task = selectOnboardingTask({
      ctx: newUserCtx(),
      optedOut: false,
      lastShownAt: null,
    })
    expect(task?.id).toBe('link-vehicle')
  })

  it('returns null when the route does not match, even if the task is outstanding', () => {
    const task = selectOnboardingTask({
      ctx: newUserCtx({ pathname: '/battery' }),
      optedOut: false,
      lastShownAt: null,
    })
    expect(task).toBeNull()
  })

  it('returns null for an experienced user regardless of outstanding tasks', () => {
    const task = selectOnboardingTask({
      ctx: newUserCtx({ driveCount: 100 }),
      optedOut: false,
      lastShownAt: null,
    })
    expect(task).toBeNull()
  })

  it('returns null when the user opted out', () => {
    const task = selectOnboardingTask({
      ctx: newUserCtx(),
      optedOut: true,
      lastShownAt: null,
    })
    expect(task).toBeNull()
  })

  it('honours the cooldown window between hints', () => {
    const now = 1_000_000_000
    expect(
      selectOnboardingTask({
        ctx: newUserCtx(),
        now,
        optedOut: false,
        lastShownAt: now - TASK_HINT_COOLDOWN_MS + 1,
      }),
    ).toBeNull()
    expect(
      selectOnboardingTask({
        ctx: newUserCtx(),
        now,
        optedOut: false,
        lastShownAt: now - TASK_HINT_COOLDOWN_MS,
      })?.id,
    ).toBe('link-vehicle')
  })

  it('does not retract the hint already on screen while inside the cooldown', () => {
    // Showing a hint stamps `last-shown`. Without the `currentTaskId` escape
    // the very next re-render — a resolved query, a route param change — saw
    // itself inside its own cooldown and blinked the card away.
    const now = 1_000_000_000
    expect(
      selectOnboardingTask({
        ctx: newUserCtx(),
        now,
        optedOut: false,
        lastShownAt: now - 1_000,
        currentTaskId: 'link-vehicle',
      })?.id,
    ).toBe('link-vehicle')
  })

  it('still refuses to swap to a DIFFERENT hint during the cooldown', () => {
    const now = 1_000_000_000
    expect(
      selectOnboardingTask({
        ctx: newUserCtx({ pathname: '/automations', vehicleCount: 1, automationCount: 0 }),
        now,
        optedOut: false,
        lastShownAt: now - 1_000,
        currentTaskId: 'link-vehicle',
      }),
    ).toBeNull()
  })

  it('does not re-offer a completed task, but does after a version bump', () => {
    const ctx = newUserCtx()
    markTaskCompleted('link-vehicle', 1)
    expect(
      selectOnboardingTask({ ctx, optedOut: false, lastShownAt: null }),
    ).toBeNull()
    // A different version is a different storage key — the task returns.
    expect(isTaskResolved('link-vehicle', 2)).toBe(false)
  })

  it('does not re-offer a dismissed task', () => {
    markTaskDismissed('link-vehicle', 1)
    expect(getTaskStatus('link-vehicle', 1)).toBe('dismissed')
    expect(
      selectOnboardingTask({ ctx: newUserCtx(), optedOut: false, lastShownAt: null }),
    ).toBeNull()
  })

  it('never fires on unknown state — an unloaded automations list yields nothing', () => {
    // `automationCount: undefined` is the "not observed" reading the reactive
    // evidence hook produces before the list resolves.
    const task = selectOnboardingTask({
      ctx: newUserCtx({
        pathname: '/automations',
        vehicleCount: 2,
        automationCount: undefined,
      }),
      optedOut: false,
      lastShownAt: null,
    })
    expect(task).toBeNull()
  })

  it('suppresses the telemetry task while live-telemetry evidence is unknown', () => {
    expect(
      selectOnboardingTask({
        ctx: newUserCtx({
          pathname: '/signals',
          vehicleCount: 1,
          hasLiveTelemetry: undefined,
        }),
        optedOut: false,
        lastShownAt: null,
      }),
    ).toBeNull()
  })

  it('fires the telemetry task only when telemetry is observed to be absent', () => {
    expect(
      selectOnboardingTask({
        ctx: newUserCtx({
          pathname: '/signals',
          vehicleCount: 1,
          hasLiveTelemetry: false,
        }),
        optedOut: false,
        lastShownAt: null,
      })?.id,
    ).toBe('enable-live-telemetry')
  })

  it('suppresses the charging-cost task while the tariff is unknown', () => {
    expect(
      selectOnboardingTask({
        ctx: newUserCtx({
          pathname: '/charging',
          vehicleCount: 1,
          chargingSessionCount: 5,
          hasElectricityTariff: undefined,
        }),
        optedOut: false,
        lastShownAt: null,
      }),
    ).toBeNull()
  })

  it('suppresses the charging-cost task once a tariff is configured', () => {
    expect(
      selectOnboardingTask({
        ctx: newUserCtx({
          pathname: '/charging',
          vehicleCount: 1,
          chargingSessionCount: 5,
          hasElectricityTariff: true,
        }),
        optedOut: false,
        lastShownAt: null,
      }),
    ).toBeNull()
  })

  it('fires the charging-cost task only with sessions AND no configured tariff', () => {
    expect(
      selectOnboardingTask({
        ctx: newUserCtx({
          pathname: '/charging',
          vehicleCount: 1,
          chargingSessionCount: 5,
          hasElectricityTariff: false,
        }),
        optedOut: false,
        lastShownAt: null,
      })?.id,
    ).toBe('first-charging-cost')
  })

  it('picks the lowest-priority-number task when several are eligible', () => {
    const task = selectOnboardingTask({
      ctx: newUserCtx({
        pathname: '/automations',
        vehicleCount: 1,
        automationCount: 0,
        notificationChannelCount: 0,
      }),
      optedOut: false,
      lastShownAt: null,
    })
    // first-automation (40) beats notification-channel (50); the channel task
    // is not even eligible because there are no automations yet.
    expect(task?.id).toBe('first-automation')
  })

  it('is deterministic — identical input yields the identical task', () => {
    const ctx = newUserCtx()
    const a = selectOnboardingTask({ ctx, optedOut: false, lastShownAt: null })
    const b = selectOnboardingTask({ ctx, optedOut: false, lastShownAt: null })
    expect(a).toBe(b)
  })

  it('reads storage-backed suppression by default', () => {
    setTaskOnboardingOptedOut(true)
    expect(selectOnboardingTask({ ctx: newUserCtx(), lastShownAt: null })).toBeNull()
    setTaskOnboardingOptedOut(false)
    expect(selectOnboardingTask({ ctx: newUserCtx(), lastShownAt: null })?.id).toBe(
      'link-vehicle',
    )
  })
})

describe('trackFirstUse', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('records the first call and reports zero days', () => {
    expect(trackFirstUse(1_000_000)).toBe(0)
  })

  it('reports whole days elapsed on later calls', () => {
    trackFirstUse(0)
    expect(trackFirstUse(3 * 86_400_000 + 500)).toBe(3)
  })

  it('never reports a negative tenure when the clock moves backwards', () => {
    trackFirstUse(10 * 86_400_000)
    expect(trackFirstUse(0)).toBe(0)
  })
})
