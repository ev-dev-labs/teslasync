package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/domain/widgetdesign"
	port "github.com/ev-dev-labs/teslasync/internal/port/widgetdesign"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type widgetDesignRepository struct{ pool pgxPool }

func NewWidgetDesignRepository(pool *pgxpool.Pool) port.Repository {
	return &widgetDesignRepository{pool: pool}
}

func (r *widgetDesignRepository) Get(ctx context.Context, scope string) (*widgetdesign.Preference, error) {
	var value widgetdesign.Preference
	err := r.pool.QueryRow(ctx,
		`SELECT pack_id, app_wide FROM widget_design_preferences WHERE subject_scope = $1`, scope).Scan(&value.PackID, &value.AppWide)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query widget design preference: %w", err)
	}
	return &value, nil
}

func (r *widgetDesignRepository) Put(ctx context.Context, scope, id string, appWide *bool) (widgetdesign.Preference, error) {
	var value widgetdesign.Preference
	err := r.pool.QueryRow(ctx, `INSERT INTO widget_design_preferences (subject_scope, pack_id, app_wide, updated_at)
		VALUES ($1, $2, COALESCE($3, false), CURRENT_TIMESTAMP)
		ON CONFLICT (subject_scope) DO UPDATE SET pack_id = EXCLUDED.pack_id,
			app_wide = COALESCE($3, widget_design_preferences.app_wide), updated_at = EXCLUDED.updated_at
		RETURNING pack_id, app_wide`,
		scope, id, appWide).Scan(&value.PackID, &value.AppWide)
	if err != nil {
		return widgetdesign.Preference{}, fmt.Errorf("upsert widget design preference: %w", err)
	}
	return value, nil
}
