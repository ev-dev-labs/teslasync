import type { LiveSignalsResponse, SignalEnvelope } from '@/api/types'
import { TELEMETRY_STALE_AFTER_MS } from '@/hooks/useTelemetryFreshness'
import { asFiniteNumber } from '@/lib/typeGuards'
import type { VehiclePart } from './partMapping'

export type OpeningState = 'open' | 'closed' | 'partial' | 'unknown'
export type WheelPosition = 'FrontLeft' | 'FrontRight' | 'RearLeft' | 'RearRight'
export type PartState = OpeningState | 'available'

export interface VehicleLabState {
  doors: Record<WheelPosition, OpeningState>
  windows: Record<WheelPosition, OpeningState>
  frunk: OpeningState
  trunk: OpeningState
  chargePort: OpeningState
  charging: boolean | null
  locked: boolean | null
  sentry: boolean | null
  tirePressurePa: Record<WheelPosition, number | null>
  insideTempC: number | null
  outsideTempC: number | null
  climateOn: boolean | null
  batteryPercent: number | null
  rangeM: number | null
  gear: 'P' | 'R' | 'N' | 'D' | null
  speedMps: number | null
  observedAt: number | null
  stale: boolean
}

function opening(value: unknown): OpeningState {
  return value === true ? 'open' : value === false ? 'closed' : 'unknown'
}

function enumFlag(value: unknown, enabled: readonly string[], disabled: readonly string[]): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  return enabled.includes(value) ? true : disabled.includes(value) ? false : null
}

export function deriveVehicleLabState(response: LiveSignalsResponse | null | undefined, now = Date.now()): VehicleLabState {
  const signals = response?.signals ?? {}
  let observedAt: number | null = null
  let stale = false
  function read(name: string) {
    const signal: SignalEnvelope | undefined = signals[name]
    if (!signal) return null
    const time = Date.parse(signal.ts)
    if (!Number.isFinite(time) || time > now) return null
    observedAt = Math.max(observedAt ?? time, time)
    if (now - time > TELEMETRY_STALE_AFTER_MS) { stale = true; return null }
    return signal.value
  }
  function number(name: string, min = -Infinity, max = Infinity) {
    const value = asFiniteNumber(read(name))
    return value !== null && value >= min && value <= max ? value : null
  }
  function window(name: string): OpeningState {
    const value = read(name)
    return value === 'Opened' ? 'open' : value === 'Closed' ? 'closed'
      : value === 'PartiallyOpen' ? 'partial' : 'unknown'
  }
  const gear = read('Gear')
  const values: Omit<VehicleLabState, 'observedAt' | 'stale'> = {
    doors: {
      FrontLeft: opening(read('DoorStateDriverFront')), FrontRight: opening(read('DoorStatePassengerFront')),
      RearLeft: opening(read('DoorStateDriverRear')), RearRight: opening(read('DoorStatePassengerRear')),
    },
    windows: {
      FrontLeft: window('FdWindow'), FrontRight: window('FpWindow'),
      RearLeft: window('RdWindow'), RearRight: window('RpWindow'),
    },
    frunk: opening(read('DoorStateFrontTrunk')),
    trunk: opening(read('DoorStateRearTrunk')),
    chargePort: opening(read('ChargePortDoorOpen')),
    charging: enumFlag(read('ChargeState'), ['Charging', 'Starting'], ['Complete', 'Stopped', 'Disconnected', 'NoPower']),
    locked: enumFlag(read('Locked'), [], []),
    sentry: enumFlag(read('SentryMode'), ['Idle', 'Armed', 'Aware', 'Panic', 'Quiet'], ['Off']),
    tirePressurePa: {
      FrontLeft: number('TpmsPressureFl', 0), FrontRight: number('TpmsPressureFr', 0),
      RearLeft: number('TpmsPressureRl', 0), RearRight: number('TpmsPressureRr', 0),
    },
    insideTempC: number('InsideTemp'), outsideTempC: number('OutsideTemp'),
    climateOn: enumFlag(read('HvacPower'), ['On', 'Precondition', 'OverheatProtect'], ['Off']),
    batteryPercent: number('Soc', 0, 100) ?? number('BatteryLevel', 0, 100),
    rangeM: number('RatedRange', 0),
    gear: gear === 'P' || gear === 'R' || gear === 'N' || gear === 'D' ? gear : null,
    speedMps: number('VehicleSpeed'),
  }
  return { ...values, observedAt, stale }
}

export function mapVehiclePartStates(state: VehicleLabState): Record<VehiclePart, PartState> {
  return {
    doorFrontLeft: state.doors.FrontLeft, doorFrontRight: state.doors.FrontRight,
    doorRearLeft: state.doors.RearLeft, doorRearRight: state.doors.RearRight,
    windowFrontLeft: state.windows.FrontLeft, windowFrontRight: state.windows.FrontRight,
    windowRearLeft: state.windows.RearLeft, windowRearRight: state.windows.RearRight,
    frunk: state.frunk, trunk: state.trunk, chargePort: state.chargePort,
    wheelFrontLeft: state.tirePressurePa.FrontLeft === null ? 'unknown' : 'available',
    wheelFrontRight: state.tirePressurePa.FrontRight === null ? 'unknown' : 'available',
    wheelRearLeft: state.tirePressurePa.RearLeft === null ? 'unknown' : 'available',
    wheelRearRight: state.tirePressurePa.RearRight === null ? 'unknown' : 'available',
    // High-beam and turn-signal flags do not establish all exterior lamp states.
    headlights: 'unknown', taillights: 'unknown',
  }
}
