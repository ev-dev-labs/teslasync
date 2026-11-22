package smartfeature

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/domain/smartfeature"
)

type Repository struct{ pool *pgxpool.Pool }

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

func (r *Repository) Preferences(ctx context.Context, subject string) (map[smartfeature.Key]bool, error) {
	rows, err := r.pool.Query(ctx, `SELECT feature, allowed FROM smart_feature_preferences WHERE subject=$1`, subject)
	if err != nil {
		return nil, fmt.Errorf("load smart feature preferences: %w", err)
	}
	defer rows.Close()
	prefs := make(map[smartfeature.Key]bool)
	for rows.Next() {
		var pref smartfeature.Preference
		if err := rows.Scan(&pref.Feature, &pref.Allowed); err != nil {
			return nil, fmt.Errorf("scan smart feature preference: %w", err)
		}
		prefs[pref.Feature] = pref.Allowed
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read smart feature preferences: %w", err)
	}
	return prefs, nil
}

func (r *Repository) SetPreference(ctx context.Context, subject string, pref smartfeature.Preference) error {
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(smart_feature_lock_key($1,$2))`, subject, pref.Feature); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO smart_feature_preferences (subject, feature, allowed, paused_at)
			VALUES ($1, $2, $3, CASE WHEN NOT $3 THEN statement_timestamp() END)
			ON CONFLICT (subject, feature) DO UPDATE SET allowed=EXCLUDED.allowed,
				paused_at=COALESCE(EXCLUDED.paused_at,smart_feature_preferences.paused_at)
			WHERE smart_feature_preferences.allowed IS DISTINCT FROM EXCLUDED.allowed`, subject, pref.Feature, pref.Allowed)
		return err
	})
	if err != nil {
		return fmt.Errorf("save smart feature preference: %w", err)
	}

	return nil
}

func HoldAllowed(ctx context.Context, tx pgx.Tx, subject string, feature smartfeature.Key) (bool, error) {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock_shared(smart_feature_lock_key($1,$2))`, subject, feature); err != nil {
		return false, fmt.Errorf("hold smart feature permission: %w", err)
	}
	var allowed bool
	if err := tx.QueryRow(ctx, `SELECT smart_feature_allowed($1,$2)`, subject, feature).Scan(&allowed); err != nil {
		return false, fmt.Errorf("read held smart feature permission: %w", err)
	}
	return allowed, nil
}

func (r *Repository) Allows(ctx context.Context, subject string, feature smartfeature.Key) (bool, error) {
	var allowed bool
	if err := r.pool.QueryRow(ctx, `SELECT smart_feature_allowed($1, $2)`, subject, feature).Scan(&allowed); err != nil {
		return false, fmt.Errorf("read smart feature permission: %w", err)
	}
	return allowed, nil
}
