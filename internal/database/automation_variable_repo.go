package database

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/jackc/pgx/v5"
)

// AutomationVariableRepo provides key-value storage for cross-automation state.
type AutomationVariableRepo struct {
	db *DB
}

func NewAutomationVariableRepo(db *DB) *AutomationVariableRepo {
	return &AutomationVariableRepo{db: db}
}

func (r *AutomationVariableRepo) Get(ctx context.Context, key string) (*models.AutomationVariable, error) {
	v := &models.AutomationVariable{}
	err := r.db.Pool.QueryRow(ctx,
		`SELECT id, key, value, vehicle_id, updated_at FROM automation_variables WHERE key = $1`, key,
	).Scan(&v.ID, &v.Key, &v.Value, &v.VehicleID, &v.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return v, err
}

func (r *AutomationVariableRepo) Set(ctx context.Context, key, value string, vehicleID *int64) error {
	now := time.Now().UTC()
	_, err := r.db.Pool.Exec(ctx,
		`INSERT INTO automation_variables (key, value, vehicle_id, updated_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (key) DO UPDATE SET value=$2, vehicle_id=$3, updated_at=$4`,
		key, value, vehicleID, now)
	return err
}

func (r *AutomationVariableRepo) Delete(ctx context.Context, key string) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM automation_variables WHERE key = $1`, key)
	return err
}
