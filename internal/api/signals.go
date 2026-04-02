package api

// SubscribedSignals is the complete list of Tesla Fleet Telemetry signals
// that we subscribe to. This must match the fleet_telemetry_config subscription.
// Covers all 259 proto fields (excluding deprecated, experimental, and semi-truck-only).
var SubscribedSignals = []string{
	// Charging (40)
	"ACChargingEnergyIn", "ACChargingPower", "BatteryLevel", "BMSState", "BatteryHeaterOn",
	"BmsFullchargecomplete", "BrickVoltageMax", "BrickVoltageMin",
	"ChargeAmps", "ChargeCurrentRequest", "ChargeCurrentRequestMax", "ChargeEnableRequest",
	"ChargeLimitSoc", "ChargePort", "ChargePortColdWeatherMode", "ChargePortDoorOpen", "ChargePortLatch",
	"ChargeRateMilePerHour", "ChargeState", "ChargerPhases", "ChargerVoltage", "ChargingCableType",
	"DCChargingEnergyIn", "DCChargingPower", "DCDCEnable", "DetailedChargeState",
	"EnergyRemaining", "EstBatteryRange", "EstimatedHoursToChargeTermination",
	"ExpectedEnergyPercentAtTripArrival", "FastChargerPresent", "FastChargerType",
	"IdealBatteryRange", "LifetimeEnergyUsed", "ModuleTempMax", "ModuleTempMin",
	"NotEnoughPowerToHeat", "NumBrickVoltageMax", "NumBrickVoltageMin", "NumModuleTempMax", "NumModuleTempMin",
	"PackCurrent", "PackVoltage", "PreconditioningEnabled", "RatedRange",
	"ScheduledChargingMode", "ScheduledChargingPending", "ScheduledChargingStartTime", "ScheduledDepartureTime",
	"Soc", "SuperchargerSessionTripPlanner", "TimeToFullCharge",

	// Powershare (5)
	"PowershareHoursLeft", "PowershareInstantaneousPowerKW", "PowershareStatus", "PowershareStopReason", "PowershareType",

	// Climate (22)
	"AutoSeatClimateLeft", "AutoSeatClimateRight",
	"CabinOverheatProtectionMode", "CabinOverheatProtectionTemperatureLimit",
	"ClimateKeeperMode", "ClimateSeatCoolingFrontLeft", "ClimateSeatCoolingFrontRight",
	"DefrostForPreconditioning", "DefrostMode",
	"HvacACEnabled", "HvacAutoMode", "HvacFanSpeed", "HvacFanStatus",
	"HvacLeftTemperatureRequest", "HvacPower", "HvacRightTemperatureRequest",
	"HvacSteeringWheelHeatAuto", "HvacSteeringWheelHeatLevel",
	"InsideTemp", "OutsideTemp", "RearDefrostEnabled", "RearDisplayHvacEnabled",
	"SeatHeaterLeft", "SeatHeaterRearCenter", "SeatHeaterRearLeft", "SeatHeaterRearRight",
	"SeatHeaterRight", "SeatVentEnabled", "WiperHeatEnabled",

	// Driving (10)
	"BrakePedal", "BrakePedalPos", "CruiseSetSpeed", "DriveRail",
	"Gear", "LateralAcceleration", "LifetimeEnergyGainedRegen", "LifetimeEnergyUsedDrive", "LongitudinalAcceleration",
	"PedalPosition", "RouteTrafficMinutesDelay", "VehicleSpeed",

	// Powertrain (29)
	"DiAxleSpeedF", "DiAxleSpeedR", "DiAxleSpeedREL", "DiAxleSpeedRER",
	"DiHeatsinkTF", "DiHeatsinkTR", "DiHeatsinkTREL", "DiHeatsinkTRER",
	"DiInverterTF", "DiInverterTR", "DiInverterTREL", "DiInverterTRER",
	"DiMotorCurrentF", "DiMotorCurrentR", "DiMotorCurrentREL", "DiMotorCurrentRER",
	"DiSlaveTorqueCmd", "DiStateF", "DiStateR", "DiStateREL", "DiStateRER",
	"DiStatorTempF", "DiStatorTempR", "DiStatorTempREL", "DiStatorTempRER",
	"DiTorqueActualF", "DiTorqueActualR", "DiTorqueActualREL", "DiTorqueActualRER",
	"DiTorquemotor", "DiVBatF", "DiVBatR", "DiVBatREL", "DiVBatRER", "Hvil",

	// Location (12)
	"DestinationLocation", "DestinationName", "GpsHeading", "GpsState",
	"LocatedAtFavorite", "LocatedAtHome", "LocatedAtWork", "Location",
	"MilesToArrival", "MinutesToArrival", "OriginLocation", "RouteLine", "RouteLastUpdated",

	// Media (10)
	"MediaAudioVolume", "MediaAudioVolumeIncrement", "MediaAudioVolumeMax",
	"MediaNowPlayingAlbum", "MediaNowPlayingArtist", "MediaNowPlayingDuration",
	"MediaNowPlayingElapsed", "MediaNowPlayingStation", "MediaNowPlayingTitle",
	"MediaPlaybackSource", "MediaPlaybackStatus",

	// Safety (12)
	"AutomaticBlindSpotCamera", "AutomaticEmergencyBrakingOff", "BlindSpotCollisionWarningChime",
	"CruiseFollowDistance", "DriverSeatBelt", "EmergencyLaneDepartureAvoidance",
	"ForwardCollisionWarning", "LaneDepartureAvoidance", "Locked",
	"MilesSinceReset", "PassengerSeatBelt", "PinToDriveEnabled",
	"SelfDrivingMilesSinceReset", "SpeedLimitWarning",

	// Service (7)
	"IsolationResistance",
	"TpmsHardWarnings", "TpmsLastSeenPressureTimeFl", "TpmsLastSeenPressureTimeFr",
	"TpmsLastSeenPressureTimeRl", "TpmsLastSeenPressureTimeRr",
	"TpmsPressureFl", "TpmsPressureFr", "TpmsPressureRl", "TpmsPressureRr", "TpmsSoftWarnings",

	// Vehicle State (18)
	"CenterDisplay", "CurrentLimitMph", "DoorState", "DriverSeatOccupied",
	"FdWindow", "FpWindow", "GuestModeEnabled", "GuestModeMobileAccessState",
	"HomelinkDeviceCount", "HomelinkNearby", "LightsHazardsActive", "LightsHighBeams", "LightsTurnSignal",
	"Odometer", "PairedPhoneKeyAndKeyFobQty", "RdWindow", "RpWindow",
	"SentryMode", "ServiceMode", "SpeedLimitMode",
	"SoftwareUpdateDownloadPercentComplete", "SoftwareUpdateExpectedDurationMinutes",
	"SoftwareUpdateInstallationPercentComplete", "SoftwareUpdateScheduledStartTime", "SoftwareUpdateVersion",
	"TonneauOpenPercent", "TonneauPosition", "TonneauTentMode", "ValetModeEnabled",

	// Vehicle Configuration (12)
	"CarType", "EfficiencyPackage", "EuropeVehicle", "ExteriorColor",
	"OffroadLightbarPresent", "RearSeatHeaters", "RemoteStartEnabled", "RightHandDrive",
	"RoofColor", "SunroofInstalled", "Trim", "VehicleName", "Version", "WheelType",

	// User Preferences (5)
	"Setting24HourTime", "SettingChargeUnit", "SettingDistanceUnit",
	"SettingTemperatureUnit", "SettingTirePressureUnit",

	// Charging Port
	"ChargePort",
}
