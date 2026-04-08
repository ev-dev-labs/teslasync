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
  fdWindow: string
  fpWindow: string
  rdWindow: string
  rpWindow: string

  // Vehicle State — Access Modes
  guestMode: boolean
  guestMobileAccess: string
  valetMode: boolean
  serviceMode: boolean
  speedLimitMode: boolean
  currentSpeedLimit: number

  // Vehicle State — Lights
  lightsHazards: boolean
  lightsHighBeams: boolean
  lightsTurnSignal: string

  // Vehicle State — Driver & Keys
  driverSeatOccupied: boolean
  pairedKeyCount: number

  // Vehicle State — Homelink
  homelinkNearby: boolean
  homelinkDeviceCount: number

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
  trim: string
  roofColor: string
  efficiencyPackage: string
  rearSeatHeaters: string
  sunroofInstalled: string
  europeVehicle: boolean
  rightHandDrive: boolean
  remoteStartEnabled: boolean
  offroadLightbar: boolean

  // Navigation
  destinationName: string
  destinationLatitude: number
  destinationLongitude: number
  distanceToArrival: number
  minutesToArrival: number
  routeLine: string
  locatedAtHome: boolean
  locatedAtWork: boolean
  locatedAtFavorite: boolean
  gpsState: boolean
  originLatitude: number
  originLongitude: number

  // Software Update (live progress)
  swUpdateVersion: string
  swUpdateDownloadPct: number
  swUpdateInstallPct: number
  swUpdateExpectedMin: number
  swUpdateScheduledStart: string

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
  fdWindow: '', fpWindow: '', rdWindow: '', rpWindow: '',
  guestMode: false, guestMobileAccess: '', valetMode: false, serviceMode: false,
  speedLimitMode: false, currentSpeedLimit: 0,
  lightsHazards: false, lightsHighBeams: false, lightsTurnSignal: '',
  driverSeatOccupied: false, pairedKeyCount: 0,
  homelinkNearby: false, homelinkDeviceCount: 0,
  tirePressureFl: 0, tirePressureFr: 0, tirePressureRl: 0, tirePressureRr: 0,
  vehicleName: '', carType: '', version: '', wheelType: '', exteriorColor: '',
  trim: '', roofColor: '', efficiencyPackage: '', rearSeatHeaters: '', sunroofInstalled: '',
  europeVehicle: false, rightHandDrive: false, remoteStartEnabled: false, offroadLightbar: false,
  destinationName: '', destinationLatitude: 0, destinationLongitude: 0,
  distanceToArrival: 0, minutesToArrival: 0, routeLine: '',
  locatedAtHome: false, locatedAtWork: false, locatedAtFavorite: false,
  gpsState: false, originLatitude: 0, originLongitude: 0,
  swUpdateVersion: '', swUpdateDownloadPct: 0, swUpdateInstallPct: 0,
  swUpdateExpectedMin: 0, swUpdateScheduledStart: '',
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
  if (raw['FdWindow'] != null) s.fdWindow = str('FdWindow')
  if (raw['FpWindow'] != null) s.fpWindow = str('FpWindow')
  if (raw['RdWindow'] != null) s.rdWindow = str('RdWindow')
  if (raw['RpWindow'] != null) s.rpWindow = str('RpWindow')

  // Vehicle State — Access Modes
  if (raw['GuestModeEnabled'] != null) s.guestMode = bool('GuestModeEnabled')
  if (raw['GuestModeMobileAccessState'] != null) s.guestMobileAccess = str('GuestModeMobileAccessState')
  if (raw['ValetModeEnabled'] != null) s.valetMode = bool('ValetModeEnabled')
  if (raw['ServiceMode'] != null) s.serviceMode = bool('ServiceMode')
  if (raw['SpeedLimitMode'] != null) s.speedLimitMode = bool('SpeedLimitMode')
  if (raw['CurrentLimitMph'] != null) s.currentSpeedLimit = n('CurrentLimitMph')

  // Vehicle State — Lights
  if (raw['LightsHazardsActive'] != null) s.lightsHazards = bool('LightsHazardsActive')
  if (raw['LightsHighBeams'] != null) s.lightsHighBeams = bool('LightsHighBeams')
  if (raw['LightsTurnSignal'] != null) s.lightsTurnSignal = str('LightsTurnSignal')

  // Vehicle State — Driver & Keys
  if (raw['DriverSeatOccupied'] != null) s.driverSeatOccupied = bool('DriverSeatOccupied')
  if (raw['PairedPhoneKeyAndKeyFobQty'] != null) s.pairedKeyCount = n('PairedPhoneKeyAndKeyFobQty')

  // Vehicle State — Homelink
  if (raw['HomelinkNearby'] != null) s.homelinkNearby = bool('HomelinkNearby')
  if (raw['HomelinkDeviceCount'] != null) s.homelinkDeviceCount = n('HomelinkDeviceCount')

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
  if (raw['Trim'] != null) s.trim = str('Trim')
  if (raw['RoofColor'] != null) s.roofColor = str('RoofColor')
  if (raw['EfficiencyPackage'] != null) s.efficiencyPackage = str('EfficiencyPackage')
  if (raw['RearSeatHeaters'] != null) s.rearSeatHeaters = str('RearSeatHeaters')
  if (raw['SunroofInstalled'] != null) s.sunroofInstalled = str('SunroofInstalled')
  if (raw['EuropeVehicle'] != null) s.europeVehicle = bool('EuropeVehicle')
  if (raw['RightHandDrive'] != null) s.rightHandDrive = bool('RightHandDrive')
  if (raw['RemoteStartEnabled'] != null) s.remoteStartEnabled = bool('RemoteStartEnabled')
  if (raw['OffroadLightbarPresent'] != null) s.offroadLightbar = bool('OffroadLightbarPresent')

  // Navigation
  if (raw['DestinationName'] != null) s.destinationName = str('DestinationName')
  if (raw['DestinationLocation'] != null && typeof raw['DestinationLocation'] === 'object') {
    const dest = raw['DestinationLocation'] as Record<string, unknown>
    if (dest['latitude'] != null) s.destinationLatitude = dest['latitude'] as number
    if (dest['longitude'] != null) s.destinationLongitude = dest['longitude'] as number
  }
  if (raw['MilesToArrival'] != null) s.distanceToArrival = n('MilesToArrival')
  if (raw['MinutesToArrival'] != null) s.minutesToArrival = n('MinutesToArrival')
  if (raw['RouteLine'] != null) s.routeLine = str('RouteLine')
  if (raw['LocatedAtHome'] != null) s.locatedAtHome = bool('LocatedAtHome')
  if (raw['LocatedAtWork'] != null) s.locatedAtWork = bool('LocatedAtWork')
  if (raw['LocatedAtFavorite'] != null) s.locatedAtFavorite = bool('LocatedAtFavorite')
  if (raw['GpsState'] != null) s.gpsState = bool('GpsState')
  if (raw['OriginLocation'] != null && typeof raw['OriginLocation'] === 'object') {
    const orig = raw['OriginLocation'] as Record<string, unknown>
    if (orig['latitude'] != null) s.originLatitude = orig['latitude'] as number
    if (orig['longitude'] != null) s.originLongitude = orig['longitude'] as number
  }

  // Software Update Progress
  if (raw['SoftwareUpdateVersion'] != null) s.swUpdateVersion = str('SoftwareUpdateVersion')
  if (raw['SoftwareUpdateDownloadPercentComplete'] != null) s.swUpdateDownloadPct = n('SoftwareUpdateDownloadPercentComplete')
  if (raw['SoftwareUpdateInstallationPercentComplete'] != null) s.swUpdateInstallPct = n('SoftwareUpdateInstallationPercentComplete')
  if (raw['SoftwareUpdateExpectedDurationMinutes'] != null) s.swUpdateExpectedMin = n('SoftwareUpdateExpectedDurationMinutes')
  if (raw['SoftwareUpdateScheduledStartTime'] != null) s.swUpdateScheduledStart = str('SoftwareUpdateScheduledStartTime')

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
