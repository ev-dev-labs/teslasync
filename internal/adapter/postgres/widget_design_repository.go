package postgres

import (
	"context"
	"errors"
	"fmt"

	port "github.com/ev-dev-labs/teslasync/internal/port/widgetdesign"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type widgetDesignRepository struct{ pool pgxPool }

func NewWidgetDesignRepository(pool *pgxpool.Pool) port.Repository {
	return &widgetDesignRepository{pool: pool}
}

func (r *widgetDesignRepository) Get(ctx context.Context, scope string) (*string, error) {
	var id string
	err := r.pool.QueryRow(ctx,
		`SELECT pack_id FROM widget_design_preferences WHERE subject_scope = $1`, scope).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query widget design preference: %w", err)
	}
	return &id, nil
}

func (r *widgetDesignRepository) Put(ctx context.Context, scope, id string) error {
	_, err := r.pool.Exec(ctx, `INSERT INTO widget_design_preferences (subject_scope, pack_id, updated_at)
		VALUES ($1, $2, CURRENT_TIMESTAMP)
		ON CONFLICT (subject_scope) DO UPDATE SET pack_id = EXCLUDED.pack_id, updated_at = EXCLUDED.updated_at`,
		scope, id)
	if err != nil {
		return fmt.Errorf("upsert widget design preference: %w", err)
	}
	return nil
}
