package automation

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// Create inserts a new automation parent row and populates the assigned ID
// and timestamps on the supplied model. Per ADR-004, child rows (steps,
// triggers, scope) are persisted by their own repos in separate calls.
func (r *AutomationRepo) Create(ctx context.Context, a *models.Automation) error {
	return r.createTx(ctx, r.db.Pool, a)
}

func (r *AutomationRepo) createTx(ctx context.Context, exec database.DBTX, a *models.Automation) error {
	const query = `
		INSERT INTO automations (name, description, enabled, vehicle_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id, created_at, updated_at`
	if err := exec.QueryRow(ctx, query, a.Name, a.Description, a.Enabled, a.VehicleID).
		Scan(&a.ID, &a.CreatedAt, &a.UpdatedAt); err != nil {
		return fmt.Errorf("automations-repo-create: %w", err)
	}
	return nil
}

// CreateWithSteps persists a full automation aggregate in one transaction:
// parent automations row, automation_steps discriminator rows, and exactly one
// matching CTI child row for each accepted typed step.
func (r *AutomationRepo) CreateWithSteps(ctx context.Context, a *models.Automation, steps []AutomationStepWrite) error {
	if err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if err := r.createTx(ctx, tx, a); err != nil {
			return err
		}
		return r.insertStepsTx(ctx, tx, a.ID, steps)
	}); err != nil {
		return fmt.Errorf("automations-repo-create-with-steps transaction: %w", err)
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

// UpdateWithSteps replaces the mutable parent fields and the full typed step
// set in a single transaction. The parent row is locked first to guard the
// automation ID while old automation_steps are deleted; CTI children cascade
// from automation_steps before the replacement set is inserted.
func (r *AutomationRepo) UpdateWithSteps(ctx context.Context, a *models.Automation, steps []AutomationStepWrite) error {
	if err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var lockedID int64
		if err := tx.QueryRow(ctx, `SELECT id FROM automations WHERE id = $1 FOR UPDATE`, a.ID).Scan(&lockedID); err != nil {
			if err == pgx.ErrNoRows {
				return fmt.Errorf("automations-repo-update-with-steps: automation %d not found", a.ID)
			}
			return fmt.Errorf("automations-repo-update-with-steps: lock: %w", err)
		}

		const updateQuery = `
			UPDATE automations
			   SET name = $1, description = $2, enabled = $3, vehicle_id = $4
			 WHERE id = $5
			 RETURNING created_at, updated_at`
		if err := tx.QueryRow(ctx, updateQuery, a.Name, a.Description, a.Enabled, a.VehicleID, a.ID).
			Scan(&a.CreatedAt, &a.UpdatedAt); err != nil {
			return fmt.Errorf("automations-repo-update-with-steps: update parent: %w", err)
		}

		stepRepo := NewAutomationStepRepo(r.db)
		if err := stepRepo.DeleteByAutomationTx(ctx, tx, a.ID); err != nil {
			return err
		}
		return r.insertStepsTx(ctx, tx, a.ID, steps)
	}); err != nil {
		return fmt.Errorf("automations-repo-update-with-steps transaction: %w", err)
	}
	return nil
}

func (r *AutomationRepo) insertStepsTx(ctx context.Context, tx pgx.Tx, automationID int64, steps []AutomationStepWrite) error {
	stepRepo := NewAutomationStepRepo(r.db)
	childRepo := NewAutomationStepChildRepo(r.db)
	for _, item := range steps {
		step := models.AutomationStep{
			AutomationID: automationID,
			StepOrder:    item.StepOrder,
			Kind:         item.Kind,
		}
		if err := stepRepo.InsertTx(ctx, tx, &step); err != nil {
			return fmt.Errorf("automations-repo-persist-steps: insert %s order %d: %w", item.Kind, item.StepOrder, err)
		}
		if err := childRepo.UpsertTx(ctx, tx, step, item.Payload); err != nil {
			return fmt.Errorf("automations-repo-persist-steps: child %s order %d: %w", item.Kind, item.StepOrder, err)
		}
	}
	return nil
}

// Delete removes an automation by ID. Child rows (steps, triggers, scope)
// are removed automatically via FK ON DELETE CASCADE per ADR-004.
func (r *AutomationRepo) Delete(ctx context.Context, id int64) error {
	const query = `DELETE FROM automations WHERE id = $1`
	if _, err := r.db.Pool.Exec(ctx, query, id); err != nil {
		return fmt.Errorf("automations-repo-delete: %w", err)
	}
	return nil
}

// IncrementExecution is a no-op in the post-142 schema. The pre-refactor
// execution_count column on automations was retired; execution tracking is
// now handled entirely by AutomationHistoryRepo.
func (r *AutomationRepo) IncrementExecution(ctx context.Context, id int64, success bool) error {
	log.Debug().Int64("automation_id", id).Bool("success", success).
		Msg("IncrementExecution no-op: execution_count column retired post-142")
	return nil
}

// ── safety.AutoDisabler / shared by MQTTRepo, SunriseSunsetRepo, etc. ──

// SetAutoDisabled is a no-op in the post-142 schema. Per ADR-012
// sub-decision (ii), auto_disabled is retired; invalid automations are
// logged and skipped at evaluation time. Run-history-based derivation
// (AutomationFull.AutoDisabled()) replaces the stored column.
func (r *AutomationRepo) SetAutoDisabled(ctx context.Context, id int64, reason string) error {
	log.Debug().Int64("automation_id", id).Str("reason", reason).
		Msg("SetAutoDisabled no-op: auto_disabled column retired per ADR-012")
	return nil
}
