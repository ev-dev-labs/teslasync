import {
  KeyRound, FileCode, Key, Globe, Shield, Link, Radio,
} from 'lucide-react'

/* ─── icon color map ──────────────────────────────────────────────────── */

export const ICON_COLOR_MAP: Record<string, string> = {
  cyan: 'bg-neon-cyan/10 text-neon-cyan ring-1 ring-neon-cyan/20',
  green: 'bg-neon-green/10 text-neon-green ring-1 ring-neon-green/20',
  purple: 'bg-neon-purple/10 text-neon-purple ring-1 ring-neon-purple/20',
  amber: 'bg-neon-amber/10 text-neon-amber ring-1 ring-neon-amber/20',
  red: 'bg-neon-red/10 text-neon-red ring-1 ring-neon-red/20',
}

/* ─── VIN decoder maps ────────────────────────────────────────────────── */

export const VIN_MANUFACTURERS: Record<string, string> = {
  '5YJ': 'Tesla (USA)',
  LRW: 'Tesla (China)',
  '7SA': 'Tesla (EU/Berlin)',
  XP7: 'Tesla (USA)',
}
export const VIN_MODELS: Record<string, string> = {
  S: 'Model S',
  '3': 'Model 3',
  X: 'Model X',
  Y: 'Model Y',
}
export const VIN_DRIVE: Record<string, string> = {
  '1': 'Single Motor RWD',
  '2': 'Dual Motor AWD',
  '3': 'Performance AWD',
  '4': 'Single Motor RWD (LFP)',
  A: 'Dual Motor AWD',
  B: 'Dual Motor AWD',
  F: 'Performance AWD',
  P: 'Performance',
  E: 'Dual Motor',
  N: 'Dual Motor',
}
export const VIN_YEAR: Record<string, string> = {
  H: '2017',
  J: '2018',
  K: '2019',
  L: '2020',
  M: '2021',
  N: '2022',
  P: '2023',
  R: '2024',
  S: '2025',
  T: '2026',
}
export const VIN_PLANT: Record<string, string> = {
  F: 'Fremont, CA',
  A: 'Austin, TX',
  B: 'Berlin, Germany',
  C: 'Shanghai, China',
  G: 'Gigafactory',
  E: 'Palo Alto, CA',
}

/* ─── byte units ──────────────────────────────────────────────────────── */

export const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/* ─── unix permission map ─────────────────────────────────────────────── */

export const PERMS: Record<string, string> = {
  '7': 'rwx',
  '6': 'rw-',
  '5': 'r-x',
  '4': 'r--',
  '3': '-wx',
  '2': '-w-',
  '1': '--x',
  '0': '---',
}

/* ─── HTTP codes ──────────────────────────────────────────────────────── */

export const HTTP_CODES: { code: number; text: string; desc: string }[] = [
  { code: 200, text: 'OK', desc: 'Request succeeded' },
  { code: 201, text: 'Created', desc: 'Resource created' },
  { code: 204, text: 'No Content', desc: 'Success with no body' },
  { code: 301, text: 'Moved Permanently', desc: 'Resource moved' },
  { code: 302, text: 'Found', desc: 'Temporary redirect' },
  { code: 304, text: 'Not Modified', desc: 'Use cached version' },
  { code: 400, text: 'Bad Request', desc: 'Invalid request' },
  { code: 401, text: 'Unauthorized', desc: 'Auth required' },
  { code: 403, text: 'Forbidden', desc: 'Access denied' },
  { code: 404, text: 'Not Found', desc: 'Resource not found' },
  { code: 405, text: 'Method Not Allowed', desc: 'HTTP method not supported' },
  { code: 408, text: 'Request Timeout', desc: 'Client took too long' },
  { code: 409, text: 'Conflict', desc: 'Resource conflict' },
  { code: 422, text: 'Unprocessable Entity', desc: 'Validation failed' },
  { code: 429, text: 'Too Many Requests', desc: 'Rate limited' },
  { code: 500, text: 'Internal Server Error', desc: 'Server error' },
  { code: 502, text: 'Bad Gateway', desc: 'Upstream error' },
  { code: 503, text: 'Service Unavailable', desc: 'Server overloaded' },
  { code: 504, text: 'Gateway Timeout', desc: 'Upstream timeout' },
]

/* ─── Tesla endpoint reference ────────────────────────────────────────── */

export const TESLA_ENDPOINTS: { method: string; path: string; desc: string }[] = [
  { method: 'GET', path: '/api/1/vehicles', desc: 'List vehicles' },
  { method: 'GET', path: '/api/1/vehicles/{id}/vehicle_data', desc: 'Get vehicle data' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/wake_up', desc: 'Wake up vehicle' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/door_lock', desc: 'Lock doors' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/door_unlock', desc: 'Unlock doors' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/flash_lights', desc: 'Flash lights' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/honk_horn', desc: 'Honk horn' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/set_charge_limit', desc: 'Set charge limit' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/charge_start', desc: 'Start charging' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/charge_stop', desc: 'Stop charging' },
  { method: 'GET', path: '/api/1/vehicles/{id}/nearby_charging_sites', desc: 'Nearby chargers' },
]

/* ─── telemetry signal fields ─────────────────────────────────────────── */

export const TELEMETRY_FIELDS = [
  { category: 'Location', fields: ['Location', 'GpsHeading', 'GpsState', 'DestinationLocation', 'DestinationName', 'MilesToArrival', 'MinutesToArrival', 'RouteLine', 'RouteLastUpdated', 'OriginLocation', 'LocatedAtHome', 'LocatedAtWork', 'LocatedAtFavorite'] },
  { category: 'Driving', fields: ['VehicleSpeed', 'Gear', 'CruiseSetSpeed', 'BrakePedal', 'BrakePedalPos', 'PedalPosition', 'DriveRail', 'LateralAcceleration', 'LongitudinalAcceleration', 'RouteTrafficMinutesDelay', 'LifetimeEnergyGainedRegen', 'LifetimeEnergyUsedDrive'] },
  { category: 'Charging', fields: ['BatteryLevel', 'Soc', 'ChargeState', 'DetailedChargeState', 'ChargeLimitSoc', 'ChargeAmps', 'ChargeCurrentRequest', 'ChargeCurrentRequestMax', 'ChargeEnableRequest', 'ChargerVoltage', 'ChargerPhases', 'ChargeRateMilePerHour', 'DCChargingPower', 'DCChargingEnergyIn', 'ACChargingPower', 'ACChargingEnergyIn', 'EnergyRemaining', 'EstBatteryRange', 'IdealBatteryRange', 'RatedRange', 'PackVoltage', 'PackCurrent', 'ChargePortDoorOpen', 'ChargePortLatch', 'ChargePortColdWeatherMode', 'ChargingCableType', 'FastChargerPresent', 'FastChargerType', 'TimeToFullCharge', 'EstimatedHoursToChargeTermination', 'ExpectedEnergyPercentAtTripArrival', 'SuperchargerSessionTripPlanner', 'ScheduledChargingMode', 'ScheduledChargingPending', 'ScheduledChargingStartTime', 'ScheduledDepartureTime', 'PreconditioningEnabled', 'BrickVoltageMax', 'BrickVoltageMin', 'NumBrickVoltageMax', 'NumBrickVoltageMin', 'ModuleTempMax', 'ModuleTempMin', 'NumModuleTempMax', 'NumModuleTempMin', 'BatteryHeaterOn', 'NotEnoughPowerToHeat', 'BMSState', 'BmsFullchargecomplete', 'DCDCEnable', 'IsolationResistance', 'LifetimeEnergyUsed'] },
  { category: 'Powershare', fields: ['PowershareStatus', 'PowershareType', 'PowershareStopReason', 'PowershareHoursLeft', 'PowershareInstantaneousPowerKW'] },
  { category: 'Climate', fields: ['InsideTemp', 'OutsideTemp', 'HvacFanSpeed', 'HvacFanStatus', 'HvacPower', 'HvacACEnabled', 'HvacAutoMode', 'HvacLeftTemperatureRequest', 'HvacRightTemperatureRequest', 'HvacSteeringWheelHeatAuto', 'HvacSteeringWheelHeatLevel', 'ClimateKeeperMode', 'DefrostMode', 'DefrostForPreconditioning', 'CabinOverheatProtectionMode', 'CabinOverheatProtectionTemperatureLimit', 'SeatHeaterLeft', 'SeatHeaterRight', 'SeatHeaterRearLeft', 'SeatHeaterRearCenter', 'SeatHeaterRearRight', 'SeatVentEnabled', 'ClimateSeatCoolingFrontLeft', 'ClimateSeatCoolingFrontRight', 'AutoSeatClimateLeft', 'AutoSeatClimateRight', 'RearDefrostEnabled', 'RearDisplayHvacEnabled', 'WiperHeatEnabled'] },
  { category: 'Vehicle State', fields: ['Locked', 'SentryMode', 'DoorState', 'FdWindow', 'FpWindow', 'RdWindow', 'RpWindow', 'Odometer', 'HomelinkNearby', 'HomelinkDeviceCount', 'GuestModeEnabled', 'GuestModeMobileAccessState', 'DriverSeatOccupied', 'CenterDisplay', 'CurrentLimitMph', 'SpeedLimitMode', 'ValetModeEnabled', 'ServiceMode', 'PairedPhoneKeyAndKeyFobQty', 'LightsHazardsActive', 'LightsHighBeams', 'LightsTurnSignal', 'TonneauPosition', 'TonneauOpenPercent', 'TonneauTentMode'] },
  { category: 'Safety', fields: ['DriverSeatBelt', 'PassengerSeatBelt', 'AutomaticEmergencyBrakingOff', 'AutomaticBlindSpotCamera', 'BlindSpotCollisionWarningChime', 'CruiseFollowDistance', 'EmergencyLaneDepartureAvoidance', 'ForwardCollisionWarning', 'LaneDepartureAvoidance', 'SpeedLimitWarning', 'PinToDriveEnabled', 'MilesSinceReset', 'SelfDrivingMilesSinceReset'] },
  { category: 'Powertrain', fields: ['DiTorquemotor', 'DiTorqueActualR', 'DiTorqueActualF', 'DiTorqueActualREL', 'DiTorqueActualRER', 'DiSlaveTorqueCmd', 'DiAxleSpeedF', 'DiAxleSpeedR', 'DiAxleSpeedREL', 'DiAxleSpeedRER', 'DiStateR', 'DiStateF', 'DiStateREL', 'DiStateRER', 'DiStatorTempR', 'DiStatorTempF', 'DiStatorTempREL', 'DiStatorTempRER', 'DiHeatsinkTR', 'DiHeatsinkTF', 'DiHeatsinkTREL', 'DiHeatsinkTRER', 'DiInverterTR', 'DiInverterTF', 'DiInverterTREL', 'DiInverterTRER', 'DiMotorCurrentR', 'DiMotorCurrentF', 'DiMotorCurrentREL', 'DiMotorCurrentRER', 'DiVBatR', 'DiVBatF', 'DiVBatREL', 'DiVBatRER', 'Hvil'] },
  { category: 'Tires & Service', fields: ['TpmsPressureFl', 'TpmsPressureFr', 'TpmsPressureRl', 'TpmsPressureRr', 'TpmsHardWarnings', 'TpmsSoftWarnings', 'TpmsLastSeenPressureTimeFl', 'TpmsLastSeenPressureTimeFr', 'TpmsLastSeenPressureTimeRl', 'TpmsLastSeenPressureTimeRr'] },
  { category: 'Media', fields: ['MediaNowPlayingTitle', 'MediaNowPlayingArtist', 'MediaNowPlayingAlbum', 'MediaNowPlayingStation', 'MediaNowPlayingDuration', 'MediaNowPlayingElapsed', 'MediaPlaybackStatus', 'MediaPlaybackSource', 'MediaAudioVolume', 'MediaAudioVolumeIncrement', 'MediaAudioVolumeMax'] },
  { category: 'User Preference', fields: ['Setting24HourTime', 'SettingChargeUnit', 'SettingDistanceUnit', 'SettingTemperatureUnit', 'SettingTirePressureUnit'] },
  { category: 'Vehicle Config', fields: ['CarType', 'Trim', 'ExteriorColor', 'RoofColor', 'WheelType', 'VehicleName', 'Version', 'RearSeatHeaters', 'SunroofInstalled', 'EfficiencyPackage', 'EuropeVehicle', 'RightHandDrive', 'RemoteStartEnabled', 'ChargePort', 'OffroadLightbarPresent', 'SoftwareUpdateVersion', 'SoftwareUpdateDownloadPercentComplete', 'SoftwareUpdateInstallationPercentComplete', 'SoftwareUpdateExpectedDurationMinutes', 'SoftwareUpdateScheduledStartTime'] },
]

/* ─── onboarding steps ────────────────────────────────────────────────── */

export const ONBOARDING_STEPS = [
  { id: 'account', label: 'Tesla Developer Account', icon: KeyRound, desc: 'Create a Tesla Developer account at developer.tesla.com' },
  { id: 'application', label: 'Create Application', icon: FileCode, desc: 'Register a new application in the Tesla Developer Portal' },
  { id: 'keypair', label: 'Generate Key Pair', icon: Key, desc: 'Generate an EC private/public key pair for Fleet API authentication' },
  { id: 'register', label: 'Register Partner', icon: Globe, desc: 'Register as a Fleet API partner with your public key' },
  { id: 'auth', label: 'Authorize Account', icon: Shield, desc: 'Complete OAuth2 authorization to get API access tokens' },
  { id: 'pair', label: 'Pair Vehicle Key', icon: Link, desc: 'Pair your public key with each vehicle for command access' },
  { id: 'telemetry', label: 'Fleet Telemetry', icon: Radio, desc: 'Configure Fleet Telemetry streaming for real-time data' },
] as const

/* ─── reference links ─────────────────────────────────────────────────── */

// `title` is an i18n key; `label` is the English default rendered via
// `t(title, label)` so the card never shows a raw key when a translation is
// absent (none of these keys ship in the locale bundles today).
export const REFERENCE_LINKS = [
  { title: 'devtools.ref.fleetOverview', label: 'Fleet API Overview', url: 'https://developer.tesla.com/docs/fleet-api', icon: 'BookOpen' as const },
  { title: 'devtools.ref.partnerEndpoints', label: 'Partner Endpoints', url: 'https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints#register', icon: 'Globe' as const },
  { title: 'devtools.ref.devPortal', label: 'Developer Portal', url: 'https://developer.tesla.com', icon: 'ExternalLink' as const },
  { title: 'devtools.ref.telemetryGuide', label: 'Fleet Telemetry Guide', url: 'https://developer.tesla.com/docs/fleet-api/fleet-telemetry', icon: 'Radio' as const },
]
