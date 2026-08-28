import {
  describeFleetState,
  summariseFleetStates,
  type FleetStateCondition,
  type FleetStateEntry,
  type FleetStatesSummary,
} from '@/api/hooks/useVehicles'
import type { VehicleStatus } from '@/api/types'
import type { Vehicle } from '@/types/vehicle'

/**
 * The posture taxonomy.
 *
 * `offline` is separated from the other five deliberately: it is the ONLY
 * category that is a claim about the vehicle. The rest are claims about our
 * evidence. Collapsing them (which the panel used to do) told operators a
 * fleet was dead when the API pod was merely restarting.
 */
export type PostureCategory =
  | 'reporting'
  | 'offline'
  | 'unverified'
  | 'stale'
  | 'missing'
  | 'failed'

export const POSTURE_CATEGORIES: readonly PostureCategory[] = [
  'reporting',
  'offline',
  'unverified',
  'stale',
  'missing',
  'failed',
]

/** Categories that require an operator's attention. */
const ATTENTION_CATEGORIES: readonly PostureCategory[] = [
  'offline',
  'unverified',
  'stale',
  'missing',
  'failed',
]

export interface VehiclePosture {
  vehicle: Vehicle
  category: PostureCategory | 'pending'
  condition: FleetStateCondition
  status: VehicleStatus | null
  observedAt: number | null
  verified: boolean
}

export interface FleetPosture {
  /** Per-vehicle classification in roster order. */
  vehicles: VehiclePosture[]
  byVehicleId: Map<number, VehiclePosture>
  counts: Record<PostureCategory, number>
  /** Vehicles whose current operational state is defensible right now. */
  verifiedCount: number
  total: number
  attentionCount: number
  /** True until the first batch resolves. Not a claim about any vehicle. */
  pending: boolean
  summary: FleetStatesSummary
}

function emptyCounts(): Record<PostureCategory, number> {
  return { reporting: 0, offline: 0, unverified: 0, stale: 0, missing: 0, failed: 0 }
}

/**
 * Classify a fleet from its trust-aware entries.
 *
 * Pure and exported so the taxonomy is unit-testable without mounting the
 * panel, and so every consumer derives the same counts from the same rule.
 */
export function buildFleetPosture(
  vehicles: readonly Vehicle[],
  entries: readonly FleetStateEntry[] | undefined,
  now = Date.now(),
): FleetPosture {
  const entryById = new Map((entries ?? []).map((entry) => [entry.vehicle.id, entry]))
  const counts = emptyCounts()
  const list: VehiclePosture[] = []
  let verifiedCount = 0
  let pendingCount = 0

  for (const vehicle of vehicles) {
    const descriptor = describeFleetState(entryById.get(vehicle.id), now)
    let category: PostureCategory | 'pending'
    switch (descriptor.condition) {
      case 'pending':
        category = 'pending'
        pendingCount += 1
        break
      case 'live':
        // The ONLY route to an offline classification: the backend said so,
        // on a currently-verified reading.
        category = descriptor.status === 'offline' ? 'offline' : 'reporting'
        break
      default:
        category = descriptor.condition
        break
    }
    if (category !== 'pending') counts[category] += 1
    if (descriptor.verified) verifiedCount += 1
    list.push({
      vehicle,
      category,
      condition: descriptor.condition,
      status: descriptor.status,
      observedAt: descriptor.observedAt,
      verified: descriptor.verified,
    })
  }

  const attentionCount = ATTENTION_CATEGORIES.reduce((sum, key) => sum + counts[key], 0)

  return {
    vehicles: list,
    byVehicleId: new Map(list.map((item) => [item.vehicle.id, item])),
    counts,
    verifiedCount,
    total: vehicles.length,
    attentionCount,
    pending: vehicles.length > 0 && pendingCount === vehicles.length,
    summary: summariseFleetStates(entries ?? []),
  }
}

/**
 * Human age of an observation, i18n-backed.
 *
 * Re-exported from `@/lib/observationAge` so the fleet list and the preview
 * drawer phrase the same fact identically without a cross-feature import.
 */
export { formatObservationAge } from '@/lib/observationAge'
