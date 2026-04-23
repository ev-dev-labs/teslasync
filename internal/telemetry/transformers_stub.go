package telemetry

// Transformer stubs — Phase 5 will replace this file with the real implementations
// in transformers.go. Until then, stubs return the raw value unchanged so that
// the catalog files compile and lookups work end-to-end.
//
// DO NOT add real conversion logic here. Edit transformers.go in Phase 5.

func passthrough(raw any) (any, error) { return raw, nil }

// Enum/string normalizers
var (
	NormalizeChargingState Transformer = passthrough
	NormalizeHvacState     Transformer = passthrough
	NormalizeShiftState    Transformer = passthrough
	NormalizeDriveState    Transformer = passthrough
	NormalizeDefrostMode   Transformer = passthrough
	NormalizeSeatHeater    Transformer = passthrough
)

// Compound flatteners
var (
	FlattenLocation Transformer = passthrough
	FlattenDoors    Transformer = passthrough
	FlattenWindows  Transformer = passthrough
)

// Time/format helpers
var (
	NormalizeTimestamp Transformer = passthrough
)

// Unit conversions
var (
	ConvertMphToMps Transformer = passthrough
)
