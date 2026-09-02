import { renderHook, act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Controllable fakes for the two dependencies of useVehicleLive. ──
// `capturedOnVehicleUpdate` lets a test push a live SSE payload straight into
// the hook; `capturedEnabled` records the flag the hook passes through;
// `mockConnected` drives the connection status; and `mockInitialData` stands
// in for the react-query snapshot returned by useVehicleLiveSignals (the
// initial hydration source). They are only dereferenced inside the mock
// functions, which run at test time, so plain `let` bindings are safe here.
let capturedOnVehicleUpdate: ((data: unknown) => void) | undefined
let capturedEnabled: boolean | undefined
let mockConnected = false
let mockInitialData:
  | { vehicle_id?: number; signals?: Record<string, unknown> }
  | undefined

vi.mock('./useRealtimeEvents', () => ({
  useRealtimeEvents: (opts: {
    onVehicleUpdate?: (data: unknown) => void
    enabled?: boolean
  }) => {
    capturedOnVehicleUpdate = opts.onVehicleUpdate
    capturedEnabled = opts.enabled
    return {
      connected: mockConnected,
      state: mockConnected ? 'connected' : 'reconnecting',
      diagnostics: {},
    }
  },
}))

vi.mock('@/api/hooks/useTelemetry', () => ({
  useVehicleLiveSignals: () => ({ data: mockInitialData }),
  telemetryKeys: {
    liveSignals: (vehicleId?: number) => ['live-signals', vehicleId] as const,
  },
}))

// `useLiveRecovery` needs a QueryClient; this suite renders the hook bare.
// Swapping in a spy keeps the existing render calls provider-free while still
// letting us assert that the reconnect-recovery wiring is present.
const liveRecoverySpy = vi.fn()
vi.mock('./useLiveRecovery', () => ({
  useLiveRecovery: (opts: unknown) => liveRecoverySpy(opts),
}))

// Import AFTER the mocks are registered so the hook binds to the fakes.
import { useVehicleLive } from './useVehicleLive'

/** Fire a live `vehicle_update` payload through the captured SSE handler. */
function emit(payload: unknown) {
  act(() => {
    capturedOnVehicleUpdate?.(payload)
  })
}

describe('useVehicleLive', () => {
  beforeEach(() => {
    capturedOnVehicleUpdate = undefined
    capturedEnabled = undefined
    mockConnected = false
    mockInitialData = undefined
    liveRecoverySpy.mockClear()
  })

  it('arms SSE reconnect recovery for the live-signals read', () => {
    // Redis Pub/Sub never replays, so a reconnect MUST trigger a canonical
    // re-read or this hook silently keeps whatever it had before the outage.
    renderHook(() => useVehicleLive(7))
    expect(liveRecoverySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKeys: [['live-signals', 7]],
        enabled: true,
      }),
    )
  })

  it('does not arm recovery without a vehicle', () => {
    renderHook(() => useVehicleLive(undefined))
    expect(liveRecoverySpy).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    )
  })

  it('starts with a complete, zeroed state and a disconnected flag', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    expect(result.current.connected).toBe(false)
    // Representative fields from several categories are present (never
    // undefined) so consumers can read them without null guards.
    expect(result.current.state.speed).toBe(0)
    expect(result.current.state.gear).toBe('')
    expect(result.current.state.isCharging).toBe(false)
    expect(result.current.state.tirePressureFl).toBe(0)
    expect(result.current.state.lastUpdated).toBeNull()
    expect(result.current.state.signalCount).toBe(0)
  })

  it('subscribes with realtime events enabled and mirrors the connected flag', () => {
    mockConnected = true
    const { result } = renderHook(() => useVehicleLive(1))
    expect(capturedEnabled).toBe(true)
    expect(typeof capturedOnVehicleUpdate).toBe('function')
    expect(result.current.connected).toBe(true)
  })

  it('parses and rounds driving/battery signals from a live state payload', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    emit({
      vehicle_id: 1,
      state: {
        VehicleSpeed: 65,
        Odometer: 12345.6,
        Gear: 'D',
        BatteryLevel: 80.6,
        Soc: 80.4,
        HvacFanSpeed: 3.7,
      },
    })
    expect(result.current.state.speed).toBe(65)
    expect(result.current.state.odometer).toBe(12345.6)
    expect(result.current.state.gear).toBe('D')
    expect(result.current.state.batteryLevel).toBe(81) // Math.round
    expect(result.current.state.soc).toBe(80.4)
    expect(result.current.state.fanSpeed).toBe(4) // Math.round
    expect(result.current.state.lastUpdated).toBeInstanceOf(Date)
    expect(result.current.state.signalCount).toBe(6)
  })

  it('ignores updates addressed to a different vehicle id', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    emit({ vehicle_id: 2, state: { VehicleSpeed: 99 } })
    expect(result.current.state.speed).toBe(0)
    expect(result.current.state.lastUpdated).toBeNull()
    // A matching update is still applied.
    emit({ vehicle_id: 1, state: { VehicleSpeed: 42 } })
    expect(result.current.state.speed).toBe(42)
  })

  it('accepts updates for any vehicle when no vehicleId is provided', () => {
    const { result } = renderHook(() => useVehicleLive())
    emit({ vehicle_id: 7, state: { VehicleSpeed: 30 } })
    expect(result.current.state.speed).toBe(30)
  })

  it('merges partial updates without losing previously known values', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    emit({ vehicle_id: 1, state: { VehicleSpeed: 50 } })
    emit({ vehicle_id: 1, state: { BatteryLevel: 60 } })
    expect(result.current.state.speed).toBe(50) // retained across updates
    expect(result.current.state.batteryLevel).toBe(60)
    expect(result.current.state.signalCount).toBe(1) // count reflects the last raw
  })

  it('derives power from pack voltage × current, preferring a direct Power reading', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    emit({ vehicle_id: 1, state: { PackVoltage: 400, PackCurrent: 100 } })
    expect(result.current.state.power).toBe(40) // 400 * 100 / 1000
    expect(result.current.state.packVoltage).toBe(400)
    expect(result.current.state.packCurrent).toBe(100)
    emit({ vehicle_id: 1, state: { Power: 25 } })
    expect(result.current.state.power).toBe(25)
  })

  it('surfaces charge-port latch and trip-meter counters without inventing zeros from absence', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    emit({
      vehicle_id: 1,
      state: {
        ChargePortLatch: 'Engaged',
        SelfDrivingMilesSinceReset: 16093.44,
        MilesSinceReset: 32186.88,
      },
    })
    expect(result.current.state.chargePortLatch).toBe('Engaged')
    expect(result.current.state.fsdDistanceM).toBe(16093.44)
    expect(result.current.state.drivingDistanceM).toBe(32186.88)
  })

  it('derives isCharging and clears it again when charging stops (regression)', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    emit({ vehicle_id: 1, state: { DetailedChargeState: 'DetailedChargeStateCharging' } })
    expect(result.current.state.isCharging).toBe(true)
    // Charging finished: state no longer indicates charging and amps drop to 0.
    // Previously isCharging was sticky-true and never reset — guard against it.
    emit({
      vehicle_id: 1,
      state: { DetailedChargeState: 'DetailedChargeStateComplete', ChargeAmps: 0 },
    })
    expect(result.current.state.isCharging).toBe(false)
  })

  it('flags isCharging from a meaningful charge current alone', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    emit({ vehicle_id: 1, state: { ChargeAmps: 16 } })
    expect(result.current.state.isCharging).toBe(true)
  })

  it('normalizes Tesla enum + buckle-status signals to booleans', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    emit({
      vehicle_id: 1,
      state: {
        Locked: 'true',
        SentryMode: 'SentryModeStateOff',
        HvacPower: 'HvacPowerStateOn',
        DriverSeatBelt: 'BuckleStatusLatched',
        PassengerSeatBelt: 'BuckleStatusUnlatched',
      },
    })
    expect(result.current.state.locked).toBe(true)
    expect(result.current.state.sentryMode).toBe(false) // enum contains "Off"
    expect(result.current.state.hvacPower).toBe(true)
    expect(result.current.state.driverSeatBelt).toBe(true)
    expect(result.current.state.passengerSeatBelt).toBe(false)
  })

  it('prefers explicit Latitude/Longitude over the Location object', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    emit({
      vehicle_id: 1,
      state: { Location: { latitude: 10, longitude: 20 }, Latitude: 11, Longitude: 21 },
    })
    expect(result.current.state.latitude).toBe(11)
    expect(result.current.state.longitude).toBe(21)
  })

  it('reads coordinates from a nested Location object when no scalar is present', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    emit({ vehicle_id: 1, state: { Location: { latitude: 51.5, longitude: -0.12 } } })
    expect(result.current.state.latitude).toBe(51.5)
    expect(result.current.state.longitude).toBe(-0.12)
  })

  it('serializes a structured DoorState object to a string', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    emit({ vehicle_id: 1, state: { DoorState: { DriverFront: true } } })
    expect(result.current.state.doorState).toBe(JSON.stringify({ DriverFront: true }))
  })

  it('falls back to the signals map when no complete state is present', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    emit({ vehicle_id: 1, signals: { VehicleSpeed: 33 } })
    expect(result.current.state.speed).toBe(33)
  })

  it('ignores payloads that carry neither state nor signals', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    emit({ vehicle_id: 1 })
    expect(result.current.state.lastUpdated).toBeNull()
    expect(result.current.state.signalCount).toBe(0)
  })

  it('prefers DC charging power over AC when both are present', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    emit({ vehicle_id: 1, state: { DCChargingPower: 150, ACChargingPower: 11 } })
    expect(result.current.state.chargerPower).toBe(150)
  })

  it('maps charge-rate, rounds charge-limit, and reads navigation signals', () => {
    const { result } = renderHook(() => useVehicleLive(1))
    emit({
      vehicle_id: 1,
      state: {
        ChargeRateMilePerHour: 30,
        ChargeLimitSoc: 79.6,
        ChargerVoltage: 240,
        ChargeAmps: 32,
        MilesToArrival: 12.4,
        MinutesToArrival: 18,
        DestinationName: 'Home',
      },
    })
    expect(result.current.state.chargeRate).toBe(30)
    expect(result.current.state.chargeLimitSoc).toBe(80) // Math.round
    expect(result.current.state.chargerVoltage).toBe(240)
    expect(result.current.state.distanceToArrival).toBe(12.4)
    expect(result.current.state.minutesToArrival).toBe(18)
    expect(result.current.state.destinationName).toBe('Home')
    expect(result.current.state.isCharging).toBe(true) // 32A > 1A threshold
  })

  it('hydrates initial state from the live-signals snapshot, unwrapping typed envelopes', async () => {
    mockInitialData = {
      signals: {
        VehicleSpeed: { value: 42 }, // Phase-42 typed envelope { value, kind, ... }
        Gear: { value: 'P' },
        BatteryLevel: 55, // legacy bare scalar
      },
    }
    const { result } = renderHook(() => useVehicleLive(1))
    await waitFor(() => expect(result.current.state.speed).toBe(42))
    expect(result.current.state.gear).toBe('P')
    expect(result.current.state.batteryLevel).toBe(55)
    expect(result.current.state.signalCount).toBe(3)
    expect(result.current.state.lastUpdated).toBeInstanceOf(Date)
  })
})
