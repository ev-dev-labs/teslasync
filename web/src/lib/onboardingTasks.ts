/**
 * Task-specific, opt-in progressive onboarding (HELP-01).
 *
 * Replaces the "broad automatic tour on first dashboard visit" model. The
 * previous behaviour interrupted every user who linked a vehicle with a
 * seven-step spotlight walkthrough of the whole app, regardless of what they
 * were trying to do. That is the definition of an interruption: it is modal,
 * global, and unrelated to the current task.
 *
 * The model here is deliberately narrower:
 *
 *  1. **Task-specific.** Each entry teaches exactly ONE thing and offers
 *     exactly ONE canonical action. There is no multi-step spotlight.
 *  2. **Relevant state + route only.** A hint is eligible only when the user
 *     is already on the route where the task is performed AND the observed
 *     state says the task is still outstanding (`isRelevant`).
 *  3. **Opt-in.** Nothing takes focus, nothing is modal, nothing blocks. The
 *     host renders an inline, dismissible card. Users can turn the whole
 *     surface off, and the off switch is honoured forever.
 *  4. **Never interrupts experienced users.** {@link isExperiencedUser}
 *     suppresses every automatic hint once the install looks established.
 *     Experienced users can still pull the same content from the Help index.
 *  5. **Completion / dismissal / version aware.** Storage is keyed by task id
 *     AND version, mirroring `lib/tourRegistry`. Bumping a version re-offers
 *     the task; dismissal and completion both suppress it at that version.
 *
 * Storage keys (all localStorage, all failure-tolerant):
 *   `teslasync:onboarding-task:v{version}:{id}` → 'completed' | 'dismissed'
 *   `teslasync:onboarding-task:opt-out`          → '1'
 *   `teslasync:onboarding-task:last-shown`       → epoch ms
 *   `teslasync:onboarding-task:first-use`        → epoch ms
 */

export type OnboardingTaskStatus = 'completed' | 'dismissed'

/**
 * Observed application state used to decide whether a task is still
 * outstanding. Every field is optional-safe: a partially-populated context
 * (hooks still loading) must never throw and must never make a task eligible
 * by accident — predicates are written so `undefined` reads as "unknown", and
 * unknown never triggers a hint.
 */
export interface OnboardingTaskContext {
  /** Current router pathname. */
  pathname: string
  /**
   * Vehicles linked to the install. `-1` means "not observed yet" — the
   * sentinel is preserved (rather than `undefined`) because the predicates
   * compare it numerically and `-1` can never satisfy a `> 0` or `=== 0` test.
   */
  vehicleCount: number
  /** Drives recorded (any vehicle). `undefined` when not observed. */
  driveCount: number | undefined
  /** Charging sessions recorded (any vehicle). `undefined` when not observed. */
  chargingSessionCount: number | undefined
  /** Automations configured. `undefined` when not observed. */
  automationCount: number | undefined
  /** Notification channels configured. `undefined` when not observed. */
  notificationChannelCount: number | undefined
  /**
   * True when live telemetry (fleet-telemetry / streaming) is flowing.
   *
   * `undefined` means "we have not observed either way" and MUST behave like
   * "configured correctly" — nagging every user of a healthy install because
   * the evidence had not loaded yet is precisely the interruption HELP-01
   * exists to remove. Predicates therefore test `=== false`, never `!value`.
   */
  hasLiveTelemetry: boolean | undefined
  /**
   * True when an electricity price is configured, so charging rows can carry
   * a cost. `undefined` when settings have not been observed.
   */
  hasElectricityTariff: boolean | undefined
  /** Whole days since the first recorded use of this browser profile. */
  daysSinceFirstUse: number
  /** Number of guided tours the user has finished or skipped. */
  completedTourCount: number
}

export interface OnboardingTaskAction {
  /** i18n key for the single canonical action. */
  labelKey: string
  labelFallback: string
  /** In-app destination. MUST be a canonical route declared in App.tsx. */
  to: string
}

export interface OnboardingTaskDefinition {
  /** Stable id — storage key, registry lookup, help-index cross reference. */
  id: string
  /** Bump to re-offer the task after materially rewriting it. */
  version: number
  /** Ordering when several tasks are eligible. Lower wins. */
  priority: number
  /** Route the task is performed on. Prefix string or RegExp. */
  routeMatch: string | RegExp
  titleKey: string
  titleFallback: string
  /** What the user gains. One sentence, no marketing. */
  bodyKey: string
  bodyFallback: string
  /** What must already be true for the task to be possible. */
  prerequisiteKey: string
  prerequisiteFallback: string
  /** Exactly one canonical action. */
  action: OnboardingTaskAction
  /**
   * True when the task is still outstanding given observed state. Must be
   * pure and must return false for unknown/loading state.
   */
  isRelevant: (ctx: OnboardingTaskContext) => boolean
}

const STORAGE_PREFIX = 'teslasync:onboarding-task'
const OPT_OUT_KEY = `${STORAGE_PREFIX}:opt-out`
const LAST_SHOWN_KEY = `${STORAGE_PREFIX}:last-shown`
const FIRST_USE_KEY = `${STORAGE_PREFIX}:first-use`

/**
 * Minimum gap between two automatic hints. One nudge per session-ish window
 * keeps the surface from becoming a drip campaign.
 */
export const TASK_HINT_COOLDOWN_MS = 6 * 60 * 60 * 1000

/** Thresholds past which automatic hints are suppressed entirely. */
export const EXPERIENCED_USER_THRESHOLDS = {
  daysSinceFirstUse: 30,
  driveCount: 25,
  completedTourCount: 2,
} as const

function taskKey(id: string, version: number): string {
  return `${STORAGE_PREFIX}:v${version}:${id}`
}

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* quota / private mode — non-fatal, the hint simply reappears */
  }
}

/** Stored status for a task at a given version, or null when never acted on. */
export function getTaskStatus(id: string, version: number): OnboardingTaskStatus | null {
  const raw = readStorage(taskKey(id, version))
  return raw === 'completed' || raw === 'dismissed' ? raw : null
}

/** True when the user finished OR dismissed the task at the current version. */
export function isTaskResolved(id: string, version: number): boolean {
  return getTaskStatus(id, version) !== null
}

export function markTaskCompleted(id: string, version: number): void {
  writeStorage(taskKey(id, version), 'completed')
}

export function markTaskDismissed(id: string, version: number): void {
  writeStorage(taskKey(id, version), 'dismissed')
}

/** Global off switch for automatic hints. Honoured across every task. */
export function isTaskOnboardingOptedOut(): boolean {
  return readStorage(OPT_OUT_KEY) === '1'
}

export function setTaskOnboardingOptedOut(optedOut: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (optedOut) window.localStorage.setItem(OPT_OUT_KEY, '1')
    else window.localStorage.removeItem(OPT_OUT_KEY)
  } catch {
    /* non-fatal */
  }
}

/** Epoch-ms of the last automatic hint, or null. */
export function getLastHintShownAt(): number | null {
  const raw = readStorage(LAST_SHOWN_KEY)
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export function markHintShown(now: number = Date.now()): void {
  writeStorage(LAST_SHOWN_KEY, String(now))
}

/**
 * Records (once) the first time this browser profile used the app so
 * {@link isExperiencedUser} has a real tenure signal instead of guessing.
 * Returns the whole number of days since that moment.
 */
export function trackFirstUse(now: number = Date.now()): number {
  const raw = readStorage(FIRST_USE_KEY)
  // `Number('')` is 0, which would masquerade as a valid epoch timestamp, so
  // an empty/absent value is normalised to NaN before the finiteness check.
  const parsed = raw && raw.trim() !== '' ? Number(raw) : Number.NaN
  if (!Number.isFinite(parsed) || parsed < 0) {
    writeStorage(FIRST_USE_KEY, String(now))
    return 0
  }
  return Math.max(0, Math.floor((now - parsed) / 86_400_000))
}

/**
 * True when the install is established enough that an unsolicited hint would
 * be noise. Any ONE signal is sufficient: tenure, usage volume, or the fact
 * that the user has already sat through two guided tours.
 */
export function isExperiencedUser(ctx: OnboardingTaskContext): boolean {
  if (!ctx) return true
  return (
    (ctx.daysSinceFirstUse ?? 0) >= EXPERIENCED_USER_THRESHOLDS.daysSinceFirstUse ||
    (ctx.driveCount ?? 0) >= EXPERIENCED_USER_THRESHOLDS.driveCount ||
    (ctx.completedTourCount ?? 0) >= EXPERIENCED_USER_THRESHOLDS.completedTourCount
  )
}

/** True when the pathname matches the task's route hint. */
export function matchesTaskRoute(def: OnboardingTaskDefinition, pathname: string): boolean {
  if (typeof pathname !== 'string' || pathname === '') return false
  if (typeof def.routeMatch === 'string') {
    if (def.routeMatch === '/') return pathname === '/'
    return pathname === def.routeMatch || pathname.startsWith(`${def.routeMatch}/`)
  }
  return def.routeMatch.test(pathname)
}

// ─── Registry ───────────────────────────────────────────────────────────────

/**
 * The governed task set. Additions must satisfy the invariants pinned in
 * `lib/__tests__/onboardingTasks.test.ts`: unique id, positive version, one
 * canonical action pointing at a declared route, a prerequisite sentence, and
 * an `isRelevant` predicate that is false for a fully-configured install.
 */
export const ONBOARDING_TASKS: readonly OnboardingTaskDefinition[] = [
  {
    id: 'link-vehicle',
    version: 1,
    priority: 10,
    routeMatch: '/',
    titleKey: 'onboarding.tasks.linkVehicle.title',
    titleFallback: 'Link a vehicle to start collecting data',
    bodyKey: 'onboarding.tasks.linkVehicle.body',
    bodyFallback:
      'Nothing is recorded until at least one vehicle is linked to your Tesla account.',
    prerequisiteKey: 'onboarding.tasks.linkVehicle.prerequisite',
    prerequisiteFallback: 'Requires a signed-in Tesla account with at least one vehicle.',
    action: {
      labelKey: 'onboarding.tasks.linkVehicle.action',
      labelFallback: 'Open setup',
      to: '/onboarding',
    },
    isRelevant: (ctx) => (ctx?.vehicleCount ?? -1) === 0,
  },
  {
    id: 'enable-live-telemetry',
    version: 1,
    priority: 20,
    routeMatch: '/signals',
    titleKey: 'onboarding.tasks.liveTelemetry.title',
    titleFallback: 'Turn on live telemetry for second-by-second signals',
    bodyKey: 'onboarding.tasks.liveTelemetry.body',
    bodyFallback:
      'Without streaming telemetry this page can only show polled snapshots, which arrive minutes apart.',
    prerequisiteKey: 'onboarding.tasks.liveTelemetry.prerequisite',
    prerequisiteFallback:
      'Requires a linked vehicle and a fleet-telemetry configuration on the server.',
    action: {
      labelKey: 'onboarding.tasks.liveTelemetry.action',
      labelFallback: 'Configure telemetry',
      to: '/settings',
    },
    isRelevant: (ctx) => (ctx?.vehicleCount ?? 0) > 0 && ctx?.hasLiveTelemetry === false,
  },
  {
    id: 'first-charging-cost',
    version: 1,
    priority: 30,
    routeMatch: '/charging',
    titleKey: 'onboarding.tasks.chargingCost.title',
    titleFallback: 'Set an electricity price to see charging costs',
    bodyKey: 'onboarding.tasks.chargingCost.body',
    bodyFallback:
      'Charging sessions are recorded without a price until a tariff is configured, so cost columns stay empty.',
    prerequisiteKey: 'onboarding.tasks.chargingCost.prerequisite',
    prerequisiteFallback: 'Requires at least one recorded charging session.',
    action: {
      labelKey: 'onboarding.tasks.chargingCost.action',
      labelFallback: 'Set electricity price',
      to: '/settings',
    },
    // Both halves are load-bearing. Without the tariff check this fired at
    // every user who had ever charged — including the ones who had already
    // set a price, i.e. the ones for whom the task was complete. `=== false`
    // (not `!hasElectricityTariff`) keeps unknown settings from triggering it.
    isRelevant: (ctx) =>
      (ctx?.chargingSessionCount ?? 0) > 0 && ctx?.hasElectricityTariff === false,
  },
  {
    id: 'first-automation',
    version: 1,
    priority: 40,
    routeMatch: '/automations',
    titleKey: 'onboarding.tasks.automation.title',
    titleFallback: 'Create your first automation',
    bodyKey: 'onboarding.tasks.automation.body',
    bodyFallback:
      'Automations react to vehicle state — for example, notify when charging stops below a target.',
    prerequisiteKey: 'onboarding.tasks.automation.prerequisite',
    prerequisiteFallback: 'Requires a linked vehicle reporting state.',
    action: {
      labelKey: 'onboarding.tasks.automation.action',
      labelFallback: 'Build an automation',
      to: '/automations/new',
    },
    isRelevant: (ctx) => (ctx?.vehicleCount ?? 0) > 0 && (ctx?.automationCount ?? -1) === 0,
  },
  {
    id: 'notification-channel',
    version: 1,
    priority: 50,
    routeMatch: '/automations',
    titleKey: 'onboarding.tasks.notificationChannel.title',
    titleFallback: 'Add a notification channel so alerts can reach you',
    bodyKey: 'onboarding.tasks.notificationChannel.body',
    bodyFallback:
      'Automations and alerts evaluate normally, but nothing is delivered until a channel exists.',
    prerequisiteKey: 'onboarding.tasks.notificationChannel.prerequisite',
    prerequisiteFallback: 'Requires at least one automation or alert rule.',
    action: {
      labelKey: 'onboarding.tasks.notificationChannel.action',
      labelFallback: 'Add a channel',
      to: '/settings',
    },
    isRelevant: (ctx) =>
      (ctx?.automationCount ?? 0) > 0 && (ctx?.notificationChannelCount ?? -1) === 0,
  },
] as const
/** Lookup helper. Returns null rather than undefined for call-site symmetry. */
export function getOnboardingTask(id: string): OnboardingTaskDefinition | null {
  return ONBOARDING_TASKS.find((task) => task.id === id) ?? null
}

export interface TaskSelectionInput {
  ctx: OnboardingTaskContext
  now?: number
  /** Test seam / SSR guard — defaults to the localStorage-backed readers. */
  optedOut?: boolean
  lastShownAt?: number | null
  isResolved?: (id: string, version: number) => boolean
  /**
   * Id of the hint currently on screen, if any.
   *
   * The cooldown exists to stop a *new* hint appearing too soon after the
   * last one. Without this field it also retracted the hint that was already
   * visible: showing it stamps `last-shown`, so the very next re-render (a
   * cache update, a route param change) saw itself inside the cooldown and
   * returned null, and the card blinked out from under the user's cursor.
   */
  currentTaskId?: string | null
}

/**
 * Picks the single task to surface, or null.
 *
 * Deterministic for a given input: the same context, clock and storage state
 * always yields the same answer. Suppression order is intentional — cheapest
 * and most absolute checks first, so an opted-out or experienced user never
 * pays for predicate evaluation.
 */
export function selectOnboardingTask(
  input: TaskSelectionInput,
): OnboardingTaskDefinition | null {
  const {
    ctx,
    now = Date.now(),
    optedOut = isTaskOnboardingOptedOut(),
    lastShownAt = getLastHintShownAt(),
    isResolved = isTaskResolved,
    currentTaskId = null,
  } = input

  if (!ctx || typeof ctx.pathname !== 'string') return null
  if (optedOut) return null
  if (isExperiencedUser(ctx)) return null

  const eligible = ONBOARDING_TASKS.filter(
    (task) =>
      matchesTaskRoute(task, ctx.pathname) &&
      !isResolved(task.id, task.version) &&
      task.isRelevant(ctx),
  )
  if (eligible.length === 0) return null

  // Stable ordering: priority first, id as the tie-break so two tasks with the
  // same priority never flip between renders.
  const chosen = [...eligible].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  )[0]

  // Cooldown gates NEW hints only. Re-selecting the hint already on screen is
  // not a new impression, so it passes through.
  const inCooldown = lastShownAt != null && now - lastShownAt < TASK_HINT_COOLDOWN_MS
  if (inCooldown && chosen.id !== currentTaskId) return null

  return chosen
}

/** Test seam — clears every task flag plus the global switches. */
export function __resetOnboardingTasksForTests(): void {
  if (typeof window === 'undefined') return
  try {
    const toRemove: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && key.startsWith(`${STORAGE_PREFIX}:`)) toRemove.push(key)
    }
    toRemove.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    /* non-fatal */
  }
}
