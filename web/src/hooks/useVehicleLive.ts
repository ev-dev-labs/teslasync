import { useEffect, useCallback, useState, useRef } from 'react'
import { useRealtimeEvents } from './useRealtimeEvents'

/**
 * Vehicle live state from the in-memory SignalStore via SSE.
 * Always complete — never has null fields for known signals.
 * Replaces polling multiple endpoints every 3-5 seconds.
 */
export interface VehicleLiveState {
  // Driving
  speed: number
  odometer: number
  gear: string
  power: number
  heading: number

  // Battery / Range
  batteryLevel: number
  soc: number
  idealRange: number
  ratedRange: number
  estRange: number
  energyRemaining: number

  // Location
  latitude: number
  longitude: number

  // Climate
  insideTemp: number
  outsideTemp: number
  hvacPower: boolean
  fanSpeed: number

  // Charging
  chargeState: string
  detailedChargeState: string
  chargerVoltage: number
  chargeAmps: number
  chargeRate: number
  chargerPower: number
  chargeLimitSoc: number
  timeToFullCharge: number
  isCharging: boolean

  // Security
  locked: boolean
  sentryMode: boolean
  doorState: string
  centerDisplay: string

  // Tire Pressure
  tirePressureFl: number
  tirePressureFr: number
  tirePressureRl: number
  tirePressureRr: number

  // Vehicle Info
  vehicleName: string
  carType: string
  version: string
  wheelType: string
  exteriorColor: string

  // Meta
  lastUpdated: Date | null
  signalCount: number
}

const EMPTY_STATE: VehicleLiveState = {
  speed: 0, odometer: 0, gear: '', power: 0, heading: 0,
  batteryLevel: 0, soc: 0, idealRange: 0, ratedRange: 0, estRange: 0, energyRemaining: 0,
  latitude: 0, longitude: 0,
  insideTemp: 0, outsideTemp: 0, hvacPower: false, fanSpeed: 0,
  chargeState: '', detailedChargeState: '', chargerVoltage: 0, chargeAmps: 0,
  chargeRate: 0, chargerPower: 0, chargeLimitSoc: 0, timeToFullCharge: 0, isCharging: false,
  locked: false, sentryMode: false, doorState: '', centerDisplay: '',
  tirePressureFl: 0, tirePressureFr: 0, tirePressureRl: 0, tirePressureRr: 0,
  vehicleName: '', carType: '', version: '', wheelType: '', exteriorColor: '',
  lastUpdated: null, signalCount: 0,
}

function parseSignals(raw: Record<string, unknown>): Partial<VehicleLiveState> {
  const s: Partial<VehicleLiveState> = {}
  const n = (key: string): number => {
    const v = raw[key]
    return typeof v === 'number' ? v : 0
  }
  const str = (key: string): string => {
    const v = raw[key]
    return typeof v === 'string' ? v : ''
  }
  const bool = (key: string): boolean => {
    const v = raw[key]
    if (typeof v === 'boolean') return v
    if (typeof v === 'string') return !v.includes('Off') && v !== 'false' && v !== ''
    return false
  }

  // Driving
  if (raw['VehicleSpeed'] != null) s.speed = n('VehicleSpeed')
  if (raw['Odometer'] != null) s.odometer = n('Odometer')
  if (raw['Gear'] != null) s.gear = str('Gear')
  if (raw['GpsHeading'] != null) s.heading = n('GpsHeading')

  // Power (computed or direct)
  if (raw['Power'] != null) {
    s.power = n('Power')
  } else if (raw['PackVoltage'] != null && raw['PackCurrent'] != null) {
    s.power = n('PackVoltage') * n('PackCurrent') / 1000
  }

  // Battery
  if (raw['BatteryLevel'] != null) s.batteryLevel = Math.round(n('BatteryLevel'))
  if (raw['Soc'] != null) s.soc = n('Soc')
  if (raw['IdealBatteryRange'] != null) s.idealRange = n('IdealBatteryRange')
  if (raw['RatedRange'] != null) s.ratedRange = n('RatedRange')
  if (raw['EstBatteryRange'] != null) s.estRange = n('EstBatteryRange')
  if (raw['EnergyRemaining'] != null) s.energyRemaining = n('EnergyRemaining')

  // Location
  if (raw['Location'] != null && typeof raw['Location'] === 'object') {
    const loc = raw['Location'] as Record<string, unknown>
    if (loc['latitude'] != null) s.latitude = loc['latitude'] as number
    if (loc['longitude'] != null) s.longitude = loc['longitude'] as number
  }
  if (raw['Latitude'] != null) s.latitude = n('Latitude')
  if (raw['Longitude'] != null) s.longitude = n('Longitude')

  // Climate
  if (raw['InsideTemp'] != null) s.insideTemp = n('InsideTemp')
  if (raw['OutsideTemp'] != null) s.outsideTemp = n('OutsideTemp')
  if (raw['HvacPower'] != null) s.hvacPower = bool('HvacPower')
  if (raw['HvacFanSpeed'] != null) s.fanSpeed = Math.round(n('HvacFanSpeed'))

  // Charging
  if (raw['ChargeState'] != null) s.chargeState = str('ChargeState')
  if (raw['DetailedChargeState'] != null) s.detailedChargeState = str('DetailedChargeState')
  if (raw['ChargerVoltage'] != null) s.chargerVoltage = n('ChargerVoltage')
  if (raw['ChargeAmps'] != null) s.chargeAmps = n('ChargeAmps')
  if (raw['ChargeRateMilePerHour'] != null) s.chargeRate = n('ChargeRateMilePerHour')
  if (raw['DCChargingPower'] != null) s.chargerPower = n('DCChargingPower')
  else if (raw['ACChargingPower'] != null) s.chargerPower = n('ACChargingPower')
  if (raw['ChargeLimitSoc'] != null) s.chargeLimitSoc = Math.round(n('ChargeLimitSoc'))
  if (raw['TimeToFullCharge'] != null) s.timeToFullCharge = n('TimeToFullCharge')
  
  // Derive isCharging
  const dcs = str('DetailedChargeState')
  if (dcs.includes('Charging') || dcs.includes('Starting')) s.isCharging = true
  else if (n('ChargeAmps') > 1) s.isCharging = true

  // Security
  if (raw['Locked'] != null) s.locked = bool('Locked')
  if (raw['SentryMode'] != null) s.sentryMode = bool('SentryMode')
  if (raw['DoorState'] != null) s.doorState = str('DoorState')
  if (raw['CenterDisplay'] != null) s.centerDisplay = str('CenterDisplay')

  // Tire Pressure
  if (raw['TpmsPressureFl'] != null) s.tirePressureFl = n('TpmsPressureFl')
  if (raw['TpmsPressureFr'] != null) s.tirePressureFr = n('TpmsPressureFr')
  if (raw['TpmsPressureRl'] != null) s.tirePressureRl = n('TpmsPressureRl')
  if (raw['TpmsPressureRr'] != null) s.tirePressureRr = n('TpmsPressureRr')

  // Vehicle Info
  if (raw['VehicleName'] != null) s.vehicleName = str('VehicleName')
  if (raw['CarType'] != null) s.carType = str('CarType')
  if (raw['Version'] != null) s.version = str('Version')
  if (raw['WheelType'] != null) s.wheelType = str('WheelType')
  if (raw['ExteriorColor'] != null) s.exteriorColor = str('ExteriorColor')

  return s
}

/**
 * Hook that provides always-complete vehicle live state via SSE.
 * Merges incoming signal updates into the state — never loses known values.
 * 
 * Usage:
 * ```
 * const { state, connected } = useVehicleLive(vehicleId)
 * // state.speed, state.batteryLevel, state.odometer — always populated
 * ```
 */
export function useVehicleLive(vehicleId?: number) {
  const [state, setState] = useState<VehicleLiveState>({ ...EMPTY_STATE })
  const stateRef = useRef(state)
  stateRef.current = state

  const handleUpdate = useCallback((data: unknown) => {
    const update = data as { vehicle_id?: number; state?: Record<string, unknown>; signals?: Record<string, unknown> }
    if (vehicleId && update.vehicle_id !== vehicleId) return

    // Prefer complete state from SignalStore, fall back to partial signals
    const raw = update.state || update.signals
    if (!raw) return

    const parsed = parseSignals(raw)
    setState(prev => ({
      ...prev,
      ...parsed,
      lastUpdated: new Date(),
      signalCount: Object.keys(raw).length,
    }))
  }, [vehicleId])

  const { connected } = useRealtimeEvents({
    onVehicleUpdate: handleUpdate,
    enabled: true,
  })

  // Initial fetch from the live API endpoint
  useEffect(() => {
    if (!vehicleId) return
    fetch(`/api/v1/signals/${vehicleId}/live`)
      .then(r => r.json())
      .then(data => {
        if (data.signals) {
          const parsed = parseSignals(data.signals)
          setState(prev => ({
            ...prev,
            ...parsed,
            lastUpdated: new Date(),
            signalCount: Object.keys(data.signals).length,
          }))
        }
      })
      .catch(() => {}) // Silent fail — SSE will provide updates
  }, [vehicleId])

  return { state, connected }
}
