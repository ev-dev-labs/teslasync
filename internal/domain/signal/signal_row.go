package signal

import "time"

// RawSignalRow is one row of the append-only provider-native system of record
// (the raw_signal table, migration 000214). It is the in-memory, framework-free
// shape the writer hands to RawSignalStore.AppendRaw; field order and types
// match the table columns one-for-one.
//
// H17 — APPEND-ONLY. raw_signal is never mutated; a correction is a NEW row
// (a later ObservedAt for the same VehicleID/ProviderKind), so this struct has
// no notion of an in-place update.
//
// H13 — NO SI-IMPLYING NUMERIC COLUMN. RawValue is the opaque provider-native
// value as text, with provider-native units; ValueType says how to parse it.
// Normalization to SI happens downstream when the canonical layer is populated,
// never here — so this struct deliberately carries no typed numeric field.
type RawSignalRow struct {
	// VehicleID is the vehicles(id) identity (BIGINT FK). Part of the
	// idempotency key.
	VehicleID int64 `json:"vehicle_id" db:"vehicle_id"`
	// ObservedAt is the provider-reported observation time. Part of the
	// idempotency key and the intended hypertable time dimension.
	ObservedAt time.Time `json:"observed_at" db:"observed_at"`
	// ProviderKind is the provider-native field name, verbatim
	// (e.g. "BatteryLevel" or "vendor.tesla.*"). Part of the idempotency key;
	// never renamed to a canonical name at the raw layer.
	ProviderKind string `json:"provider_kind" db:"provider_kind"`
	// ValueType discriminates how RawValue is to be parsed.
	ValueType ValueType `json:"value_type" db:"value_type"`
	// RawValue is the opaque provider-native value as text (H13).
	RawValue string `json:"raw_value" db:"raw_value"`
	// Brand is the provider/brand that emitted the reading (e.g. "tesla").
	Brand string `json:"brand" db:"brand"`
	// PrivacyClass is the sensitivity class stamped from the SignalDescriptor.
	PrivacyClass PrivacyClass `json:"privacy_class" db:"privacy_class"`
	// CreatedAt is the server-side ingest timestamp (raw_signal.created_at
	// DEFAULT now()). It is populated on reads only; on AppendRaw it is left
	// zero and the database stamps it. Forensic/lag metric only — identity and
	// ordering use ObservedAt.
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// IdentityKey returns the (vehicle_id, observed_at, provider_kind) triple that
// is raw_signal's primary key — the unit of idempotency for AppendRaw (H24):
// a re-delivered reading with the same key collapses to the row already on
// disk (ON CONFLICT DO NOTHING) instead of double-writing.
func (r RawSignalRow) IdentityKey() (int64, time.Time, string) {
	return r.VehicleID, r.ObservedAt, r.ProviderKind
}

// CanonicalSignalRow is one row of the SI-united, taxonomy-aligned query layer
// (the canonical_signal table, migration 000215) that dashboards, alerts, and
// automations read. It is the in-memory, framework-free shape exchanged with
// CanonicalSignalStore; field order and types match the table columns.
//
// H13 — NumValue IS SI-CANONICAL. The numeric value is already normalized to
// SI; its unit is implied by the CanonicalKind suffix (".._mps" = m/s,
// ".._pct" = percent, ".._wh" = watt-hours) and is never re-converted
// downstream — readers apply only a display-unit preference at the render
// boundary. Exactly one of NumValue / StrValue / BoolValue is non-nil,
// dictated by ValueType (mirrors the chk_canonical_signal_value_present CHECK).
//
// H14 — CanonicalKind is a permanent taxonomy name. Once minted it is never
// renamed or repurposed, so historical rows stay queryable under the same name
// forever; provider-native renames live in RawSignalRow.ProviderKind, not here.
type CanonicalSignalRow struct {
	// VehicleID is the vehicles(id) identity (BIGINT FK). Part of the
	// idempotency key.
	VehicleID int64 `json:"vehicle_id" db:"vehicle_id"`
	// ObservedAt is the provider-reported observation time. Part of the
	// idempotency key and the intended hypertable time dimension.
	ObservedAt time.Time `json:"observed_at" db:"observed_at"`
	// CanonicalKind is the permanent canonical taxonomy name
	// (e.g. "vehicle.battery.state_of_charge_pct"). Part of the idempotency key
	// (H14).
	CanonicalKind string `json:"canonical_kind" db:"canonical_kind"`
	// ValueType selects which typed value field is populated.
	ValueType ValueType `json:"value_type" db:"value_type"`
	// NumValue is the SI-canonical numeric value (H13); nil unless ValueType is
	// numeric. Unit is implied by the CanonicalKind suffix.
	NumValue *float64 `json:"num_value" db:"num_value"`
	// StrValue is the string value; nil unless ValueType is ValueTypeString.
	StrValue *string `json:"str_value" db:"str_value"`
	// BoolValue is the boolean value; nil unless ValueType is ValueTypeBool.
	BoolValue *bool `json:"bool_value" db:"bool_value"`
	// Brand is the provider/brand that produced the underlying reading.
	Brand string `json:"brand" db:"brand"`
	// PrivacyClass is the sensitivity class stamped from the SignalDescriptor.
	PrivacyClass PrivacyClass `json:"privacy_class" db:"privacy_class"`
	// CreatedAt is the server-side write timestamp (canonical_signal.created_at
	// DEFAULT now()). Populated on reads only; left zero on UpsertCanonical.
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// IdentityKey returns the (vehicle_id, observed_at, canonical_kind) triple that
// is canonical_signal's primary key — the unit of idempotency for
// UpsertCanonical (H24 / TL-7): a re-delivered derived reading with the same
// key is a no-op (ON CONFLICT DO NOTHING).
func (c CanonicalSignalRow) IdentityKey() (int64, time.Time, string) {
	return c.VehicleID, c.ObservedAt, c.CanonicalKind
}

// HasValue reports whether at least one typed value column is populated, the
// invariant enforced on disk by chk_canonical_signal_value_present.
func (c CanonicalSignalRow) HasValue() bool {
	return c.NumValue != nil || c.StrValue != nil || c.BoolValue != nil
}
