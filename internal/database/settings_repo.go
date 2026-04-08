package database

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// SettingsRepo provides settings data access.
type SettingsRepo struct {
	db *DB
}

func NewSettingsRepo(db *DB) *SettingsRepo {
	return &SettingsRepo{db: db}
}

func (r *SettingsRepo) Get(ctx context.Context) (*models.Settings, error) {
	query := `SELECT id, unit_of_length, unit_of_temp, preferred_range, language, base_cost_per_kwh, api_suspended, theme, mode, custom_primary, custom_accent, gas_price_per_unit, gas_unit, gas_efficiency_mpg, decimal_precision, polling_config FROM settings WHERE id = 1`
	s := &models.Settings{}
	var pollingConfigJSON []byte
	err := r.db.Pool.QueryRow(ctx, query).Scan(
		&s.ID, &s.UnitOfLength, &s.UnitOfTemp, &s.PreferredRange, &s.Language, &s.BaseCostPerKWh, &s.APISuspended,
		&s.Theme, &s.Mode, &s.CustomPrimary, &s.CustomAccent, &s.GasPricePerUnit, &s.GasUnit, &s.GasEfficiencyMPG,
		&s.DecimalPrecision, &pollingConfigJSON,
	)
	if err == pgx.ErrNoRows {
		defaults := r.defaults()
		return defaults, nil
	}
	if err != nil {
		return nil, err
	}
	s.PollingConfig = models.DefaultPollingConfig()
	if len(pollingConfigJSON) > 0 && string(pollingConfigJSON) != "{}" {
		json.Unmarshal(pollingConfigJSON, &s.PollingConfig)
	}
	return s, nil
}

func (r *SettingsRepo) Upsert(ctx context.Context, s *models.Settings) error {
	pollingConfigJSON, err := json.Marshal(s.PollingConfig)
	if err != nil {
		return err
	}
	query := `
		INSERT INTO settings (id, unit_of_length, unit_of_temp, preferred_range, language, base_cost_per_kwh, api_suspended, theme, mode, custom_primary, custom_accent, gas_price_per_unit, gas_unit, gas_efficiency_mpg, decimal_precision, polling_config)
		VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		ON CONFLICT (id) DO UPDATE SET
			unit_of_length = EXCLUDED.unit_of_length,
			unit_of_temp = EXCLUDED.unit_of_temp,
			preferred_range = EXCLUDED.preferred_range,
			language = EXCLUDED.language,
			base_cost_per_kwh = EXCLUDED.base_cost_per_kwh,
			api_suspended = EXCLUDED.api_suspended,
			theme = EXCLUDED.theme,
			mode = EXCLUDED.mode,
			custom_primary = EXCLUDED.custom_primary,
			custom_accent = EXCLUDED.custom_accent,
			gas_price_per_unit = EXCLUDED.gas_price_per_unit,
			gas_unit = EXCLUDED.gas_unit,
			gas_efficiency_mpg = EXCLUDED.gas_efficiency_mpg,
			decimal_precision = EXCLUDED.decimal_precision,
			polling_config = EXCLUDED.polling_config`
	_, err = r.db.Pool.Exec(ctx, query, s.UnitOfLength, s.UnitOfTemp, s.PreferredRange, s.Language, s.BaseCostPerKWh, s.APISuspended,
		s.Theme, s.Mode, s.CustomPrimary, s.CustomAccent, s.GasPricePerUnit, s.GasUnit, s.GasEfficiencyMPG, s.DecimalPrecision, pollingConfigJSON)
	return err
}

// IsAPISuspended returns true if the user has suspended all Tesla API calls.
func (r *SettingsRepo) IsAPISuspended(ctx context.Context) (bool, error) {
	var suspended bool
	err := r.db.Pool.QueryRow(ctx, `SELECT api_suspended FROM settings WHERE id = 1`).Scan(&suspended)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	return suspended, err
}

// GetPollingConfig returns the current polling configuration. If no config
// is stored, returns DefaultPollingConfig with all endpoints enabled.
func (r *SettingsRepo) GetPollingConfig(ctx context.Context) (*models.PollingConfig, error) {
	var pollingConfigJSON []byte
	err := r.db.Pool.QueryRow(ctx, `SELECT polling_config FROM settings WHERE id = 1`).Scan(&pollingConfigJSON)
	if err == pgx.ErrNoRows {
		pc := models.DefaultPollingConfig()
		return &pc, nil
	}
	if err != nil {
		return nil, err
	}
	pc := models.DefaultPollingConfig()
	if len(pollingConfigJSON) > 0 && string(pollingConfigJSON) != "{}" {
		json.Unmarshal(pollingConfigJSON, &pc)
	}
	return &pc, nil
}

// UpdatePollingConfig updates only the polling_config column.
func (r *SettingsRepo) UpdatePollingConfig(ctx context.Context, pc *models.PollingConfig) error {
	pollingConfigJSON, err := json.Marshal(pc)
	if err != nil {
		return err
	}
	_, err = r.db.Pool.Exec(ctx, `UPDATE settings SET polling_config = $1 WHERE id = 1`, pollingConfigJSON)
	return err
}

func (r *SettingsRepo) defaults() *models.Settings {
	return &models.Settings{
		ID:               1,
		UnitOfLength:     "km",
		UnitOfTemp:       "C",
		PreferredRange:   "rated",
		Language:         "en",
		Theme:            "neon-cyan",
		Mode:             "dark",
		CustomPrimary:    "#00b4d8",
		CustomAccent:     "#e63946",
		GasPricePerUnit:  3.50,
		GasUnit:          "gallon",
		GasEfficiencyMPG: 25,
		DecimalPrecision: 1,
		PollingConfig:    models.DefaultPollingConfig(),
	}
}
