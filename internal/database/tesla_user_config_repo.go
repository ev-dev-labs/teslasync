package database

import (
	"context"
	"fmt"
	"time"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/jackc/pgx/v5"
)

// TeslaUserConfigRepo provides data access for Tesla user configuration blobs.
type TeslaUserConfigRepo struct {
	db *DB
}

// NewTeslaUserConfigRepo creates a new repository.
func NewTeslaUserConfigRepo(db *DB) *TeslaUserConfigRepo {
	return &TeslaUserConfigRepo{db: db}
}

// GetByType returns the stored config for a given type (e.g. "feature_config", "region").
func (r *TeslaUserConfigRepo) GetByType(ctx context.Context, configType string) (*teslamodel.TeslaUserConfig, error) {
	c := &teslamodel.TeslaUserConfig{}
	query := `SELECT id, config_type, data, fetched_at, created_at, updated_at
		FROM tesla_user_config WHERE config_type = $1`
	err := r.db.Pool.QueryRow(ctx, query, configType).Scan(
		&c.ID, &c.ConfigType, &c.Data, &c.FetchedAt, &c.CreatedAt, &c.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user config %s: %w", configType, err)
	}
	return c, nil
}

// Upsert inserts or updates a config entry by type.
func (r *TeslaUserConfigRepo) Upsert(ctx context.Context, configType string, data string) error {
	now := time.Now().UTC()
	_, err := r.db.Pool.Exec(ctx, `
		INSERT INTO tesla_user_config (config_type, data, fetched_at, created_at, updated_at)
		VALUES ($1, $2, $3, $3, $3)
		ON CONFLICT (config_type) DO UPDATE SET data = $2, fetched_at = $3, updated_at = $3`,
		configType, data, now,
	)
	if err != nil {
		return fmt.Errorf("upsert user config %s: %w", configType, err)
	}
	return nil
}
