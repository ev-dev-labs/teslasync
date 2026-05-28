package geofence

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// FilterExistingIDs returns the subset of `ids` that exist in the
// geofences table. Used by the bulk handler to surface {id, "not_found"}
// failures without round-tripping per id.
//
// Phase-45 / Prompt 32 — bulk-actions framework.
func (r *GeofenceRepo) FilterExistingIDs(ctx context.Context, ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.db.Pool.Query(ctx, `SELECT id FROM geofences WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, fmt.Errorf("geofences-repo-filter-existing: %w", err)
	}
	defer rows.Close()
	out := make([]int64, 0, len(ids))
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// BulkDelete removes geofences whose IDs are in `ids`, all inside a single
// transaction. Returns the rows-affected count.
func (r *GeofenceRepo) BulkDelete(ctx context.Context, ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var deleted int64
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM geofences WHERE id = ANY($1)`, ids)
		if err != nil {
			return err
		}
		deleted = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("geofences-repo-bulk-delete: %w", err)
	}
	return deleted, nil
}
