package automation

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// FilterExistingIDs returns the subset of `ids` that exist in the
// automations table, in arbitrary order. Used by the bulk handler to
// surface {id, "not_found"} entries without round-tripping per id.
func (r *AutomationRepo) FilterExistingIDs(ctx context.Context, ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.db.Pool.Query(ctx, `SELECT id FROM automations WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, fmt.Errorf("automations-repo-filter-existing: %w", err)
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

// BulkSetEnabled flips `enabled` for every automation in `ids` inside a
// single transaction. Returns the rows-affected count.
func (r *AutomationRepo) BulkSetEnabled(ctx context.Context, ids []int64, enabled bool) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var updated int64
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx,
			`UPDATE automations SET enabled = $1, updated_at = NOW() WHERE id = ANY($2)`,
			enabled, ids,
		)
		if err != nil {
			return err
		}
		updated = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("automations-repo-bulk-set-enabled: %w", err)
	}
	return updated, nil
}

// BulkDelete removes automations whose IDs are in `ids`, all inside a
// single transaction. Child rows (steps, triggers, scope) cascade via FK.
// Callers should pre-validate which ids exist via FilterExistingIDs.
func (r *AutomationRepo) BulkDelete(ctx context.Context, ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var deleted int64
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM automations WHERE id = ANY($1)`, ids)
		if err != nil {
			return err
		}
		deleted = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("automations-repo-bulk-delete: %w", err)
	}
	return deleted, nil
}
