package signal

// This file defines typed string enums for signal_catalog columns so callers
// cannot pass arbitrary strings. Values mirror the Postgres CHECK constraints
// declared in migrations/_baseline_source/09-signal-catalog.sql.

// SignalDataKind enumerates the value flavor of a signal. It mirrors the
// CHECK constraint on signal_catalog.data_kind and tells the cold-path
// reader which value_* column on signal_observations is populated.
type SignalDataKind string

const (
	SignalDataKindNumeric  SignalDataKind = "numeric"
	SignalDataKindText     SignalDataKind = "text"
	SignalDataKindBoolean  SignalDataKind = "boolean"
	SignalDataKindCompound SignalDataKind = "compound"
)

// Valid reports whether k is one of the allowed signal_catalog.data_kind
// values. Keep this in sync with the CHECK constraint.
func (k SignalDataKind) Valid() bool {
	switch k {
	case SignalDataKindNumeric,
		SignalDataKindText,
		SignalDataKindBoolean,
		SignalDataKindCompound:
		return true
	}
	return false
}

// SignalStorageTier enumerates the routing tier for an observed signal.
// Mirrors the CHECK constraint on signal_catalog.storage_tier (ADR-002
// hot/cold split + dropped).
type SignalStorageTier string

const (
	SignalStorageTierHot     SignalStorageTier = "hot"
	SignalStorageTierCold    SignalStorageTier = "cold"
	SignalStorageTierDropped SignalStorageTier = "dropped"
)

// Valid reports whether t is one of the allowed signal_catalog.storage_tier
// values. Keep this in sync with the CHECK constraint.
func (t SignalStorageTier) Valid() bool {
	switch t {
	case SignalStorageTierHot,
		SignalStorageTierCold,
		SignalStorageTierDropped:
		return true
	}
	return false
}
