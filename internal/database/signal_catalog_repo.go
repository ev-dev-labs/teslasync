package database

import (
	"context"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/jackc/pgx/v5"
)

// SignalCatalogRepo provides data access for the signal_catalog registry
// table (ADR-009 onboarding source of truth).
type SignalCatalogRepo struct {
	db *DB
}

// NewSignalCatalogRepo constructs a SignalCatalogRepo bound to db.
func NewSignalCatalogRepo(db *DB) *SignalCatalogRepo {
	return &SignalCatalogRepo{db: db}
}

// BulkUpsert inserts or updates a batch of signal_catalog rows keyed by
// name (the table's PRIMARY KEY). On conflict, the mutable classification
// fields (storage_tier, typed_table, typed_column, data_kind, unit, notes)
// are refreshed from the supplied definition; the immutable counters
// (first_seen_at, observation_count) are preserved by the database.
//
// Implements the ADR-009 onboarding ritual: every signal name ever seen
// must exist here before signal_observations rows can FK to it.
func (r *SignalCatalogRepo) BulkUpsert(ctx context.Context, defs []models.SignalCatalog) error {
	if len(defs) == 0 {
		return nil
	}
	const q = `
INSERT INTO signal_catalog (name, storage_tier, typed_table, typed_column, data_kind, unit, notes)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (name) DO UPDATE SET
  storage_tier = EXCLUDED.storage_tier,
  typed_table  = EXCLUDED.typed_table,
  typed_column = EXCLUDED.typed_column,
  data_kind    = EXCLUDED.data_kind,
  unit         = EXCLUDED.unit,
  notes        = EXCLUDED.notes`
	for _, d := range defs {
		if _, err := r.db.Pool.Exec(ctx, q,
			d.Name,
			d.StorageTier,
			d.TypedTable,
			d.TypedColumn,
			d.DataKind,
			d.Unit,
			d.Notes,
		); err != nil {
			return fmt.Errorf("signal-catalog-repo-bulk-upsert %s: %w", d.Name, err)
		}
	}
	return nil
}

// List returns the full signal_catalog ordered by name.
func (r *SignalCatalogRepo) List(ctx context.Context) ([]models.SignalCatalog, error) {
	const q = `
SELECT name, first_seen_at, last_seen_at, observation_count,
       storage_tier, typed_table, typed_column, data_kind, unit, notes,
       created_at, updated_at
FROM signal_catalog
ORDER BY name`
	rows, err := r.db.Pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("signal-catalog-repo-list: %w", err)
	}
	defer rows.Close()
	var out []models.SignalCatalog
	for rows.Next() {
		var c models.SignalCatalog
		if err := rows.Scan(
			&c.Name,
			&c.FirstSeenAt,
			&c.LastSeenAt,
			&c.ObservationCount,
			&c.StorageTier,
			&c.TypedTable,
			&c.TypedColumn,
			&c.DataKind,
			&c.Unit,
			&c.Notes,
			&c.CreatedAt,
			&c.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("signal-catalog-repo-list-scan: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("signal-catalog-repo-list-rows: %w", err)
	}
	return out, nil
}

// GetByName returns the signal_catalog row for the given canonical name,
// or (nil, nil) if no such row exists. ADR-009: signal names are the
// stable identity for both ingestion and downstream typed promotion.
func (r *SignalCatalogRepo) GetByName(ctx context.Context, name string) (*models.SignalCatalog, error) {
	const q = `
SELECT name, first_seen_at, last_seen_at, observation_count,
       storage_tier, typed_table, typed_column, data_kind, unit, notes,
       created_at, updated_at
FROM signal_catalog
WHERE name = $1`
	var c models.SignalCatalog
	err := r.db.Pool.QueryRow(ctx, q, name).Scan(
		&c.Name,
		&c.FirstSeenAt,
		&c.LastSeenAt,
		&c.ObservationCount,
		&c.StorageTier,
		&c.TypedTable,
		&c.TypedColumn,
		&c.DataKind,
		&c.Unit,
		&c.Notes,
		&c.CreatedAt,
		&c.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("signal-catalog-repo-get-by-name %s: %w", name, err)
	}
	return &c, nil
}
