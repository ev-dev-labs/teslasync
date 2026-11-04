import { describe, expect, it } from 'vitest'
import type { LiveSignalsResponse, SignalEnvelope } from '@/api/types'
import { deriveVehicleLabState, mapVehiclePartStates } from './vehicleLabState'

const now = Date.parse('2026-11-01T12:00:00Z')
function response(values: Record<string, SignalEnvelope['value']>, age = 0): LiveSignalsResponse {
  return {
    vehicle_id: 7, count: Object.keys(values).length, at: new Date(now).toISOString(),
    signals: Object.fromEntries(Object.entries(values).map(([field, value]) => [
      field, { kind: typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'float' : 'enum', value, ts: new Date(now - age).toISOString() },
    ])),
  }
}

it('keeps every absent part unknown instead of reporting closed or normal', () => {
  const state = deriveVehicleLabState(null, now)
  expect(Object.values(mapVehiclePartStates(state))).toEqual(Array(17).fill('unknown'))
  expect(state).toMatchObject({ locked: null, charging: null, climateOn: null, batteryPercent: null, rangeM: null, observedAt: null })
})

describe.each([
  ['DoorStateDriverFront', 'doorFrontLeft'], ['DoorStatePassengerFront', 'doorFrontRight'],
  ['DoorStateDriverRear', 'doorRearLeft'], ['DoorStatePassengerRear', 'doorRearRight'],
  ['DoorStateFrontTrunk', 'frunk'], ['DoorStateRearTrunk', 'trunk'], ['ChargePortDoorOpen', 'chargePort'],
] as const)('%s', (signal, part) => {
  it.each([[true, 'open'], [false, 'closed'], ['false', 'unknown'], [null, 'unknown']] as const)('maps %s to %s without coercion', (value, expected) => {
    expect(mapVehiclePartStates(deriveVehicleLabState(response({ [signal]: value }), now))[part]).toBe(expected)
  })
})

it.each([
  ['FdWindow', 'windowFrontLeft'], ['FpWindow', 'windowFrontRight'],
  ['RdWindow', 'windowRearLeft'], ['RpWindow', 'windowRearRight'],
] as const)('preserves partial %s state and does not infer a fully open window', (field, part) => {
  expect(mapVehiclePartStates(deriveVehicleLabState(response({ [field]: 'PartiallyOpen' }), now))[part]).toBe('partial')
  expect(mapVehiclePartStates(deriveVehicleLabState(response({ [field]: 'Opened' }), now))[part]).toBe('open')
  expect(mapVehiclePartStates(deriveVehicleLabState(response({ [field]: 'Closed' }), now))[part]).toBe('closed')
})

it('preserves measured zeroes and SI values, rejects out-of-range values and unknown enums', () => {
  const state = deriveVehicleLabState(response({
    Soc: 0, RatedRange: 0, VehicleSpeed: 0, InsideTemp: 0, OutsideTemp: -8,
    TpmsPressureFl: 0, TpmsPressureFr: -1, Gear: 'D', Locked: false,
    SentryMode: 'Off', HvacPower: 'Unknown', ChargeState: 'Unknown',
  }), now)
  expect(state).toMatchObject({
    batteryPercent: 0, rangeM: 0, speedMps: 0, insideTempC: 0, outsideTempC: -8,
    tirePressurePa: { FrontLeft: 0, FrontRight: null }, gear: 'D', locked: false,
    sentry: false, climateOn: null, charging: null,
  })
  expect(deriveVehicleLabState(response({ Soc: 101, RatedRange: -1 }), now)).toMatchObject({ batteryPercent: null, rangeM: null })
})

it('expires per-field observations even when the response was fetched just now', () => {
  const old = response({ DoorStateDriverFront: true, BatteryLevel: 72 }, 120_001)
  old.signals.DoorStatePassengerFront = response({ DoorStatePassengerFront: false }).signals.DoorStatePassengerFront
  const state = deriveVehicleLabState(old, now)
  expect(state.doors).toMatchObject({ FrontLeft: 'unknown', FrontRight: 'closed' })
  expect(state.batteryPercent).toBeNull()
  expect(state.stale).toBe(true)
})

it('rejects future or malformed clocks instead of treating them as current readings', () => {
  const data = response({ Soc: 72, Locked: true })
  data.signals.Soc.ts = new Date(now + 1).toISOString()
  data.signals.Locked.ts = 'not-a-time'
  expect(deriveVehicleLabState(data, now)).toMatchObject({ batteryPercent: null, locked: null, observedAt: null })
})

it.each(['Charging', 'Starting'])('marks %s as charging while retaining canonical security and climate flags', charge => {
  const state = deriveVehicleLabState(response({ ChargeState: charge, SentryMode: 'Armed', HvacPower: 'On' }), now)
  expect(state).toMatchObject({ charging: true, sentry: true, climateOn: true })
})
