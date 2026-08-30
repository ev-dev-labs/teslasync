import { useEffect, useCallback, useState, useRef } from 'react'
import { useRealtimeEvents } from './useRealtimeEvents'
import { useLiveRecovery } from './useLiveRecovery'
import { useVehicleLiveSignals } from '@/api/hooks/useTelemetry'
import { telemetryKeys } from '@/api/hooks/useTelemetry'
import { parseEnumBool, parseBuckleStatus } from '../lib/parseEnums'

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
  hvacACEnabled: boolean
  hvacAutoMode: string
  hvacFanStatus: number
  climateKeeperMode: string
  cabinOverheatMode: string
  cabinOverheatTempLimit: string
  defrostMode: string
  defrostPreconditioning: boolean
  rearDefrost: boolean
  rearDisplayHvac: boolean
  wiperHeat: boolean
  steeringWheelHeatAuto: boolean
  steeringWheelHeatLevel: number
  seatHeaterLeft: number
  seatHeaterRight: number
  seatHeaterRearLeft: number
  seatHeaterRearCenter: number
  seatHeaterRearRight: number
  seatCoolingFrontLeft: number
  seatCoolingFrontRight: number
  autoSeatClimateLeft: boolean
  autoSeatClimateRight: boolean
  seatVentEnabled: boolean

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
  driverSeatBelt: boolean
  passengerSeatBelt: boolean

  // Vehicle State — Homelink
  homelinkNearby: boolean
  homelinkDeviceCount: number

  // Tire Pressure
  tirePressureFl: number
  tirePressureFr: number
  tirePressureRl: number
  tirePressureRr: number
  tpmsHardWarnings: string
  tpmsSoftWarnings: string
  tpmsLastSeenFl: string
  tpmsLastSeenFr: string
  tpmsLastSeenRl: string
  tpmsLastSeenRr: string
  isolationResistance: number

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
  gpsState: string
  originLatitude: number
  originLongitude: number

  // Software Update (live progress)
  swUpdateVersion: string
  swUpdateDownloadPct: number
  swUpdateInstallPct: number
  swUpdateExpectedMin: number
  swUpdateScheduledStart: string

  // User Preferences (from car)
  setting24HourTime: boolean
  settingChargeUnit: string
  settingDistanceUnit: string
  settingTemperatureUnit: string
  settingTirePressureUnit: string

  // Meta
  lastUpdated: Date | null
  signalCount: number
}

const EMPTY_STATE: VehicleLiveState = {
  speed: 0, odometer: 0, gear: '', power: 0, heading: 0,
  batteryLevel: 0, soc: 0, idealRange: 0, ratedRange: 0, estRange: 0, energyRemaining: 0,
  latitude: 0, longitude: 0,
  insideTemp: 0, outsideTemp: 0, hvacPower: false, fanSpeed: 0,
  hvacACEnabled: false, hvacAutoMode: '', hvacFanStatus: 0,
  climateKeeperMode: '', cabinOverheatMode: '', cabinOverheatTempLimit: '',
  defrostMode: '', defrostPreconditioning: false, rearDefrost: false,
  rearDisplayHvac: false, wiperHeat: false,
  steeringWheelHeatAuto: false, steeringWheelHeatLevel: 0,
  seatHeaterLeft: 0, seatHeaterRight: 0, seatHeaterRearLeft: 0,
  seatHeaterRearCenter: 0, seatHeaterRearRight: 0,
  seatCoolingFrontLeft: 0, seatCoolingFrontRight: 0,
  autoSeatClimateLeft: false, autoSeatClimateRight: false, seatVentEnabled: false,
  chargeState: '', detailedChargeState: '', chargerVoltage: 0, chargeAmps: 0,
  chargeRate: 0, chargerPower: 0, chargeLimitSoc: 0, timeToFullCharge: 0, isCharging: false,
  locked: false, sentryMode: false, doorState: '', centerDisplay: '',
  fdWindow: '', fpWindow: '', rdWindow: '', rpWindow: '',
  guestMode: false, guestMobileAccess: '', valetMode: false, serviceMode: false,
  speedLimitMode: false, currentSpeedLimit: 0,
  lightsHazards: false, lightsHighBeams: false, lightsTurnSignal: '',
  driverSeatOccupied: false, pairedKeyCount: 0,
  driverSeatBelt: false, passengerSeatBelt: false,
  homelinkNearby: false, homelinkDeviceCount: 0,
  tirePressureFl: 0, tirePressureFr: 0, tirePressureRl: 0, tirePressureRr: 0,
  tpmsHardWarnings: '', tpmsSoftWarnings: '',
  tpmsLastSeenFl: '', tpmsLastSeenFr: '', tpmsLastSeenRl: '', tpmsLastSeenRr: '',
  isolationResistance: 0,
  vehicleName: '', carType: '', version: '', wheelType: '', exteriorColor: '',
  trim: '', roofColor: '', efficiencyPackage: '', rearSeatHeaters: '', sunroofInstalled: '',
  europeVehicle: false, rightHandDrive: false, remoteStartEnabled: false, offroadLightbar: false,
  destinationName: '', destinationLatitude: 0, destinationLongitude: 0,
  distanceToArrival: 0, minutesToArrival: 0, routeLine: '',
  locatedAtHome: false, locatedAtWork: false, locatedAtFavorite: false,
  gpsState: '', originLatitude: 0, originLongitude: 0,
  swUpdateVersion: '', swUpdateDownloadPct: 0, swUpdateInstallPct: 0,
  swUpdateExpectedMin: 0, swUpdateScheduledStart: '',
  setting24HourTime: false, settingChargeUnit: '', settingDistanceUnit: '',
  settingTemperatureUnit: '', settingTirePressureUnit: '',
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
  const bool = (key: string): boolean => parseEnumBool(raw[key])

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
  if (raw['HvacACEnabled'] != null) s.hvacACEnabled = bool('HvacACEnabled')
  if (raw['HvacAutoMode'] != null) s.hvacAutoMode = str('HvacAutoMode')
  if (raw['HvacFanStatus'] != null) s.hvacFanStatus = n('HvacFanStatus')
  if (raw['ClimateKeeperMode'] != null) s.climateKeeperMode = str('ClimateKeeperMode')
  if (raw['CabinOverheatProtectionMode'] != null) s.cabinOverheatMode = str('CabinOverheatProtectionMode')
  if (raw['CabinOverheatProtectionTemperatureLimit'] != null) s.cabinOverheatTempLimit = str('CabinOverheatProtectionTemperatureLimit')
  if (raw['DefrostMode'] != null) s.defrostMode = str('DefrostMode')
  if (raw['DefrostForPreconditioning'] != null) s.defrostPreconditioning = bool('DefrostForPreconditioning')
  if (raw['RearDefrostEnabled'] != null) s.rearDefrost = bool('RearDefrostEnabled')
  if (raw['RearDisplayHvacEnabled'] != null) s.rearDisplayHvac = bool('RearDisplayHvacEnabled')
  if (raw['WiperHeatEnabled'] != null) s.wiperHeat = bool('WiperHeatEnabled')
  if (raw['HvacSteeringWheelHeatAuto'] != null) s.steeringWheelHeatAuto = bool('HvacSteeringWheelHeatAuto')
  if (raw['HvacSteeringWheelHeatLevel'] != null) s.steeringWheelHeatLevel = n('HvacSteeringWheelHeatLevel')
  if (raw['SeatHeaterLeft'] != null) s.seatHeaterLeft = n('SeatHeaterLeft')
  if (raw['SeatHeaterRight'] != null) s.seatHeaterRight = n('SeatHeaterRight')
  if (raw['SeatHeaterRearLeft'] != null) s.seatHeaterRearLeft = n('SeatHeaterRearLeft')
  if (raw['SeatHeaterRearCenter'] != null) s.seatHeaterRearCenter = n('SeatHeaterRearCenter')
  if (raw['SeatHeaterRearRight'] != null) s.seatHeaterRearRight = n('SeatHeaterRearRight')
  if (raw['ClimateSeatCoolingFrontLeft'] != null) s.seatCoolingFrontLeft = n('ClimateSeatCoolingFrontLeft')
  if (raw['ClimateSeatCoolingFrontRight'] != null) s.seatCoolingFrontRight = n('ClimateSeatCoolingFrontRight')
  if (raw['AutoSeatClimateLeft'] != null) s.autoSeatClimateLeft = bool('AutoSeatClimateLeft')
  if (raw['AutoSeatClimateRight'] != null) s.autoSeatClimateRight = bool('AutoSeatClimateRight')
  if (raw['SeatVentEnabled'] != null) s.seatVentEnabled = bool('SeatVentEnabled')

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
  
  // Derive isCharging from the live charge signals. Only override when a
  // charge-related signal is present in this update so the merge in
  // useVehicleLive preserves the last known value between partial updates
  // instead of leaving a stale `true` after charging stops.
  const dcs = str('DetailedChargeState')
  if (raw['DetailedChargeState'] != null || raw['ChargeAmps'] != null) {
    s.isCharging = dcs.includes('Charging') || dcs.includes('Starting') || n('ChargeAmps') > 1
  }

  // Security
  if (raw['Locked'] != null) s.locked = bool('Locked')
  if (raw['SentryMode'] != null) s.sentryMode = bool('SentryMode')
  if (raw['DoorState'] != null) {
    const dv = raw['DoorState']
    s.doorState = typeof dv === 'string' ? dv : typeof dv === 'object' ? JSON.stringify(dv) : ''
  }
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
  if (raw['DriverSeatBelt'] != null) s.driverSeatBelt = parseBuckleStatus(raw['DriverSeatBelt'])
  if (raw['PassengerSeatBelt'] != null) s.passengerSeatBelt = parseBuckleStatus(raw['PassengerSeatBelt'])

  // Vehicle State — Homelink
  if (raw['HomelinkNearby'] != null) s.homelinkNearby = bool('HomelinkNearby')
  if (raw['HomelinkDeviceCount'] != null) s.homelinkDeviceCount = n('HomelinkDeviceCount')

  // Tire Pressure
  if (raw['TpmsPressureFl'] != null) s.tirePressureFl = n('TpmsPressureFl')
  if (raw['TpmsPressureFr'] != null) s.tirePressureFr = n('TpmsPressureFr')
  if (raw['TpmsPressureRl'] != null) s.tirePressureRl = n('TpmsPressureRl')
  if (raw['TpmsPressureRr'] != null) s.tirePressureRr = n('TpmsPressureRr')
  if (raw['TpmsHardWarnings'] != null) s.tpmsHardWarnings = str('TpmsHardWarnings')
  if (raw['TpmsSoftWarnings'] != null) s.tpmsSoftWarnings = str('TpmsSoftWarnings')
  if (raw['TpmsLastSeenPressureTimeFl'] != null) s.tpmsLastSeenFl = str('TpmsLastSeenPressureTimeFl')
  if (raw['TpmsLastSeenPressureTimeFr'] != null) s.tpmsLastSeenFr = str('TpmsLastSeenPressureTimeFr')
  if (raw['TpmsLastSeenPressureTimeRl'] != null) s.tpmsLastSeenRl = str('TpmsLastSeenPressureTimeRl')
  if (raw['TpmsLastSeenPressureTimeRr'] != null) s.tpmsLastSeenRr = str('TpmsLastSeenPressureTimeRr')
  if (raw['IsolationResistance'] != null) s.isolationResistance = n('IsolationResistance')

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
  if (raw['GpsState'] != null) s.gpsState = str('GpsState')
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

  // User Preferences
  if (raw['Setting24HourTime'] != null) s.setting24HourTime = bool('Setting24HourTime')
  if (raw['SettingChargeUnit'] != null) s.settingChargeUnit = str('SettingChargeUnit')
  if (raw['SettingDistanceUnit'] != null) s.settingDistanceUnit = str('SettingDistanceUnit')
  if (raw['SettingTemperatureUnit'] != null) s.settingTemperatureUnit = str('SettingTemperatureUnit')
  if (raw['SettingTirePressureUnit'] != null) s.settingTirePressureUnit = str('SettingTirePressureUnit')

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
  const { data: initialLiveSignals } = useVehicleLiveSignals(vehicleId)

  // Redis Pub/Sub does not replay: every `vehicle_update` published while the
  // EventSource was down is gone. Re-read the canonical live endpoint on
  // reconnect so a silent 40-second gap cannot leave this state object
  // permanently behind with no visible symptom.
  useLiveRecovery({
    queryKeys: [telemetryKeys.liveSignals(vehicleId)],
    enabled: vehicleId != null && vehicleId > 0,
  })

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

  useEffect(() => {
    if (!initialLiveSignals?.signals) return

    const flat: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(initialLiveSignals.signals)) {
      if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
        flat[k] = (v as Record<string, unknown>).value
      } else {
        flat[k] = v
      }
    }

    const parsed = parseSignals(flat)
    setState(prev => ({
      ...prev,
      ...parsed,
      lastUpdated: new Date(),
      signalCount: Object.keys(flat).length,
    }))
  }, [initialLiveSignals])

  return { state, connected }
}
