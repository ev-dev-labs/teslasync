package database

import (
	"context"

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
	query := `SELECT id, unit_of_length, unit_of_temp, preferred_range, language, base_cost_per_kwh, api_suspended, theme, mode, custom_primary, custom_accent FROM settings WHERE id = 1`
	s := &models.Settings{}
	err := r.db.Pool.QueryRow(ctx, query).Scan(
		&s.ID, &s.UnitOfLength, &s.UnitOfTemp, &s.PreferredRange, &s.Language, &s.BaseCostPerKWh, &s.APISuspended,
		&s.Theme, &s.Mode, &s.CustomPrimary, &s.CustomAccent,
	)
	if err == pgx.ErrNoRows {
		return &models.Settings{
			ID:             1,
			UnitOfLength:   "km",
			UnitOfTemp:     "C",
			PreferredRange: "rated",
			Language:       "en",
			Theme:          "neon-cyan",
			Mode:           "dark",
			CustomPrimary:  "#00b4d8",
			CustomAccent:   "#e63946",
		}, nil
	}
	return s, err
}

func (r *SettingsRepo) Upsert(ctx context.Context, s *models.Settings) error {
	query := `
		INSERT INTO settings (id, unit_of_length, unit_of_temp, preferred_range, language, base_cost_per_kwh, api_suspended, theme, mode, custom_primary, custom_accent)
		VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
			custom_accent = EXCLUDED.custom_accent`
	_, err := r.db.Pool.Exec(ctx, query, s.UnitOfLength, s.UnitOfTemp, s.PreferredRange, s.Language, s.BaseCostPerKWh, s.APISuspended,
		s.Theme, s.Mode, s.CustomPrimary, s.CustomAccent)
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
