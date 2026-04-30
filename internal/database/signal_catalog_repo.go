package database

import (
	"context"
	"fmt"
	"strings"

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

// BulkUpsertObserved registers a batch of newly-observed signal names in
// signal_catalog with a single round-trip, leaving classification fields
// (storage_tier, typed_table, ...) at their schema defaults. Names that
// already exist are left untouched. Returns the number of newly-inserted
// rows.
//
// This is the ADR-009 hot-path onboarding ritual called once per ingest
// batch, before signal_observations rows are inserted, so the FK from
// signal_observations.signal_name -> signal_catalog.name resolves.
func (r *SignalCatalogRepo) BulkUpsertObserved(ctx context.Context, names []string) (int, error) {
	if len(names) == 0 {
		return 0, nil
	}
	var b strings.Builder
	b.Grow(64 + len(names)*8)
	b.WriteString("INSERT INTO signal_catalog (name) VALUES ")
	args := make([]any, len(names))
	for i, n := range names {
		if i > 0 {
			b.WriteString(", ")
		}
		fmt.Fprintf(&b, "($%d)", i+1)
		args[i] = n
	}
	b.WriteString(" ON CONFLICT (name) DO NOTHING RETURNING name")

	rows, err := r.db.Pool.Query(ctx, b.String(), args...)
	if err != nil {
		return 0, fmt.Errorf("signal-catalog-repo-bulk-upsert-observed: %w", err)
	}
	defer rows.Close()
	newCount := 0
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return newCount, fmt.Errorf("signal-catalog-repo-bulk-upsert-observed-scan: %w", err)
		}
		newCount++
	}
	if err := rows.Err(); err != nil {
		return newCount, fmt.Errorf("signal-catalog-repo-bulk-upsert-observed-rows: %w", err)
	}
	return newCount, nil
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

// GetIDByName returns the surrogate id for the given canonical signal
// name, or 0 if no such row exists. ADR-009 ingest hot path uses this to
// translate a name to its stable id once and cache the result, avoiding
// per-observation text comparisons in tight inner loops.
func (r *SignalCatalogRepo) GetIDByName(ctx context.Context, name string) (int64, error) {
	var id int64
	err := r.db.Pool.QueryRow(ctx, `SELECT id FROM signal_catalog WHERE name = $1`, name).Scan(&id)
	if err == pgx.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("signal-catalog-repo-get-id-by-name %s: %w", name, err)
	}
	return id, nil
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
