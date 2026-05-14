package database

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// SettingsRepo provides settings data access over the typed key/value
// `settings` table introduced by migration 000142.
//
// ADR-011 Option A — typed-struct facade.
//
// Callers continue to operate on a single *models.Settings value; the
// repo is responsible for hydrating that struct from N rows of the
// `settings` table on read and decomposing it back into N upserts on
// write. Each setting is one row keyed by its JSON tag, with `data_kind`
// selecting which value_* column is meaningful (text / number / boolean).
//
// Per-vehicle polling tuning is intentionally NOT modeled here — it
// lives in the sibling `polling_config` table and is owned by
// PollingConfigRepo. The pre-refactor `polling_config` JSONB column on
// the wide settings row no longer exists (ADR-001, ADR-005, ADR-011).
type SettingsRepo struct {
	db *DB
}

func NewSettingsRepo(db *DB) *SettingsRepo {
	return &SettingsRepo{db: db}
}

// settingsDefaults returns a fully-populated Settings with the same
// defaults the pre-refactor wide-row schema used. Get() overlays stored
// rows on top of this baseline so missing keys fall back to these
// values without an extra round-trip.
func settingsDefaults() *models.Settings {
	return &models.Settings{
		UnitOfLength:         "km",
		UnitOfTemp:           "C",
		UnitOfPressure:       "bar",
		PreferredRange:       "rated",
		Language:             "en",
		BaseCostPerKWh:       0,
		APISuspended:         false,
		Theme:                "neon-cyan",
		Mode:                 "dark",
		CustomPrimary:        "#00b4d8",
		CustomAccent:         "#e63946",
		GasPricePerUnit:      3.50,
		GasUnit:              "gallon",
		GasEfficiencyMPG:     25,
		DecimalPrecision:     1,
		QuietHoursEnabled:    false,
		QuietHoursStart:      "22:00",
		QuietHoursEnd:        "07:00",
		AlertDigestMode:      "instant",
		CurrencySymbol:       "$",
		Locale:               "en-US",
		TzDisplayDefault:     "vehicle",
		TimezoneUser:         "",
		TabBadgeEnabled:      true,
		CriticalFlashEnabled: true,
		UIDensity:            "comfortable",
		TimeFormatDefault:    "relative",
		ChartPalette:         "cb_safe",
		// ADR-015: AI is strictly additive and default-off. A struct
		// freshly built from defaults must satisfy `AIMode=='off'`
		// AND `AIFeatures` must be a non-nil empty map so callers can
		// safely lookup feature IDs without a nil-map panic.
		AIMode:           "off",
		AIFeatures:       map[string]bool{},
		AIProviderConfig: map[string]any{},
		AICostCapCents:   0,
	}
}

// Get reads every row from the `settings` table and hydrates a typed
// Settings struct keyed by JSON tag. Missing keys fall back to defaults.
func (r *SettingsRepo) Get(ctx context.Context) (*models.Settings, error) {
	const query = `
		SELECT key, value_text, value_num, value_bool, value_jsonb, data_kind
		FROM settings`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("settings get query: %w", err)
	}
	defer rows.Close()

	out := settingsDefaults()
	for rows.Next() {
		var (
			key       string
			valueText *string
			valueNum  *float64
			valueBool *bool
			valueJSON []byte
			dataKind  string
		)
		if err := rows.Scan(&key, &valueText, &valueNum, &valueBool, &valueJSON, &dataKind); err != nil {
			return nil, fmt.Errorf("settings get scan: %w", err)
		}
		applySettingsRow(out, key, dataKind, valueText, valueNum, valueBool, valueJSON)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("settings get rows: %w", err)
	}
	return out, nil
}

// applySettingsRow maps one persisted row onto the typed Settings
// struct. Unknown keys are tolerated (forward-compat) and silently
// ignored. NULL value_* columns leave the default in place.
func applySettingsRow(s *models.Settings, key, _ string, vText *string, vNum *float64, vBool *bool, vJSON []byte) {
	switch key {
	case "unit_of_length":
		if vText != nil {
			s.UnitOfLength = *vText
		}
	case "unit_of_temp":
		if vText != nil {
			s.UnitOfTemp = *vText
		}
	case "unit_of_pressure":
		if vText != nil {
			s.UnitOfPressure = *vText
		}
	case "preferred_range":
		if vText != nil {
			s.PreferredRange = *vText
		}
	case "language":
		if vText != nil {
			s.Language = *vText
		}
	case "base_cost_per_kwh":
		if vNum != nil {
			s.BaseCostPerKWh = *vNum
		}
	case "api_suspended":
		if vBool != nil {
			s.APISuspended = *vBool
		}
	case "theme":
		if vText != nil {
			s.Theme = *vText
		}
	case "mode":
		if vText != nil {
			s.Mode = *vText
		}
	case "custom_primary":
		if vText != nil {
			s.CustomPrimary = *vText
		}
	case "custom_accent":
		if vText != nil {
			s.CustomAccent = *vText
		}
	case "gas_price_per_unit":
		if vNum != nil {
			s.GasPricePerUnit = *vNum
		}
	case "gas_unit":
		if vText != nil {
			s.GasUnit = *vText
		}
	case "gas_efficiency_mpg":
		if vNum != nil {
			s.GasEfficiencyMPG = *vNum
		}
	case "decimal_precision":
		if vNum != nil {
			s.DecimalPrecision = int(*vNum)
		}
	case "quiet_hours_enabled":
		if vBool != nil {
			s.QuietHoursEnabled = *vBool
		}
	case "quiet_hours_start":
		if vText != nil {
			s.QuietHoursStart = *vText
		}
	case "quiet_hours_end":
		if vText != nil {
			s.QuietHoursEnd = *vText
		}
	case "alert_digest_mode":
		if vText != nil {
			s.AlertDigestMode = *vText
		}
	case "currency_symbol":
		if vText != nil {
			s.CurrencySymbol = *vText
		}
	case "locale":
		if vText != nil {
			s.Locale = *vText
		}
	case "tz_display_default":
		if vText != nil {
			s.TzDisplayDefault = *vText
		}
	case "timezone_user":
		if vText != nil {
			s.TimezoneUser = *vText
		}
	case "tab_badge_enabled":
		if vBool != nil {
			s.TabBadgeEnabled = *vBool
		}
	case "critical_flash_enabled":
		if vBool != nil {
			s.CriticalFlashEnabled = *vBool
		}
	case "ui_density":
		if vText != nil {
			s.UIDensity = *vText
		}
	case "time_format_default":
		if vText != nil {
			s.TimeFormatDefault = *vText
		}
	case "chart_palette":
		if vText != nil {
			s.ChartPalette = *vText
		}
	case "ai_mode":
		if vText != nil {
			s.AIMode = *vText
		}
	case "ai_features":
		if len(vJSON) > 0 {
			m := map[string]bool{}
			if err := json.Unmarshal(vJSON, &m); err == nil {
				s.AIFeatures = m
			}
		}
	case "ai_provider_config":
		if len(vJSON) > 0 {
			m := map[string]any{}
			if err := json.Unmarshal(vJSON, &m); err == nil {
				s.AIProviderConfig = m
			}
		}
	case "ai_cost_cap_cents":
		if vNum != nil {
			s.AICostCapCents = int(*vNum)
		}
	}
}

// Upsert decomposes a Settings struct into N upserts (one per scalar
// field) executed inside a single transaction. Either all fields are
// persisted or none are. Each upsert clears the sibling value_* columns
// so `data_kind` always agrees with the populated column.
func (r *SettingsRepo) Upsert(ctx context.Context, s *models.Settings) error {
	if s == nil {
		return errors.New("settings upsert: nil settings")
	}
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("settings upsert begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const upsertText = `
		INSERT INTO settings (key, value_text, data_kind)
		VALUES ($1, $2, 'text')
		ON CONFLICT (key) DO UPDATE SET
			value_text  = EXCLUDED.value_text,
			value_num   = NULL,
			value_bool  = NULL,
			value_jsonb = NULL,
			data_kind   = 'text'`
	const upsertNum = `
		INSERT INTO settings (key, value_num, data_kind)
		VALUES ($1, $2, 'number')
		ON CONFLICT (key) DO UPDATE SET
			value_text  = NULL,
			value_num   = EXCLUDED.value_num,
			value_bool  = NULL,
			value_jsonb = NULL,
			data_kind   = 'number'`
	const upsertBool = `
		INSERT INTO settings (key, value_bool, data_kind)
		VALUES ($1, $2, 'boolean')
		ON CONFLICT (key) DO UPDATE SET
			value_text  = NULL,
			value_num   = NULL,
			value_bool  = EXCLUDED.value_bool,
			value_jsonb = NULL,
			data_kind   = 'boolean'`
	const upsertJSONB = `
		INSERT INTO settings (key, value_jsonb, data_kind)
		VALUES ($1, $2::jsonb, 'jsonb')
		ON CONFLICT (key) DO UPDATE SET
			value_text  = NULL,
			value_num   = NULL,
			value_bool  = NULL,
			value_jsonb = EXCLUDED.value_jsonb,
			data_kind   = 'jsonb'`

	type rowText struct {
		key, value string
	}
	type rowNum struct {
		key   string
		value float64
	}
	type rowBool struct {
		key   string
		value bool
	}
	type rowJSONB struct {
		key   string
		value string // raw JSON text; pgx encodes as jsonb via the cast in upsertJSONB
	}

	textRows := []rowText{
		{"unit_of_length", s.UnitOfLength},
		{"unit_of_temp", s.UnitOfTemp},
		{"unit_of_pressure", s.UnitOfPressure},
		{"preferred_range", s.PreferredRange},
		{"language", s.Language},
		{"theme", s.Theme},
		{"mode", s.Mode},
		{"custom_primary", s.CustomPrimary},
		{"custom_accent", s.CustomAccent},
		{"gas_unit", s.GasUnit},
		{"quiet_hours_start", s.QuietHoursStart},
		{"quiet_hours_end", s.QuietHoursEnd},
		{"alert_digest_mode", s.AlertDigestMode},
		{"currency_symbol", s.CurrencySymbol},
		{"locale", s.Locale},
		{"tz_display_default", s.TzDisplayDefault},
		{"timezone_user", s.TimezoneUser},
		{"ui_density", s.UIDensity},
		{"time_format_default", s.TimeFormatDefault},
		{"chart_palette", s.ChartPalette},
		// ADR-015: ai_mode is the top-level AI gate. Validation
		// (one of 'off' / 'local' / 'cloud') happens in the
		// settings handler before reaching this layer.
		{"ai_mode", s.AIMode},
	}
	numRows := []rowNum{
		{"base_cost_per_kwh", s.BaseCostPerKWh},
		{"gas_price_per_unit", s.GasPricePerUnit},
		{"gas_efficiency_mpg", s.GasEfficiencyMPG},
		{"decimal_precision", float64(s.DecimalPrecision)},
		{"ai_cost_cap_cents", float64(s.AICostCapCents)},
	}
	boolRows := []rowBool{
		{"api_suspended", s.APISuspended},
		{"quiet_hours_enabled", s.QuietHoursEnabled},
		{"tab_badge_enabled", s.TabBadgeEnabled},
		{"critical_flash_enabled", s.CriticalFlashEnabled},
	}

	// JSONB rows. Empty maps marshal to "{}" — match the migration
	// default so a round-trip of a defaults Settings stays a no-op.
	aiFeaturesJSON, err := marshalJSONOrEmpty(s.AIFeatures)
	if err != nil {
		return fmt.Errorf("settings upsert ai_features marshal: %w", err)
	}
	aiProviderJSON, err := marshalJSONOrEmpty(s.AIProviderConfig)
	if err != nil {
		return fmt.Errorf("settings upsert ai_provider_config marshal: %w", err)
	}
	jsonbRows := []rowJSONB{
		{"ai_features", aiFeaturesJSON},
		{"ai_provider_config", aiProviderJSON},
	}

	for _, rw := range textRows {
		if _, err := tx.Exec(ctx, upsertText, rw.key, rw.value); err != nil {
			return fmt.Errorf("settings upsert %s: %w", rw.key, err)
		}
	}
	for _, rw := range numRows {
		if _, err := tx.Exec(ctx, upsertNum, rw.key, rw.value); err != nil {
			return fmt.Errorf("settings upsert %s: %w", rw.key, err)
		}
	}
	for _, rw := range boolRows {
		if _, err := tx.Exec(ctx, upsertBool, rw.key, rw.value); err != nil {
			return fmt.Errorf("settings upsert %s: %w", rw.key, err)
		}
	}
	for _, rw := range jsonbRows {
		if _, err := tx.Exec(ctx, upsertJSONB, rw.key, rw.value); err != nil {
			return fmt.Errorf("settings upsert %s: %w", rw.key, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("settings upsert commit: %w", err)
	}
	return nil
}

// IsAPISuspended returns true if the user has globally suspended Tesla
// Fleet API polling. Reads the single `api_suspended` row.
func (r *SettingsRepo) IsAPISuspended(ctx context.Context) (bool, error) {
	const query = `SELECT value_bool FROM settings WHERE key = 'api_suspended'`
	var suspended *bool
	err := r.db.Pool.QueryRow(ctx, query).Scan(&suspended)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("settings is_api_suspended: %w", err)
	}
	if suspended == nil {
		return false, nil
	}
	return *suspended, nil
}

// GetDashboardLayouts reads the raw JSON stored under key "dashboard_layouts".
// Returns empty string if the key does not exist.
func (r *SettingsRepo) GetDashboardLayouts(ctx context.Context) (string, error) {
	const query = `SELECT value_text FROM settings WHERE key = 'dashboard_layouts'`
	var valueText *string
	err := r.db.Pool.QueryRow(ctx, query).Scan(&valueText)
	if errors.Is(err, pgx.ErrNoRows) || valueText == nil {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("settings get_dashboard_layouts: %w", err)
	}
	return *valueText, nil
}

// UpsertDashboardLayouts stores the raw JSON string under key "dashboard_layouts".
func (r *SettingsRepo) UpsertDashboardLayouts(ctx context.Context, jsonStr string) error {
	const query = `
		INSERT INTO settings (key, value_text, data_kind)
		VALUES ('dashboard_layouts', $1, 'text')
		ON CONFLICT (key) DO UPDATE SET
			value_text  = EXCLUDED.value_text,
			value_num   = NULL,
			value_bool  = NULL,
			value_jsonb = NULL,
			data_kind   = 'text'`
	if _, err := r.db.Pool.Exec(ctx, query, jsonStr); err != nil {
		return fmt.Errorf("settings upsert_dashboard_layouts: %w", err)
	}
	return nil
}

// GetPollingConfig returns the first polling configuration row, or nil if
// the polling_config table is empty. The action.SettingsChecker interface
// uses this to retrieve timing parameters for command wake-up sequences.
func (r *SettingsRepo) GetPollingConfig(ctx context.Context) (*models.PollingConfig, error) {
	const query = `
		SELECT vehicle_id, awake_interval_sec, asleep_interval_sec,
		       driving_interval_sec, enabled, created_at, updated_at
		FROM polling_config
		LIMIT 1`
	pc := &models.PollingConfig{}
	err := r.db.Pool.QueryRow(ctx, query).Scan(
		&pc.VehicleID, &pc.AwakeIntervalSec, &pc.AsleepIntervalSec,
		&pc.DrivingIntervalSec, &pc.Enabled, &pc.CreatedAt, &pc.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("settings get_polling_config: %w", err)
	}
	return pc, nil
}

// AIMode returns the current top-level AI feature gate
// (one of "off" / "local" / "cloud"). When the row is missing — for
// example on a fresh DB before migration 000201 has run — the
// default-off contract (ADR-015 §I1) is preserved by returning "off".
//
// This single-tenant accessor is the read path used by
// internal/ai/guard.Wrap; it is intentionally cheap (single-row
// PK lookup, no allocation in the hot path) so the guard adds
// negligible per-request overhead.
func (r *SettingsRepo) AIMode(ctx context.Context) (string, error) {
	const query = `SELECT value_text FROM settings WHERE key = 'ai_mode'`
	var v *string
	err := r.db.Pool.QueryRow(ctx, query).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return "off", nil
	}
	if err != nil {
		return "off", fmt.Errorf("settings ai_mode: %w", err)
	}
	if v == nil || *v == "" {
		return "off", nil
	}
	return *v, nil
}

// AIFeatureEnabled reports whether the named AI feature is opted-in
// for the current installation. The feature is enabled iff the
// `ai_features` JSONB row contains `{"<featureID>": true}` AND the
// top-level `ai_mode` is not "off". When either condition fails the
// caller MUST treat the feature as disabled (ADR-015 §I7).
//
// Missing row, missing key, or any decode failure resolves to false —
// the contract is fail-closed.
func (r *SettingsRepo) AIFeatureEnabled(ctx context.Context, featureID string) (bool, error) {
	if featureID == "" {
		return false, nil
	}
	mode, err := r.AIMode(ctx)
	if err != nil {
		return false, err
	}
	if mode == "off" {
		return false, nil
	}
	const query = `SELECT value_jsonb FROM settings WHERE key = 'ai_features'`
	var raw []byte
	err = r.db.Pool.QueryRow(ctx, query).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) || len(raw) == 0 {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("settings ai_features: %w", err)
	}
	m := map[string]bool{}
	if err := json.Unmarshal(raw, &m); err != nil {
		return false, nil
	}
	return m[featureID], nil
}

// marshalJSONOrEmpty serialises v to JSON, returning "{}" for nil
// maps so the JSONB columns always carry a parseable document. The
// only error path is a value with an unmarshalable type, which is
// not reachable for the typed maps in models.Settings.
func marshalJSONOrEmpty(v any) (string, error) {
	if v == nil {
		return "{}", nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	if len(b) == 0 || string(b) == "null" {
		return "{}", nil
	}
	return string(b), nil
}
