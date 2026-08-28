/**
 * Why data is unavailable — the six causes that look identical on screen
 * (HELP-04).
 *
 * "No data" is rendered the same way whether the car is asleep, the account
 * lacks permission, the rows aged out of retention, the pipeline is behind, a
 * filter excluded everything, or a dependency is down. Those have completely
 * different responses — one of them means "wait", one means "ask an admin",
 * and one means "widen your date range". Guessing wrong wastes the user's
 * time and generates support load.
 *
 * This module classifies the cause from evidence the UI already has, and maps
 * it onto the EXISTING data-state contract (`DataStateKind` from
 * `components/feedback/DataStateNotice`) so the visual language does not fork:
 *
 *   stale       → data exists but is older than it should be (asleep, lag)
 *   partial     → some of the requested scope could not be answered (filters)
 *   unavailable → a dependency could not answer at all (outage)
 *   unsupported → the answer is structurally impossible here (permission,
 *                 retention) — retrying will not help
 *
 * Classification is pure and deterministic: same evidence in, same reason out.
 */

import type { DataStateKind } from '@/components/feedback/DataStateNotice'
import { classifyError } from './errorClassification'

export type UnavailabilityReason =
  | 'vehicle_asleep'
  | 'vehicle_offline'
  | 'permission'
  | 'retention'
  | 'ingestion_lag'
  | 'filter_scope'
  | 'service_outage'

export interface UnavailabilityEvidence {
  /** Query error, if any. Classified through the shared error taxonomy. */
  error?: unknown
  /** Browser connectivity, forwarded to {@link classifyError}. */
  online?: boolean
  /** Vehicle state string as reported by the API (`online`/`asleep`/…). */
  vehicleState?: string | null
  /**
   * True when the requested window starts before the configured retention
   * horizon, so rows for part of it cannot exist by policy.
   */
  requestedBeforeRetention?: boolean
  /** Age of the newest ingested row for this scope, in seconds. */
  newestDataAgeSec?: number | null
  /** True when the user has narrowing filters applied beyond the defaults. */
  filtersActive?: boolean
}

/**
 * Ingestion is considered "behind" past this age. Chosen to sit above the
 * 2-minute staleness marker used for live signals so a normally-stale live
 * value is not reported as a pipeline problem.
 */
export const INGESTION_LAG_THRESHOLD_SEC = 15 * 60

const ASLEEP_STATES = new Set(['asleep', 'sleeping', 'suspended'])
const OFFLINE_STATES = new Set(['offline', 'unavailable', 'inactive'])

/**
 * Classify why a surface has nothing to show.
 *
 * Order is load-bearing and runs most-authoritative first:
 *   1. permission — a 401/403 is a definitive answer about the caller; no
 *      other evidence can override it.
 *   2. service outage — a failing dependency means every other signal below
 *      is unreliable (a stale timestamp during an outage is a symptom, not a
 *      cause).
 *   3. retention — a policy boundary. Deterministic and unfixable by waiting.
 *   4. vehicle asleep / offline — expected, benign, and the single most common
 *      real cause. Asleep is separated from offline because asleep is normal
 *      and waking costs range, while offline usually means connectivity.
 *   5. ingestion lag — the pipeline is behind; data will arrive.
 *   6. filter scope — nothing matched what the user asked for.
 *
 * Returns null when no evidence explains the emptiness, in which case the
 * caller should fall back to the governed empty-state guidance (HELP-02)
 * rather than inventing a cause.
 */
export function classifyUnavailability(
  evidence: UnavailabilityEvidence,
): UnavailabilityReason | null {
  if (!evidence) return null

  if (evidence.error != null) {
    const kind = classifyError(evidence.error, evidence.online ?? true)
    if (kind === 'unauthorized' || kind === 'forbidden') return 'permission'
    if (
      kind === 'unavailable' ||
      kind === 'server' ||
      kind === 'timed_out' ||
      kind === 'offline' ||
      kind === 'network'
    ) {
      return 'service_outage'
    }
  }

  if (evidence.requestedBeforeRetention === true) return 'retention'

  const state = (evidence.vehicleState ?? '').trim().toLowerCase()
  if (state !== '') {
    if (ASLEEP_STATES.has(state)) return 'vehicle_asleep'
    if (OFFLINE_STATES.has(state)) return 'vehicle_offline'
  }

  const age = evidence.newestDataAgeSec
  if (typeof age === 'number' && Number.isFinite(age) && age > INGESTION_LAG_THRESHOLD_SEC) {
    return 'ingestion_lag'
  }

  if (evidence.filtersActive === true) return 'filter_scope'

  return null
}

export interface UnavailabilityExplanation {
  reason: UnavailabilityReason
  /** Existing data-state contract this reason renders through. */
  dataState: DataStateKind
  titleKey: string
  titleFallback: string
  /** What is happening, in system terms. */
  bodyKey: string
  bodyFallback: string
  /** What the user should do — including "nothing, this is normal". */
  whatToDoKey: string
  whatToDoFallback: string
  /** True when waiting resolves it without user action. */
  resolvesOnItsOwn: boolean
  /** Optional single canonical destination for the recommended action. */
  actionTo?: string
  actionLabelKey?: string
  actionLabelFallback?: string
}

const EXPLANATIONS: Record<UnavailabilityReason, UnavailabilityExplanation> = {
  vehicle_asleep: {
    reason: 'vehicle_asleep',
    dataState: 'stale',
    titleKey: 'dataUnavailable.vehicleAsleep.title',
    titleFallback: 'The vehicle is asleep',
    bodyKey: 'dataUnavailable.vehicleAsleep.body',
    bodyFallback:
      'Tesla stops reporting while a vehicle sleeps. The values shown are the last ones received before it slept.',
    whatToDoKey: 'dataUnavailable.vehicleAsleep.whatToDo',
    whatToDoFallback:
      'Nothing — this is normal and preserves range. Data resumes automatically when the vehicle wakes.',
    resolvesOnItsOwn: true,
    actionTo: '/vehicles',
    actionLabelKey: 'dataUnavailable.vehicleAsleep.action',
    actionLabelFallback: 'View vehicle state',
  },
  vehicle_offline: {
    reason: 'vehicle_offline',
    dataState: 'stale',
    titleKey: 'dataUnavailable.vehicleOffline.title',
    titleFallback: 'The vehicle is offline',
    bodyKey: 'dataUnavailable.vehicleOffline.body',
    bodyFallback:
      'The vehicle is not reachable — usually no cellular coverage, or the car is in a garage or transport mode.',
    whatToDoKey: 'dataUnavailable.vehicleOffline.whatToDo',
    whatToDoFallback:
      'Wait for connectivity to return. Repeated wake attempts will not help and consume range.',
    resolvesOnItsOwn: true,
    actionTo: '/vehicles',
    actionLabelKey: 'dataUnavailable.vehicleOffline.action',
    actionLabelFallback: 'View vehicle state',
  },
  permission: {
    reason: 'permission',
    dataState: 'unsupported',
    titleKey: 'dataUnavailable.permission.title',
    titleFallback: 'Your account cannot read this data',
    bodyKey: 'dataUnavailable.permission.body',
    bodyFallback:
      'The server refused the request for this scope. This is an access decision, not a failure — the data may well exist.',
    whatToDoKey: 'dataUnavailable.permission.whatToDo',
    whatToDoFallback:
      'Request access from an administrator. Retrying or reloading will return the same result.',
    resolvesOnItsOwn: false,
    actionTo: '/help',
    actionLabelKey: 'dataUnavailable.permission.action',
    actionLabelFallback: 'How to request access',
  },
  retention: {
    reason: 'retention',
    dataState: 'unsupported',
    titleKey: 'dataUnavailable.retention.title',
    titleFallback: 'Part of this range is older than the retention window',
    bodyKey: 'dataUnavailable.retention.body',
    bodyFallback:
      'Rows older than the configured retention horizon are deleted permanently, so no query can return them.',
    whatToDoKey: 'dataUnavailable.retention.whatToDo',
    whatToDoFallback:
      'Shorten the range to stay inside retention, or ask an administrator to extend the retention policy.',
    resolvesOnItsOwn: false,
    actionTo: '/settings',
    actionLabelKey: 'dataUnavailable.retention.action',
    actionLabelFallback: 'Review retention settings',
  },
  ingestion_lag: {
    reason: 'ingestion_lag',
    dataState: 'stale',
    titleKey: 'dataUnavailable.ingestionLag.title',
    titleFallback: 'Ingestion is behind',
    bodyKey: 'dataUnavailable.ingestionLag.body',
    bodyFallback:
      'The newest stored row is older than expected, so recent activity has not been written yet.',
    whatToDoKey: 'dataUnavailable.ingestionLag.whatToDo',
    whatToDoFallback:
      'Wait for the pipeline to catch up. If the gap keeps growing, check pipeline health.',
    resolvesOnItsOwn: true,
    actionTo: '/system-status',
    actionLabelKey: 'dataUnavailable.ingestionLag.action',
    actionLabelFallback: 'Check pipeline health',
  },
  filter_scope: {
    reason: 'filter_scope',
    dataState: 'partial',
    titleKey: 'dataUnavailable.filterScope.title',
    titleFallback: 'No records match the current filters',
    bodyKey: 'dataUnavailable.filterScope.body',
    bodyFallback:
      'The query succeeded and returned zero rows for the selected vehicle, date range and filters.',
    whatToDoKey: 'dataUnavailable.filterScope.whatToDo',
    whatToDoFallback:
      'Widen the date range or clear filters before concluding that the data is missing.',
    resolvesOnItsOwn: false,
  },
  service_outage: {
    reason: 'service_outage',
    dataState: 'unavailable',
    titleKey: 'dataUnavailable.serviceOutage.title',
    titleFallback: 'A required service did not respond',
    bodyKey: 'dataUnavailable.serviceOutage.body',
    bodyFallback:
      'A dependency this view needs is unreachable or erroring, so the request could not be answered.',
    whatToDoKey: 'dataUnavailable.serviceOutage.whatToDo',
    whatToDoFallback:
      'Check system status for a known incident. The view recovers automatically once the dependency returns.',
    resolvesOnItsOwn: true,
    actionTo: '/system-status',
    actionLabelKey: 'dataUnavailable.serviceOutage.action',
    actionLabelFallback: 'Open system status',
  },
}

/** The full explanation for a reason. Total over the union — never null. */
export function explainUnavailability(
  reason: UnavailabilityReason,
): UnavailabilityExplanation {
  return EXPLANATIONS[reason]
}

/** Convenience: classify then explain. Null when nothing explains it. */
export function explainEvidence(
  evidence: UnavailabilityEvidence,
): UnavailabilityExplanation | null {
  const reason = classifyUnavailability(evidence)
  return reason ? EXPLANATIONS[reason] : null
}

/** Every reason, in the classifier's own priority order. */
export const UNAVAILABILITY_REASONS: readonly UnavailabilityReason[] = [
  'permission',
  'service_outage',
  'retention',
  'vehicle_asleep',
  'vehicle_offline',
  'ingestion_lag',
  'filter_scope',
] as const
