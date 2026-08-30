/**
 * @module lib/signalCatalog
 *
 * Complete catalog of Tesla Fleet Telemetry signals with metadata.
 * Derived from internal/api/signals.go SubscribedSignals list.
 */

export interface SignalMeta {
  name: string
  category: string
  type: 'number' | 'string' | 'boolean'
  unit?: string
  description: string
  enumValues?: string[]
}

const catalog: SignalMeta[] = [
  // ── Charging ──────────────────────────────────────────────────────────
  { name: 'ACChargingEnergyIn', category: 'Charging', type: 'number', unit: 'kWh', description: 'AC energy delivered to the battery' },
  { name: 'ACChargingPower', category: 'Charging', type: 'number', unit: 'kW', description: 'Current AC charging power' },
  { name: 'BatteryLevel', category: 'Battery', type: 'number', unit: '%', description: 'State of charge percentage' },
  { name: 'BMSState', category: 'Battery', type: 'string', description: 'Battery Management System state', enumValues: ['Standby', 'Drive', 'Support', 'Charge', 'Fault'] },
  { name: 'BatteryHeaterOn', category: 'Battery', type: 'boolean', description: 'Battery heater active' },
  { name: 'BmsFullchargecomplete', category: 'Charging', type: 'boolean', description: 'BMS reports full charge complete' },
  { name: 'BrickVoltageMax', category: 'Battery', type: 'number', unit: 'V', description: 'Maximum brick voltage' },
  { name: 'BrickVoltageMin', category: 'Battery', type: 'number', unit: 'V', description: 'Minimum brick voltage' },
  { name: 'ChargeAmps', category: 'Charging', type: 'number', unit: 'A', description: 'Current charging amperage' },
  { name: 'ChargeCurrentRequest', category: 'Charging', type: 'number', unit: 'A', description: 'Requested charge current' },
  { name: 'ChargeCurrentRequestMax', category: 'Charging', type: 'number', unit: 'A', description: 'Maximum requestable charge current' },
  { name: 'ChargeEnableRequest', category: 'Charging', type: 'boolean', description: 'Charge enable request flag' },
  { name: 'ChargeLimitSoc', category: 'Charging', type: 'number', unit: '%', description: 'User-set charge limit SOC' },
  { name: 'ChargePort', category: 'Charging', type: 'string', description: 'Charge port state', enumValues: ['Open', 'Closed', 'Unknown'] },
  { name: 'ChargePortColdWeatherMode', category: 'Charging', type: 'boolean', description: 'Cold weather mode for charge port' },
  { name: 'ChargePortDoorOpen', category: 'Charging', type: 'boolean', description: 'Charge port door open status' },
  { name: 'ChargePortLatch', category: 'Charging', type: 'string', description: 'Charge port latch status', enumValues: ['Engaged', 'Disengaged', 'Unknown'] },
  { name: 'ChargeRateMilePerHour', category: 'Charging', type: 'number', unit: 'm/h', description: 'Range added per hour (Tesla proto field name says "MilePerHour" but wire content is meters of range added per hour; see R2 audit pin)' },
  { name: 'ChargeState', category: 'Charging', type: 'string', description: 'Current charging state', enumValues: ['Charging', 'Complete', 'Disconnected', 'NoPower', 'Starting', 'Stopped'] },
  { name: 'ChargerPhases', category: 'Charging', type: 'number', description: 'Number of charger phases in use' },
  { name: 'ChargerVoltage', category: 'Charging', type: 'number', unit: 'V', description: 'Charger voltage' },
  { name: 'ChargingCableType', category: 'Charging', type: 'string', description: 'Type of charging cable connected', enumValues: ['SAE', 'IEC', 'GB_AC', 'GB_DC', 'Unknown'] },
  { name: 'DCChargingEnergyIn', category: 'Charging', type: 'number', unit: 'kWh', description: 'DC energy delivered to the battery' },
  { name: 'DCChargingPower', category: 'Charging', type: 'number', unit: 'kW', description: 'Current DC charging power' },
  { name: 'DCDCEnable', category: 'Charging', type: 'boolean', description: 'DC-DC converter enabled' },
  { name: 'DetailedChargeState', category: 'Charging', type: 'string', description: 'Detailed charge state', enumValues: ['Charging', 'Complete', 'Disconnected', 'NoPower', 'Starting', 'Stopped', 'Error'] },
  { name: 'EnergyRemaining', category: 'Battery', type: 'number', unit: 'kWh', description: 'Remaining energy in battery' },
  { name: 'EstBatteryRange', category: 'Battery', type: 'number', unit: 'mi', description: 'Estimated battery range' },
  { name: 'EstimatedHoursToChargeTermination', category: 'Charging', type: 'number', unit: 'h', description: 'Estimated hours to charge completion' },
  { name: 'ExpectedEnergyPercentAtTripArrival', category: 'Navigation', type: 'number', unit: '%', description: 'Expected battery percent at trip arrival' },
  { name: 'FastChargerPresent', category: 'Charging', type: 'boolean', description: 'Fast charger detected' },
  { name: 'FastChargerType', category: 'Charging', type: 'string', description: 'Type of fast charger', enumValues: ['Supercharger', 'CCS', 'CHAdeMO', 'Other', 'None'] },
  { name: 'IdealBatteryRange', category: 'Battery', type: 'number', unit: 'mi', description: 'Ideal battery range' },
  { name: 'LifetimeEnergyUsed', category: 'Battery', type: 'number', unit: 'kWh', description: 'Total lifetime energy used' },
  { name: 'ModuleTempMax', category: 'Battery', type: 'number', unit: '°C', description: 'Maximum battery module temperature' },
  { name: 'ModuleTempMin', category: 'Battery', type: 'number', unit: '°C', description: 'Minimum battery module temperature' },
  { name: 'NotEnoughPowerToHeat', category: 'Battery', type: 'boolean', description: 'Not enough power to heat battery' },
  { name: 'NumBrickVoltageMax', category: 'Battery', type: 'number', description: 'Brick number with maximum voltage' },
  { name: 'NumBrickVoltageMin', category: 'Battery', type: 'number', description: 'Brick number with minimum voltage' },
  { name: 'NumModuleTempMax', category: 'Battery', type: 'number', description: 'Module number with maximum temperature' },
  { name: 'NumModuleTempMin', category: 'Battery', type: 'number', description: 'Module number with minimum temperature' },
  { name: 'PackCurrent', category: 'Battery', type: 'number', unit: 'A', description: 'Battery pack current' },
  { name: 'PackVoltage', category: 'Battery', type: 'number', unit: 'V', description: 'Battery pack voltage' },
  { name: 'PreconditioningEnabled', category: 'Charging', type: 'boolean', description: 'Battery preconditioning enabled' },
  { name: 'RatedRange', category: 'Battery', type: 'number', unit: 'mi', description: 'EPA rated range' },
  { name: 'ScheduledChargingMode', category: 'Charging', type: 'string', description: 'Scheduled charging mode', enumValues: ['Off', 'StartAt', 'DepartBy'] },
  { name: 'ScheduledChargingPending', category: 'Charging', type: 'boolean', description: 'Scheduled charging pending' },
  { name: 'ScheduledChargingStartTime', category: 'Charging', type: 'string', description: 'Scheduled charging start time' },
  { name: 'ScheduledDepartureTime', category: 'Charging', type: 'string', description: 'Scheduled departure time' },
  { name: 'Soc', category: 'Battery', type: 'number', unit: '%', description: 'State of charge (raw)' },
  { name: 'SuperchargerSessionTripPlanner', category: 'Charging', type: 'boolean', description: 'Supercharger session trip planner active' },
  { name: 'TimeToFullCharge', category: 'Charging', type: 'number', unit: 'h', description: 'Time remaining to full charge' },

  // ── Powershare ────────────────────────────────────────────────────────
  { name: 'PowershareHoursLeft', category: 'Powershare', type: 'number', unit: 'h', description: 'Hours of Powershare remaining' },
  { name: 'PowershareInstantaneousPowerKW', category: 'Powershare', type: 'number', unit: 'kW', description: 'Current Powershare output power' },
  { name: 'PowershareStatus', category: 'Powershare', type: 'string', description: 'Powershare status', enumValues: ['Active', 'Inactive', 'Unknown'] },
  { name: 'PowershareStopReason', category: 'Powershare', type: 'string', description: 'Reason Powershare stopped', enumValues: ['UserRequest', 'LowBattery', 'Error', 'None'] },
  { name: 'PowershareType', category: 'Powershare', type: 'string', description: 'Type of Powershare', enumValues: ['Home', 'Vehicle', 'None'] },

  // ── Climate ───────────────────────────────────────────────────────────
  { name: 'AutoSeatClimateLeft', category: 'Climate', type: 'boolean', description: 'Auto seat climate left enabled' },
  { name: 'AutoSeatClimateRight', category: 'Climate', type: 'boolean', description: 'Auto seat climate right enabled' },
  { name: 'CabinOverheatProtectionMode', category: 'Climate', type: 'string', description: 'Cabin overheat protection mode', enumValues: ['Off', 'On', 'Fan Only', 'No Cooling'] },
  { name: 'CabinOverheatProtectionTemperatureLimit', category: 'Climate', type: 'string', description: 'Cabin overheat protection temperature limit', enumValues: ['Low', 'Medium', 'High'] },
  { name: 'ClimateKeeperMode', category: 'Climate', type: 'string', description: 'Climate keeper mode', enumValues: ['Off', 'On', 'Dog Mode', 'Camp Mode'] },
  { name: 'ClimateSeatCoolingFrontLeft', category: 'Climate', type: 'number', description: 'Front left seat cooling level (0-3)' },
  { name: 'ClimateSeatCoolingFrontRight', category: 'Climate', type: 'number', description: 'Front right seat cooling level (0-3)' },
  { name: 'DefrostForPreconditioning', category: 'Climate', type: 'boolean', description: 'Defrost for preconditioning active' },
  { name: 'DefrostMode', category: 'Climate', type: 'string', description: 'Defrost mode state', enumValues: ['Off', 'Normal', 'Max', 'AutoDefog'] },
  { name: 'HvacACEnabled', category: 'Climate', type: 'boolean', description: 'HVAC AC compressor enabled' },
  { name: 'HvacAutoMode', category: 'Climate', type: 'string', description: 'HVAC auto mode enabled', enumValues: ['On', 'Off'] },
  { name: 'HvacFanSpeed', category: 'Climate', type: 'number', description: 'HVAC fan speed setting (0-10)' },
  { name: 'HvacFanStatus', category: 'Climate', type: 'number', description: 'HVAC fan status' },
  { name: 'HvacLeftTemperatureRequest', category: 'Climate', type: 'number', unit: '°C', description: 'Left side temperature request' },
  { name: 'HvacPower', category: 'Climate', type: 'boolean', description: 'HVAC system power state' },
  { name: 'HvacRightTemperatureRequest', category: 'Climate', type: 'number', unit: '°C', description: 'Right side temperature request' },
  { name: 'HvacSteeringWheelHeatAuto', category: 'Climate', type: 'boolean', description: 'Steering wheel heater auto mode' },
  { name: 'HvacSteeringWheelHeatLevel', category: 'Climate', type: 'number', description: 'Steering wheel heater level (0-3)' },
  { name: 'InsideTemp', category: 'Climate', type: 'number', unit: '°C', description: 'Interior cabin temperature' },
  { name: 'OutsideTemp', category: 'Climate', type: 'number', unit: '°C', description: 'Outside ambient temperature' },
  { name: 'RearDefrostEnabled', category: 'Climate', type: 'boolean', description: 'Rear window defrost enabled' },
  { name: 'RearDisplayHvacEnabled', category: 'Climate', type: 'boolean', description: 'Rear display HVAC controls enabled' },
  { name: 'SeatHeaterLeft', category: 'Climate', type: 'number', description: 'Left seat heater level (0-3)' },
  { name: 'SeatHeaterRearCenter', category: 'Climate', type: 'number', description: 'Rear center seat heater level (0-3)' },
  { name: 'SeatHeaterRearLeft', category: 'Climate', type: 'number', description: 'Rear left seat heater level (0-3)' },
  { name: 'SeatHeaterRearRight', category: 'Climate', type: 'number', description: 'Rear right seat heater level (0-3)' },
  { name: 'SeatHeaterRight', category: 'Climate', type: 'number', description: 'Right seat heater level (0-3)' },
  { name: 'SeatVentEnabled', category: 'Climate', type: 'boolean', description: 'Seat ventilation enabled' },
  { name: 'WiperHeatEnabled', category: 'Climate', type: 'boolean', description: 'Wiper heater enabled' },

  // ── Driving ───────────────────────────────────────────────────────────
  { name: 'BrakePedal', category: 'Driving', type: 'boolean', description: 'Brake pedal pressed' },
  { name: 'BrakePedalPos', category: 'Driving', type: 'number', unit: '%', description: 'Brake pedal position' },
  { name: 'CruiseSetSpeed', category: 'Driving', type: 'number', unit: 'km/h', description: 'Cruise control set speed' },
  { name: 'DriveRail', category: 'Driving', type: 'boolean', description: 'Drive rail active' },
  { name: 'Gear', category: 'Driving', type: 'string', description: 'Current gear', enumValues: ['P', 'R', 'N', 'D'] },
  { name: 'LateralAcceleration', category: 'Driving', type: 'number', unit: 'g', description: 'Lateral acceleration' },
  { name: 'LifetimeEnergyGainedRegen', category: 'Driving', type: 'number', unit: 'kWh', description: 'Lifetime energy gained via regen' },
  { name: 'LifetimeEnergyUsedDrive', category: 'Driving', type: 'number', unit: 'kWh', description: 'Lifetime energy used for driving' },
  { name: 'LongitudinalAcceleration', category: 'Driving', type: 'number', unit: 'g', description: 'Longitudinal acceleration' },
  { name: 'PedalPosition', category: 'Driving', type: 'number', unit: '%', description: 'Accelerator pedal position' },
  { name: 'RouteTrafficMinutesDelay', category: 'Navigation', type: 'number', unit: 'min', description: 'Traffic delay on route' },
  { name: 'VehicleSpeed', category: 'Driving', type: 'number', unit: 'km/h', description: 'Current vehicle speed' },

  // ── Motor (Powertrain) ────────────────────────────────────────────────
  { name: 'DiAxleSpeedF', category: 'Motor', type: 'number', unit: 'RPM', description: 'Front axle speed' },
  { name: 'DiAxleSpeedR', category: 'Motor', type: 'number', unit: 'RPM', description: 'Rear axle speed' },
  { name: 'DiAxleSpeedREL', category: 'Motor', type: 'number', unit: 'RPM', description: 'Rear-left axle speed' },
  { name: 'DiAxleSpeedRER', category: 'Motor', type: 'number', unit: 'RPM', description: 'Rear-right axle speed' },
  { name: 'DiHeatsinkTF', category: 'Motor', type: 'number', unit: '°C', description: 'Front heatsink temperature' },
  { name: 'DiHeatsinkTR', category: 'Motor', type: 'number', unit: '°C', description: 'Rear heatsink temperature' },
  { name: 'DiHeatsinkTREL', category: 'Motor', type: 'number', unit: '°C', description: 'Rear-left heatsink temperature' },
  { name: 'DiHeatsinkTRER', category: 'Motor', type: 'number', unit: '°C', description: 'Rear-right heatsink temperature' },
  { name: 'DiInverterTF', category: 'Motor', type: 'number', unit: '°C', description: 'Front inverter temperature' },
  { name: 'DiInverterTR', category: 'Motor', type: 'number', unit: '°C', description: 'Rear inverter temperature' },
  { name: 'DiInverterTREL', category: 'Motor', type: 'number', unit: '°C', description: 'Rear-left inverter temperature' },
  { name: 'DiInverterTRER', category: 'Motor', type: 'number', unit: '°C', description: 'Rear-right inverter temperature' },
  { name: 'DiMotorCurrentF', category: 'Motor', type: 'number', unit: 'A', description: 'Front motor current' },
  { name: 'DiMotorCurrentR', category: 'Motor', type: 'number', unit: 'A', description: 'Rear motor current' },
  { name: 'DiMotorCurrentREL', category: 'Motor', type: 'number', unit: 'A', description: 'Rear-left motor current' },
  { name: 'DiMotorCurrentRER', category: 'Motor', type: 'number', unit: 'A', description: 'Rear-right motor current' },
  { name: 'DiSlaveTorqueCmd', category: 'Motor', type: 'number', unit: 'Nm', description: 'Slave torque command' },
  { name: 'DiStateF', category: 'Motor', type: 'string', description: 'Front drive inverter state', enumValues: ['Idle', 'Running', 'Fault', 'Unavailable'] },
  { name: 'DiStateR', category: 'Motor', type: 'string', description: 'Rear drive inverter state', enumValues: ['Idle', 'Running', 'Fault', 'Unavailable'] },
  { name: 'DiStateREL', category: 'Motor', type: 'string', description: 'Rear-left drive inverter state', enumValues: ['Idle', 'Running', 'Fault', 'Unavailable'] },
  { name: 'DiStateRER', category: 'Motor', type: 'string', description: 'Rear-right drive inverter state', enumValues: ['Idle', 'Running', 'Fault', 'Unavailable'] },
  { name: 'DiStatorTempF', category: 'Motor', type: 'number', unit: '°C', description: 'Front stator temperature' },
  { name: 'DiStatorTempR', category: 'Motor', type: 'number', unit: '°C', description: 'Rear stator temperature' },
  { name: 'DiStatorTempREL', category: 'Motor', type: 'number', unit: '°C', description: 'Rear-left stator temperature' },
  { name: 'DiStatorTempRER', category: 'Motor', type: 'number', unit: '°C', description: 'Rear-right stator temperature' },
  { name: 'DiTorqueActualF', category: 'Motor', type: 'number', unit: 'Nm', description: 'Front actual torque' },
  { name: 'DiTorqueActualR', category: 'Motor', type: 'number', unit: 'Nm', description: 'Rear actual torque' },
  { name: 'DiTorqueActualREL', category: 'Motor', type: 'number', unit: 'Nm', description: 'Rear-left actual torque' },
  { name: 'DiTorqueActualRER', category: 'Motor', type: 'number', unit: 'Nm', description: 'Rear-right actual torque' },
  { name: 'DiTorquemotor', category: 'Motor', type: 'number', unit: 'Nm', description: 'Combined motor torque' },
  { name: 'DiVBatF', category: 'Motor', type: 'number', unit: 'V', description: 'Front inverter battery voltage' },
  { name: 'DiVBatR', category: 'Motor', type: 'number', unit: 'V', description: 'Rear inverter battery voltage' },
  { name: 'DiVBatREL', category: 'Motor', type: 'number', unit: 'V', description: 'Rear-left inverter battery voltage' },
  { name: 'DiVBatRER', category: 'Motor', type: 'number', unit: 'V', description: 'Rear-right inverter battery voltage' },
  { name: 'Hvil', category: 'Motor', type: 'boolean', description: 'High-voltage interlock loop status' },

  // ── Location ──────────────────────────────────────────────────────────
  { name: 'DestinationLocation', category: 'Location', type: 'string', description: 'Navigation destination coordinates' },
  { name: 'DestinationName', category: 'Navigation', type: 'string', description: 'Navigation destination name' },
  { name: 'GpsHeading', category: 'Location', type: 'number', unit: '°', description: 'GPS heading in degrees' },
  { name: 'GpsState', category: 'Location', type: 'string', description: 'GPS fix state. Polymorphic: Tesla emits "true"/"false" or "GpsLocked"; legacy data uses "GPSValid"/"GPSInvalid"; canonical enum is NoFix/Fix2D/Fix3D. Use normalizeGpsState() before display.', enumValues: ['NoFix', 'Fix2D', 'Fix3D', 'GPSValid', 'GPSInvalid', 'GpsLocked', 'true', 'false'] },
  { name: 'LocatedAtFavorite', category: 'Location', type: 'boolean', description: 'Vehicle at a favorite location' },
  { name: 'LocatedAtHome', category: 'Location', type: 'boolean', description: 'Vehicle at home location' },
  { name: 'LocatedAtWork', category: 'Location', type: 'boolean', description: 'Vehicle at work location' },
  { name: 'Location', category: 'Location', type: 'string', description: 'Current vehicle GPS coordinates' },
  { name: 'MilesToArrival', category: 'Navigation', type: 'number', unit: 'mi', description: 'Miles remaining to navigation destination' },
  { name: 'MinutesToArrival', category: 'Navigation', type: 'number', unit: 'min', description: 'Minutes remaining to navigation destination' },
  { name: 'OriginLocation', category: 'Location', type: 'string', description: 'Navigation origin coordinates' },
  { name: 'RouteLine', category: 'Navigation', type: 'string', description: 'Encoded route polyline' },
  { name: 'RouteLastUpdated', category: 'Navigation', type: 'string', description: 'Last time route was updated' },

  // ── Media ─────────────────────────────────────────────────────────────
  { name: 'MediaAudioVolume', category: 'Media', type: 'number', description: 'Audio volume level' },
  { name: 'MediaAudioVolumeIncrement', category: 'Media', type: 'number', description: 'Volume increment step' },
  { name: 'MediaAudioVolumeMax', category: 'Media', type: 'number', description: 'Maximum audio volume' },
  { name: 'MediaNowPlayingAlbum', category: 'Media', type: 'string', description: 'Currently playing album name' },
  { name: 'MediaNowPlayingArtist', category: 'Media', type: 'string', description: 'Currently playing artist name' },
  { name: 'MediaNowPlayingDuration', category: 'Media', type: 'number', unit: 'ms', description: 'Duration of current track (milliseconds)' },
  { name: 'MediaNowPlayingElapsed', category: 'Media', type: 'number', unit: 'ms', description: 'Elapsed time of current track (milliseconds)' },
  { name: 'MediaNowPlayingStation', category: 'Media', type: 'string', description: 'Currently playing radio station' },
  { name: 'MediaNowPlayingTitle', category: 'Media', type: 'string', description: 'Currently playing track title' },
  { name: 'MediaPlaybackSource', category: 'Media', type: 'string', description: 'Playback source (Spotify, Bluetooth, etc.)' },
  { name: 'MediaPlaybackStatus', category: 'Media', type: 'string', description: 'Playback status', enumValues: ['Playing', 'Paused', 'Stopped'] },

  // ── Safety ────────────────────────────────────────────────────────────
  { name: 'AutomaticBlindSpotCamera', category: 'Safety', type: 'boolean', description: 'Automatic blind spot camera enabled' },
  { name: 'AutomaticEmergencyBrakingOff', category: 'Safety', type: 'boolean', description: 'Automatic emergency braking disabled' },
  { name: 'BlindSpotCollisionWarningChime', category: 'Safety', type: 'boolean', description: 'Blind spot collision warning chime enabled' },
  { name: 'CruiseFollowDistance', category: 'Safety', type: 'string', description: 'Cruise follow distance setting (1-7)', enumValues: ['1', '2', '3', '4', '5', '6', '7'] },
  { name: 'DriverSeatBelt', category: 'Safety', type: 'boolean', description: 'Driver seat belt unbuckled warning' },
  { name: 'EmergencyLaneDepartureAvoidance', category: 'Safety', type: 'boolean', description: 'Emergency lane departure avoidance enabled' },
  { name: 'ForwardCollisionWarning', category: 'Safety', type: 'string', description: 'Forward collision warning sensitivity', enumValues: ['Off', 'Late', 'Average', 'Early'] },
  { name: 'LaneDepartureAvoidance', category: 'Safety', type: 'string', description: 'Lane departure avoidance mode', enumValues: ['Off', 'Warning', 'Assist'] },
  { name: 'Locked', category: 'Security', type: 'boolean', description: 'Vehicle locked state' },
  { name: 'MilesSinceReset', category: 'Driving', type: 'number', unit: 'm', description: 'Resettable trip distance counter since the last reset. Normalized to SI meters on ingest despite the "Miles" proto name.' },
  { name: 'PassengerSeatBelt', category: 'Safety', type: 'boolean', description: 'Passenger seat belt buckled' },
  { name: 'PinToDriveEnabled', category: 'Security', type: 'boolean', description: 'PIN to Drive enabled' },
  { name: 'SelfDrivingMilesSinceReset', category: 'Driving', type: 'number', unit: 'm', description: 'Resettable supervised self-driving distance counter. Normalized to SI meters on ingest despite the "Miles" proto name; it does not describe interventions or safety.' },
  { name: 'SpeedLimitWarning', category: 'Safety', type: 'string', description: 'Speed limit warning mode', enumValues: ['Off', 'Display', 'Chime'] },

  // ── Service / Tire Pressure ───────────────────────────────────────────
  { name: 'IsolationResistance', category: 'Service', type: 'number', unit: 'kΩ', description: 'HV isolation resistance' },
  { name: 'TpmsHardWarnings', category: 'Tire Pressure', type: 'string', description: 'TPMS hard warnings (per-tire JSON)' },
  { name: 'TpmsLastSeenPressureTimeFl', category: 'Tire Pressure', type: 'string', description: 'Last TPMS reading time — front left' },
  { name: 'TpmsLastSeenPressureTimeFr', category: 'Tire Pressure', type: 'string', description: 'Last TPMS reading time — front right' },
  { name: 'TpmsLastSeenPressureTimeRl', category: 'Tire Pressure', type: 'string', description: 'Last TPMS reading time — rear left' },
  { name: 'TpmsLastSeenPressureTimeRr', category: 'Tire Pressure', type: 'string', description: 'Last TPMS reading time — rear right' },
  { name: 'TpmsPressureFl', category: 'Tire Pressure', type: 'number', unit: 'bar', description: 'Front-left tire pressure' },
  { name: 'TpmsPressureFr', category: 'Tire Pressure', type: 'number', unit: 'bar', description: 'Front-right tire pressure' },
  { name: 'TpmsPressureRl', category: 'Tire Pressure', type: 'number', unit: 'bar', description: 'Rear-left tire pressure' },
  { name: 'TpmsPressureRr', category: 'Tire Pressure', type: 'number', unit: 'bar', description: 'Rear-right tire pressure' },
  { name: 'TpmsSoftWarnings', category: 'Tire Pressure', type: 'string', description: 'TPMS soft warnings (per-tire JSON)' },

  // ── Vehicle State ─────────────────────────────────────────────────────
  { name: 'CenterDisplay', category: 'Vehicle Config', type: 'string', description: 'Center display state', enumValues: ['Off', 'Dim', 'Accessory', 'On', 'Driving', 'Charging', 'Lock', 'Sentry', 'Dog', 'Entertainment'] },
  { name: 'CurrentLimitMph', category: 'Driving', type: 'number', unit: 'mph', description: 'Current speed limit' },
  { name: 'DoorState', category: 'Security', type: 'string', description: 'Door open/closed states' },
  { name: 'DriverSeatOccupied', category: 'Safety', type: 'boolean', description: 'Driver seat occupied' },
  { name: 'FdWindow', category: 'Security', type: 'string', description: 'Front driver window state', enumValues: ['Closed', 'Open', 'Partial'] },
  { name: 'FpWindow', category: 'Security', type: 'string', description: 'Front passenger window state', enumValues: ['Closed', 'Open', 'Partial'] },
  { name: 'GuestModeEnabled', category: 'Security', type: 'boolean', description: 'Guest mode enabled' },
  { name: 'GuestModeMobileAccessState', category: 'Security', type: 'string', description: 'Guest mode mobile access state' },
  { name: 'HomelinkDeviceCount', category: 'Vehicle Config', type: 'number', description: 'Number of HomeLink devices configured' },
  { name: 'HomelinkNearby', category: 'Location', type: 'boolean', description: 'Near a HomeLink location' },
  { name: 'LightsHazardsActive', category: 'Driving', type: 'boolean', description: 'Hazard lights active' },
  { name: 'LightsHighBeams', category: 'Driving', type: 'boolean', description: 'High beams active' },
  { name: 'LightsTurnSignal', category: 'Driving', type: 'string', description: 'Turn signal state', enumValues: ['Off', 'Left', 'Right', 'Both'] },
  { name: 'Odometer', category: 'Driving', type: 'number', unit: 'mi', description: 'Vehicle odometer reading' },
  { name: 'PairedPhoneKeyAndKeyFobQty', category: 'Security', type: 'number', description: 'Number of paired phone keys and key fobs' },
  { name: 'RdWindow', category: 'Security', type: 'string', description: 'Rear driver window state', enumValues: ['Closed', 'Open', 'Partial'] },
  { name: 'RpWindow', category: 'Security', type: 'string', description: 'Rear passenger window state', enumValues: ['Closed', 'Open', 'Partial'] },
  { name: 'SentryMode', category: 'Security', type: 'boolean', description: 'Sentry mode enabled' },
  { name: 'ServiceMode', category: 'Service', type: 'boolean', description: 'Service mode active' },
  { name: 'SpeedLimitMode', category: 'Safety', type: 'boolean', description: 'Speed limit mode active' },

  // ── Software ──────────────────────────────────────────────────────────
  { name: 'SoftwareUpdateDownloadPercentComplete', category: 'Software', type: 'number', unit: '%', description: 'Software update download progress' },
  { name: 'SoftwareUpdateExpectedDurationMinutes', category: 'Software', type: 'number', unit: 'min', description: 'Expected software update duration' },
  { name: 'SoftwareUpdateInstallationPercentComplete', category: 'Software', type: 'number', unit: '%', description: 'Software update installation progress' },
  { name: 'SoftwareUpdateScheduledStartTime', category: 'Software', type: 'string', description: 'Scheduled software update start time' },
  { name: 'SoftwareUpdateVersion', category: 'Software', type: 'string', description: 'Pending software update version' },
  { name: 'TonneauOpenPercent', category: 'Vehicle Config', type: 'number', unit: '%', description: 'Tonneau cover open percentage' },
  { name: 'TonneauPosition', category: 'Vehicle Config', type: 'string', description: 'Tonneau cover position' },
  { name: 'TonneauTentMode', category: 'Vehicle Config', type: 'string', description: 'Tonneau tent mode state' },
  { name: 'ValetModeEnabled', category: 'Security', type: 'boolean', description: 'Valet mode enabled' },

  // ── Vehicle Configuration ─────────────────────────────────────────────
  { name: 'CarType', category: 'Vehicle Config', type: 'string', description: 'Vehicle model type' },
  { name: 'EfficiencyPackage', category: 'Vehicle Config', type: 'string', description: 'Efficiency package installed' },
  { name: 'EuropeVehicle', category: 'Vehicle Config', type: 'boolean', description: 'European market vehicle' },
  { name: 'ExteriorColor', category: 'Vehicle Config', type: 'string', description: 'Exterior paint color' },
  { name: 'OffroadLightbarPresent', category: 'Vehicle Config', type: 'boolean', description: 'Offroad lightbar installed' },
  { name: 'RearSeatHeaters', category: 'Vehicle Config', type: 'number', description: 'Number of rear seat heaters' },
  { name: 'RemoteStartEnabled', category: 'Security', type: 'boolean', description: 'Remote start enabled' },
  { name: 'RightHandDrive', category: 'Vehicle Config', type: 'boolean', description: 'Right-hand drive vehicle' },
  { name: 'RoofColor', category: 'Vehicle Config', type: 'string', description: 'Roof color' },
  { name: 'SunroofInstalled', category: 'Vehicle Config', type: 'boolean', description: 'Sunroof installed' },
  { name: 'Trim', category: 'Vehicle Config', type: 'string', description: 'Vehicle trim level' },
  { name: 'VehicleName', category: 'Vehicle Config', type: 'string', description: 'User-set vehicle name' },
  { name: 'Version', category: 'Software', type: 'string', description: 'Current software version' },
  { name: 'WheelType', category: 'Vehicle Config', type: 'string', description: 'Wheel type' },

  // ── User Preferences ──────────────────────────────────────────────────
  { name: 'Setting24HourTime', category: 'User Preferences', type: 'boolean', description: '24-hour time format enabled' },
  { name: 'SettingChargeUnit', category: 'User Preferences', type: 'string', description: 'Charge unit preference', enumValues: ['mi', 'km', '%'] },
  { name: 'SettingDistanceUnit', category: 'User Preferences', type: 'string', description: 'Distance unit preference', enumValues: ['mi/hr', 'km/hr'] },
  { name: 'SettingTemperatureUnit', category: 'User Preferences', type: 'string', description: 'Temperature unit preference', enumValues: ['F', 'C'] },
  { name: 'SettingTirePressureUnit', category: 'User Preferences', type: 'string', description: 'Tire pressure unit preference', enumValues: ['Bar', 'Psi'] },
]

export const signalCatalog: SignalMeta[] = catalog

/** Unique sorted list of signal categories. */
export const signalCategories: string[] = [
  ...new Set(catalog.map(s => s.category)),
].sort()

/** Lookup map for O(1) access by name. */
const _byName = new Map<string, SignalMeta>()
for (const s of catalog) _byName.set(s.name, s)

/** Returns metadata for a signal by name. */
export function getSignalMeta(name: string): SignalMeta | undefined {
  return _byName.get(name)
}

/* ------------------------------------------------------------------ */
/*  GPS state normalisation                                            */
/* ------------------------------------------------------------------ */

/** Stable 3-value enum the UI can switch on for the polymorphic gps_state field. */
export type GpsFixState = 'locked' | 'unlocked' | 'unknown'

/**
 * Canonicalises the polymorphic gps_state values Tesla and our test
 * generators emit into a stable 3-value enum the UI can switch on.
 *
 * Real-world raw values include: "true"/"false" (Tesla bool literal),
 * "GpsLocked" (current firmware / proto-batch wire form persisted verbatim
 * by internal/tesla/codec/coercion.go), "GPSValid"/"GPSInvalid" (legacy
 * test data), "NoFix"/"Fix2D"/"Fix3D"/"fix" (canonical enum + short form),
 * and historic strings like "normal"/"good"/"strong"/"ok"/"valid"/
 * "invalid"/"none". Genuinely ambiguous states ("GpsUnknown",
 * "DR_GPS_NAV_LIMITED") fall through to 'unknown' rather than guessing.
 */
export function normalizeGpsState(raw: string | null | undefined): GpsFixState {
  if (raw == null) return 'unknown'
  const v = String(raw).trim().toLowerCase()
  if (!v) return 'unknown'

  if (
    v === 'true' || v === '1' || v === 'yes' ||
    v === 'gpsvalid' || v === 'gpslocked' ||
    v === 'fix' || v === 'fix2d' || v === 'fix3d' ||
    v === 'normal' || v === 'good' || v === 'strong' || v === 'ok' || v === 'valid'
  ) return 'locked'

  if (
    v === 'false' || v === '0' || v === 'no' ||
    v === 'gpsinvalid' ||
    v === 'nofix' ||
    v === 'invalid' || v === 'none'
  ) return 'unlocked'

  return 'unknown'
}
