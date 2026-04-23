package database

import (
	"context"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AutomationRepo provides automation data access operations against the
// post-migration `automations` table. Per ADR-004 the typed CTI children
// (steps, triggers, scope) are loaded by their own repos; methods here
// operate only on the automations row itself.
type AutomationRepo struct {
	db *DB
}

func NewAutomationRepo(db *DB) *AutomationRepo {
	return &AutomationRepo{db: db}
}

// ListSummaries returns lightweight automation summaries (id, name, enabled)
// suitable for list views. Steps, triggers, and scope are intentionally not
// loaded; callers needing the full aggregate should use GetByID.
func (r *AutomationRepo) ListSummaries(ctx context.Context) ([]models.AutomationSummary, error) {
	const query = `SELECT id, name, enabled FROM automations ORDER BY name`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("automations-repo-list-summaries: %w", err)
	}
	defer rows.Close()

	var out []models.AutomationSummary
	for rows.Next() {
		var s models.AutomationSummary
		if err := rows.Scan(&s.ID, &s.Name, &s.Enabled); err != nil {
			return nil, fmt.Errorf("automations-repo-list-summaries-scan: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("automations-repo-list-summaries-rows: %w", err)
	}
	return out, nil
}
