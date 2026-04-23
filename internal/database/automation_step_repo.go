package database

import (
	"context"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AutomationStepRepo provides data access for the `automation_steps`
// discriminator table. Per ADR-004 each step row is the parent of exactly one
// kind-specific CTI child row (condition, action, delay); those children are
// persisted by their own repos in separate calls.
type AutomationStepRepo struct {
	db *DB
}

func NewAutomationStepRepo(db *DB) *AutomationStepRepo {
	return &AutomationStepRepo{db: db}
}

// Insert adds a new step row and populates the assigned ID on the supplied
// model. The caller is responsible for inserting the matching CTI child row
// keyed by the returned step ID (ADR-004).
func (r *AutomationStepRepo) Insert(ctx context.Context, s *models.AutomationStep) error {
	const query = `
		INSERT INTO automation_steps (automation_id, step_order, kind)
		VALUES ($1, $2, $3)
		RETURNING id`
	if err := r.db.Pool.QueryRow(ctx, query, s.AutomationID, s.StepOrder, s.Kind).
		Scan(&s.ID); err != nil {
		return fmt.Errorf("automation-steps-repo-insert: %w", err)
	}
	return nil
}

// UpdateOrder reorders steps within a single automation in one transaction.
// Each entry in `ordering` is a (stepID, step_order) tuple; the automationID
// scope guard prevents callers from accidentally renumbering steps that belong
// to a different automation.
func (r *AutomationStepRepo) UpdateOrder(ctx context.Context, automationID int64, ordering []models.StepOrdering) error {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("automation-steps-repo-update-order: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	const query = `UPDATE automation_steps SET step_order=$1 WHERE id=$2 AND automation_id=$3`
	for _, o := range ordering {
		if _, err := tx.Exec(ctx, query, o.StepOrder, o.ID, automationID); err != nil {
			return fmt.Errorf("automation-steps-repo-update-order: step %d: %w", o.ID, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("automation-steps-repo-update-order: commit: %w", err)
	}
	return nil
}

// Delete removes a single step row. The matching CTI child row (condition,
// action, or delay) is removed automatically by the FK ON DELETE CASCADE
// declared in the phase-3 schema (ADR-004).
func (r *AutomationStepRepo) Delete(ctx context.Context, stepID int64) error {
	const query = `DELETE FROM automation_steps WHERE id=$1`
	if _, err := r.db.Pool.Exec(ctx, query, stepID); err != nil {
		return fmt.Errorf("automation-steps-repo-delete: %w", err)
	}
	return nil
}
