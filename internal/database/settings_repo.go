package database

import (
	"context"
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
	}
}

// Get reads every row from the `settings` table and hydrates a typed
// Settings struct keyed by JSON tag. Missing keys fall back to defaults.
func (r *SettingsRepo) Get(ctx context.Context) (*models.Settings, error) {
	const query = `
		SELECT key, value_text, value_num, value_bool, data_kind
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
			dataKind  string
		)
		if err := rows.Scan(&key, &valueText, &valueNum, &valueBool, &dataKind); err != nil {
			return nil, fmt.Errorf("settings get scan: %w", err)
		}
		applySettingsRow(out, key, dataKind, valueText, valueNum, valueBool)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("settings get rows: %w", err)
	}
	return out, nil
}

// applySettingsRow maps one persisted row onto the typed Settings
// struct. Unknown keys are tolerated (forward-compat) and silently
// ignored. NULL value_* columns leave the default in place.
func applySettingsRow(s *models.Settings, key, _ string, vText *string, vNum *float64, vBool *bool) {
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
			value_text = EXCLUDED.value_text,
			value_num  = NULL,
			value_bool = NULL,
			data_kind  = 'text'`
	const upsertNum = `
		INSERT INTO settings (key, value_num, data_kind)
		VALUES ($1, $2, 'number')
		ON CONFLICT (key) DO UPDATE SET
			value_text = NULL,
			value_num  = EXCLUDED.value_num,
			value_bool = NULL,
			data_kind  = 'number'`
	const upsertBool = `
		INSERT INTO settings (key, value_bool, data_kind)
		VALUES ($1, $2, 'boolean')
		ON CONFLICT (key) DO UPDATE SET
			value_text = NULL,
			value_num  = NULL,
			value_bool = EXCLUDED.value_bool,
			data_kind  = 'boolean'`

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
	}
	numRows := []rowNum{
		{"base_cost_per_kwh", s.BaseCostPerKWh},
		{"gas_price_per_unit", s.GasPricePerUnit},
		{"gas_efficiency_mpg", s.GasEfficiencyMPG},
		{"decimal_precision", float64(s.DecimalPrecision)},
	}
	boolRows := []rowBool{
		{"api_suspended", s.APISuspended},
		{"quiet_hours_enabled", s.QuietHoursEnabled},
		{"tab_badge_enabled", s.TabBadgeEnabled},
		{"critical_flash_enabled", s.CriticalFlashEnabled},
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
			value_text = EXCLUDED.value_text,
			value_num  = NULL,
			value_bool = NULL,
			data_kind  = 'text'`
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
