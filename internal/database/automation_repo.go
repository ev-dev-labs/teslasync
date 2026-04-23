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

// Create inserts a new automation parent row and populates the assigned ID
// and timestamps on the supplied model. Per ADR-004, child rows (steps,
// triggers, scope) are persisted by their own repos in separate calls.
func (r *AutomationRepo) Create(ctx context.Context, a *models.Automation) error {
	const query = `
		INSERT INTO automations (name, description, enabled, vehicle_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id, created_at, updated_at`
	if err := r.db.Pool.QueryRow(ctx, query, a.Name, a.Description, a.Enabled, a.VehicleID).
		Scan(&a.ID, &a.CreatedAt, &a.UpdatedAt); err != nil {
		return fmt.Errorf("automations-repo-create: %w", err)
	}
	return nil
}

// Update modifies the mutable parent fields (name, enabled) on an existing
// automation row. Per ADR-004, child rows (steps, triggers, scope) are managed
// by their own repos; this method touches only the automations table.
func (r *AutomationRepo) Update(ctx context.Context, a *models.Automation) error {
	const query = `UPDATE automations SET name = $1, enabled = $2 WHERE id = $3`
	if _, err := r.db.Pool.Exec(ctx, query, a.Name, a.Enabled, a.ID); err != nil {
		return fmt.Errorf("automations-repo-update: %w", err)
	}
	return nil
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

// ListFull returns every automation with its ordered steps fully hydrated.
// CTI child payloads (trigger/condition/action specifics) are intentionally
// not loaded here; callers that need them must use the step-children loader
// (Phase-5 prompts 49-51) per ADR-004. Steps are fetched in a single grouped
// query to avoid per-automation fan-out.
func (r *AutomationRepo) ListFull(ctx context.Context) ([]models.AutomationFull, error) {
	parents, err := r.ListSummaries(ctx)
	if err != nil {
		return nil, fmt.Errorf("automations-repo-list-full: %w", err)
	}
	out := make([]models.AutomationFull, 0, len(parents))
	indexByID := make(map[int64]int, len(parents))
	for i, p := range parents {
		out = append(out, models.AutomationFull{
			Automation: models.Automation{ID: p.ID, Name: p.Name, Enabled: p.Enabled},
			Steps:      []models.AutomationStep{},
		})
		indexByID[p.ID] = i
	}
	if len(parents) == 0 {
		return out, nil
	}

	const stepsQuery = `
		SELECT s.id, s.automation_id, s.step_order, s.kind
		FROM automation_steps s
		JOIN automations a ON a.id = s.automation_id
		ORDER BY s.automation_id, s.step_order`
	rows, err := r.db.Pool.Query(ctx, stepsQuery)
	if err != nil {
		return nil, fmt.Errorf("automations-repo-list-full-steps: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var s models.AutomationStep
		if err := rows.Scan(&s.ID, &s.AutomationID, &s.StepOrder, &s.Kind); err != nil {
			return nil, fmt.Errorf("automations-repo-list-full-steps-scan: %w", err)
		}
		idx, ok := indexByID[s.AutomationID]
		if !ok {
			continue
		}
		out[idx].Steps = append(out[idx].Steps, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("automations-repo-list-full-steps-rows: %w", err)
	}
	return out, nil
}
