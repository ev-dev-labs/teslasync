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
