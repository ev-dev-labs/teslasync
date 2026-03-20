package database

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/teslasync/teslasync/internal/models"
)

// SettingsRepo provides settings data access.
type SettingsRepo struct {
	db *DB
}

func NewSettingsRepo(db *DB) *SettingsRepo {
	return &SettingsRepo{db: db}
}

func (r *SettingsRepo) Get(ctx context.Context) (*models.Settings, error) {
	query := `SELECT id, unit_of_length, unit_of_temp, preferred_range, language, base_cost_per_kwh FROM settings WHERE id = 1`
	s := &models.Settings{}
	err := r.db.Pool.QueryRow(ctx, query).Scan(
		&s.ID, &s.UnitOfLength, &s.UnitOfTemp, &s.PreferredRange, &s.Language, &s.BaseCostPerKWh,
	)
	if err == pgx.ErrNoRows {
		return &models.Settings{
			ID:             1,
			UnitOfLength:   "km",
			UnitOfTemp:     "C",
			PreferredRange: "rated",
			Language:       "en",
		}, nil
	}
	return s, err
}

func (r *SettingsRepo) Upsert(ctx context.Context, s *models.Settings) error {
	query := `
		INSERT INTO settings (id, unit_of_length, unit_of_temp, preferred_range, language, base_cost_per_kwh)
		VALUES (1, $1, $2, $3, $4, $5)
		ON CONFLICT (id) DO UPDATE SET
			unit_of_length = EXCLUDED.unit_of_length,
			unit_of_temp = EXCLUDED.unit_of_temp,
			preferred_range = EXCLUDED.preferred_range,
			language = EXCLUDED.language,
			base_cost_per_kwh = EXCLUDED.base_cost_per_kwh`
	_, err := r.db.Pool.Exec(ctx, query, s.UnitOfLength, s.UnitOfTemp, s.PreferredRange, s.Language, s.BaseCostPerKWh)
	return err
}
