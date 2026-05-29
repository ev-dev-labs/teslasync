// Package settings stores per-vehicle overrides in `vehicle_settings`
// (migration 000175) and resolves them above install-global settings
// and hard-coded defaults.
//
// Supported override keys:
//
//	nickname              text       (override → vehicle.display_name)
//	mute_until            timestamp  (override → null)
//	charge_cost_tariff_id text       (override → null)
//	units_distance        text       (override → settings.unit_of_length → "km")
//	units_temperature     text       (override → settings.unit_of_temp   → "C")
//	units_energy          text       (override → "kWh")
//
// Per-vehicle polling stays in `polling_config`; exposing polling_seconds
// here would create a second source of truth. Hot-path callers continue
// reading the existing user-level settings until each consumer is moved
// to the override layer deliberately.
package settings

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
)

// EffectiveSettingSource identifies which layer of the resolver
// produced a returned value. The SPA's pill rendering keys off this
// enum; do not silently rename a constant without updating the
// frontend's <SourcePill> component.
type EffectiveSettingSource string

const (
	// EffectiveSourceOverride means a vehicle_settings row was
	// found and produced the value. This is the only source the
	// API can reset (DELETE the row reverts to the next layer).
	EffectiveSourceOverride EffectiveSettingSource = "override"
	// EffectiveSourceUser means the value came from the install-global
	// SettingsRepo. "User" is a misnomer in single-user installs but keeps
	// the API compatible with future subject-aware settings.
	EffectiveSourceUser EffectiveSettingSource = "user"
	// EffectiveSourceDefault means the value came from the
	// hard-coded fallback in this package — no row in either
	// layer.
	EffectiveSourceDefault EffectiveSettingSource = "default"
	// EffectiveSourceVehicle means the value came from the
	// vehicles base table (e.g. nickname falls back to
	// vehicles.display_name). Distinguished from "user" so the
	// SPA pill can say "Vehicle name" instead of "User default"
	// — the vehicle base name isn't actually a setting.
	EffectiveSourceVehicle EffectiveSettingSource = "vehicle"
)

// VehicleSettingValueKind enumerates the typed-column discriminators
// stored in the data_kind column. Mirrors the existing settings
// table's "text|number|boolean" plus a new "timestamp" for
// mute_until.
type VehicleSettingValueKind string

const (
	VehicleSettingKindText      VehicleSettingValueKind = "text"
	VehicleSettingKindNumber    VehicleSettingValueKind = "number"
	VehicleSettingKindBoolean   VehicleSettingValueKind = "boolean"
	VehicleSettingKindTimestamp VehicleSettingValueKind = "timestamp"
)

// Sentinel errors raised by the repo and resolver. Handlers map these
// to 4xx responses; anything else is treated as a 500.
var (
	// ErrVehicleSettingNotFound is returned by Get when no override
	// row exists for the (vehicle_id, key) tuple. The handler maps
	// this back to "no override; fall through" via the resolver
	// rather than surfacing a 404.
	ErrVehicleSettingNotFound = errors.New("vehicle_settings: not found")
	// ErrVehicleSettingInvalidKey is returned by every entry point
	// when the supplied key is unsupported. The handler maps this to
	// 400 INVALID_KEY.
	ErrVehicleSettingInvalidKey = errors.New("vehicle_settings: unsupported key")
	// ErrVehicleSettingInvalidValue is returned by Upsert when the
	// supplied value does not match the key's expected shape (e.g.
	// units_distance with "lightyears", nickname > 64 chars). The
	// handler maps this to 400 INVALID_VALUE.
	ErrVehicleSettingInvalidValue = errors.New("vehicle_settings: invalid value")
)

// VehicleNicknameMaxLen caps the nickname text length. Mirrors the
// vehicles.display_name TEXT column's practical UI limit; longer
// values would push the page header into a truncated render.
const VehicleNicknameMaxLen = 64

// PollingSecondsMin / Max are reserved for a later polling_config
// migration; documenting them here prevents the per-vehicle range from
// silently diverging across the codebase.
//
// Intentionally NOT exported — no caller today should be able to
// write a polling_seconds row through this repo.

// VehicleSettingDef describes one supported key, its expected value
// kind, and the resolver wiring. Add entries here in lockstep with the
// frontend's SETTING_DEFS table so the SPA renders the same contract.
type VehicleSettingDef struct {
	// Key is the canonical identifier used in URLs, the PK, and
	// the JSON payload. Do not rename — it's the public contract.
	Key string
	// Kind selects which value_* column the repo writes/reads.
	Kind VehicleSettingValueKind
	// Validate enforces the per-key constraints (enum, length,
	// range). Returns ErrVehicleSettingInvalidValue on failure so
	// the handler can blanket-map to 400.
	Validate func(value any) error
}

// vehicleSettingDefs is the supported-key whitelist. Iteration order
// matters: the resolver returns settings in this order so the SPA renders
// deterministic rows for snapshot tests and visual diffs.
var vehicleSettingDefs = []VehicleSettingDef{
	{
		Key:      "nickname",
		Kind:     VehicleSettingKindText,
		Validate: validateNickname,
	},
	{
		Key:      "mute_until",
		Kind:     VehicleSettingKindTimestamp,
		Validate: validateMuteUntil,
	},
	{
		Key:      "charge_cost_tariff_id",
		Kind:     VehicleSettingKindText,
		Validate: validateChargeCostTariffID,
	},
	{
		Key:      "units_distance",
		Kind:     VehicleSettingKindText,
		Validate: validateEnum(allowedUnitsDistance),
	},
	{
		Key:      "units_temperature",
		Kind:     VehicleSettingKindText,
		Validate: validateEnum(allowedUnitsTemperature),
	},
	{
		Key:      "units_energy",
		Kind:     VehicleSettingKindText,
		Validate: validateEnum(allowedUnitsEnergy),
	},
}

// Allowed value sets for the units_* keys. Mirrors the global
// settings_handler validation so the per-vehicle override can never
// hold a value the rest of the app doesn't understand.
var (
	allowedUnitsDistance    = []string{"km", "mi"}
	allowedUnitsTemperature = []string{"C", "F"}
	// units_energy currently only ships kWh; the slot exists so the
	// frontend can wire the row + the hierarchy is symmetric, and
	// so a future Wh/MJ option can land without a schema change.
	allowedUnitsEnergy = []string{"kWh"}
)

// vehicleSettingDefByKey is an O(1) lookup helper built once at
// package init. The order-preserved list above remains the canonical
// iteration order; this map is just a fast index.
var vehicleSettingDefByKey = func() map[string]VehicleSettingDef {
	out := make(map[string]VehicleSettingDef, len(vehicleSettingDefs))
	for _, d := range vehicleSettingDefs {
		out[d.Key] = d
	}
	return out
}()

// VehicleSettingDefs returns the canonical list of supported keys in
// the resolver's iteration order. Exported so the handler test can
// assert the wire contract without duplicating the literal list.
func VehicleSettingDefs() []VehicleSettingDef {
	out := make([]VehicleSettingDef, len(vehicleSettingDefs))
	copy(out, vehicleSettingDefs)
	return out
}

// IsValidVehicleSettingKey centralizes the supported-key predicate for
// handlers, repos, and tests.
func IsValidVehicleSettingKey(key string) bool {
	_, ok := vehicleSettingDefByKey[key]
	return ok
}

// ValidateVehicleSettingValue dispatches to the per-key validator
// from vehicleSettingDefs. Returns ErrVehicleSettingInvalidKey when
// key is not in the whitelist; ErrVehicleSettingInvalidValue when
// the value fails the per-key rule.
func ValidateVehicleSettingValue(key string, value any) error {
	def, ok := vehicleSettingDefByKey[key]
	if !ok {
		return ErrVehicleSettingInvalidKey
	}
	return def.Validate(value)
}

// VehicleSettingsRepo is the data-access layer for vehicle_settings.
// Stateless; safe to call concurrently — every method takes a context
// and forwards to the shared pgx pool.
type VehicleSettingsRepo struct {
	db *database.DB
}

// NewVehicleSettingsRepo wires the repo to a database pool. No
// background work is started; the repo is purely a thin SQL facade.
func NewVehicleSettingsRepo(db *database.DB) *VehicleSettingsRepo {
	return &VehicleSettingsRepo{db: db}
}

// VehicleSettingRow is the in-memory projection of one row in the
// vehicle_settings table. Exactly one of ValueText/ValueNum/ValueBool/
// ValueTS is non-nil, selected by Kind.
type VehicleSettingRow struct {
	VehicleID int64
	Key       string
	Kind      VehicleSettingValueKind
	ValueText *string
	ValueNum  *float64
	ValueBool *bool
	ValueTS   *time.Time
	UpdatedAt time.Time
}

// AsAny collapses the row's typed value fields into a single any
// suitable for JSON encoding. Returns nil when the row's payload
// columns are all NULL (a defensive degraded case — the schema's
// CHECK constraint should prevent it).
func (r VehicleSettingRow) AsAny() any {
	switch r.Kind {
	case VehicleSettingKindText:
		if r.ValueText == nil {
			return nil
		}
		return *r.ValueText
	case VehicleSettingKindNumber:
		if r.ValueNum == nil {
			return nil
		}
		return *r.ValueNum
	case VehicleSettingKindBoolean:
		if r.ValueBool == nil {
			return nil
		}
		return *r.ValueBool
	case VehicleSettingKindTimestamp:
		if r.ValueTS == nil {
			return nil
		}
		return r.ValueTS.UTC().Format(time.RFC3339)
	default:
		return nil
	}
}

// Get returns the override row for the given (vehicleID, key) tuple,
// or ErrVehicleSettingNotFound when no row is present. Callers use
// this when they want to inspect a single override; the resolver uses
// List for bulk reads.
func (r *VehicleSettingsRepo) Get(ctx context.Context, vehicleID int64, key string) (*VehicleSettingRow, error) {
	if !IsValidVehicleSettingKey(key) {
		return nil, ErrVehicleSettingInvalidKey
	}
	const q = `
		SELECT vehicle_id, setting_key, data_kind,
		       value_text, value_num, value_bool, value_ts, updated_at
		FROM vehicle_settings
		WHERE vehicle_id = $1 AND setting_key = $2`
	var row VehicleSettingRow
	var kind string
	err := r.db.Pool.QueryRow(ctx, q, vehicleID, key).Scan(
		&row.VehicleID, &row.Key, &kind,
		&row.ValueText, &row.ValueNum, &row.ValueBool, &row.ValueTS, &row.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVehicleSettingNotFound
		}
		return nil, fmt.Errorf("vehicle_settings: get: %w", err)
	}
	row.Kind = VehicleSettingValueKind(kind)
	return &row, nil
}

// List returns every override for vehicleID, keyed by setting_key.
// Returns an empty (non-nil) map when no overrides exist — callers
// can range over the result without a nil-check.
func (r *VehicleSettingsRepo) List(ctx context.Context, vehicleID int64) (map[string]VehicleSettingRow, error) {
	const q = `
		SELECT vehicle_id, setting_key, data_kind,
		       value_text, value_num, value_bool, value_ts, updated_at
		FROM vehicle_settings
		WHERE vehicle_id = $1`
	rows, err := r.db.Pool.Query(ctx, q, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("vehicle_settings: list: %w", err)
	}
	defer rows.Close()
	out := make(map[string]VehicleSettingRow)
	for rows.Next() {
		var row VehicleSettingRow
		var kind string
		if err := rows.Scan(
			&row.VehicleID, &row.Key, &kind,
			&row.ValueText, &row.ValueNum, &row.ValueBool, &row.ValueTS, &row.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("vehicle_settings: scan: %w", err)
		}
		row.Kind = VehicleSettingValueKind(kind)
		out[row.Key] = row
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("vehicle_settings: rows: %w", err)
	}
	return out, nil
}

// Upsert validates the (key, value) pair and writes the override row.
// The other value_* columns are NULLed so data_kind always agrees
// with the populated column. Returns ErrVehicleSettingInvalidKey or
// ErrVehicleSettingInvalidValue on bad input.
//
// `value` MUST be one of: string, float64, bool, time.Time, *time.Time
// — the kind dispatch checks at runtime. The handler decodes JSON
// into the right Go type before calling.
func (r *VehicleSettingsRepo) Upsert(ctx context.Context, vehicleID int64, key string, value any) error {
	def, ok := vehicleSettingDefByKey[key]
	if !ok {
		return ErrVehicleSettingInvalidKey
	}
	if err := def.Validate(value); err != nil {
		return err
	}

	const q = `
		INSERT INTO vehicle_settings (
			vehicle_id, setting_key, data_kind,
			value_text, value_num, value_bool, value_ts, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
		ON CONFLICT (vehicle_id, setting_key) DO UPDATE SET
			data_kind  = EXCLUDED.data_kind,
			value_text = EXCLUDED.value_text,
			value_num  = EXCLUDED.value_num,
			value_bool = EXCLUDED.value_bool,
			value_ts   = EXCLUDED.value_ts,
			updated_at = now()`

	var (
		vText *string
		vNum  *float64
		vBool *bool
		vTS   *time.Time
	)
	switch def.Kind {
	case VehicleSettingKindText:
		s, ok := value.(string)
		if !ok {
			return ErrVehicleSettingInvalidValue
		}
		vText = &s
	case VehicleSettingKindNumber:
		f, ok := value.(float64)
		if !ok {
			return ErrVehicleSettingInvalidValue
		}
		vNum = &f
	case VehicleSettingKindBoolean:
		b, ok := value.(bool)
		if !ok {
			return ErrVehicleSettingInvalidValue
		}
		vBool = &b
	case VehicleSettingKindTimestamp:
		switch tv := value.(type) {
		case time.Time:
			tCopy := tv.UTC()
			vTS = &tCopy
		case *time.Time:
			if tv == nil {
				return ErrVehicleSettingInvalidValue
			}
			tCopy := tv.UTC()
			vTS = &tCopy
		default:
			return ErrVehicleSettingInvalidValue
		}
	default:
		return ErrVehicleSettingInvalidValue
	}

	if _, err := r.db.Pool.Exec(ctx, q, vehicleID, key, string(def.Kind),
		vText, vNum, vBool, vTS); err != nil {
		return fmt.Errorf("vehicle_settings: upsert: %w", err)
	}
	return nil
}

// Delete removes the override row for (vehicleID, key). Returns
// ErrVehicleSettingNotFound when no row matched — the handler maps
// that to 204 (idempotent: caller wanted to revert to the user-level
// fallback, and there was nothing to revert).
func (r *VehicleSettingsRepo) Delete(ctx context.Context, vehicleID int64, key string) error {
	if !IsValidVehicleSettingKey(key) {
		return ErrVehicleSettingInvalidKey
	}
	const q = `DELETE FROM vehicle_settings WHERE vehicle_id = $1 AND setting_key = $2`
	tag, err := r.db.Pool.Exec(ctx, q, vehicleID, key)
	if err != nil {
		return fmt.Errorf("vehicle_settings: delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrVehicleSettingNotFound
	}
	return nil
}

// validateNickname enforces "non-empty, ≤ VehicleNicknameMaxLen runes,
// no leading/trailing whitespace". Empty / whitespace-only nicknames
// would silently render as the vehicle base name and look like a bug
// to the user.
func validateNickname(value any) error {
	s, ok := value.(string)
	if !ok {
		return ErrVehicleSettingInvalidValue
	}
	if s != strings.TrimSpace(s) {
		return ErrVehicleSettingInvalidValue
	}
	if s == "" {
		return ErrVehicleSettingInvalidValue
	}
	// Use rune count not byte count so multi-byte UTF-8 (emoji,
	// non-ASCII) is measured intuitively.
	if runeCount(s) > VehicleNicknameMaxLen {
		return ErrVehicleSettingInvalidValue
	}
	return nil
}

// validateMuteUntil accepts time.Time (any timezone) and rejects the
// zero value. We deliberately do NOT reject past timestamps here —
// the handler may call Upsert with a near-now value and a small clock
// skew would otherwise surface as a 400 in the SPA.
func validateMuteUntil(value any) error {
	switch tv := value.(type) {
	case time.Time:
		if tv.IsZero() {
			return ErrVehicleSettingInvalidValue
		}
		return nil
	case *time.Time:
		if tv == nil || tv.IsZero() {
			return ErrVehicleSettingInvalidValue
		}
		return nil
	default:
		return ErrVehicleSettingInvalidValue
	}
}

// validateChargeCostTariffID accepts any non-empty, ≤ 64-rune ASCII
// string. There is no tariffs table to FK against today; the field stays
// opaque so one can be introduced later without a migration.
func validateChargeCostTariffID(value any) error {
	s, ok := value.(string)
	if !ok {
		return ErrVehicleSettingInvalidValue
	}
	if s != strings.TrimSpace(s) {
		return ErrVehicleSettingInvalidValue
	}
	if s == "" {
		return ErrVehicleSettingInvalidValue
	}
	if runeCount(s) > 64 {
		return ErrVehicleSettingInvalidValue
	}
	return nil
}

// validateEnum builds an enum validator over the supplied allowed
// values. Returned closure captures the slice by reference — safe
// because the package-level allowed slices are append-only literals.
func validateEnum(allowed []string) func(any) error {
	return func(value any) error {
		s, ok := value.(string)
		if !ok {
			return ErrVehicleSettingInvalidValue
		}
		for _, a := range allowed {
			if s == a {
				return nil
			}
		}
		return ErrVehicleSettingInvalidValue
	}
}

// runeCount returns the number of UTF-8 runes in s. Inlined here to
// keep the file dependency-free; equivalent to utf8.RuneCountInString.
func runeCount(s string) int {
	n := 0
	for range s {
		n++
	}
	return n
}
