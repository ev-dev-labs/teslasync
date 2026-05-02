// Code emitter for the Tesla Fleet Telemetry proto. Reads the in-memory
// ProtoFile produced by parser.go and writes three deterministic Go source
// files into the target package directory.
package main

import (
	"bytes"
	"fmt"
	"go/format"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"text/template"
)

// fieldClass is the per-Field classification used by the emitted SignalMeta map.
type fieldClass struct {
	cat           string // charging|driving|climate|location|powertrain|vehicle_state|safety_security|media|config|prefs|setting_unit|metadata
	kind          string // string|int|long|float|double|bool|enum|compound:<MessageName>
	unit          string // distance|temperature|pressure|charge|none
	isSettingUnit bool
}

// classify returns the canonical (category, value-kind, unit-kind, is-setting-unit)
// for a single Field name. The mapping is canonicalized from the
// fleet-telemetry-audit coverage.json shipped with the audit branch and is
// the single source of truth for the emitter. Field names not in the table
// fall back to (metadata, string, none, false) and the second return value is
// false so callers (e.g. tests) can distinguish an explicit metadata
// classification from an unclassified fall-through.
func classify(name string) (fieldClass, bool) {
	c := classifyExplicit(name)
	if c == (fieldClass{}) {
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}, false
	}
	return c, true
}

// classifyExplicit returns the explicit classification table entry for name,
// or the zero-value fieldClass{} when the name has no entry. This is used
// internally by classify(); callers should always go through classify().
func classifyExplicit(name string) fieldClass {
	switch name {
	case "Unknown":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "DriveRail":
		return fieldClass{cat: "driving", kind: "bool", unit: "none", isSettingUnit: false}
	case "ChargeState":
		return fieldClass{cat: "charging", kind: "enum", unit: "none", isSettingUnit: false}
	case "BmsFullchargecomplete":
		return fieldClass{cat: "charging", kind: "bool", unit: "none", isSettingUnit: false}
	case "VehicleSpeed":
		return fieldClass{cat: "driving", kind: "float", unit: "none", isSettingUnit: false}
	case "Odometer":
		return fieldClass{cat: "vehicle_state", kind: "float", unit: "distance", isSettingUnit: false}
	case "PackVoltage":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "PackCurrent":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "Soc":
		return fieldClass{cat: "charging", kind: "float", unit: "charge", isSettingUnit: false}
	case "DCDCEnable":
		return fieldClass{cat: "charging", kind: "bool", unit: "none", isSettingUnit: false}
	case "Gear":
		return fieldClass{cat: "driving", kind: "enum", unit: "none", isSettingUnit: false}
	case "IsolationResistance":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "PedalPosition":
		return fieldClass{cat: "driving", kind: "float", unit: "none", isSettingUnit: false}
	case "BrakePedal":
		return fieldClass{cat: "driving", kind: "bool", unit: "none", isSettingUnit: false}
	case "DiStateR":
		return fieldClass{cat: "powertrain", kind: "enum", unit: "none", isSettingUnit: false}
	case "DiHeatsinkTR":
		return fieldClass{cat: "powertrain", kind: "float", unit: "temperature", isSettingUnit: false}
	case "DiAxleSpeedR":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiTorquemotor":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiStatorTempR":
		return fieldClass{cat: "powertrain", kind: "float", unit: "temperature", isSettingUnit: false}
	case "DiVBatR":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiMotorCurrentR":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "Location":
		return fieldClass{cat: "location", kind: "compound:LocationValue", unit: "none", isSettingUnit: false}
	case "GpsState":
		return fieldClass{cat: "location", kind: "string", unit: "none", isSettingUnit: false}
	case "GpsHeading":
		return fieldClass{cat: "location", kind: "float", unit: "none", isSettingUnit: false}
	case "NumBrickVoltageMax":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "BrickVoltageMax":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "NumBrickVoltageMin":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "BrickVoltageMin":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "NumModuleTempMax":
		return fieldClass{cat: "charging", kind: "float", unit: "temperature", isSettingUnit: false}
	case "ModuleTempMax":
		return fieldClass{cat: "charging", kind: "float", unit: "temperature", isSettingUnit: false}
	case "NumModuleTempMin":
		return fieldClass{cat: "charging", kind: "float", unit: "temperature", isSettingUnit: false}
	case "ModuleTempMin":
		return fieldClass{cat: "charging", kind: "float", unit: "temperature", isSettingUnit: false}
	case "RatedRange":
		return fieldClass{cat: "charging", kind: "float", unit: "distance", isSettingUnit: false}
	case "Hvil":
		return fieldClass{cat: "powertrain", kind: "enum", unit: "none", isSettingUnit: false}
	case "DCChargingEnergyIn":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "DCChargingPower":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "ACChargingEnergyIn":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "ACChargingPower":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "ChargeLimitSoc":
		return fieldClass{cat: "charging", kind: "float", unit: "charge", isSettingUnit: false}
	case "FastChargerPresent":
		return fieldClass{cat: "charging", kind: "bool", unit: "none", isSettingUnit: false}
	case "EstBatteryRange":
		return fieldClass{cat: "charging", kind: "float", unit: "distance", isSettingUnit: false}
	case "IdealBatteryRange":
		return fieldClass{cat: "charging", kind: "float", unit: "distance", isSettingUnit: false}
	case "BatteryLevel":
		return fieldClass{cat: "charging", kind: "float", unit: "charge", isSettingUnit: false}
	case "TimeToFullCharge":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "ScheduledChargingStartTime":
		return fieldClass{cat: "charging", kind: "compound:Time", unit: "none", isSettingUnit: false}
	case "ScheduledChargingPending":
		return fieldClass{cat: "charging", kind: "bool", unit: "none", isSettingUnit: false}
	case "ScheduledDepartureTime":
		return fieldClass{cat: "charging", kind: "compound:Time", unit: "none", isSettingUnit: false}
	case "PreconditioningEnabled":
		return fieldClass{cat: "charging", kind: "bool", unit: "none", isSettingUnit: false}
	case "ScheduledChargingMode":
		return fieldClass{cat: "charging", kind: "enum", unit: "none", isSettingUnit: false}
	case "ChargeAmps":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "ChargeEnableRequest":
		return fieldClass{cat: "charging", kind: "bool", unit: "none", isSettingUnit: false}
	case "ChargerPhases":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "ChargePortColdWeatherMode":
		return fieldClass{cat: "charging", kind: "bool", unit: "none", isSettingUnit: false}
	case "ChargeCurrentRequest":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "ChargeCurrentRequestMax":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "BatteryHeaterOn":
		return fieldClass{cat: "charging", kind: "bool", unit: "none", isSettingUnit: false}
	case "NotEnoughPowerToHeat":
		return fieldClass{cat: "charging", kind: "bool", unit: "none", isSettingUnit: false}
	case "SuperchargerSessionTripPlanner":
		return fieldClass{cat: "charging", kind: "bool", unit: "none", isSettingUnit: false}
	case "DoorState":
		return fieldClass{cat: "vehicle_state", kind: "compound:Doors", unit: "none", isSettingUnit: false}
	case "Locked":
		return fieldClass{cat: "safety_security", kind: "bool", unit: "none", isSettingUnit: false}
	case "FdWindow":
		return fieldClass{cat: "vehicle_state", kind: "enum", unit: "none", isSettingUnit: false}
	case "FpWindow":
		return fieldClass{cat: "vehicle_state", kind: "enum", unit: "none", isSettingUnit: false}
	case "RdWindow":
		return fieldClass{cat: "vehicle_state", kind: "enum", unit: "none", isSettingUnit: false}
	case "RpWindow":
		return fieldClass{cat: "vehicle_state", kind: "enum", unit: "none", isSettingUnit: false}
	case "VehicleName":
		return fieldClass{cat: "config", kind: "string", unit: "none", isSettingUnit: false}
	case "SentryMode":
		return fieldClass{cat: "vehicle_state", kind: "enum", unit: "none", isSettingUnit: false}
	case "SpeedLimitMode":
		return fieldClass{cat: "vehicle_state", kind: "bool", unit: "none", isSettingUnit: false}
	case "CurrentLimitMph":
		return fieldClass{cat: "vehicle_state", kind: "float", unit: "distance", isSettingUnit: false}
	case "Version":
		return fieldClass{cat: "config", kind: "string", unit: "none", isSettingUnit: false}
	case "TpmsPressureFl":
		return fieldClass{cat: "safety_security", kind: "float", unit: "pressure", isSettingUnit: false}
	case "TpmsPressureFr":
		return fieldClass{cat: "safety_security", kind: "float", unit: "pressure", isSettingUnit: false}
	case "TpmsPressureRl":
		return fieldClass{cat: "safety_security", kind: "float", unit: "pressure", isSettingUnit: false}
	case "TpmsPressureRr":
		return fieldClass{cat: "safety_security", kind: "float", unit: "pressure", isSettingUnit: false}
	case "SemitruckTpmsPressureRe1L0":
		return fieldClass{cat: "safety_security", kind: "string", unit: "pressure", isSettingUnit: false}
	case "SemitruckTpmsPressureRe1L1":
		return fieldClass{cat: "safety_security", kind: "string", unit: "pressure", isSettingUnit: false}
	case "SemitruckTpmsPressureRe1R0":
		return fieldClass{cat: "safety_security", kind: "string", unit: "pressure", isSettingUnit: false}
	case "SemitruckTpmsPressureRe1R1":
		return fieldClass{cat: "safety_security", kind: "string", unit: "pressure", isSettingUnit: false}
	case "SemitruckTpmsPressureRe2L0":
		return fieldClass{cat: "safety_security", kind: "string", unit: "pressure", isSettingUnit: false}
	case "SemitruckTpmsPressureRe2L1":
		return fieldClass{cat: "safety_security", kind: "string", unit: "pressure", isSettingUnit: false}
	case "SemitruckTpmsPressureRe2R0":
		return fieldClass{cat: "safety_security", kind: "string", unit: "pressure", isSettingUnit: false}
	case "SemitruckTpmsPressureRe2R1":
		return fieldClass{cat: "safety_security", kind: "string", unit: "pressure", isSettingUnit: false}
	case "TpmsLastSeenPressureTimeFl":
		return fieldClass{cat: "safety_security", kind: "float", unit: "none", isSettingUnit: false}
	case "TpmsLastSeenPressureTimeFr":
		return fieldClass{cat: "safety_security", kind: "float", unit: "none", isSettingUnit: false}
	case "TpmsLastSeenPressureTimeRl":
		return fieldClass{cat: "safety_security", kind: "float", unit: "none", isSettingUnit: false}
	case "TpmsLastSeenPressureTimeRr":
		return fieldClass{cat: "safety_security", kind: "float", unit: "none", isSettingUnit: false}
	case "InsideTemp":
		return fieldClass{cat: "climate", kind: "float", unit: "temperature", isSettingUnit: false}
	case "OutsideTemp":
		return fieldClass{cat: "climate", kind: "float", unit: "temperature", isSettingUnit: false}
	case "SeatHeaterLeft":
		return fieldClass{cat: "climate", kind: "float", unit: "none", isSettingUnit: false}
	case "SeatHeaterRight":
		return fieldClass{cat: "climate", kind: "float", unit: "none", isSettingUnit: false}
	case "SeatHeaterRearLeft":
		return fieldClass{cat: "climate", kind: "float", unit: "none", isSettingUnit: false}
	case "SeatHeaterRearRight":
		return fieldClass{cat: "climate", kind: "float", unit: "none", isSettingUnit: false}
	case "SeatHeaterRearCenter":
		return fieldClass{cat: "climate", kind: "float", unit: "none", isSettingUnit: false}
	case "AutoSeatClimateLeft":
		return fieldClass{cat: "climate", kind: "bool", unit: "none", isSettingUnit: false}
	case "AutoSeatClimateRight":
		return fieldClass{cat: "climate", kind: "bool", unit: "none", isSettingUnit: false}
	case "DriverSeatBelt":
		return fieldClass{cat: "climate", kind: "enum", unit: "none", isSettingUnit: false}
	case "PassengerSeatBelt":
		return fieldClass{cat: "climate", kind: "enum", unit: "none", isSettingUnit: false}
	case "DriverSeatOccupied":
		return fieldClass{cat: "climate", kind: "bool", unit: "none", isSettingUnit: false}
	case "SemitruckPassengerSeatFoldPosition":
		return fieldClass{cat: "climate", kind: "string", unit: "none", isSettingUnit: false}
	case "LateralAcceleration":
		return fieldClass{cat: "driving", kind: "float", unit: "none", isSettingUnit: false}
	case "LongitudinalAcceleration":
		return fieldClass{cat: "driving", kind: "float", unit: "none", isSettingUnit: false}
	case "Deprecated_2":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "CruiseSetSpeed":
		return fieldClass{cat: "driving", kind: "float", unit: "none", isSettingUnit: false}
	case "LifetimeEnergyUsed":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "LifetimeEnergyUsedDrive":
		return fieldClass{cat: "driving", kind: "float", unit: "none", isSettingUnit: false}
	case "SemitruckTractorParkBrakeStatus":
		return fieldClass{cat: "safety_security", kind: "string", unit: "none", isSettingUnit: false}
	case "SemitruckTrailerParkBrakeStatus":
		return fieldClass{cat: "safety_security", kind: "string", unit: "none", isSettingUnit: false}
	case "BrakePedalPos":
		return fieldClass{cat: "driving", kind: "float", unit: "none", isSettingUnit: false}
	case "RouteLastUpdated":
		return fieldClass{cat: "location", kind: "string", unit: "none", isSettingUnit: false}
	case "RouteLine":
		return fieldClass{cat: "location", kind: "string", unit: "none", isSettingUnit: false}
	case "MilesToArrival":
		return fieldClass{cat: "location", kind: "float", unit: "distance", isSettingUnit: false}
	case "MinutesToArrival":
		return fieldClass{cat: "location", kind: "float", unit: "none", isSettingUnit: false}
	case "OriginLocation":
		return fieldClass{cat: "location", kind: "compound:LocationValue", unit: "none", isSettingUnit: false}
	case "DestinationLocation":
		return fieldClass{cat: "location", kind: "compound:LocationValue", unit: "none", isSettingUnit: false}
	case "CarType":
		return fieldClass{cat: "config", kind: "enum", unit: "none", isSettingUnit: false}
	case "Trim":
		return fieldClass{cat: "config", kind: "string", unit: "none", isSettingUnit: false}
	case "ExteriorColor":
		return fieldClass{cat: "config", kind: "string", unit: "none", isSettingUnit: false}
	case "RoofColor":
		return fieldClass{cat: "config", kind: "string", unit: "none", isSettingUnit: false}
	case "ChargePort":
		return fieldClass{cat: "charging", kind: "enum", unit: "none", isSettingUnit: false}
	case "ChargePortLatch":
		return fieldClass{cat: "charging", kind: "enum", unit: "none", isSettingUnit: false}
	case "Experimental_1":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "Experimental_2":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "Experimental_3":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "Experimental_4":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "GuestModeEnabled":
		return fieldClass{cat: "vehicle_state", kind: "bool", unit: "none", isSettingUnit: false}
	case "PinToDriveEnabled":
		return fieldClass{cat: "safety_security", kind: "bool", unit: "none", isSettingUnit: false}
	case "PairedPhoneKeyAndKeyFobQty":
		return fieldClass{cat: "vehicle_state", kind: "float", unit: "none", isSettingUnit: false}
	case "CruiseFollowDistance":
		return fieldClass{cat: "safety_security", kind: "enum", unit: "none", isSettingUnit: false}
	case "AutomaticBlindSpotCamera":
		return fieldClass{cat: "safety_security", kind: "bool", unit: "none", isSettingUnit: false}
	case "BlindSpotCollisionWarningChime":
		return fieldClass{cat: "safety_security", kind: "bool", unit: "none", isSettingUnit: false}
	case "SpeedLimitWarning":
		return fieldClass{cat: "charging", kind: "enum", unit: "none", isSettingUnit: false}
	case "ForwardCollisionWarning":
		return fieldClass{cat: "safety_security", kind: "enum", unit: "none", isSettingUnit: false}
	case "LaneDepartureAvoidance":
		return fieldClass{cat: "safety_security", kind: "enum", unit: "none", isSettingUnit: false}
	case "EmergencyLaneDepartureAvoidance":
		return fieldClass{cat: "safety_security", kind: "bool", unit: "none", isSettingUnit: false}
	case "AutomaticEmergencyBrakingOff":
		return fieldClass{cat: "safety_security", kind: "bool", unit: "none", isSettingUnit: false}
	case "LifetimeEnergyGainedRegen":
		return fieldClass{cat: "driving", kind: "float", unit: "none", isSettingUnit: false}
	case "DiStateF":
		return fieldClass{cat: "powertrain", kind: "enum", unit: "none", isSettingUnit: false}
	case "DiStateREL":
		return fieldClass{cat: "powertrain", kind: "enum", unit: "none", isSettingUnit: false}
	case "DiStateRER":
		return fieldClass{cat: "powertrain", kind: "enum", unit: "none", isSettingUnit: false}
	case "DiHeatsinkTF":
		return fieldClass{cat: "powertrain", kind: "float", unit: "temperature", isSettingUnit: false}
	case "DiHeatsinkTREL":
		return fieldClass{cat: "powertrain", kind: "float", unit: "temperature", isSettingUnit: false}
	case "DiHeatsinkTRER":
		return fieldClass{cat: "powertrain", kind: "float", unit: "temperature", isSettingUnit: false}
	case "DiAxleSpeedF":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiAxleSpeedREL":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiAxleSpeedRER":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiSlaveTorqueCmd":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiTorqueActualR":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiTorqueActualF":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiTorqueActualREL":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiTorqueActualRER":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiStatorTempF":
		return fieldClass{cat: "powertrain", kind: "float", unit: "temperature", isSettingUnit: false}
	case "DiStatorTempREL":
		return fieldClass{cat: "powertrain", kind: "float", unit: "temperature", isSettingUnit: false}
	case "DiStatorTempRER":
		return fieldClass{cat: "powertrain", kind: "float", unit: "temperature", isSettingUnit: false}
	case "DiVBatF":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiVBatREL":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiVBatRER":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiMotorCurrentF":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiMotorCurrentREL":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "DiMotorCurrentRER":
		return fieldClass{cat: "powertrain", kind: "float", unit: "none", isSettingUnit: false}
	case "EnergyRemaining":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "ServiceMode":
		return fieldClass{cat: "vehicle_state", kind: "bool", unit: "none", isSettingUnit: false}
	case "BMSState":
		return fieldClass{cat: "charging", kind: "enum", unit: "none", isSettingUnit: false}
	case "GuestModeMobileAccessState":
		return fieldClass{cat: "vehicle_state", kind: "enum", unit: "none", isSettingUnit: false}
	case "Deprecated_1":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "DestinationName":
		return fieldClass{cat: "location", kind: "string", unit: "none", isSettingUnit: false}
	case "DiInverterTR":
		return fieldClass{cat: "powertrain", kind: "float", unit: "temperature", isSettingUnit: false}
	case "DiInverterTF":
		return fieldClass{cat: "powertrain", kind: "float", unit: "temperature", isSettingUnit: false}
	case "DiInverterTREL":
		return fieldClass{cat: "powertrain", kind: "float", unit: "temperature", isSettingUnit: false}
	case "DiInverterTRER":
		return fieldClass{cat: "powertrain", kind: "float", unit: "temperature", isSettingUnit: false}
	case "Experimental_5":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "Experimental_6":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "Experimental_7":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "Experimental_8":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "Experimental_9":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "Experimental_10":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "Experimental_11":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "Experimental_12":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "Experimental_13":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "Experimental_14":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "Experimental_15":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "DetailedChargeState":
		return fieldClass{cat: "charging", kind: "enum", unit: "none", isSettingUnit: false}
	case "CabinOverheatProtectionMode":
		return fieldClass{cat: "climate", kind: "enum", unit: "none", isSettingUnit: false}
	case "CabinOverheatProtectionTemperatureLimit":
		return fieldClass{cat: "climate", kind: "enum", unit: "none", isSettingUnit: false}
	case "CenterDisplay":
		return fieldClass{cat: "vehicle_state", kind: "enum", unit: "none", isSettingUnit: false}
	case "ChargePortDoorOpen":
		return fieldClass{cat: "charging", kind: "bool", unit: "none", isSettingUnit: false}
	case "ChargerVoltage":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "ChargingCableType":
		return fieldClass{cat: "charging", kind: "enum", unit: "none", isSettingUnit: false}
	case "ClimateKeeperMode":
		return fieldClass{cat: "climate", kind: "enum", unit: "none", isSettingUnit: false}
	case "DefrostForPreconditioning":
		return fieldClass{cat: "climate", kind: "bool", unit: "none", isSettingUnit: false}
	case "DefrostMode":
		return fieldClass{cat: "climate", kind: "enum", unit: "none", isSettingUnit: false}
	case "EfficiencyPackage":
		return fieldClass{cat: "config", kind: "string", unit: "none", isSettingUnit: false}
	case "EstimatedHoursToChargeTermination":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "EuropeVehicle":
		return fieldClass{cat: "config", kind: "bool", unit: "none", isSettingUnit: false}
	case "ExpectedEnergyPercentAtTripArrival":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "FastChargerType":
		return fieldClass{cat: "charging", kind: "enum", unit: "none", isSettingUnit: false}
	case "HomelinkDeviceCount":
		return fieldClass{cat: "vehicle_state", kind: "float", unit: "none", isSettingUnit: false}
	case "HomelinkNearby":
		return fieldClass{cat: "vehicle_state", kind: "bool", unit: "none", isSettingUnit: false}
	case "HvacACEnabled":
		return fieldClass{cat: "climate", kind: "bool", unit: "none", isSettingUnit: false}
	case "HvacAutoMode":
		return fieldClass{cat: "climate", kind: "enum", unit: "none", isSettingUnit: false}
	case "HvacFanSpeed":
		return fieldClass{cat: "climate", kind: "float", unit: "none", isSettingUnit: false}
	case "HvacFanStatus":
		return fieldClass{cat: "climate", kind: "float", unit: "none", isSettingUnit: false}
	case "HvacLeftTemperatureRequest":
		return fieldClass{cat: "climate", kind: "float", unit: "temperature", isSettingUnit: false}
	case "HvacPower":
		return fieldClass{cat: "climate", kind: "enum", unit: "none", isSettingUnit: false}
	case "HvacRightTemperatureRequest":
		return fieldClass{cat: "climate", kind: "float", unit: "temperature", isSettingUnit: false}
	case "HvacSteeringWheelHeatAuto":
		return fieldClass{cat: "climate", kind: "bool", unit: "none", isSettingUnit: false}
	case "HvacSteeringWheelHeatLevel":
		return fieldClass{cat: "climate", kind: "float", unit: "none", isSettingUnit: false}
	case "OffroadLightbarPresent":
		return fieldClass{cat: "config", kind: "bool", unit: "none", isSettingUnit: false}
	case "PowershareHoursLeft":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "PowershareInstantaneousPowerKW":
		return fieldClass{cat: "charging", kind: "float", unit: "none", isSettingUnit: false}
	case "PowershareStatus":
		return fieldClass{cat: "charging", kind: "enum", unit: "none", isSettingUnit: false}
	case "PowershareStopReason":
		return fieldClass{cat: "charging", kind: "enum", unit: "none", isSettingUnit: false}
	case "PowershareType":
		return fieldClass{cat: "charging", kind: "enum", unit: "none", isSettingUnit: false}
	case "RearDisplayHvacEnabled":
		return fieldClass{cat: "metadata", kind: "bool", unit: "none", isSettingUnit: false}
	case "RearSeatHeaters":
		return fieldClass{cat: "climate", kind: "float", unit: "none", isSettingUnit: false}
	case "RemoteStartEnabled":
		return fieldClass{cat: "config", kind: "bool", unit: "none", isSettingUnit: false}
	case "RightHandDrive":
		return fieldClass{cat: "config", kind: "bool", unit: "none", isSettingUnit: false}
	case "RouteTrafficMinutesDelay":
		return fieldClass{cat: "location", kind: "float", unit: "none", isSettingUnit: false}
	case "SoftwareUpdateDownloadPercentComplete":
		return fieldClass{cat: "vehicle_state", kind: "float", unit: "none", isSettingUnit: false}
	case "SoftwareUpdateExpectedDurationMinutes":
		return fieldClass{cat: "vehicle_state", kind: "float", unit: "none", isSettingUnit: false}
	case "SoftwareUpdateInstallationPercentComplete":
		return fieldClass{cat: "vehicle_state", kind: "float", unit: "none", isSettingUnit: false}
	case "SoftwareUpdateScheduledStartTime":
		return fieldClass{cat: "vehicle_state", kind: "string", unit: "none", isSettingUnit: false}
	case "SoftwareUpdateVersion":
		return fieldClass{cat: "vehicle_state", kind: "string", unit: "none", isSettingUnit: false}
	case "TonneauOpenPercent":
		return fieldClass{cat: "vehicle_state", kind: "float", unit: "none", isSettingUnit: false}
	case "TonneauPosition":
		return fieldClass{cat: "vehicle_state", kind: "enum", unit: "none", isSettingUnit: false}
	case "TonneauTentMode":
		return fieldClass{cat: "vehicle_state", kind: "enum", unit: "none", isSettingUnit: false}
	case "TpmsHardWarnings":
		return fieldClass{cat: "safety_security", kind: "compound:TireLocation", unit: "none", isSettingUnit: false}
	case "TpmsSoftWarnings":
		return fieldClass{cat: "safety_security", kind: "compound:TireLocation", unit: "none", isSettingUnit: false}
	case "ValetModeEnabled":
		return fieldClass{cat: "vehicle_state", kind: "bool", unit: "none", isSettingUnit: false}
	case "WheelType":
		return fieldClass{cat: "config", kind: "string", unit: "none", isSettingUnit: false}
	case "WiperHeatEnabled":
		return fieldClass{cat: "climate", kind: "bool", unit: "none", isSettingUnit: false}
	case "LocatedAtHome":
		return fieldClass{cat: "location", kind: "bool", unit: "none", isSettingUnit: false}
	case "LocatedAtWork":
		return fieldClass{cat: "location", kind: "bool", unit: "none", isSettingUnit: false}
	case "LocatedAtFavorite":
		return fieldClass{cat: "location", kind: "bool", unit: "none", isSettingUnit: false}
	case "SettingDistanceUnit":
		return fieldClass{cat: "setting_unit", kind: "enum", unit: "distance", isSettingUnit: true}
	case "SettingTemperatureUnit":
		return fieldClass{cat: "setting_unit", kind: "enum", unit: "temperature", isSettingUnit: true}
	case "Setting24HourTime":
		return fieldClass{cat: "prefs", kind: "bool", unit: "none", isSettingUnit: false}
	case "SettingTirePressureUnit":
		return fieldClass{cat: "setting_unit", kind: "enum", unit: "pressure", isSettingUnit: true}
	case "SettingChargeUnit":
		return fieldClass{cat: "setting_unit", kind: "enum", unit: "charge", isSettingUnit: true}
	case "ClimateSeatCoolingFrontLeft":
		return fieldClass{cat: "climate", kind: "float", unit: "none", isSettingUnit: false}
	case "ClimateSeatCoolingFrontRight":
		return fieldClass{cat: "climate", kind: "float", unit: "none", isSettingUnit: false}
	case "LightsHazardsActive":
		return fieldClass{cat: "vehicle_state", kind: "bool", unit: "none", isSettingUnit: false}
	case "LightsTurnSignal":
		return fieldClass{cat: "vehicle_state", kind: "enum", unit: "none", isSettingUnit: false}
	case "LightsHighBeams":
		return fieldClass{cat: "vehicle_state", kind: "bool", unit: "none", isSettingUnit: false}
	case "MediaPlaybackStatus":
		return fieldClass{cat: "media", kind: "enum", unit: "none", isSettingUnit: false}
	case "MediaPlaybackSource":
		return fieldClass{cat: "media", kind: "string", unit: "none", isSettingUnit: false}
	case "MediaAudioVolume":
		return fieldClass{cat: "media", kind: "float", unit: "none", isSettingUnit: false}
	case "MediaNowPlayingDuration":
		return fieldClass{cat: "media", kind: "float", unit: "none", isSettingUnit: false}
	case "MediaNowPlayingElapsed":
		return fieldClass{cat: "media", kind: "float", unit: "none", isSettingUnit: false}
	case "MediaNowPlayingArtist":
		return fieldClass{cat: "media", kind: "string", unit: "none", isSettingUnit: false}
	case "MediaNowPlayingTitle":
		return fieldClass{cat: "media", kind: "string", unit: "none", isSettingUnit: false}
	case "MediaNowPlayingAlbum":
		return fieldClass{cat: "media", kind: "string", unit: "none", isSettingUnit: false}
	case "MediaNowPlayingStation":
		return fieldClass{cat: "media", kind: "string", unit: "none", isSettingUnit: false}
	case "MediaAudioVolumeIncrement":
		return fieldClass{cat: "media", kind: "float", unit: "none", isSettingUnit: false}
	case "MediaAudioVolumeMax":
		return fieldClass{cat: "media", kind: "float", unit: "none", isSettingUnit: false}
	case "SunroofInstalled":
		return fieldClass{cat: "config", kind: "enum", unit: "none", isSettingUnit: false}
	case "SeatVentEnabled":
		return fieldClass{cat: "climate", kind: "bool", unit: "none", isSettingUnit: false}
	case "RearDefrostEnabled":
		return fieldClass{cat: "metadata", kind: "bool", unit: "none", isSettingUnit: false}
	case "ChargeRateMilePerHour":
		return fieldClass{cat: "charging", kind: "float", unit: "distance", isSettingUnit: false}
	case "Deprecated_3":
		return fieldClass{cat: "metadata", kind: "string", unit: "none", isSettingUnit: false}
	case "MilesSinceReset":
		return fieldClass{cat: "safety_security", kind: "float", unit: "distance", isSettingUnit: false}
	case "SelfDrivingMilesSinceReset":
		return fieldClass{cat: "safety_security", kind: "float", unit: "distance", isSettingUnit: false}
	}
	return fieldClass{}
}

// generatedHeader is the comment header every emitted file starts with. It is
// detected by editor agents (per .github/instructions/tesla-pipeline.instructions.md)
// to refuse manual edits to *_gen.go files.
const generatedHeader = "// Code generated by cmd/protogen-tesla; DO NOT EDIT.\n\n"

// fileSignalMetadata is the file name for the SignalMeta + Field enum file.
const fileSignalMetadata = "signal_metadata_gen.go"

// fileEnumParsers is the file name for non-Field named-enum parsers.
const fileEnumParsers = "enum_parsers_gen.go"

// fileDatumDecoder is the file name for compound message types and DecodeValue.
const fileDatumDecoder = "datum_decoder_gen.go"

// compoundNames is the set of message types that are exposed as Datum value
// compounds. They live in datum_decoder_gen.go and are referenced by both the
// signal_metadata classifier and the Value oneof.
var compoundNames = map[string]bool{
	"LocationValue": true,
	"Doors":         true,
	"TireLocation":  true,
	"Time":          true,
}

// Emit writes the three generated Go source files into outDir. Existing files
// are overwritten. The output directory must already exist.
func Emit(pf *ProtoFile, packageName, outDir string) error {
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return fmt.Errorf("create out dir %s: %w", outDir, err)
	}
	if err := emitFile(pf, packageName, outDir, fileSignalMetadata, renderSignalMetadata); err != nil {
		return err
	}
	if err := emitFile(pf, packageName, outDir, fileEnumParsers, renderEnumParsers); err != nil {
		return err
	}
	if err := emitFile(pf, packageName, outDir, fileDatumDecoder, renderDatumDecoder); err != nil {
		return err
	}
	return nil
}

func emitFile(pf *ProtoFile, packageName, outDir, name string, render func(*ProtoFile, string) (string, error)) error {
	src, err := render(pf, packageName)
	if err != nil {
		return fmt.Errorf("render %s: %w", name, err)
	}
	formatted, err := format.Source([]byte(src))
	if err != nil {
		return fmt.Errorf("gofmt %s: %w\n--- raw ---\n%s\n--- end ---", name, err, src)
	}
	path := filepath.Join(outDir, name)
	if err := os.WriteFile(path, formatted, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", name, err)
	}
	return nil
}

// ---- signal_metadata_gen.go -----------------------------------------------

type signalMetaTplData struct {
	Package    string
	Header     string
	FieldEnum  EnumDef
	SignalMeta []signalMetaRow
}

type signalMetaRow struct {
	ConstName     string
	Name          string
	Number        int32
	Category      string
	ValueKind     string
	IsCompound    bool
	UnitKind      string
	IsSettingUnit bool
}

const signalMetaTemplate = `{{.Header}}package {{.Package}}

import "fmt"

// Field is the proto3 Field enum identifier for a Tesla telemetry signal.
// Numeric values match the Tesla Fleet Telemetry vehicle_data.proto Field
// enum exactly; do not reorder or repurpose values.
type Field int32

const (
{{range .FieldEnum.Values}}	{{$.FieldEnum.Name}}_{{.Name}} Field = {{.Number}}
{{end}})

// Name returns the protobuf field name for this Field. Returns the empty
// string when f is not a known Field value.
func (f Field) Name() string {
	switch f {
{{range .FieldEnum.Values}}	case {{$.FieldEnum.Name}}_{{.Name}}:
		return "{{.Name}}"
{{end}}	}
	return ""
}

// String implements fmt.Stringer; identical to Name plus a fallback for
// unknown numeric values.
func (f Field) String() string {
	if n := f.Name(); n != "" {
		return n
	}
	return fmt.Sprintf("Field(%d)", int32(f))
}

// ParseField parses a protobuf field name (e.g. "VehicleSpeed") and returns
// the corresponding Field constant. Returns an error if the name is not a
// known Field value.
func ParseField(s string) (Field, error) {
	switch s {
{{range .FieldEnum.Values}}	case "{{.Name}}":
		return {{$.FieldEnum.Name}}_{{.Name}}, nil
{{end}}	}
	return Field(0), fmt.Errorf("protomodel: unknown Field name %q", s)
}

// SignalMeta describes the routing classification of a telemetry signal.
// Category and UnitKind drive routing.yaml lookups and unit-history queries
// respectively; ValueKind tells the codec which Value oneof variant to expect.
type SignalMeta struct {
	Field         Field
	Name          string
	Category      string
	ValueKind     string
	IsCompound    bool
	UnitKind      string
	IsSettingUnit bool
}

// SignalMetaByField is the canonical metadata table keyed by Field. Every
// Field value declared in the proto is present, including the Unknown,
// Deprecated_*, Experimental_*, and Semitruck* sentinel values.
var SignalMetaByField = map[Field]SignalMeta{
{{range .SignalMeta}}	{{$.FieldEnum.Name}}_{{.Name}}: {Field: {{$.FieldEnum.Name}}_{{.Name}}, Name: "{{.Name}}", Category: "{{.Category}}", ValueKind: "{{.ValueKind}}", IsCompound: {{.IsCompound}}, UnitKind: "{{.UnitKind}}", IsSettingUnit: {{.IsSettingUnit}}},
{{end}}}
`

func renderSignalMetadata(pf *ProtoFile, packageName string) (string, error) {
	fieldEnum := pf.FindEnum("Field")
	if fieldEnum == nil {
		return "", fmt.Errorf("Field enum not found in proto")
	}
	rows := make([]signalMetaRow, 0, len(fieldEnum.Values))
	for _, v := range fieldEnum.Values {
		c, _ := classify(v.Name)
		rows = append(rows, signalMetaRow{
			ConstName:     fieldEnum.Name + "_" + v.Name,
			Name:          v.Name,
			Number:        v.Number,
			Category:      c.cat,
			ValueKind:     c.kind,
			IsCompound:    strings.HasPrefix(c.kind, "compound:"),
			UnitKind:      c.unit,
			IsSettingUnit: c.isSettingUnit,
		})
	}
	tpl, err := template.New("signal_metadata").Parse(signalMetaTemplate)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := tpl.Execute(&buf, signalMetaTplData{
		Package:    packageName,
		Header:     generatedHeader,
		FieldEnum:  *fieldEnum,
		SignalMeta: rows,
	}); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// ---- enum_parsers_gen.go --------------------------------------------------

type enumParsersTplData struct {
	Package string
	Header  string
	Enums   []EnumDef
}

const enumParsersTemplate = `{{.Header}}package {{.Package}}

import "fmt"

{{range .Enums}}{{$enum := .Name}}// {{.Name}} is a proto3 enum from telemetry.vehicle_data.
type {{.Name}} int32

const (
{{range .Values}}	{{$enum}}_{{.Name}} {{$enum}} = {{.Number}}
{{end}})

// String returns the symbolic name of the enum value, falling back to the
// numeric form when the value is unknown.
func (e {{.Name}}) String() string {
	switch e {
{{range .Values}}	case {{$enum}}_{{.Name}}:
		return "{{.Name}}"
{{end}}	}
	return fmt.Sprintf("{{$enum}}(%d)", int32(e))
}

// Parse{{.Name}} parses a symbolic enum value name and returns the
// corresponding {{.Name}} constant. Returns an error if the name is not
// a known {{.Name}} value.
func Parse{{.Name}}(s string) ({{.Name}}, error) {
	switch s {
{{range .Values}}	case "{{.Name}}":
		return {{$enum}}_{{.Name}}, nil
{{end}}	}
	return {{.Name}}(0), fmt.Errorf("protomodel: unknown {{$enum}} name %q", s)
}

{{end}}`

func renderEnumParsers(pf *ProtoFile, packageName string) (string, error) {
	// Drop the Field enum (it lives in signal_metadata_gen.go).
	enums := make([]EnumDef, 0, len(pf.Enums))
	for _, e := range pf.Enums {
		if e.Name == "Field" {
			continue
		}
		enums = append(enums, e)
	}
	tpl, err := template.New("enum_parsers").Parse(enumParsersTemplate)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := tpl.Execute(&buf, struct {
		Package string
		Header  string
		Enums   []EnumDef
	}{Package: packageName, Header: generatedHeader, Enums: enums}); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// ---- datum_decoder_gen.go -------------------------------------------------

// scalarVariantKinds maps the proto scalar oneof variant name to the Go scalar
// type used by the emitted Value struct.
var scalarVariantKinds = map[string]string{
	"string": "string",
	"int32":  "int32",
	"int64":  "int64",
	"float":  "float32",
	"double": "float64",
	"bool":   "bool",
}

type datumTplData struct {
	Package        string
	Header         string
	Compounds      []compoundTpl
	ValueVariants  []valueVariantTpl
	HasInvalidFlag bool
}

type compoundTpl struct {
	Name   string
	Fields []compoundField
}

type compoundField struct {
	GoName string
	GoType string
	Number int32
}

// valueVariantTpl describes a single oneof variant of the Value message.
// Either ScalarType (for primitive variants) or RefType (for enum/message
// variants) is set. Invalid is true for the special `bool invalid = 10` case.
type valueVariantTpl struct {
	ProtoName string // e.g. "string_value"
	GoFieldName string // e.g. "StringValue"
	ProtoType   string // e.g. "string", "LocationValue", "ChargingState"
	GoType      string // pointer-stripped Go type, e.g. "string", "*LocationValue", "*ChargingState"
	IsScalar    bool
	IsCompound  bool
	IsEnum      bool
	IsInvalid   bool
	Number      int32
}

const datumDecoderTemplate = `{{.Header}}package {{.Package}}

import "errors"

// ErrInvalidDatum is returned by DecodeValue when the source Datum's invalid
// flag is set, meaning the producer marked this telemetry sample as not
// trustworthy. Callers MUST drop the value (do not store assumed defaults).
var ErrInvalidDatum = errors.New("protomodel: datum value is invalid")

{{range .Compounds}}// {{.Name}} is a Datum value compound type. Compounds are flattened to typed
// atomic children at the codec boundary; downstream consumers see only
// primitives and never observe nested map shapes (per ADR-004).
type {{.Name}} struct {
{{range .Fields}}	{{.GoName}} {{.GoType}}
{{end}}}

{{end}}// Value is a dynamic Datum value. Exactly one of the *Value pointers will be
// non-nil for a populated Datum; an Invalid==true value indicates the producer
// rejected this sample and DecodeValue will return ErrInvalidDatum.
type Value struct {
{{range .ValueVariants}}	{{.GoFieldName}} {{.GoType}}
{{end}}}

// Datum is a single (Field, Value) pair from a Payload. The Key matches the
// proto Field enum number; Value carries the dynamic oneof payload.
type Datum struct {
	Key   Field
	Value *Value
}

// Payload holds a collection of Datums emitted at a single timestamp. Vin may
// be empty when the payload was emitted before the producer knew the VIN
// (e.g. during the bootstrap window).
type Payload struct {
	Data      []Datum
	CreatedAt int64 // unix nanos; google.protobuf.Timestamp converted at decode
	Vin       string
	IsResend  bool
}

// DecodeValue extracts the populated oneof variant from v and returns it as
// the caller-friendly Go value. Returns:
//   - (nil, nil) when v is nil or no variant is populated;
//   - (nil, ErrInvalidDatum) when v.Invalid is set to true;
//   - (underlying value, nil) for any populated scalar/enum/compound variant.
//
// The returned any is one of: string, int32, int64, float32, float64, bool,
// or a *<MessageName> / <EnumName> for compound and enum variants.
func DecodeValue(v *Value) (any, error) {
	if v == nil {
		return nil, nil
	}
{{if .HasInvalidFlag}}	if v.Invalid != nil && *v.Invalid {
		return nil, ErrInvalidDatum
	}
{{end}}{{range .ValueVariants}}{{if not .IsInvalid}}	if v.{{.GoFieldName}} != nil {
{{if .IsScalar}}		return *v.{{.GoFieldName}}, nil
{{else if .IsCompound}}		return v.{{.GoFieldName}}, nil
{{else if .IsEnum}}		return *v.{{.GoFieldName}}, nil
{{else}}		return v.{{.GoFieldName}}, nil
{{end}}	}
{{end}}{{end}}	return nil, nil
}
`

func renderDatumDecoder(pf *ProtoFile, packageName string) (string, error) {
	// Compound message types go to datum_decoder; sort by name.
	var compounds []compoundTpl
	for _, m := range pf.Messages {
		if !compoundNames[m.Name] {
			continue
		}
		ct := compoundTpl{Name: m.Name}
		for _, f := range m.Fields {
			ct.Fields = append(ct.Fields, compoundField{
				GoName: goCamelCase(f.Name),
				GoType: protoTypeToGo(f.Type),
				Number: f.Number,
			})
		}
		compounds = append(compounds, ct)
	}
	sort.SliceStable(compounds, func(i, j int) bool { return compounds[i].Name < compounds[j].Name })

	// Value oneof variants come from the Value message.
	valueMsg := pf.FindMessage("Value")
	if valueMsg == nil {
		return "", fmt.Errorf("Value message not found in proto")
	}
	if len(valueMsg.Oneofs) != 1 {
		return "", fmt.Errorf("Value message must have exactly one oneof, got %d", len(valueMsg.Oneofs))
	}
	hasInvalid := false
	var variants []valueVariantTpl
	for _, vrnt := range valueMsg.Oneofs[0].Variants {
		isInvalid := vrnt.Name == "invalid"
		if isInvalid {
			hasInvalid = true
		}
		goField := goCamelCase(vrnt.Name)
		var goType string
		var isScalar, isCompound, isEnum bool
		if scalarGo, ok := scalarVariantKinds[vrnt.Type]; ok {
			isScalar = true
			goType = "*" + scalarGo
		} else if compoundNames[vrnt.Type] {
			isCompound = true
			goType = "*" + vrnt.Type
		} else {
			// Treat any other named type as an enum (defined in
			// enum_parsers_gen.go). The proto Value oneof only references
			// scalars, the four compounds, and named enums.
			isEnum = true
			goType = "*" + vrnt.Type
		}
		variants = append(variants, valueVariantTpl{
			ProtoName:   vrnt.Name,
			GoFieldName: goField,
			ProtoType:   vrnt.Type,
			GoType:      goType,
			IsScalar:    isScalar,
			IsCompound:  isCompound,
			IsEnum:      isEnum,
			IsInvalid:   isInvalid,
			Number:      vrnt.Number,
		})
	}
	sort.SliceStable(variants, func(i, j int) bool { return variants[i].Number < variants[j].Number })

	tpl, err := template.New("datum_decoder").Parse(datumDecoderTemplate)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := tpl.Execute(&buf, datumTplData{
		Package:        packageName,
		Header:         generatedHeader,
		Compounds:      compounds,
		ValueVariants:  variants,
		HasInvalidFlag: hasInvalid,
	}); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// goCamelCase converts a snake_case proto field name (e.g. "string_value",
// "scheduled_charging_mode_value") to a Go-idiomatic exported field name
// ("StringValue", "ScheduledChargingModeValue"). Already-CamelCase names
// (e.g. "DriverFront") pass through unchanged.
func goCamelCase(s string) string {
	if !strings.ContainsAny(s, "_") {
		// already camel/pascal — only ensure first letter is upper-cased
		if s == "" {
			return s
		}
		return strings.ToUpper(s[:1]) + s[1:]
	}
	parts := strings.Split(s, "_")
	var out strings.Builder
	for _, p := range parts {
		if p == "" {
			continue
		}
		out.WriteString(strings.ToUpper(p[:1]))
		if len(p) > 1 {
			out.WriteString(p[1:])
		}
	}
	return out.String()
}

// protoTypeToGo maps a proto3 scalar type name to the Go type used in
// emitted compound structs. Non-scalar types pass through unchanged so the
// emitted code references the user-defined message/enum directly.
func protoTypeToGo(t string) string {
	switch t {
	case "double":
		return "float64"
	case "float":
		return "float32"
	case "int32", "sint32", "sfixed32":
		return "int32"
	case "int64", "sint64", "sfixed64":
		return "int64"
	case "uint32", "fixed32":
		return "uint32"
	case "uint64", "fixed64":
		return "uint64"
	case "bool":
		return "bool"
	case "string":
		return "string"
	case "bytes":
		return "[]byte"
	}
	return t
}
