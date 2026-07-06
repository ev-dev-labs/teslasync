package geofence

import (
	"context"
	"fmt"
)

// FilterExistingIDs returns the subset of `ids` that exist in the
// geofences table. Used by the bulk handler to surface {id, "not_found"}
// failures without round-tripping per id.
func (r *GeofenceRepo) FilterExistingIDs(ctx context.Context, ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.pool.Query(ctx, `SELECT id FROM geofences WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, fmt.Errorf("geofences-repo-filter-existing: %w", err)
	}
	defer rows.Close()
	out := make([]int64, 0, len(ids))
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("geofences-repo-filter-existing scan: %w", err)
		}
		out = append(out, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("geofences-repo-filter-existing iter: %w", err)
	}
	return out, nil
}

// BulkDelete removes geofences whose IDs are in `ids`, all inside a single
// transaction. Returns the rows-affected count.
//
// The DELETE runs in an explicit transaction so a caller that later chains
// additional statements (e.g. an audit write) can share the same fate; the
// deferred Rollback is a no-op once Commit succeeds.
func (r *GeofenceRepo) BulkDelete(ctx context.Context, ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("geofences-repo-bulk-delete begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `DELETE FROM geofences WHERE id = ANY($1)`, ids)
	if err != nil {
		return 0, fmt.Errorf("geofences-repo-bulk-delete: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("geofences-repo-bulk-delete commit: %w", err)
	}
	return tag.RowsAffected(), nil
}
