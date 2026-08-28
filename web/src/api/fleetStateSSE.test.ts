import { describe, expect, it } from 'vitest'

import type { SignalChangeEvent, VehicleState } from '@/api/types'
import type { FleetStateEntry } from '@/api/hooks/useVehicles'
import type { Vehicle } from '@/types/vehicle'
import {
  advanceSignalSequence,
  patchFleetStateEntry,
  type SignalSequenceCursor,
} from './fleetStateSSE'

const NOW = Date.parse('2026-08-27T12:00:10Z')
const EVENT_AT = '2026-08-27T12:00:09Z'

function vehicle(): Vehicle {
  return {
    id: 7,
    vehicle_id: 7,
    vin: 'TESTVIN0000000001',
    display_name: 'Aurora',
    model: 'modely',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function state(): VehicleState {
  return {
    vehicle_id: 7,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 70,
    rated_range: 400_000,
    ideal_range: 420_000,
    odometer: 30_000_000,
    inside_temp: 20,
    outside_temp: 18,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '2026.8.1',
  }
}

function entry(overrides: Partial<FleetStateEntry> = {}): FleetStateEntry {
  return {
    vehicle: vehicle(),
    state: state(),
    outcome: 'resolved',
    freshness: 'fresh',
    verifiedFields: ['state'],
    stale: false,
    observedAt: Date.parse('2026-08-27T12:00:08Z'),
    receivedAt: NOW - 2_000,
    ...overrides,
  }
}

function event(overrides: Partial<SignalChangeEvent> = {}): SignalChangeEvent {
  return {
    stream_id: 'stream-a',
    sequence: 1,
    vehicle_id: 7,
    field: 'VehicleSpeed',
    kind: 'float',
    value: 12.5,
    ts: EVENT_AT,
    ...overrides,
  }
}

describe('advanceSignalSequence', () => {
  it('accepts the first and each contiguous event without recovery', () => {
    const first = advanceSignalSequence(null, event())
    expect(first).toEqual({
      cursor: { streamId: 'stream-a', sequence: 1 },
      accept: true,
      recover: false,
    })
    expect(advanceSignalSequence(first.cursor, event({ sequence: 2 }))).toMatchObject({
      accept: true,
      recover: false,
    })
  })

  it('detects gaps and stream restarts while rejecting duplicates', () => {
    const cursor: SignalSequenceCursor = { streamId: 'stream-a', sequence: 4 }
    expect(advanceSignalSequence(cursor, event({ sequence: 7 }))).toMatchObject({
      accept: true,
      recover: true,
    })
    expect(advanceSignalSequence(cursor, event({ sequence: 4 }))).toEqual({
      cursor,
      accept: false,
      recover: false,
    })
    expect(advanceSignalSequence(cursor, event({ stream_id: 'stream-b', sequence: 1 })))
      .toMatchObject({ accept: true, recover: true })
  })

  it('leaves rolling-upgrade frames to aggregate reconciliation', () => {
    expect(advanceSignalSequence(null, event({ stream_id: '', sequence: 0 }))).toEqual({
      cursor: null,
      accept: false,
      recover: false,
    })
  })
})

describe('patchFleetStateEntry', () => {
  it('patches a canonical field immediately and advances trust metadata', () => {
    const result = patchFleetStateEntry(entry(), event(), NOW)
    expect(result.kind).toBe('patched')
    if (result.kind !== 'patched') return
    expect(result.entry.state?.speed).toBe(12.5)
    expect(result.entry.verifiedFields).toContain('speed')
    expect(result.entry.observedAt).toBe(Date.parse(EVENT_AT))
    expect(result.entry.receivedAt).toBe(NOW)
    expect(result.entry.stale).toBe(false)
  })

  it('applies canonical charging-state semantics without waiting for a poll', () => {
    const result = patchFleetStateEntry(
      entry(),
      event({ field: 'DetailedChargeState', kind: 'string', value: 'Charging' }),
      NOW,
    )
    expect(result.kind).toBe('patched')
    if (result.kind !== 'patched') return
    expect(result.entry.state?.is_charging).toBe(true)
    expect(result.entry.verifiedFields).toContain('is_charging')
  })

  it('requests authoritative recovery for derived or precedence-sensitive signals', () => {
    expect(patchFleetStateEntry(entry(), event({ field: 'PackVoltage' }), NOW))
      .toEqual({ kind: 'recover' })
    expect(patchFleetStateEntry(entry(), event({ field: 'ChargeAmps' }), NOW))
      .toEqual({ kind: 'recover' })
  })

  it('does not regress state with an older observation', () => {
    const result = patchFleetStateEntry(
      entry({ observedAt: Date.parse('2026-08-27T12:00:09.500Z') }),
      event(),
      NOW,
    )
    expect(result).toEqual({ kind: 'recover' })
  })

  it('ignores unrelated vehicles and fields', () => {
    expect(patchFleetStateEntry(entry(), event({ vehicle_id: 9 }), NOW))
      .toEqual({ kind: 'ignored' })
    expect(patchFleetStateEntry(entry(), event({ field: 'Gear' }), NOW))
      .toEqual({ kind: 'ignored' })
  })
})
