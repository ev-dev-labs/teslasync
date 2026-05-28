package export

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// FilterExistingStringIDs returns the subset of `ids` that exist in the
// export_jobs table. Used by the bulk-export handler to surface
// {id, "not_found"} failures without round-tripping per id.
//
// Phase-45 / Prompt 32 — bulk-actions framework. Export-job ids are UUID
// strings rather than int64s, so a separate helper exists rather than
// reusing FilterExistingIDs.
func (r *ExportJobRepo) FilterExistingStringIDs(ctx context.Context, ids []string) ([]string, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.db.Pool.Query(ctx, `SELECT id FROM export_jobs WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, fmt.Errorf("export-jobs-repo-filter-existing: %w", err)
	}
	defer rows.Close()
	out := make([]string, 0, len(ids))
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// BulkDeleteByIDs removes export_jobs whose IDs are in `ids`, all inside a
// single transaction. Returns the rows-affected count. Idempotent for
// missing ids — callers should pre-validate via FilterExistingStringIDs to
// surface partial failures to the client.
func (r *ExportJobRepo) BulkDeleteByIDs(ctx context.Context, ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var deleted int64
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM export_jobs WHERE id = ANY($1)`, ids)
		if err != nil {
			return err
		}
		deleted = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("export-jobs-repo-bulk-delete: %w", err)
	}
	return deleted, nil
}
