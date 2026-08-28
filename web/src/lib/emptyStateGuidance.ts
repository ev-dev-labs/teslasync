/**
 * Governed actionable-empty-state pattern (HELP-02).
 *
 * An empty panel is a communication failure unless it answers four questions:
 *
 *   1. **Meaning**      — what does "nothing here" actually mean?
 *   2. **Prerequisite** — what has to be true before anything can appear?
 *   3. **Likely cause** — given a healthy install, why is it empty right now?
 *   4. **One action**   — the single most useful next step.
 *
 * This module is the registry of those answers. It is data-only so the
 * governance test can assert the invariants for every entry without
 * rendering anything, and so a reviewer can diff copy changes in one place
 * instead of hunting through pages.
 *
 * Deliberate constraints:
 *  - **Exactly one action.** Two CTAs is a decision, and a user staring at an
 *    empty panel has already failed to make one. The `action.to` value must be
 *    a canonical route (pinned by the governance test against ROUTE_REGISTRY).
 *  - **No panel hiding.** This describes panel *content*. The surrounding
 *    section shell always renders — see the react-frontend instructions.
 *  - **No blame.** "Likely cause" describes the system, never the user.
 */

export interface EmptyStateGuidanceAction {
  labelKey: string
  labelFallback: string
  /** Canonical in-app route. Validated against the route registry in tests. */
  to: string
}

export interface EmptyStateGuidance {
  /** Stable id — `{feature}.{surface}`. Also used as the help-index key. */
  id: string
  /** Feature bucket, used by the help index for route-aware lookup. */
  feature: string
  /** What an empty panel means here. */
  meaningKey: string
  meaningFallback: string
  /** What must already be true for data to exist. */
  prerequisiteKey: string
  prerequisiteFallback: string
  /** The most probable reason it is empty on a healthy install. */
  likelyCauseKey: string
  likelyCauseFallback: string
  /** Exactly one canonical next step. */
  action: EmptyStateGuidanceAction
}

/**
 * High-value empty surfaces. "High value" means: a first-run user will hit it,
 * and the panel is otherwise indistinguishable from a bug.
 */
export const EMPTY_STATE_GUIDANCE: readonly EmptyStateGuidance[] = [
  {
    id: 'drives.list',
    feature: 'driving',
    meaningKey: 'emptyState.drives.list.meaning',
    meaningFallback: 'No completed drives have been recorded for this vehicle yet.',
    prerequisiteKey: 'emptyState.drives.list.prerequisite',
    prerequisiteFallback:
      'A drive appears after the vehicle moves and then parks — drives are only written when they end.',
    likelyCauseKey: 'emptyState.drives.list.likelyCause',
    likelyCauseFallback:
      'Most often the vehicle has not driven since it was linked, or the selected date range ends before the first recorded drive.',
    action: {
      labelKey: 'emptyState.drives.list.action',
      labelFallback: 'Check vehicle status',
      to: '/vehicles',
    },
  },
  {
    id: 'charging.list',
    feature: 'charging',
    meaningKey: 'emptyState.charging.list.meaning',
    meaningFallback: 'No charging sessions have been recorded for this vehicle yet.',
    prerequisiteKey: 'emptyState.charging.list.prerequisite',
    prerequisiteFallback:
      'A session is written when the vehicle starts charging while it is being polled or streaming telemetry.',
    likelyCauseKey: 'emptyState.charging.list.likelyCause',
    likelyCauseFallback:
      'Most often the vehicle has not charged since it was linked, or it charged while asleep and unreachable.',
    action: {
      labelKey: 'emptyState.charging.list.action',
      labelFallback: 'Check vehicle status',
      to: '/vehicles',
    },
  },
  {
    id: 'battery.degradation',
    feature: 'battery',
    meaningKey: 'emptyState.battery.degradation.meaning',
    meaningFallback: 'There is not enough history yet to estimate battery degradation.',
    prerequisiteKey: 'emptyState.battery.degradation.prerequisite',
    prerequisiteFallback:
      'Degradation is derived from repeated full-ish charges observed over weeks, not from a single reading.',
    likelyCauseKey: 'emptyState.battery.degradation.likelyCause',
    likelyCauseFallback:
      'Most often the vehicle was linked recently, so the observation window is still too short to be meaningful.',
    action: {
      labelKey: 'emptyState.battery.degradation.action',
      labelFallback: 'View charging history',
      to: '/charging',
    },
  },
  {
    id: 'automations.list',
    feature: 'automations',
    meaningKey: 'emptyState.automations.list.meaning',
    meaningFallback: 'No automations are configured, so nothing is being evaluated.',
    prerequisiteKey: 'emptyState.automations.list.prerequisite',
    prerequisiteFallback:
      'An automation needs a trigger, at least one condition, and an enabled notification channel to deliver to.',
    likelyCauseKey: 'emptyState.automations.list.likelyCause',
    likelyCauseFallback:
      'This list is empty by default — automations are opt-in and are never created for you.',
    action: {
      labelKey: 'emptyState.automations.list.action',
      labelFallback: 'Build an automation',
      to: '/automations/new',
    },
  },
  {
    id: 'signals.live',
    feature: 'telemetry',
    meaningKey: 'emptyState.signals.live.meaning',
    meaningFallback: 'No live signals are arriving for this vehicle right now.',
    prerequisiteKey: 'emptyState.signals.live.prerequisite',
    prerequisiteFallback:
      'Live signals require fleet telemetry to be configured on the server and the vehicle to be awake.',
    likelyCauseKey: 'emptyState.signals.live.likelyCause',
    likelyCauseFallback:
      'Most often the vehicle is asleep — Tesla stops streaming while a car sleeps, and waking it costs range.',
    action: {
      labelKey: 'emptyState.signals.live.action',
      labelFallback: 'Check telemetry health',
      to: '/system-status',
    },
  },
  {
    id: 'alerts.list',
    feature: 'alerts',
    meaningKey: 'emptyState.alerts.list.meaning',
    meaningFallback: 'No alerts have fired — this is the expected steady state.',
    prerequisiteKey: 'emptyState.alerts.list.prerequisite',
    prerequisiteFallback:
      'Alerts are produced by alert rules and automations; without rules there is nothing to fire.',
    likelyCauseKey: 'emptyState.alerts.list.likelyCause',
    likelyCauseFallback:
      'Either no rules are configured yet, or every rule has evaluated cleanly in the selected window.',
    action: {
      labelKey: 'emptyState.alerts.list.action',
      labelFallback: 'Review alert rules',
      to: '/automations',
    },
  },
  {
    id: 'analytics.efficiency',
    feature: 'analytics',
    meaningKey: 'emptyState.analytics.efficiency.meaning',
    meaningFallback: 'No efficiency figures can be computed for the selected period.',
    prerequisiteKey: 'emptyState.analytics.efficiency.prerequisite',
    prerequisiteFallback:
      'Efficiency needs completed drives with both a distance and an energy figure in the selected range.',
    likelyCauseKey: 'emptyState.analytics.efficiency.likelyCause',
    likelyCauseFallback:
      'Most often the selected range contains no completed drives — widen it before assuming data is missing.',
    action: {
      labelKey: 'emptyState.analytics.efficiency.action',
      labelFallback: 'Open drives',
      to: '/drives',
    },
  },
  {
    id: 'vehicles.list',
    feature: 'vehicles',
    meaningKey: 'emptyState.vehicles.list.meaning',
    meaningFallback: 'No vehicles are linked, so nothing is being collected anywhere in the app.',
    prerequisiteKey: 'emptyState.vehicles.list.prerequisite',
    prerequisiteFallback:
      'Linking requires a Tesla account authorisation that grants this install access to your vehicles.',
    likelyCauseKey: 'emptyState.vehicles.list.likelyCause',
    likelyCauseFallback:
      'Either setup has not been completed, or the stored Tesla authorisation was revoked and needs renewing.',
    action: {
      labelKey: 'emptyState.vehicles.list.action',
      labelFallback: 'Run setup',
      to: '/onboarding',
    },
  },
] as const

const GUIDANCE_BY_ID: ReadonlyMap<string, EmptyStateGuidance> = new Map(
  EMPTY_STATE_GUIDANCE.map((entry) => [entry.id, entry]),
)

/** Registry lookup. Returns null for unknown ids so callers can fall back. */
export function getEmptyStateGuidance(id: string): EmptyStateGuidance | null {
  return GUIDANCE_BY_ID.get(id) ?? null
}

/** Every governed id, sorted — used by the help index and the governance test. */
export function listEmptyStateGuidanceIds(): string[] {
  return EMPTY_STATE_GUIDANCE.map((entry) => entry.id).sort()
}
