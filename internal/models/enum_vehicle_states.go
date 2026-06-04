package models

// This file defines typed string enums for vehicle_live_state columns so
// callers cannot pass arbitrary strings. Values mirror the Postgres CHECK
// constraints for charging_state, hvac_state, and shift_state.
//
// ADR-001 keeps these fields typed by default, and ADR-004 keeps them out of
// JSONB carve-outs.

// ChargingStateKind enumerates the value of vehicle_live_state.charging_state.
// Mirrors the CHECK constraint:
//
//	CHECK (charging_state IN ('Disconnected','Connected','Charging','Stopped','Complete','NoPower','Starting'))
type ChargingStateKind string

const (
	ChargingStateDisconnected ChargingStateKind = "Disconnected"
	ChargingStateConnected    ChargingStateKind = "Connected"
	ChargingStateCharging     ChargingStateKind = "Charging"
	ChargingStateStopped      ChargingStateKind = "Stopped"
	ChargingStateComplete     ChargingStateKind = "Complete"
	ChargingStateNoPower      ChargingStateKind = "NoPower"
	ChargingStateStarting     ChargingStateKind = "Starting"
)

// Valid reports whether k is one of the allowed
// vehicle_live_state.charging_state values. Keep exhaustive and in sync
// with the CHECK constraint.
func (k ChargingStateKind) Valid() bool {
	switch k {
	case ChargingStateDisconnected,
		ChargingStateConnected,
		ChargingStateCharging,
		ChargingStateStopped,
		ChargingStateComplete,
		ChargingStateNoPower,
		ChargingStateStarting:
		return true
	}
	return false
}

// HVACStateKind enumerates the value of vehicle_live_state.hvac_state.
// Mirrors the CHECK constraint:
//
//	CHECK (hvac_state IN ('Off','On','Auto','Heating','Cooling','Defrost','Preconditioning'))
type HVACStateKind string

const (
	HVACStateOff             HVACStateKind = "Off"
	HVACStateOn              HVACStateKind = "On"
	HVACStateAuto            HVACStateKind = "Auto"
	HVACStateHeating         HVACStateKind = "Heating"
	HVACStateCooling         HVACStateKind = "Cooling"
	HVACStateDefrost         HVACStateKind = "Defrost"
	HVACStatePreconditioning HVACStateKind = "Preconditioning"
)

// Valid reports whether k is one of the allowed
// vehicle_live_state.hvac_state values. Keep exhaustive and in sync with
// the CHECK constraint.
func (k HVACStateKind) Valid() bool {
	switch k {
	case HVACStateOff,
		HVACStateOn,
		HVACStateAuto,
		HVACStateHeating,
		HVACStateCooling,
		HVACStateDefrost,
		HVACStatePreconditioning:
		return true
	}
	return false
}

// ShiftStateKind enumerates the value of vehicle_live_state.shift_state.
// Mirrors the CHECK constraint:
//
//	CHECK (shift_state IN ('P','R','N','D'))
//
// NULL in the database when the vehicle is asleep — represented as the
// zero value ("") in Go, which Valid() reports as false.
type ShiftStateKind string

const (
	ShiftStatePark    ShiftStateKind = "P"
	ShiftStateReverse ShiftStateKind = "R"
	ShiftStateNeutral ShiftStateKind = "N"
	ShiftStateDrive   ShiftStateKind = "D"
)

// Valid reports whether k is one of the allowed
// vehicle_live_state.shift_state values. Keep exhaustive and in sync
// with the CHECK constraint.
func (k ShiftStateKind) Valid() bool {
	switch k {
	case ShiftStatePark,
		ShiftStateReverse,
		ShiftStateNeutral,
		ShiftStateDrive:
		return true
	}
	return false
}
