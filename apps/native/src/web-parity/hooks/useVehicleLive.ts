/**
 * Native web-parity port of `web/src/hooks/useVehicleLive.ts`.
 *
 * Always-complete vehicle live state assembled from the in-memory SignalStore.
 * The web hook layered two sources: a one-shot REST hydration
 * (`useVehicleLiveSignals`) plus a singleton SSE stream (`useRealtimeEvents` ->
 * `@/lib/sseManager`) that merges incoming `vehicle_update` events into the
 * state so no known field is ever lost. The public surface is unchanged:
 * `useVehicleLive(vehicleId?)` returns `{ state, connected }`, where `state` is
 * the fully-populated `VehicleLiveState` and `connected` reflects the live SSE
 * pipe.
 *
 * Native adaptations (behavior, state names, API paths, and the parse/merge
 * logic are all preserved 1:1):
 *   - `useVehicleLiveSignals` is imported from the native parity telemetry hook
 *     (`../api/hooks/useTelemetry`) instead of the web `@/api/hooks/useTelemetry`
 *     alias. Same `/signals/{id}/live` REST contract, same `{ signals }` shape.
 *   - `parseEnumBool` / `parseBuckleStatus` (web `@/lib/parseEnums`) are not part
 *     of the native parity layer, so — following the established self-contained
 *     idiom the converted hooks/pages use for unavailable `@/lib` helpers — the
 *     two tiny pure parsers this file consumes are inlined verbatim.
 *   - The web SSE plumbing (`./useRealtimeEvents` + the singleton
 *     `@/lib/sseManager`) does not exist in the native parity layer, and React
 *     Native ships no browser `EventSource`. Following the sanctioned native SSE
 *     idiom (`api/sseClient`, `useAchievementUnlocks`, `useStatusLiveSSE`), the
 *     subset of the singleton manager this hook depends on — ONE shared
 *     `/api/v1/events` connection, the `vehicle_update` dispatch, the
 *     `connected`/disconnect lifecycle, and capped exponential-backoff
 *     reconnect — is reconstructed here on top of a host-provided global
 *     `EventSource` polyfill. When no polyfill is present the stream reports the
 *     explicit unavailable state (`connected` stays `false`) and the hook
 *     degrades gracefully to the one-shot REST hydration, never throwing.
 *
 * Unit handling: this hook is a pure pass-through. `parseSignals` reads raw
 * signal values straight off the wire and never converts units, so the SI
 * cutover contract is unaffected — display-unit conversion stays at the render
 * boundary in consumers.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiUrl } from '../api/client';
import { useVehicleLiveSignals } from '../api/hooks/useTelemetry';

/* ── Inlined from web @/lib/parseEnums (unavailable in the native layer) ───── */

/** Convert Tesla enum string to boolean. True if not "Off"/"false"/"". */
function parseEnumBool(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string')
    return raw !== '' && !raw.includes('Off') && raw !== 'false' && raw !== '0';
  if (typeof raw === 'number') return raw !== 0;
  return false;
}

/**
 * Convert Tesla BuckleStatus enum to boolean.
 * "BuckleStatusLatched" → true (buckled), anything else → false.
 */
function parseBuckleStatus(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw === 'BuckleStatusLatched';
  if (typeof raw === 'number') return raw !== 0;
  return false;
}

/* ── VehicleLiveState (verbatim from web) ─────────────────────────────────── */

/**
 * Vehicle live state from the in-memory SignalStore via SSE.
 * Always complete — never has null fields for known signals.
 * Replaces polling multiple endpoints every 3-5 seconds.
 */
export interface VehicleLiveState {
  // Driving
  speed: number;
  odometer: number;
  gear: string;
  power: number;
  heading: number;

  // Battery / Range
  batteryLevel: number;
  soc: number;
  idealRange: number;
  ratedRange: number;
  estRange: number;
  energyRemaining: number;

  // Location
  latitude: number;
  longitude: number;

  // Climate
  insideTemp: number;
  outsideTemp: number;
  hvacPower: boolean;
  fanSpeed: number;
  hvacACEnabled: boolean;
  hvacAutoMode: string;
  hvacFanStatus: number;
  climateKeeperMode: string;
  cabinOverheatMode: string;
  cabinOverheatTempLimit: string;
  defrostMode: string;
  defrostPreconditioning: boolean;
  rearDefrost: boolean;
  rearDisplayHvac: boolean;
  wiperHeat: boolean;
  steeringWheelHeatAuto: boolean;
  steeringWheelHeatLevel: number;
  seatHeaterLeft: number;
  seatHeaterRight: number;
  seatHeaterRearLeft: number;
  seatHeaterRearCenter: number;
  seatHeaterRearRight: number;
  seatCoolingFrontLeft: number;
  seatCoolingFrontRight: number;
  autoSeatClimateLeft: boolean;
  autoSeatClimateRight: boolean;
  seatVentEnabled: boolean;

  // Charging
  chargeState: string;
  detailedChargeState: string;
  chargerVoltage: number;
  chargeAmps: number;
  chargeRate: number;
  chargerPower: number;
  chargeLimitSoc: number;
  timeToFullCharge: number;
  isCharging: boolean;

  // Security
  locked: boolean;
  sentryMode: boolean;
  doorState: string;
  centerDisplay: string;
  fdWindow: string;
  fpWindow: string;
  rdWindow: string;
  rpWindow: string;

  // Vehicle State — Access Modes
  guestMode: boolean;
  guestMobileAccess: string;
  valetMode: boolean;
  serviceMode: boolean;
  speedLimitMode: boolean;
  currentSpeedLimit: number;

  // Vehicle State — Lights
  lightsHazards: boolean;
  lightsHighBeams: boolean;
  lightsTurnSignal: string;

  // Vehicle State — Driver & Keys
  driverSeatOccupied: boolean;
  pairedKeyCount: number;
  driverSeatBelt: boolean;
  passengerSeatBelt: boolean;

  // Vehicle State — Homelink
  homelinkNearby: boolean;
  homelinkDeviceCount: number;

  // Tire Pressure
  tirePressureFl: number;
  tirePressureFr: number;
  tirePressureRl: number;
  tirePressureRr: number;
  tpmsHardWarnings: string;
  tpmsSoftWarnings: string;
  tpmsLastSeenFl: string;
  tpmsLastSeenFr: string;
  tpmsLastSeenRl: string;
  tpmsLastSeenRr: string;
  isolationResistance: number;

  // Vehicle Info
  vehicleName: string;
  carType: string;
  version: string;
  wheelType: string;
  exteriorColor: string;
  trim: string;
  roofColor: string;
  efficiencyPackage: string;
  rearSeatHeaters: string;
  sunroofInstalled: string;
  europeVehicle: boolean;
  rightHandDrive: boolean;
  remoteStartEnabled: boolean;
  offroadLightbar: boolean;

  // Navigation
  destinationName: string;
  destinationLatitude: number;
  destinationLongitude: number;
  distanceToArrival: number;
  minutesToArrival: number;
  routeLine: string;
  locatedAtHome: boolean;
  locatedAtWork: boolean;
  locatedAtFavorite: boolean;
  gpsState: string;
  originLatitude: number;
  originLongitude: number;

  // Software Update (live progress)
  swUpdateVersion: string;
  swUpdateDownloadPct: number;
  swUpdateInstallPct: number;
  swUpdateExpectedMin: number;
  swUpdateScheduledStart: string;

  // User Preferences (from car)
  setting24HourTime: boolean;
  settingChargeUnit: string;
  settingDistanceUnit: string;
  settingTemperatureUnit: string;
  settingTirePressureUnit: string;

  // Meta
  lastUpdated: Date | null;
  signalCount: number;
}

const EMPTY_STATE: VehicleLiveState = {
  speed: 0,
  odometer: 0,
  gear: '',
  power: 0,
  heading: 0,
  batteryLevel: 0,
  soc: 0,
  idealRange: 0,
  ratedRange: 0,
  estRange: 0,
  energyRemaining: 0,
  latitude: 0,
  longitude: 0,
  insideTemp: 0,
  outsideTemp: 0,
  hvacPower: false,
  fanSpeed: 0,
  hvacACEnabled: false,
  hvacAutoMode: '',
  hvacFanStatus: 0,
  climateKeeperMode: '',
  cabinOverheatMode: '',
  cabinOverheatTempLimit: '',
  defrostMode: '',
  defrostPreconditioning: false,
  rearDefrost: false,
  rearDisplayHvac: false,
  wiperHeat: false,
  steeringWheelHeatAuto: false,
  steeringWheelHeatLevel: 0,
  seatHeaterLeft: 0,
  seatHeaterRight: 0,
  seatHeaterRearLeft: 0,
  seatHeaterRearCenter: 0,
  seatHeaterRearRight: 0,
  seatCoolingFrontLeft: 0,
  seatCoolingFrontRight: 0,
  autoSeatClimateLeft: false,
  autoSeatClimateRight: false,
  seatVentEnabled: false,
  chargeState: '',
  detailedChargeState: '',
  chargerVoltage: 0,
  chargeAmps: 0,
  chargeRate: 0,
  chargerPower: 0,
  chargeLimitSoc: 0,
  timeToFullCharge: 0,
  isCharging: false,
  locked: false,
  sentryMode: false,
  doorState: '',
  centerDisplay: '',
  fdWindow: '',
  fpWindow: '',
  rdWindow: '',
  rpWindow: '',
  guestMode: false,
  guestMobileAccess: '',
  valetMode: false,
  serviceMode: false,
  speedLimitMode: false,
  currentSpeedLimit: 0,
  lightsHazards: false,
  lightsHighBeams: false,
  lightsTurnSignal: '',
  driverSeatOccupied: false,
  pairedKeyCount: 0,
  driverSeatBelt: false,
  passengerSeatBelt: false,
  homelinkNearby: false,
  homelinkDeviceCount: 0,
  tirePressureFl: 0,
  tirePressureFr: 0,
  tirePressureRl: 0,
  tirePressureRr: 0,
  tpmsHardWarnings: '',
  tpmsSoftWarnings: '',
  tpmsLastSeenFl: '',
  tpmsLastSeenFr: '',
  tpmsLastSeenRl: '',
  tpmsLastSeenRr: '',
  isolationResistance: 0,
  vehicleName: '',
  carType: '',
  version: '',
  wheelType: '',
  exteriorColor: '',
  trim: '',
  roofColor: '',
  efficiencyPackage: '',
  rearSeatHeaters: '',
  sunroofInstalled: '',
  europeVehicle: false,
  rightHandDrive: false,
  remoteStartEnabled: false,
  offroadLightbar: false,
  destinationName: '',
  destinationLatitude: 0,
  destinationLongitude: 0,
  distanceToArrival: 0,
  minutesToArrival: 0,
  routeLine: '',
  locatedAtHome: false,
  locatedAtWork: false,
  locatedAtFavorite: false,
  gpsState: '',
  originLatitude: 0,
  originLongitude: 0,
  swUpdateVersion: '',
  swUpdateDownloadPct: 0,
  swUpdateInstallPct: 0,
  swUpdateExpectedMin: 0,
  swUpdateScheduledStart: '',
  setting24HourTime: false,
  settingChargeUnit: '',
  settingDistanceUnit: '',
  settingTemperatureUnit: '',
  settingTirePressureUnit: '',
  lastUpdated: null,
  signalCount: 0,
};

function parseSignals(raw: Record<string, unknown>): Partial<VehicleLiveState> {
  const s: Partial<VehicleLiveState> = {};
  const n = (key: string): number => {
    const v = raw[key];
    return typeof v === 'number' ? v : 0;
  };
  const str = (key: string): string => {
    const v = raw[key];
    return typeof v === 'string' ? v : '';
  };
  const bool = (key: string): boolean => parseEnumBool(raw[key]);

  // Driving
  if (raw.VehicleSpeed != null) s.speed = n('VehicleSpeed');
  if (raw.Odometer != null) s.odometer = n('Odometer');
  if (raw.Gear != null) s.gear = str('Gear');
  if (raw.GpsHeading != null) s.heading = n('GpsHeading');

  // Power (computed or direct)
  if (raw.Power != null) {
    s.power = n('Power');
  } else if (raw.PackVoltage != null && raw.PackCurrent != null) {
    s.power = (n('PackVoltage') * n('PackCurrent')) / 1000;
  }

  // Battery
  if (raw.BatteryLevel != null) s.batteryLevel = Math.round(n('BatteryLevel'));
  if (raw.Soc != null) s.soc = n('Soc');
  if (raw.IdealBatteryRange != null) s.idealRange = n('IdealBatteryRange');
  if (raw.RatedRange != null) s.ratedRange = n('RatedRange');
  if (raw.EstBatteryRange != null) s.estRange = n('EstBatteryRange');
  if (raw.EnergyRemaining != null) s.energyRemaining = n('EnergyRemaining');

  // Location
  if (raw.Location != null && typeof raw.Location === 'object') {
    const loc = raw.Location as Record<string, unknown>;
    if (loc.latitude != null) s.latitude = loc.latitude as number;
    if (loc.longitude != null) s.longitude = loc.longitude as number;
  }
  if (raw.Latitude != null) s.latitude = n('Latitude');
  if (raw.Longitude != null) s.longitude = n('Longitude');

  // Climate
  if (raw.InsideTemp != null) s.insideTemp = n('InsideTemp');
  if (raw.OutsideTemp != null) s.outsideTemp = n('OutsideTemp');
  if (raw.HvacPower != null) s.hvacPower = bool('HvacPower');
  if (raw.HvacFanSpeed != null) s.fanSpeed = Math.round(n('HvacFanSpeed'));
  if (raw.HvacACEnabled != null) s.hvacACEnabled = bool('HvacACEnabled');
  if (raw.HvacAutoMode != null) s.hvacAutoMode = str('HvacAutoMode');
  if (raw.HvacFanStatus != null) s.hvacFanStatus = n('HvacFanStatus');
  if (raw.ClimateKeeperMode != null)
    s.climateKeeperMode = str('ClimateKeeperMode');
  if (raw.CabinOverheatProtectionMode != null)
    s.cabinOverheatMode = str('CabinOverheatProtectionMode');
  if (raw.CabinOverheatProtectionTemperatureLimit != null)
    s.cabinOverheatTempLimit = str('CabinOverheatProtectionTemperatureLimit');
  if (raw.DefrostMode != null) s.defrostMode = str('DefrostMode');
  if (raw.DefrostForPreconditioning != null)
    s.defrostPreconditioning = bool('DefrostForPreconditioning');
  if (raw.RearDefrostEnabled != null)
    s.rearDefrost = bool('RearDefrostEnabled');
  if (raw.RearDisplayHvacEnabled != null)
    s.rearDisplayHvac = bool('RearDisplayHvacEnabled');
  if (raw.WiperHeatEnabled != null) s.wiperHeat = bool('WiperHeatEnabled');
  if (raw.HvacSteeringWheelHeatAuto != null)
    s.steeringWheelHeatAuto = bool('HvacSteeringWheelHeatAuto');
  if (raw.HvacSteeringWheelHeatLevel != null)
    s.steeringWheelHeatLevel = n('HvacSteeringWheelHeatLevel');
  if (raw.SeatHeaterLeft != null) s.seatHeaterLeft = n('SeatHeaterLeft');
  if (raw.SeatHeaterRight != null) s.seatHeaterRight = n('SeatHeaterRight');
  if (raw.SeatHeaterRearLeft != null)
    s.seatHeaterRearLeft = n('SeatHeaterRearLeft');
  if (raw.SeatHeaterRearCenter != null)
    s.seatHeaterRearCenter = n('SeatHeaterRearCenter');
  if (raw.SeatHeaterRearRight != null)
    s.seatHeaterRearRight = n('SeatHeaterRearRight');
  if (raw.ClimateSeatCoolingFrontLeft != null)
    s.seatCoolingFrontLeft = n('ClimateSeatCoolingFrontLeft');
  if (raw.ClimateSeatCoolingFrontRight != null)
    s.seatCoolingFrontRight = n('ClimateSeatCoolingFrontRight');
  if (raw.AutoSeatClimateLeft != null)
    s.autoSeatClimateLeft = bool('AutoSeatClimateLeft');
  if (raw.AutoSeatClimateRight != null)
    s.autoSeatClimateRight = bool('AutoSeatClimateRight');
  if (raw.SeatVentEnabled != null) s.seatVentEnabled = bool('SeatVentEnabled');

  // Charging
  if (raw.ChargeState != null) s.chargeState = str('ChargeState');
  if (raw.DetailedChargeState != null)
    s.detailedChargeState = str('DetailedChargeState');
  if (raw.ChargerVoltage != null) s.chargerVoltage = n('ChargerVoltage');
  if (raw.ChargeAmps != null) s.chargeAmps = n('ChargeAmps');
  if (raw.ChargeRateMilePerHour != null)
    s.chargeRate = n('ChargeRateMilePerHour');
  if (raw.DCChargingPower != null) s.chargerPower = n('DCChargingPower');
  else if (raw.ACChargingPower != null) s.chargerPower = n('ACChargingPower');
  if (raw.ChargeLimitSoc != null)
    s.chargeLimitSoc = Math.round(n('ChargeLimitSoc'));
  if (raw.TimeToFullCharge != null) s.timeToFullCharge = n('TimeToFullCharge');

  // Derive isCharging
  const dcs = str('DetailedChargeState');
  if (dcs.includes('Charging') || dcs.includes('Starting')) s.isCharging = true;
  else if (n('ChargeAmps') > 1) s.isCharging = true;

  // Security
  if (raw.Locked != null) s.locked = bool('Locked');
  if (raw.SentryMode != null) s.sentryMode = bool('SentryMode');
  if (raw.DoorState != null) {
    const dv = raw.DoorState;
    s.doorState =
      typeof dv === 'string'
        ? dv
        : typeof dv === 'object'
        ? JSON.stringify(dv)
        : '';
  }
  if (raw.CenterDisplay != null) s.centerDisplay = str('CenterDisplay');
  if (raw.FdWindow != null) s.fdWindow = str('FdWindow');
  if (raw.FpWindow != null) s.fpWindow = str('FpWindow');
  if (raw.RdWindow != null) s.rdWindow = str('RdWindow');
  if (raw.RpWindow != null) s.rpWindow = str('RpWindow');

  // Vehicle State — Access Modes
  if (raw.GuestModeEnabled != null) s.guestMode = bool('GuestModeEnabled');
  if (raw.GuestModeMobileAccessState != null)
    s.guestMobileAccess = str('GuestModeMobileAccessState');
  if (raw.ValetModeEnabled != null) s.valetMode = bool('ValetModeEnabled');
  if (raw.ServiceMode != null) s.serviceMode = bool('ServiceMode');
  if (raw.SpeedLimitMode != null) s.speedLimitMode = bool('SpeedLimitMode');
  if (raw.CurrentLimitMph != null) s.currentSpeedLimit = n('CurrentLimitMph');

  // Vehicle State — Lights
  if (raw.LightsHazardsActive != null)
    s.lightsHazards = bool('LightsHazardsActive');
  if (raw.LightsHighBeams != null) s.lightsHighBeams = bool('LightsHighBeams');
  if (raw.LightsTurnSignal != null)
    s.lightsTurnSignal = str('LightsTurnSignal');

  // Vehicle State — Driver & Keys
  if (raw.DriverSeatOccupied != null)
    s.driverSeatOccupied = bool('DriverSeatOccupied');
  if (raw.PairedPhoneKeyAndKeyFobQty != null)
    s.pairedKeyCount = n('PairedPhoneKeyAndKeyFobQty');
  if (raw.DriverSeatBelt != null)
    s.driverSeatBelt = parseBuckleStatus(raw.DriverSeatBelt);
  if (raw.PassengerSeatBelt != null)
    s.passengerSeatBelt = parseBuckleStatus(raw.PassengerSeatBelt);

  // Vehicle State — Homelink
  if (raw.HomelinkNearby != null) s.homelinkNearby = bool('HomelinkNearby');
  if (raw.HomelinkDeviceCount != null)
    s.homelinkDeviceCount = n('HomelinkDeviceCount');

  // Tire Pressure
  if (raw.TpmsPressureFl != null) s.tirePressureFl = n('TpmsPressureFl');
  if (raw.TpmsPressureFr != null) s.tirePressureFr = n('TpmsPressureFr');
  if (raw.TpmsPressureRl != null) s.tirePressureRl = n('TpmsPressureRl');
  if (raw.TpmsPressureRr != null) s.tirePressureRr = n('TpmsPressureRr');
  if (raw.TpmsHardWarnings != null)
    s.tpmsHardWarnings = str('TpmsHardWarnings');
  if (raw.TpmsSoftWarnings != null)
    s.tpmsSoftWarnings = str('TpmsSoftWarnings');
  if (raw.TpmsLastSeenPressureTimeFl != null)
    s.tpmsLastSeenFl = str('TpmsLastSeenPressureTimeFl');
  if (raw.TpmsLastSeenPressureTimeFr != null)
    s.tpmsLastSeenFr = str('TpmsLastSeenPressureTimeFr');
  if (raw.TpmsLastSeenPressureTimeRl != null)
    s.tpmsLastSeenRl = str('TpmsLastSeenPressureTimeRl');
  if (raw.TpmsLastSeenPressureTimeRr != null)
    s.tpmsLastSeenRr = str('TpmsLastSeenPressureTimeRr');
  if (raw.IsolationResistance != null)
    s.isolationResistance = n('IsolationResistance');

  // Vehicle Info
  if (raw.VehicleName != null) s.vehicleName = str('VehicleName');
  if (raw.CarType != null) s.carType = str('CarType');
  if (raw.Version != null) s.version = str('Version');
  if (raw.WheelType != null) s.wheelType = str('WheelType');
  if (raw.ExteriorColor != null) s.exteriorColor = str('ExteriorColor');
  if (raw.Trim != null) s.trim = str('Trim');
  if (raw.RoofColor != null) s.roofColor = str('RoofColor');
  if (raw.EfficiencyPackage != null)
    s.efficiencyPackage = str('EfficiencyPackage');
  if (raw.RearSeatHeaters != null) s.rearSeatHeaters = str('RearSeatHeaters');
  if (raw.SunroofInstalled != null)
    s.sunroofInstalled = str('SunroofInstalled');
  if (raw.EuropeVehicle != null) s.europeVehicle = bool('EuropeVehicle');
  if (raw.RightHandDrive != null) s.rightHandDrive = bool('RightHandDrive');
  if (raw.RemoteStartEnabled != null)
    s.remoteStartEnabled = bool('RemoteStartEnabled');
  if (raw.OffroadLightbarPresent != null)
    s.offroadLightbar = bool('OffroadLightbarPresent');

  // Navigation
  if (raw.DestinationName != null) s.destinationName = str('DestinationName');
  if (
    raw.DestinationLocation != null &&
    typeof raw.DestinationLocation === 'object'
  ) {
    const dest = raw.DestinationLocation as Record<string, unknown>;
    if (dest.latitude != null) s.destinationLatitude = dest.latitude as number;
    if (dest.longitude != null)
      s.destinationLongitude = dest.longitude as number;
  }
  if (raw.MilesToArrival != null) s.distanceToArrival = n('MilesToArrival');
  if (raw.MinutesToArrival != null) s.minutesToArrival = n('MinutesToArrival');
  if (raw.RouteLine != null) s.routeLine = str('RouteLine');
  if (raw.LocatedAtHome != null) s.locatedAtHome = bool('LocatedAtHome');
  if (raw.LocatedAtWork != null) s.locatedAtWork = bool('LocatedAtWork');
  if (raw.LocatedAtFavorite != null)
    s.locatedAtFavorite = bool('LocatedAtFavorite');
  if (raw.GpsState != null) s.gpsState = str('GpsState');
  if (raw.OriginLocation != null && typeof raw.OriginLocation === 'object') {
    const orig = raw.OriginLocation as Record<string, unknown>;
    if (orig.latitude != null) s.originLatitude = orig.latitude as number;
    if (orig.longitude != null) s.originLongitude = orig.longitude as number;
  }

  // Software Update Progress
  if (raw.SoftwareUpdateVersion != null)
    s.swUpdateVersion = str('SoftwareUpdateVersion');
  if (raw.SoftwareUpdateDownloadPercentComplete != null)
    s.swUpdateDownloadPct = n('SoftwareUpdateDownloadPercentComplete');
  if (raw.SoftwareUpdateInstallationPercentComplete != null)
    s.swUpdateInstallPct = n('SoftwareUpdateInstallationPercentComplete');
  if (raw.SoftwareUpdateExpectedDurationMinutes != null)
    s.swUpdateExpectedMin = n('SoftwareUpdateExpectedDurationMinutes');
  if (raw.SoftwareUpdateScheduledStartTime != null)
    s.swUpdateScheduledStart = str('SoftwareUpdateScheduledStartTime');

  // User Preferences
  if (raw.Setting24HourTime != null)
    s.setting24HourTime = bool('Setting24HourTime');
  if (raw.SettingChargeUnit != null)
    s.settingChargeUnit = str('SettingChargeUnit');
  if (raw.SettingDistanceUnit != null)
    s.settingDistanceUnit = str('SettingDistanceUnit');
  if (raw.SettingTemperatureUnit != null)
    s.settingTemperatureUnit = str('SettingTemperatureUnit');
  if (raw.SettingTirePressureUnit != null)
    s.settingTirePressureUnit = str('SettingTirePressureUnit');

  return s;
}

/* ── Native realtime vehicle_update stream ────────────────────────────────────
 *
 * Faithful native-safe reconstruction of the subset of the web singleton SSE
 * manager (`@/lib/sseManager`) + `./useRealtimeEvents` that `useVehicleLive`
 * depends on. Neither file exists in the native parity layer, so — following
 * the sanctioned native SSE idiom (`api/sseClient`, `useAchievementUnlocks`,
 * `useStatusLiveSSE`) — the `vehicle_update` subscription, the singleton
 * ONE-connection guarantee, the `connected` lifecycle, and the capped
 * exponential-backoff reconnect are reproduced here.
 *
 * The web manager opens ONE EventSource to `/api/v1/events`, flips
 * `state = 'connected'` on the server-sent `connected` event, dispatches
 * `vehicle_update` payloads to subscribers, and on error closes + emits
 * `disconnected` + reconnects with 1s→60s backoff. `connected` here mirrors
 * `state === 'connected'`.
 */

const EVENTS_PATH = '/events';
const CONNECTED_EVENT = 'connected';
const VEHICLE_UPDATE_EVENT = 'vehicle_update';
// Capped exponential backoff: 1s → 2s → 4s → … → 60s (max), mirroring sseManager.
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

type NativeEventSourceEvent = {
  readonly data?: unknown;
};

type NativeEventSourceListener = (event: NativeEventSourceEvent) => void;

interface NativeEventSource {
  addEventListener(event: string, listener: NativeEventSourceListener): void;
  removeEventListener?(
    event: string,
    listener: NativeEventSourceListener,
  ): void;
  close(): void;
}

type NativeEventSourceConstructor = new (url: string) => NativeEventSource;

function getEventSourceConstructor(): NativeEventSourceConstructor | null {
  const candidate = (
    globalThis as typeof globalThis & { EventSource?: unknown }
  ).EventSource;
  return typeof candidate === 'function'
    ? (candidate as NativeEventSourceConstructor)
    : null;
}

type VehicleUpdateListener = (data: unknown) => void;
type ConnectionListener = (connected: boolean) => void;

const vehicleUpdateListeners = new Set<VehicleUpdateListener>();
const connectionListeners = new Set<ConnectionListener>();
let sharedSource: NativeEventSource | null = null;
let sharedConnected = false;
let failCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function emitConnection(next: boolean): void {
  if (sharedConnected === next) return;
  sharedConnected = next;
  for (const listener of Array.from(connectionListeners)) listener(next);
}

function emitVehicleUpdate(data: unknown): void {
  for (const listener of Array.from(vehicleUpdateListeners)) listener(data);
}

/** Parse a raw SSE payload. The web manager `JSON.parse`s the event data and
 * does NOT route it through camelCaseKeys, so keys stay snake_case here too. */
function parseEventData(event: NativeEventSourceEvent): unknown {
  if (typeof event.data !== 'string' || event.data.length === 0) {
    return event.data ?? null;
  }
  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}

function handleConnected(): void {
  failCount = 0;
  emitConnection(true);
}

function handleVehicleUpdate(event: NativeEventSourceEvent): void {
  emitVehicleUpdate(parseEventData(event));
}

function handleSourceError(): void {
  // Mirror sseManager.onerror: close, mark reconnecting (connected=false), and
  // schedule a capped exponential-backoff reconnect while subscribers remain.
  closeSharedSource();
  emitConnection(false);
  if (vehicleUpdateListeners.size === 0 && connectionListeners.size === 0) {
    return;
  }
  failCount += 1;
  const backoff = Math.min(
    BASE_BACKOFF_MS * Math.pow(2, failCount - 1),
    MAX_BACKOFF_MS,
  );
  reconnectTimer = setTimeout(openSharedSource, backoff);
}

function openSharedSource(): void {
  reconnectTimer = null;
  if (sharedSource != null) return;

  const EventSourceCtor = getEventSourceConstructor();
  if (EventSourceCtor == null) {
    // Explicit unavailable state: no EventSource polyfill on this host. The
    // hook degrades to the one-shot REST hydration and `connected` stays false.
    emitConnection(false);
    return;
  }

  let es: NativeEventSource;
  try {
    es = new EventSourceCtor(apiUrl(EVENTS_PATH));
  } catch {
    emitConnection(false);
    return;
  }

  sharedSource = es;
  es.addEventListener(CONNECTED_EVENT, handleConnected);
  es.addEventListener(VEHICLE_UPDATE_EVENT, handleVehicleUpdate);
  es.addEventListener('error', handleSourceError);
}

function closeSharedSource(): void {
  if (reconnectTimer != null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (sharedSource == null) return;
  sharedSource.removeEventListener?.(CONNECTED_EVENT, handleConnected);
  sharedSource.removeEventListener?.(VEHICLE_UPDATE_EVENT, handleVehicleUpdate);
  sharedSource.removeEventListener?.('error', handleSourceError);
  sharedSource.close();
  sharedSource = null;
}

function subscribeVehicleUpdates(
  onUpdate: VehicleUpdateListener,
  onConnection: ConnectionListener,
): void {
  vehicleUpdateListeners.add(onUpdate);
  connectionListeners.add(onConnection);
  // Auto-connect on first subscriber (sseManager.subscribe parity).
  if (sharedSource == null && reconnectTimer == null) {
    openSharedSource();
  }
}

function unsubscribeVehicleUpdates(
  onUpdate: VehicleUpdateListener,
  onConnection: ConnectionListener,
): void {
  vehicleUpdateListeners.delete(onUpdate);
  connectionListeners.delete(onConnection);
  // Auto-disconnect when no subscribers remain (sseManager.unsubscribe parity).
  if (vehicleUpdateListeners.size === 0 && connectionListeners.size === 0) {
    closeSharedSource();
    sharedConnected = false;
    failCount = 0;
  }
}

interface VehicleUpdateStreamOptions {
  onVehicleUpdate?: (data: unknown) => void;
  enabled?: boolean;
}

/**
 * Native-safe subset of `useRealtimeEvents` for the `vehicle_update` channel.
 * Returns `{ connected }` exactly like the web hook; the callback is held in a
 * ref so a changing `onVehicleUpdate` never re-subscribes the shared stream.
 */
function useVehicleUpdateStream(options: VehicleUpdateStreamOptions = {}): {
  connected: boolean;
} {
  const { enabled = true } = options;
  const [connected, setConnected] = useState<boolean>(() => sharedConnected);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  useEffect(() => {
    if (!enabled) return;

    const onUpdate = (data: unknown) =>
      callbacksRef.current.onVehicleUpdate?.(data);
    const onConnection = (next: boolean) => setConnected(next);

    subscribeVehicleUpdates(onUpdate, onConnection);
    setConnected(sharedConnected);

    return () => {
      unsubscribeVehicleUpdates(onUpdate, onConnection);
    };
  }, [enabled]);

  return { connected };
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
  const [state, setState] = useState<VehicleLiveState>({ ...EMPTY_STATE });
  const stateRef = useRef(state);
  stateRef.current = state;
  const { data: initialLiveSignals } = useVehicleLiveSignals(vehicleId);

  const handleUpdate = useCallback(
    (data: unknown) => {
      const update = data as {
        vehicle_id?: number;
        state?: Record<string, unknown>;
        signals?: Record<string, unknown>;
      };
      if (vehicleId && update.vehicle_id !== vehicleId) return;

      // Prefer complete state from SignalStore, fall back to partial signals
      const raw = update.state || update.signals;
      if (!raw) return;

      const parsed = parseSignals(raw);
      setState(prev => ({
        ...prev,
        ...parsed,
        lastUpdated: new Date(),
        signalCount: Object.keys(raw).length,
      }));
    },
    [vehicleId],
  );

  const { connected } = useVehicleUpdateStream({
    onVehicleUpdate: handleUpdate,
    enabled: true,
  });

  useEffect(() => {
    if (!initialLiveSignals?.signals) return;

    const flat: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(initialLiveSignals.signals)) {
      if (
        v &&
        typeof v === 'object' &&
        'value' in (v as Record<string, unknown>)
      ) {
        flat[k] = (v as Record<string, unknown>).value;
      } else {
        flat[k] = v;
      }
    }

    const parsed = parseSignals(flat);
    setState(prev => ({
      ...prev,
      ...parsed,
      lastUpdated: new Date(),
      signalCount: Object.keys(flat).length,
    }));
  }, [initialLiveSignals]);

  return { state, connected };
}
