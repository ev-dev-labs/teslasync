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
	"strconv"
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
	case "RangeAddedMetersPerHour":
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

// enumTypeOf returns the Go type name of the enum that decodes the
// Datum.Value oneof variant for a given Field name. The mapping is derived
// by inspecting the vendored vehicle_data.proto Value oneof and matching
// each enum-classified Field to its semantically-paired enum type. Used
// to populate SignalMeta.EnumTypeName for ValueKind == ValueKindEnum
// entries; returns "" for Field names that are not enum-classified.
//
// Adding a new enum-classified Field to classify() also requires adding
// it here, otherwise SignalMeta.EnumTypeName will be the empty string and
// the codec dispatcher will not be able to pick a Parse<EnumName>.
func enumTypeOf(name string) string {
	switch name {
	case "ChargeState":
		return "ChargingState"
	case "Gear":
		return "ShiftState"
	case "DiStateR", "DiStateF", "DiStateREL", "DiStateRER":
		return "DriveInverterState"
	case "Hvil":
		return "HvilStatus"
	case "ScheduledChargingMode":
		return "ScheduledChargingModeValue"
	case "FdWindow", "FpWindow", "RdWindow", "RpWindow":
		return "WindowState"
	case "SentryMode":
		return "SentryModeState"
	case "DriverSeatBelt", "PassengerSeatBelt":
		return "BuckleStatus"
	case "CarType":
		return "CarTypeValue"
	case "ChargePort":
		return "ChargePortValue"
	case "ChargePortLatch":
		return "ChargePortLatchValue"
	case "CruiseFollowDistance":
		return "FollowDistance"
	case "SpeedLimitWarning":
		return "SpeedAssistLevel"
	case "ForwardCollisionWarning":
		return "ForwardCollisionSensitivity"
	case "LaneDepartureAvoidance":
		return "LaneAssistLevel"
	case "BMSState":
		return "BMSStateValue"
	case "GuestModeMobileAccessState":
		return "GuestModeMobileAccess"
	case "DetailedChargeState":
		return "DetailedChargeStateValue"
	case "CabinOverheatProtectionMode":
		return "CabinOverheatProtectionModeState"
	case "CabinOverheatProtectionTemperatureLimit":
		return "ClimateOverheatProtectionTempLimit"
	case "CenterDisplay":
		return "DisplayState"
	case "ChargingCableType":
		return "CableType"
	case "ClimateKeeperMode":
		return "ClimateKeeperModeState"
	case "DefrostMode":
		return "DefrostModeState"
	case "FastChargerType":
		return "FastCharger"
	case "HvacAutoMode":
		return "HvacAutoModeState"
	case "HvacPower":
		return "HvacPowerState"
	case "PowershareStatus":
		return "PowershareState"
	case "PowershareStopReason":
		return "PowershareStopReasonStatus"
	case "PowershareType":
		return "PowershareTypeStatus"
	case "TonneauPosition":
		return "TonneauPositionState"
	case "TonneauTentMode":
		return "TonneauTentModeState"
	case "SettingDistanceUnit":
		return "DistanceUnit"
	case "SettingTemperatureUnit":
		return "TemperatureUnit"
	case "SettingTirePressureUnit":
		return "PressureUnit"
	case "SettingChargeUnit":
		return "ChargeUnitPreference"
	case "LightsTurnSignal":
		return "TurnSignalState"
	case "MediaPlaybackStatus":
		return "MediaStatus"
	case "SunroofInstalled":
		return "SunroofInstalledState"
	}
	return ""
}

// valueKindConstName maps a classifier kind string to the Go constant name
// from internal/tesla/protomodel/types.go. Compound kinds carry their
// nested message type after a colon (e.g. "compound:LocationValue") which
// is stripped here; the message type itself is encoded via IsCompound +
// the typed Value oneof variant in datum_decoder_gen.go, not via SignalMeta.
func valueKindConstName(kind string) string {
	if strings.HasPrefix(kind, "compound:") {
		return "ValueKindCompound"
	}
	switch kind {
	case "string":
		return "ValueKindString"
	case "bool":
		return "ValueKindBool"
	case "int":
		return "ValueKindInt32"
	case "long":
		return "ValueKindInt64"
	case "float":
		return "ValueKindFloat"
	case "double":
		return "ValueKindDouble"
	case "enum":
		return "ValueKindEnum"
	case "time":
		return "ValueKindTime"
	case "invalid":
		return "ValueKindInvalid"
	}
	return "ValueKindUnknown"
}

// unitKindConstName maps a classifier unit string to the Go constant name
// from internal/tesla/protomodel/types.go.
func unitKindConstName(unit string) string {
	switch unit {
	case "distance":
		return "UnitKindDistance"
	case "temperature":
		return "UnitKindTemperature"
	case "pressure":
		return "UnitKindPressure"
	case "charge":
		return "UnitKindCharge"
	}
	return "UnitKindNone"
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
	return EmitFiltered(pf, packageName, outDir, "")
}

// EmitFiltered is like Emit but optionally restricts the set of generated
// files. When only is the empty string all three files are emitted; when
// only is one of "signal_metadata", "enum_parsers", or "datum_decoder"
// just the matching file is emitted. Any other value is rejected so that
// typos do not silently skip generation.
//
// The filter exists so that intermediate phase-42 prompts can land their
// dedicated _gen.go file in isolation without dragging the still-unclaimed
// sibling files along; once all three claims are committed, callers should
// drop the --only flag and rely on the full Emit().
func EmitFiltered(pf *ProtoFile, packageName, outDir, only string) error {
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return fmt.Errorf("create out dir %s: %w", outDir, err)
	}
	type emitTarget struct {
		flag   string
		name   string
		render func(*ProtoFile, string) (string, error)
	}
	targets := []emitTarget{
		{flag: "signal_metadata", name: fileSignalMetadata, render: renderSignalMetadata},
		{flag: "enum_parsers", name: fileEnumParsers, render: renderEnumParsers},
		{flag: "datum_decoder", name: fileDatumDecoder, render: renderDatumDecoder},
	}
	if only != "" {
		matched := false
		for _, t := range targets {
			if t.flag == only {
				matched = true
				break
			}
		}
		if !matched {
			return fmt.Errorf("unknown --only value %q (want one of: signal_metadata, enum_parsers, datum_decoder)", only)
		}
	}
	for _, t := range targets {
		if only != "" && t.flag != only {
			continue
		}
		if err := emitFile(pf, packageName, outDir, t.name, t.render); err != nil {
			return err
		}
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
	ValueKindExpr string
	EnumTypeName  string
	IsCompound    bool
	UnitKindExpr  string
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

// Signals is the canonical list of every Tesla Fleet Telemetry signal,
// in proto3 enum-number order. Every Field value declared in the vendored
// vehicle_data.proto is present, including the Unknown, Deprecated_*,
// Experimental_*, and Semitruck* sentinel values, so that downstream code
// can iterate Signals to build per-Field state without having to reflect
// on the proto.
var Signals = []SignalMeta{
{{range .SignalMeta}}	{Field: "{{.Name}}", ProtoEnumNum: {{.Number}}, Category: "{{.Category}}", ValueKind: {{.ValueKindExpr}}, EnumTypeName: "{{.EnumTypeName}}", IsCompound: {{.IsCompound}}, UnitKind: {{.UnitKindExpr}}, IsSettingUnit: {{.IsSettingUnit}}},
{{end}}}

// SignalsByName indexes Signals by canonical proto field name. The pointer
// values are stable for the lifetime of the process; callers MUST NOT
// mutate the SignalMeta they reference.
var SignalsByName = map[string]*SignalMeta{}

// SignalsByEnum indexes Signals by proto3 enum number. Use this when
// decoding a Datum whose key arrived as a numeric Field value rather than
// a symbolic name.
var SignalsByEnum = map[int32]*SignalMeta{}

func init() {
	for i := range Signals {
		s := &Signals[i]
		SignalsByName[s.Field] = s
		SignalsByEnum[s.ProtoEnumNum] = s
	}
}
`

func renderSignalMetadata(pf *ProtoFile, packageName string) (string, error) {
	fieldEnum := pf.FindEnum("Field")
	if fieldEnum == nil {
		return "", fmt.Errorf("Field enum not found in proto")
	}
	rows := make([]signalMetaRow, 0, len(fieldEnum.Values))
	for _, v := range fieldEnum.Values {
		c, _ := classify(v.Name)
		isCompound := strings.HasPrefix(c.kind, "compound:")
		var enumName string
		if c.kind == "enum" {
			enumName = enumTypeOf(v.Name)
		}
		rows = append(rows, signalMetaRow{
			ConstName:     fieldEnum.Name + "_" + v.Name,
			Name:          v.Name,
			Number:        v.Number,
			Category:      c.cat,
			ValueKindExpr: valueKindConstName(c.kind),
			EnumTypeName:  enumName,
			IsCompound:    isCompound,
			UnitKindExpr:  unitKindConstName(c.unit),
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

// enumParserValueTpl is the per-value template input. Suffix is the bare
// token after stripping the enum's longest common prefix, e.g. "P" for
// ShiftStateP under the LCP "ShiftState". Suffix is empty when it would
// equal Name (no useful prefix to strip) or the empty string (one of the
// values equals the LCP itself); the template emits a single-arm case
// for the full token in that case so the switch never contains an empty
// string literal.
type enumParserValueTpl struct {
	Name   string
	Number int32
	Suffix string
}

type enumParserEnumTpl struct {
	Name   string
	Values []enumParserValueTpl
}

type enumParsersTplData struct {
	Package string
	Header  string
	Enums   []enumParserEnumTpl
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
// corresponding {{.Name}} constant. Both the full proto-cased token
// (e.g. "{{$enum}}<Suffix>") and the bare suffix (e.g. "<Suffix>") are
// accepted so callers can pass either the wire-format name or a
// human-friendly short form. Returns an error if the name is not a
// known {{.Name}} value.
func Parse{{.Name}}(s string) ({{.Name}}, error) {
	switch s {
{{range .Values}}{{if .Suffix}}	case "{{.Name}}", "{{.Suffix}}":
{{else}}	case "{{.Name}}":
{{end}}		return {{$enum}}_{{.Name}}, nil
{{end}}	}
	return {{.Name}}(0), fmt.Errorf("unknown {{$enum}} %q", s)
}

{{end}}`

// longestCommonPrefix returns the longest string that is a prefix of every
// element of strs. Returns the empty string when strs is empty or any pair
// of elements share no leading character.
func longestCommonPrefix(strs []string) string {
	if len(strs) == 0 {
		return ""
	}
	prefix := strs[0]
	for i := 1; i < len(strs); i++ {
		s := strs[i]
		// Truncate prefix until it is a prefix of s.
		max := len(prefix)
		if len(s) < max {
			max = len(s)
		}
		j := 0
		for j < max && prefix[j] == s[j] {
			j++
		}
		prefix = prefix[:j]
		if prefix == "" {
			return ""
		}
	}
	return prefix
}

func renderEnumParsers(pf *ProtoFile, packageName string) (string, error) {
	// Drop the Field enum (it lives in signal_metadata_gen.go).
	enums := make([]enumParserEnumTpl, 0, len(pf.Enums))
	for _, e := range pf.Enums {
		if e.Name == "Field" {
			continue
		}
		names := make([]string, len(e.Values))
		for i, v := range e.Values {
			names[i] = v.Name
		}
		lcp := longestCommonPrefix(names)
		values := make([]enumParserValueTpl, len(e.Values))
		for i, v := range e.Values {
			suffix := ""
			if lcp != "" && len(v.Name) > len(lcp) {
				candidate := v.Name[len(lcp):]
				if candidate != "" && candidate != v.Name {
					suffix = candidate
				}
			}
			values[i] = enumParserValueTpl{
				Name:   v.Name,
				Number: v.Number,
				Suffix: suffix,
			}
		}
		enums = append(enums, enumParserEnumTpl{Name: e.Name, Values: values})
	}
	tpl, err := template.New("enum_parsers").Parse(enumParsersTemplate)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := tpl.Execute(&buf, enumParsersTplData{
		Package: packageName,
		Header:  generatedHeader,
		Enums:   enums,
	}); err != nil {
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

// compoundGoTypeName maps a proto compound message name to the Go type name
// used in the generated decoder. The Go type names are owned by the
// hand-written compounds.go file in the same package; keep this map in sync
// with the type declarations there. New compounds require updating both
// compoundNames (above) and compoundDecoderBody (below) too.
var compoundGoTypeName = map[string]string{
	"LocationValue": "Location",
	"Doors":         "Doors",
	"TireLocation":  "TireLocation",
	"Time":          "Time",
}

// compoundDecoderBody returns the case-body that constructs the typed
// compound from an ftproto oneof case. The body assumes the surrounding
// switch arm is `case *ftproto.Value_<GoFieldName>:` and that the matched
// value is bound to identifier x. Field names match the hand-written
// compounds.go declarations; getter names match the protoc-gen-go output
// for the vendored Tesla proto (note the underscore-before-digit on the
// SemiMiddleAxleLeft_2 / SemiRearAxleLeft_2 etc. accessors).
func compoundDecoderBody(protoCompound, oneofGoFieldName string) string {
	switch protoCompound {
	case "LocationValue":
		return `		lv := x.` + oneofGoFieldName + `
		if lv == nil {
			return Location{}, nil
		}
		return Location{Latitude: lv.GetLatitude(), Longitude: lv.GetLongitude()}, nil`
	case "Doors":
		return `		d := x.` + oneofGoFieldName + `
		if d == nil {
			return Doors{}, nil
		}
		return Doors{
			DriverFront:    d.GetDriverFront(),
			DriverRear:     d.GetDriverRear(),
			PassengerFront: d.GetPassengerFront(),
			PassengerRear:  d.GetPassengerRear(),
			TrunkFront:     d.GetTrunkFront(),
			TrunkRear:      d.GetTrunkRear(),
		}, nil`
	case "Time":
		return `		tv := x.` + oneofGoFieldName + `
		if tv == nil {
			return Time{}, nil
		}
		return Time{Hour: tv.GetHour(), Minute: tv.GetMinute(), Second: tv.GetSecond()}, nil`
	case "TireLocation":
		return `		tl := x.` + oneofGoFieldName + `
		if tl == nil {
			return TireLocation{}, nil
		}
		return TireLocation{
			FrontLeft:            tl.GetFrontLeft(),
			FrontRight:           tl.GetFrontRight(),
			RearLeft:             tl.GetRearLeft(),
			RearRight:            tl.GetRearRight(),
			SemiMiddleAxleLeft2:  tl.GetSemiMiddleAxleLeft_2(),
			SemiMiddleAxleRight2: tl.GetSemiMiddleAxleRight_2(),
			SemiRearAxleLeft:     tl.GetSemiRearAxleLeft(),
			SemiRearAxleRight:    tl.GetSemiRearAxleRight(),
			SemiRearAxleLeft2:    tl.GetSemiRearAxleLeft_2(),
			SemiRearAxleRight2:   tl.GetSemiRearAxleRight_2(),
		}, nil`
	}
	// Should never happen — renderDatumDecoder validates against compoundNames.
	return `		return nil, fmt.Errorf("protomodel: missing decoder body for compound ` + protoCompound + `")`
}

type datumTplData struct {
	Package  string
	Header   string
	Variants []decoderVariantTpl
}

// decoderVariantTpl is one rendered case-arm of the DecodeValue switch.
type decoderVariantTpl struct {
	GoFieldName string // e.g. "StringValue" — appears in `case *ftproto.Value_<X>:`
	Body        string // case-body text (already indented, no leading tab)
}

const datumDecoderTemplate = `{{.Header}}// Decoder for the Tesla Fleet Telemetry Datum.Value oneof. Every variant the
// vendored proto declares is covered by an explicit case in DecodeValue; the
// "default" arm is reachable only if the upstream ftproto package adds a new
// variant we have not yet classified, in which case we return a descriptive
// error so the caller can surface a clear "needs codegen update" signal.
//
// The decoder honors Value.invalid=true BEFORE inspecting any other variant
// (per ADR-004): the producer marks a sample untrustworthy by setting the
// invalid bit irrespective of which oneof slot is populated, and the rest of
// the pipeline drops the field on ErrInvalid. Callers MUST NOT substitute a
// default or zero on ErrInvalid — the entire telemetry sample is suspect.
//
// The decoder also rejects the unset-oneof case with ErrUnsetValue. A Value
// arriving with no populated variant is a producer bug, not a "no change"
// signal; treating it silently as the zero value would corrupt downstream
// state. ErrUnsetValue forces the caller to make an explicit decision.
//
// Compound message variants (LocationValue, Doors, TireLocation, Time)
// return the typed structs from compounds.go (Location, Doors, TireLocation,
// Time). Flattening of those typed structs to atomic per-child signals
// happens in the codec package (Prompt 0020), not here.
package {{.Package}}

import (
	"errors"
	"fmt"
	"strings"

	ftproto "github.com/teslamotors/fleet-telemetry/protos"
)

// ErrInvalid is returned by DecodeValue / DecodeDatum when the source Value
// has its invalid flag set to true. The Tesla Fleet Telemetry producer uses
// this flag to mark a sample as not trustworthy (e.g. sensor unavailable,
// transient fault, value out of expected range). The pipeline drops fields
// returning this error; callers MUST NOT substitute a default or zero
// value, and MUST NOT persist the sample under any other interpretation.
var ErrInvalid = errors.New("protomodel: value marked invalid")

// ErrUnsetValue is returned by DecodeValue when the Value has no populated
// oneof variant (or is nil). This is a producer bug — every populated
// Datum.value SHOULD have exactly one of the oneof slots set. The decoder
// surfaces this as a hard error rather than silently producing the zero
// value, so the caller can log it, drop the sample, and increment a metric
// rather than corrupting downstream state with an assumed default.
var ErrUnsetValue = errors.New("protomodel: oneof value is unset")

// DecodeValue extracts the populated oneof variant from v and returns it as
// a strict typed Go value.
//
// Returns:
//   - (nil, ErrInvalid)     when v.invalid==true (caller drops the sample);
//   - (nil, ErrUnsetValue)  when v is nil or no oneof variant is populated;
//   - (typed value, nil)    for any populated scalar/enum/compound variant.
//
// The returned ` + "`any`" + ` is one of:
//   - string  (string_value, AND every named-enum variant — see below)
//   - int32   (int_value)
//   - int64   (long_value)
//   - float32 (float_value)
//   - float64 (double_value)
//   - bool    (boolean_value)
//   - Location, Doors, TireLocation, Time (the four compound message variants)
//
// **Enum variants are returned as canonical short strings**, NOT as typed
// ftproto enum values. The decoder calls .String() on the typed proto enum
// then strips the per-enum value-name prefix so the result is the human-
// readable short form (e.g. "D", "Charging", "Disconnected", "Armed",
// "Idle"). This is the SINGLE conversion point for proto-enum -> internal-
// representation translation in the entire pipeline; no downstream code
// (FSM, sessions, alerts, signal store, REST handlers, SSE, signal_log
// writer) is permitted to type-assert against ftproto.* enum values.
// Adding a new conversion site duplicates this contract and is a code-
// review block.
//
// Rationale: every serialization edge in the system (Postgres TEXT, Redis
// HSET, REST/SSE JSON) requires strings anyway. Making the codec's internal
// representation also string keeps the entire pipeline uniform on
// primitives, localizes the ftproto SDK coupling to this package, and
// matches the canonical-short-form constants in internal/enums (GearDrive=
// "D", ChargeStateCharging="Charging", etc.) that consumers compare
// against.
func DecodeValue(v *ftproto.Value) (any, error) {
	if v == nil {
		return nil, ErrUnsetValue
	}
	// Honor the invalid flag BEFORE the oneof switch. The Tesla producer
	// emits Value{Value: &Value_Invalid{Invalid: true}} as the populated
	// variant; v.GetInvalid() returns true only in that case (not for the
	// rare Value{Value: &Value_Invalid{Invalid: false}} which would mean
	// "explicitly NOT invalid" and is treated as the unset-oneof case
	// further down).
	if v.GetInvalid() {
		return nil, ErrInvalid
	}
	switch x := v.GetValue().(type) {
	case nil:
		return nil, ErrUnsetValue
{{range .Variants}}	case *ftproto.Value_{{.GoFieldName}}:
{{.Body}}
{{end}}	default:
		// A type the upstream ftproto package added that this codegen has
		// not yet classified. Returning a descriptive error keeps the
		// pipeline running (the field is dropped by the caller) while
		// surfacing a clear signal that codegen needs an update.
		return nil, fmt.Errorf("protomodel: unhandled Value oneof variant %T", x)
	}
}

// DecodeDatum extracts the field name and decoded Go value from d.
//
// Returns:
//   - ("", nil, ErrUnsetValue) when d is nil or carries no Value;
//   - (field name, nil, ErrInvalid) when d.value.invalid==true;
//   - (field name, typed value, nil) on success.
//
// ` + "`field`" + ` is the symbolic ftproto.Field name (e.g. "VehicleSpeed",
// "Location"), suitable for routing.yaml lookups, signal_log columns, and
// SSE topic keys. ` + "`value`" + ` is one of the documented Go types in DecodeValue.
func DecodeDatum(d *ftproto.Datum) (field string, value any, err error) {
	if d == nil {
		return "", nil, ErrUnsetValue
	}
	field = d.GetKey().String()
	value, err = DecodeValue(d.GetValue())
	return field, value, err
}
`

func renderDatumDecoder(pf *ProtoFile, packageName string) (string, error) {
	// Value oneof variants come from the Value message.
	valueMsg := pf.FindMessage("Value")
	if valueMsg == nil {
		return "", fmt.Errorf("Value message not found in proto")
	}
	if len(valueMsg.Oneofs) != 1 {
		return "", fmt.Errorf("Value message must have exactly one oneof, got %d", len(valueMsg.Oneofs))
	}

	// Build per-enum value-name longest-common-prefix table. The decoder
	// strips this prefix from .String() output to produce the canonical
	// short form (e.g. ShiftState's values share "ShiftState" prefix, so
	// "ShiftStateD".String() -> "ShiftStateD" -> TrimPrefix -> "D"). Same
	// computation as renderEnumParsers; kept local so the two emitters
	// stay independently auditable.
	enumPrefix := make(map[string]string, len(pf.Enums))
	for _, e := range pf.Enums {
		if e.Name == "Field" {
			continue
		}
		names := make([]string, len(e.Values))
		for i, v := range e.Values {
			names[i] = v.Name
		}
		enumPrefix[e.Name] = longestCommonPrefix(names)
	}

	// Sort variants by proto field number for stable output.
	oneofVariants := append([]FieldDef(nil), valueMsg.Oneofs[0].Variants...)
	sort.SliceStable(oneofVariants, func(i, j int) bool { return oneofVariants[i].Number < oneofVariants[j].Number })

	var rendered []decoderVariantTpl
	for _, vrnt := range oneofVariants {
		goField := goCamelCase(vrnt.Name)
		var body string
		switch {
		case vrnt.Name == "invalid":
			// v.GetInvalid() above already short-circuited the populated case;
			// reaching here means Invalid==false, which is treated as unset.
			body = "\t\t// v.GetInvalid() above already short-circuited the populated case;\n" +
				"\t\t// reaching here means Invalid==false, which is treated as unset.\n" +
				"\t\treturn nil, ErrUnsetValue"
		case scalarIsScalar(vrnt.Type):
			// Scalar oneof: x.<GoFieldName> is the underlying scalar value
			// directly (no pointer deref needed — protoc-gen-go embeds the
			// scalar inline in the oneof wrapper struct).
			body = "\t\treturn x." + goField + ", nil"
		case compoundNames[vrnt.Type]:
			body = compoundDecoderBody(vrnt.Type, goField)
		default:
			// Named enum variant. Convert to canonical short string by
			// calling .String() (every protoc-gen-go enum implements
			// fmt.Stringer via its *_name map) then stripping the per-enum
			// value-name prefix. This is the SINGLE conversion point for
			// proto-enum -> internal-representation in the pipeline; see
			// the doc comment on DecodeValue for the architectural rule.
			//
			// strings.TrimPrefix is well-defined to return the input
			// unchanged when the prefix is empty, so the emitted body
			// shape is uniform across all enum variants regardless of
			// whether their values share a common prefix.
			prefix, ok := enumPrefix[vrnt.Type]
			if !ok {
				return "", fmt.Errorf("enum %q referenced by Value oneof variant %q not found in proto", vrnt.Type, vrnt.Name)
			}
			body = "\t\treturn strings.TrimPrefix(x." + goField + ".String(), " + strconv.Quote(prefix) + "), nil"
		}
		rendered = append(rendered, decoderVariantTpl{
			GoFieldName: goField,
			Body:        body,
		})
	}

	tpl, err := template.New("datum_decoder").Parse(datumDecoderTemplate)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := tpl.Execute(&buf, datumTplData{
		Package:  packageName,
		Header:   generatedHeader,
		Variants: rendered,
	}); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// scalarIsScalar reports whether the given proto type name is one of the
// primitive scalar variant types handled by the Value oneof.
func scalarIsScalar(t string) bool {
	_, ok := scalarVariantKinds[t]
	return ok
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
