// signal_audit_test.go — Cross-references all 230+ Tesla Fleet Telemetry signals
// across subscription, registry, and live_state layers.
package enums

import (
	"sort"
	"strings"
	"testing"
)

// subscribedSignals is copied from internal/api/signals.go for audit purposes.
// When signals.go changes, this list must be updated.
var subscribedSignals = []string{
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
	"PowershareHoursLeft", "PowershareInstantaneousPowerKW", "PowershareStatus", "PowershareStopReason", "PowershareType",
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
	"BrakePedal", "BrakePedalPos", "CruiseSetSpeed", "DriveRail",
	"Gear", "LateralAcceleration", "LifetimeEnergyGainedRegen", "LifetimeEnergyUsedDrive", "LongitudinalAcceleration",
	"PedalPosition", "RouteTrafficMinutesDelay", "VehicleSpeed",
	"DiAxleSpeedF", "DiAxleSpeedR", "DiAxleSpeedREL", "DiAxleSpeedRER",
	"DiHeatsinkTF", "DiHeatsinkTR", "DiHeatsinkTREL", "DiHeatsinkTRER",
	"DiInverterTF", "DiInverterTR", "DiInverterTREL", "DiInverterTRER",
	"DiMotorCurrentF", "DiMotorCurrentR", "DiMotorCurrentREL", "DiMotorCurrentRER",
	"DiSlaveTorqueCmd", "DiStateF", "DiStateR", "DiStateREL", "DiStateRER",
	"DiStatorTempF", "DiStatorTempR", "DiStatorTempREL", "DiStatorTempRER",
	"DiTorqueActualF", "DiTorqueActualR", "DiTorqueActualREL", "DiTorqueActualRER",
	"DiTorquemotor", "DiVBatF", "DiVBatR", "DiVBatREL", "DiVBatRER", "Hvil",
	"DestinationLocation", "DestinationName", "GpsHeading", "GpsState",
	"LocatedAtFavorite", "LocatedAtHome", "LocatedAtWork", "Location",
	"MilesToArrival", "MinutesToArrival", "OriginLocation", "RouteLine", "RouteLastUpdated",
	"MediaAudioVolume", "MediaAudioVolumeIncrement", "MediaAudioVolumeMax",
	"MediaNowPlayingAlbum", "MediaNowPlayingArtist", "MediaNowPlayingDuration",
	"MediaNowPlayingElapsed", "MediaNowPlayingStation", "MediaNowPlayingTitle",
	"MediaPlaybackSource", "MediaPlaybackStatus",
	"AutomaticBlindSpotCamera", "AutomaticEmergencyBrakingOff", "BlindSpotCollisionWarningChime",
	"CruiseFollowDistance", "DriverSeatBelt", "EmergencyLaneDepartureAvoidance",
	"ForwardCollisionWarning", "LaneDepartureAvoidance", "Locked",
	"MilesSinceReset", "PassengerSeatBelt", "PinToDriveEnabled",
	"SelfDrivingMilesSinceReset", "SpeedLimitWarning",
	"IsolationResistance",
	"TpmsHardWarnings", "TpmsLastSeenPressureTimeFl", "TpmsLastSeenPressureTimeFr",
	"TpmsLastSeenPressureTimeRl", "TpmsLastSeenPressureTimeRr",
	"TpmsPressureFl", "TpmsPressureFr", "TpmsPressureRl", "TpmsPressureRr", "TpmsSoftWarnings",
	"CenterDisplay", "CurrentLimitMph", "DoorState", "DriverSeatOccupied",
	"FdWindow", "FpWindow", "GuestModeEnabled", "GuestModeMobileAccessState",
	"HomelinkDeviceCount", "HomelinkNearby", "LightsHazardsActive", "LightsHighBeams", "LightsTurnSignal",
	"Odometer", "PairedPhoneKeyAndKeyFobQty", "RdWindow", "RpWindow",
	"SentryMode", "ServiceMode", "SpeedLimitMode",
	"SoftwareUpdateDownloadPercentComplete", "SoftwareUpdateExpectedDurationMinutes",
	"SoftwareUpdateInstallationPercentComplete", "SoftwareUpdateScheduledStartTime", "SoftwareUpdateVersion",
	"TonneauOpenPercent", "TonneauPosition", "TonneauTentMode", "ValetModeEnabled",
	"CarType", "EfficiencyPackage", "EuropeVehicle", "ExteriorColor",
	"OffroadLightbarPresent", "RearSeatHeaters", "RemoteStartEnabled", "RightHandDrive",
	"RoofColor", "SunroofInstalled", "Trim", "VehicleName", "Version", "WheelType",
	"Setting24HourTime", "SettingChargeUnit", "SettingDistanceUnit",
	"SettingTemperatureUnit", "SettingTirePressureUnit",
	"ChargePort",
}

func TestSubscribedVsRegistry(t *testing.T) {
	subSet := make(map[string]bool)
	for _, s := range subscribedSignals {
		subSet[s] = true
	}

	// Every subscribed signal should be in the registry
	var missingFromRegistry []string
	for _, s := range subscribedSignals {
		if _, ok := SignalRegistry[s]; !ok {
			missingFromRegistry = append(missingFromRegistry, s)
		}
	}
	if len(missingFromRegistry) > 0 {
		sort.Strings(missingFromRegistry)
		t.Errorf("Subscribed but NOT in SignalRegistry (%d):\n  %s",
			len(missingFromRegistry), strings.Join(missingFromRegistry, "\n  "))
	}

	// Every registry signal should be subscribed
	var missingFromSub []string
	for name := range SignalRegistry {
		if !subSet[name] {
			missingFromSub = append(missingFromSub, name)
		}
	}
	if len(missingFromSub) > 0 {
		sort.Strings(missingFromSub)
		t.Errorf("In SignalRegistry but NOT subscribed (%d):\n  %s",
			len(missingFromSub), strings.Join(missingFromSub, "\n  "))
	}
}

func TestCompoundSignalsAllIdentified(t *testing.T) {
	// These MUST be compound based on the Tesla proto
	mustBeCompound := []string{
		"Location", "DestinationLocation", "OriginLocation",
		"DoorState", "RouteLine",
		"TpmsHardWarnings", "TpmsSoftWarnings",
	}
	for _, name := range mustBeCompound {
		if !IsCompoundSignal(name) {
			t.Errorf("%s should be compound but IsCompoundSignal returns false", name)
		}
	}
}

func TestEnumSignalsAllIdentified(t *testing.T) {
	// These MUST be enum based on the Tesla proto
	mustBeEnum := []string{
		"Gear", "DetailedChargeState", "ChargeState", "SentryMode",
		"HvacPower", "DefrostMode", "CabinOverheatProtectionMode",
		"ClimateKeeperMode", "CenterDisplay", "BMSState",
		"ChargePort", "ChargePortLatch", "ChargingCableType",
		"FastChargerType", "ScheduledChargingMode",
		"HvacAutoMode", "MediaPlaybackStatus",
		"CruiseFollowDistance", "ForwardCollisionWarning",
		"LaneDepartureAvoidance", "SpeedLimitWarning",
		"DriverSeatBelt", "PassengerSeatBelt",
		"PowershareStatus", "PowershareStopReason", "PowershareType",
		"DiStateF", "DiStateR", "DiStateREL", "DiStateRER",
		"Hvil", "FdWindow", "FpWindow", "RdWindow", "RpWindow",
		"GuestModeMobileAccessState", "LightsTurnSignal",
		"CarType", "SunroofInstalled",
		"SettingChargeUnit", "SettingDistanceUnit",
		"SettingTemperatureUnit", "SettingTirePressureUnit",
		"TonneauPosition", "TonneauTentMode",
	}
	for _, name := range mustBeEnum {
		if !IsEnumSignal(name) {
			t.Errorf("%s should be enum but IsEnumSignal returns false", name)
		}
	}
}

func TestSignalTypeCoverage(t *testing.T) {
	// Count signals by type
	counts := map[SignalType]int{}
	for _, info := range SignalRegistry {
		counts[info.Type]++
	}

	t.Logf("Signal type distribution:")
	t.Logf("  Float:        %d", counts[TypeFloat])
	t.Logf("  Bool:         %d", counts[TypeBool])
	t.Logf("  String:       %d", counts[TypeString])
	t.Logf("  Enum:         %d", counts[TypeEnum])
	t.Logf("  Location:     %d", counts[TypeLocation])
	t.Logf("  Doors:        %d", counts[TypeDoors])
	t.Logf("  TireLocation: %d", counts[TypeTireLocation])
	t.Logf("  Time:         %d", counts[TypeTime])
	t.Logf("  Route:        %d", counts[TypeRoute])
	t.Logf("  TOTAL:        %d", len(SignalRegistry))

	// Sanity: should have a good mix
	if counts[TypeFloat] < 100 {
		t.Errorf("Expected at least 100 float signals, got %d", counts[TypeFloat])
	}
	if counts[TypeEnum] < 30 {
		t.Errorf("Expected at least 30 enum signals, got %d", counts[TypeEnum])
	}
	if counts[TypeBool] < 20 {
		t.Errorf("Expected at least 20 bool signals, got %d", counts[TypeBool])
	}
}
