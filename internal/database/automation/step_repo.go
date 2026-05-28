package automation

import (
	"context"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/database"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AutomationStepRepo provides data access for the `automation_steps`
// discriminator table. Per ADR-004 each step row is the parent of exactly one
// kind-specific CTI child row (condition, action, delay); those children are
// persisted by their own repos in separate calls.
type AutomationStepRepo struct {
	db *database.DB
}

func NewAutomationStepRepo(db *database.DB) *AutomationStepRepo {
	return &AutomationStepRepo{db: db}
}

// Insert adds a new step row and populates the assigned ID on the supplied
// model. The caller is responsible for inserting the matching CTI child row
// keyed by the returned step ID (ADR-004).
func (r *AutomationStepRepo) Insert(ctx context.Context, s *models.AutomationStep) error {
	return r.InsertTx(ctx, r.db.Pool, s)
}

// InsertTx adds a new step row using the supplied executor. Passing pgx.Tx keeps
// parent automation, discriminator step, and CTI child writes in one transaction.
func (r *AutomationStepRepo) InsertTx(ctx context.Context, exec database.DBTX, s *models.AutomationStep) error {
	const query = `
		INSERT INTO automation_steps (automation_id, step_order, kind)
		VALUES ($1, $2, $3)
		RETURNING id`
	if err := exec.QueryRow(ctx, query, s.AutomationID, s.StepOrder, s.Kind).
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

// ListByAutomation returns all steps for the given automation in step_order
// ascending. Per ADR-004 the CTI child rows (condition, action, delay) are
// loaded by a separate UNION hydrator wired in by the orchestrating service;
// this method returns the discriminator rows only.
func (r *AutomationStepRepo) ListByAutomation(ctx context.Context, automationID int64) ([]models.AutomationStep, error) {
	const query = `
		SELECT id, automation_id, kind, step_order
		FROM automation_steps
		WHERE automation_id = $1
		ORDER BY step_order`
	rows, err := r.db.Pool.Query(ctx, query, automationID)
	if err != nil {
		return nil, fmt.Errorf("automation-steps-repo-list-by-automation: %w", err)
	}
	defer rows.Close()

	var out []models.AutomationStep
	for rows.Next() {
		var s models.AutomationStep
		if err := rows.Scan(&s.ID, &s.AutomationID, &s.Kind, &s.StepOrder); err != nil {
			return nil, fmt.Errorf("automation-steps-repo-list-by-automation: scan: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("automation-steps-repo-list-by-automation: rows: %w", err)
	}
	return out, nil
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

// DeleteByAutomationTx removes all step discriminator rows for an automation
// using the supplied transaction/executor. CTI child rows are removed by FK
// cascade from automation_steps.
func (r *AutomationStepRepo) DeleteByAutomationTx(ctx context.Context, exec database.DBTX, automationID int64) error {
	const query = `DELETE FROM automation_steps WHERE automation_id = $1`
	if _, err := exec.Exec(ctx, query, automationID); err != nil {
		return fmt.Errorf("automation-steps-repo-delete-by-automation: %w", err)
	}
	return nil
}
