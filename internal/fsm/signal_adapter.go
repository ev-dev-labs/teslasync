package fsm

import (
	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

// Canonical proto field names for the signals the FSM rule layer cares
// about. Kept as private constants so the adapter is the only place in
// the package that mentions raw field names.
const (
	fieldGear                = "Gear"
	fieldVehicleSpeed        = "VehicleSpeed"
	fieldChargeState         = "ChargeState"
	fieldDetailedChargeState = "DetailedChargeState"
	fieldLocked              = "Locked"
	fieldBatteryLevel        = "BatteryLevel"
	fieldLocationLatitude    = "LocationLatitude"
	fieldLocationLongitude   = "LocationLongitude"
)

// SignalAdapter centralizes typed signal.Store lookups for the FSM rule
// layer. Each method returns an FSM-friendly Go primitive (canonical short
// strings for enums, SI floats for numerics, plain bool for flags)
// alongside an "ok" indicator.
//
// After the codec canonicalization change (see protomodel.DecodeValue),
// enum fields are stored as canonical short strings in signal.Store ("D",
// "Charging", "Disconnected", etc.). The adapter is now a thin typed
// facade — it does NOT translate ftproto.* values; that work happens
// once at the codec boundary. Domain rules MUST consume short strings
// and SI numerics and MUST NOT type-assert against ftproto enum values.
type SignalAdapter struct {
	store *signal.Store
	log   zerolog.Logger
}

// NewSignalAdapter returns a SignalAdapter backed by the given store.
// The logger is used at debug level for missing / wrong-kind diagnostics
// only; happy-path lookups are silent.
func NewSignalAdapter(s *signal.Store, log zerolog.Logger) *SignalAdapter {
	return &SignalAdapter{store: s, log: log}
}

// Last returns the raw signal.Value for any field. Useful for callers
// that need the timestamp (e.g. freshness checks) or the untyped Raw
// payload that the typed accessors deliberately drop.
func (a *SignalAdapter) Last(vehicleID int64, field string) (signal.Value, bool) {
	v := a.store.Get(vehicleID, field)
	if v == nil {
		return signal.Value{}, false
	}
	return *v, true
}

// Gear returns the canonical short shift suffix ("P", "R", "N", "D").
//
// The codec canonicalizes Gear to its single-letter short form so the
// adapter is a thin GetString wrapper plus a guard that filters out
// non-canonical variants ("Unknown", "Invalid", "SNA").
func (a *SignalAdapter) Gear(vehicleID int64) (string, bool) {
	if !a.expectKind(vehicleID, fieldGear, protomodel.ValueKindEnum) {
		return "", false
	}
	g, ok := a.store.GetString(vehicleID, fieldGear)
	if !ok {
		return "", false
	}
	switch g {
	case "P", "R", "N", "D":
		return g, true
	}
	a.log.Debug().
		Int64("vehicle_id", vehicleID).
		Str("field", fieldGear).
		Str("value", g).
		Msg("fsm signal adapter: Gear value not in {P,R,N,D}")
	return "", false
}

// Speed returns VehicleSpeed in m/s. Unit conversion happens upstream
// in normalize.toSI (per the speed-override list in
// internal/tesla/normalize/normalize.go); the store always holds SI
// metres-per-second for this field.
func (a *SignalAdapter) Speed(vehicleID int64) (float64, bool) {
	f, ok := a.store.GetFloat(vehicleID, fieldVehicleSpeed)
	if !ok {
		a.log.Debug().
			Int64("vehicle_id", vehicleID).
			Str("field", fieldVehicleSpeed).
			Msg("fsm signal adapter: Speed unavailable")
		return 0, false
	}
	return f, true
}

// IsCharging returns true when ChargeState reports an active
// charging-related state (Charging or Starting). DetailedChargeState
// is consulted only as a fallback when ChargeState is missing.
//
// Disconnected, NoPower, Stopped, Complete, and Unknown all map to
// "not charging" — the FSM treats Complete as a terminal, post-session
// state and Stopped as a paused / interrupted session that the
// reconciler should NOT re-enter Charging from.
func (a *SignalAdapter) IsCharging(vehicleID int64) (bool, bool) {
	if state, ok := a.chargeStateName(vehicleID, fieldChargeState); ok {
		return chargeStateIsActive(state), true
	}
	if state, ok := a.chargeStateName(vehicleID, fieldDetailedChargeState); ok {
		return chargeStateIsActive(state), true
	}
	return false, false
}

// IsDriving returns true when the gear is in Drive or Reverse and
// VehicleSpeed > 0.
//
// The "ok" flag reflects whether the predicate could be evaluated, not
// the predicate's truth:
//   - Gear missing: (false, false)
//   - Gear in {P, N}: (false, true) — speed is irrelevant
//   - Gear in {D, R} and Speed available: (speed > 0, true)
//   - Gear in {D, R} and Speed missing: (false, false)
//
// Callers can therefore distinguish "definitely not driving" from
// "unknown" by inspecting ok.
func (a *SignalAdapter) IsDriving(vehicleID int64) (bool, bool) {
	gear, gearOk := a.Gear(vehicleID)
	if !gearOk {
		return false, false
	}
	switch gear {
	case "P", "N":
		return false, true
	case "D", "R":
		speed, speedOk := a.Speed(vehicleID)
		if !speedOk {
			return false, false
		}
		return speed > 0, true
	}
	return false, false
}

// Locked returns the Locked door-state flag.
func (a *SignalAdapter) Locked(vehicleID int64) (bool, bool) {
	return a.store.GetBool(vehicleID, fieldLocked)
}

// SoC returns BatteryLevel as a percentage in [0, 100]. BatteryLevel
// has UnitKindCharge, which the normalize layer passes through unchanged,
// so the store always holds a raw percentage.
func (a *SignalAdapter) SoC(vehicleID int64) (float64, bool) {
	return a.store.GetFloat(vehicleID, fieldBatteryLevel)
}

// Position returns the codec-flattened LocationLatitude / LocationLongitude
// pair. Both atomics MUST be present; if either is missing or fails to
// coerce to float64, ok is false and lat/lng are zero (not partial
// fix).
func (a *SignalAdapter) Position(vehicleID int64) (lat, lng float64, ok bool) {
	lat, latOk := a.store.GetFloat(vehicleID, fieldLocationLatitude)
	lng, lngOk := a.store.GetFloat(vehicleID, fieldLocationLongitude)
	if !latOk || !lngOk {
		return 0, 0, false
	}
	return lat, lng, true
}

// expectKind verifies the field's declared ValueKind. Unannotated
// fields (no entry in protomodel.SignalsByName, e.g. flattened
// LocationLatitude) are accepted because the codec / flattener is the
// authoritative source for their runtime type. Mismatched kinds log at
// debug and return false.
func (a *SignalAdapter) expectKind(vehicleID int64, field string, want protomodel.ValueKind) bool {
	meta, ok := protomodel.SignalsByName[field]
	if !ok {
		return true
	}
	if meta.ValueKind != want {
		a.log.Debug().
			Int64("vehicle_id", vehicleID).
			Str("field", field).
			Stringer("got_kind", meta.ValueKind).
			Stringer("want_kind", want).
			Msg("fsm signal adapter: ValueKind mismatch")
		return false
	}
	return true
}

// chargeStateName returns the canonical short suffix (e.g. "Charging")
// for a ChargeState / DetailedChargeState field. The codec already
// emits the short form, so the adapter is a thin GetString wrapper plus
// the ValueKind guard.
func (a *SignalAdapter) chargeStateName(vehicleID int64, field string) (string, bool) {
	if !a.expectKind(vehicleID, field, protomodel.ValueKindEnum) {
		return "", false
	}
	return a.store.GetString(vehicleID, field)
}

// chargeStateIsActive returns true when the canonical charge-state
// short form represents an active charging session.
func chargeStateIsActive(suffix string) bool {
	switch suffix {
	case "Charging", "Starting":
		return true
	}
	return false
}
