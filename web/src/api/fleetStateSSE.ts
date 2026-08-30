import type { SignalChangeEvent, VehicleState } from '@/api/types'
import type {
  FleetStateEntry,
  VerifiedVehicleStateField,
} from '@/api/hooks/useVehicles'
import { isCharging, parseEnumBool } from '@/lib/parseEnums'
import { TELEMETRY_STALE_AFTER_MS } from '@/hooks/useTelemetryFreshness'

export interface SignalSequenceCursor {
  streamId: string
  sequence: number
}

export interface SignalSequenceDecision {
  cursor: SignalSequenceCursor | null
  accept: boolean
  recover: boolean
}

export type FleetStateSignalPatch =
  | { kind: 'patched'; entry: FleetStateEntry }
  | { kind: 'ignored' }
  | { kind: 'recover' }

type StateMutation =
  | { kind: 'patched'; state: VehicleState; field: VerifiedVehicleStateField }
  | { kind: 'ignored' }
  | { kind: 'recover' }

const MAX_FUTURE_SKEW_MS = 60_000

/**
 * Advances the SSE cursor without confusing a server restart with a dropped
 * frame. Legacy, unsequenced frames are ignored here and remain covered by the
 * aggregate vehicle_update reconciliation path during rolling upgrades.
 */
export function advanceSignalSequence(
  current: SignalSequenceCursor | null,
  event: SignalChangeEvent,
): SignalSequenceDecision {
  if (
    event.stream_id === '' ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence <= 0
  ) {
    return { cursor: current, accept: false, recover: false }
  }

  const next = { streamId: event.stream_id, sequence: event.sequence }
  if (current == null) return { cursor: next, accept: true, recover: false }
  if (current.streamId !== event.stream_id) {
    return { cursor: next, accept: true, recover: true }
  }
  if (event.sequence <= current.sequence) {
    return { cursor: current, accept: false, recover: false }
  }
  return {
    cursor: next,
    accept: true,
    recover: event.sequence !== current.sequence + 1,
  }
}

/**
 * Applies only signals whose mapping is identical to the backend's canonical
 * VehicleState assembler. Signals that require multi-field precedence (for
 * example AC/DC charging power or PackVoltage x PackCurrent) request one
 * authoritative reconcile instead of guessing in the browser.
 */
export function patchFleetStateEntry(
  entry: FleetStateEntry,
  event: SignalChangeEvent,
  now = Date.now(),
): FleetStateSignalPatch {
  if (entry.vehicle.id !== event.vehicle_id) return { kind: 'ignored' }
  if (entry.outcome !== 'resolved' || entry.state == null) return { kind: 'recover' }

  const observedAt = Date.parse(event.ts)
  if (
    !Number.isFinite(observedAt) ||
    observedAt <= 0 ||
    observedAt > now + MAX_FUTURE_SKEW_MS ||
    now - observedAt > TELEMETRY_STALE_AFTER_MS ||
    (entry.observedAt != null && observedAt < entry.observedAt)
  ) {
    return { kind: 'recover' }
  }

  const mutation = mutateVehicleState(entry.state, event)
  if (mutation.kind !== 'patched') return mutation

  const verifiedFields = new Set(entry.verifiedFields)
  verifiedFields.add(mutation.field)
  return {
    kind: 'patched',
    entry: {
      ...entry,
      state: mutation.state,
      freshness: 'fresh',
      verifiedFields: [...verifiedFields],
      stale: false,
      observedAt: Math.max(entry.observedAt ?? 0, observedAt),
      receivedAt: now,
      error: undefined,
    },
  }
}

function mutateVehicleState(
  current: VehicleState,
  event: SignalChangeEvent,
): StateMutation {
  const numberValue = finiteNumber(event.value)
  const stringValue = typeof event.value === 'string' ? event.value : null

  switch (event.field) {
    case 'VehicleSpeed':
      return numberValue == null
        ? { kind: 'recover' }
        : changed(current, 'speed', numberValue)
    case 'Odometer':
      return numberValue == null
        ? { kind: 'recover' }
        : changed(current, 'odometer', numberValue)
    case 'BatteryLevel':
      return numberValue == null
        ? { kind: 'recover' }
        : changed(current, 'battery_level', Math.trunc(numberValue))
    case 'IdealBatteryRange':
      return numberValue == null
        ? { kind: 'recover' }
        : changed(current, 'ideal_range', numberValue)
    case 'RatedRange':
      return numberValue == null
        ? { kind: 'recover' }
        : changed(current, 'rated_range', numberValue)
    case 'InsideTemp':
      return numberValue == null
        ? { kind: 'recover' }
        : changed(current, 'inside_temp', numberValue)
    case 'OutsideTemp':
      return numberValue == null
        ? { kind: 'recover' }
        : changed(current, 'outside_temp', numberValue)
    case 'LocationLatitude':
      return numberValue == null
        ? { kind: 'recover' }
        : changed(current, 'latitude', numberValue)
    case 'LocationLongitude':
      return numberValue == null
        ? { kind: 'recover' }
        : changed(current, 'longitude', numberValue)
    case 'GpsHeading':
      return numberValue == null
        ? { kind: 'recover' }
        : changed(current, 'heading', numberValue)
    case 'Power':
      return numberValue == null
        ? { kind: 'recover' }
        : changed(current, 'power', numberValue)
    case 'DetailedChargeState':
      return stringValue == null
        ? { kind: 'recover' }
        : changed(current, 'is_charging', isCharging(stringValue))
    case 'TimeToFullCharge':
      return numberValue == null
        ? { kind: 'recover' }
        : changed(current, 'time_to_full_charge', numberValue)
    case 'Locked':
      return changed(current, 'is_locked', parseEnumBool(event.value))
    case 'SentryMode':
      return changed(current, 'sentry_mode', parseEnumBool(event.value))
    case 'Version':
      return stringValue == null || stringValue === ''
        ? { kind: 'recover' }
        : changed(current, 'software_version', stringValue)
    case 'HvacPower':
      return changed(current, 'is_climate_on', parseEnumBool(event.value))

    // These values participate in fallback or multi-signal precedence in the
    // Go assembler. An HTTP reconcile preserves that contract exactly.
    case 'Soc':
    case 'EstBatteryRange':
    case 'Latitude':
    case 'Longitude':
    case 'PackVoltage':
    case 'PackCurrent':
    case 'ACChargingPower':
    case 'DCChargingPower':
    case 'ChargeAmps':
    case 'ChargeRateMilePerHour':
    case 'SoftwareUpdateVersion':
      return { kind: 'recover' }
    default:
      return { kind: 'ignored' }
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function changed<K extends VerifiedVehicleStateField>(
  state: VehicleState,
  field: K,
  value: VehicleState[K],
): StateMutation {
  return {
    kind: 'patched',
    state: { ...state, [field]: value },
    field,
  }
}
