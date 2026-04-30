package database

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/automation/trigger"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AutomationRepo provides automation data access operations against the
// post-migration `automations` table. Per ADR-004 the typed CTI children
// (steps, triggers, scope) are loaded by their own repos; methods here
// operate only on the automations row itself.
type AutomationRepo struct {
	db *DB
}

// AutomationStepWrite is the persistence DTO for an ordered discriminator row
// plus its already-validated typed CTI payload.
type AutomationStepWrite struct {
	StepOrder int
	Kind      string
	Payload   any
}

func NewAutomationRepo(db *DB) *AutomationRepo {
	return &AutomationRepo{db: db}
}

// Create inserts a new automation parent row and populates the assigned ID
// and timestamps on the supplied model. Per ADR-004, child rows (steps,
// triggers, scope) are persisted by their own repos in separate calls.
func (r *AutomationRepo) Create(ctx context.Context, a *models.Automation) error {
	return r.createTx(ctx, r.db.Pool, a)
}

func (r *AutomationRepo) createTx(ctx context.Context, exec DBTX, a *models.Automation) error {
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

// ListFull returns every automation with ordered steps and typed CTI children
// fully hydrated. Steps are fetched in a single grouped query; CTI children are
// attached by AutomationStepChildRepo one lane at a time to avoid N+1 fan-out.
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
	ptrs := make([]*models.AutomationFull, 0, len(out))
	for i := range out {
		ptrs = append(ptrs, &out[i])
	}
	if err := NewAutomationStepChildRepo(r.db).HydrateAutomations(ctx, ptrs); err != nil {
		return nil, fmt.Errorf("automations-repo-list-full-children: %w", err)
	}
	return out, nil
}

// ── AutomationStore interface ──────────────────────────────────────────

// GetByID loads a single automation by primary key, hydrated with its ordered
// steps. Returns (nil, nil) when no row exists for the given ID.
func (r *AutomationRepo) GetByID(ctx context.Context, id int64) (*models.AutomationFull, error) {
	const parentQuery = `
		SELECT id, name, description, enabled, vehicle_id, created_at, updated_at
		FROM automations WHERE id = $1`
	var a models.Automation
	err := r.db.Pool.QueryRow(ctx, parentQuery, id).Scan(
		&a.ID, &a.Name, &a.Description, &a.Enabled, &a.VehicleID, &a.CreatedAt, &a.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("automations-repo-get-by-id: %w", err)
	}

	out := &models.AutomationFull{
		Automation: a,
		Steps:      []models.AutomationStep{},
	}

	const stepsQuery = `
		SELECT id, automation_id, step_order, kind
		FROM automation_steps
		WHERE automation_id = $1
		ORDER BY step_order`
	rows, err := r.db.Pool.Query(ctx, stepsQuery, id)
	if err != nil {
		return nil, fmt.Errorf("automations-repo-get-by-id-steps: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var s models.AutomationStep
		if err := rows.Scan(&s.ID, &s.AutomationID, &s.StepOrder, &s.Kind); err != nil {
			return nil, fmt.Errorf("automations-repo-get-by-id-steps-scan: %w", err)
		}
		out.Steps = append(out.Steps, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("automations-repo-get-by-id-steps-rows: %w", err)
	}
	if err := NewAutomationStepChildRepo(r.db).HydrateAutomation(ctx, out); err != nil {
		return nil, fmt.Errorf("automations-repo-get-by-id-children: %w", err)
	}
	return out, nil
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

// ── trigger.CronRepo ───────────────────────────────────────────────────

// LoadEnabledScheduleTriggers returns all enabled automations whose trigger
// step is a schedule (cron) trigger, joined with the typed CTI row from
// automation_step_trigger_schedule. One batched query avoids N+1.
func (r *AutomationRepo) LoadEnabledScheduleTriggers(ctx context.Context) ([]trigger.CronAutomation, error) {
	const query = `
		SELECT a.id, a.name, a.description, a.enabled, a.vehicle_id, a.created_at, a.updated_at,
		       ts.step_id, ts.cron_expr, ts.timezone
		FROM automations a
		JOIN automation_steps s ON s.automation_id = a.id
		JOIN automation_step_trigger_schedule ts ON ts.step_id = s.id
		WHERE s.kind = 'trigger_schedule'
		  AND a.enabled = true
		ORDER BY a.id`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("automations-repo-load-schedule-triggers: %w", err)
	}
	defer rows.Close()

	var out []trigger.CronAutomation
	for rows.Next() {
		var ca trigger.CronAutomation
		if err := rows.Scan(
			&ca.Automation.ID, &ca.Automation.Name, &ca.Automation.Description,
			&ca.Automation.Enabled, &ca.Automation.VehicleID,
			&ca.Automation.CreatedAt, &ca.Automation.UpdatedAt,
			&ca.Trigger.StepID, &ca.Trigger.CronExpr, &ca.Trigger.Timezone,
		); err != nil {
			return nil, fmt.Errorf("automations-repo-load-schedule-triggers-scan: %w", err)
		}
		out = append(out, ca)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("automations-repo-load-schedule-triggers-rows: %w", err)
	}
	return out, nil
}

// ── trigger.SignalRepo ─────────────────────────────────────────────────

// LoadEnabledSignalTriggers returns enabled automations whose trigger step is
// a typed signal trigger for the requested vehicle and signal.
func (r *AutomationRepo) LoadEnabledSignalTriggers(ctx context.Context, vehicleID int64, signal string) ([]trigger.SignalAutomation, error) {
	const query = `
		SELECT a.id, a.name, a.description, a.enabled, a.vehicle_id, a.created_at, a.updated_at,
		       ts.step_id, ts.signal, ts.op, ts.value_text, ts.value_num, ts.value_bool
		FROM automations a
		JOIN automation_steps s ON s.automation_id = a.id
		JOIN automation_step_trigger_signal ts ON ts.step_id = s.id
		WHERE s.kind = 'trigger_signal'
		  AND ts.signal = $2
		  AND a.enabled = true
		  AND (a.vehicle_id = $1 OR a.vehicle_id IS NULL)
		ORDER BY a.id`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, signal)
	if err != nil {
		return nil, fmt.Errorf("automations-repo-load-signal-triggers: %w", err)
	}
	defer rows.Close()

	var out []trigger.SignalAutomation
	for rows.Next() {
		var ba trigger.SignalAutomation
		if err := rows.Scan(
			&ba.Automation.ID, &ba.Automation.Name, &ba.Automation.Description,
			&ba.Automation.Enabled, &ba.Automation.VehicleID,
			&ba.Automation.CreatedAt, &ba.Automation.UpdatedAt,
			&ba.Trigger.StepID, &ba.Trigger.Signal, &ba.Trigger.Op,
			&ba.Trigger.ValueText, &ba.Trigger.ValueNum, &ba.Trigger.ValueBool,
		); err != nil {
			return nil, fmt.Errorf("automations-repo-load-signal-triggers-scan: %w", err)
		}
		out = append(out, ba)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("automations-repo-load-signal-triggers-rows: %w", err)
	}
	return out, nil
}

// ── trigger.GeofenceRepo ───────────────────────────────────────────────

// LoadEnabledGeofenceTriggers returns enabled automations with typed geofence
// triggers scoped to the requested vehicle.
func (r *AutomationRepo) LoadEnabledGeofenceTriggers(ctx context.Context, vehicleID int64) ([]trigger.GeofenceAutomation, error) {
	const query = `
		SELECT a.id, a.name, a.description, a.enabled, a.vehicle_id, a.created_at, a.updated_at,
		       tg.step_id, tg.place_id, tg.event
		FROM automations a
		JOIN automation_steps s ON s.automation_id = a.id
		JOIN automation_step_trigger_geofence tg ON tg.step_id = s.id
		WHERE s.kind = 'trigger_geofence'
		  AND a.enabled = true
		  AND (a.vehicle_id = $1 OR a.vehicle_id IS NULL)
		ORDER BY a.id`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("automations-repo-load-geofence-triggers: %w", err)
	}
	defer rows.Close()

	var out []trigger.GeofenceAutomation
	for rows.Next() {
		var ga trigger.GeofenceAutomation
		if err := rows.Scan(
			&ga.Automation.ID, &ga.Automation.Name, &ga.Automation.Description,
			&ga.Automation.Enabled, &ga.Automation.VehicleID,
			&ga.Automation.CreatedAt, &ga.Automation.UpdatedAt,
			&ga.Trigger.StepID, &ga.Trigger.PlaceID, &ga.Trigger.Event,
		); err != nil {
			return nil, fmt.Errorf("automations-repo-load-geofence-triggers-scan: %w", err)
		}
		out = append(out, ga)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("automations-repo-load-geofence-triggers-rows: %w", err)
	}
	return out, nil
}

// ── trigger.EventRepo ──────────────────────────────────────────────────

// LoadEnabledEventTriggers returns enabled automations with typed event
// triggers for the requested vehicle and event type.
func (r *AutomationRepo) LoadEnabledEventTriggers(ctx context.Context, vehicleID int64, eventType string) ([]trigger.EventAutomation, error) {
	const query = `
		SELECT a.id, a.name, a.description, a.enabled, a.vehicle_id, a.created_at, a.updated_at,
		       te.step_id, te.event_type
		FROM automations a
		JOIN automation_steps s ON s.automation_id = a.id
		JOIN automation_step_trigger_event te ON te.step_id = s.id
		WHERE s.kind = 'trigger_event'
		  AND te.event_type = $2
		  AND a.enabled = true
		  AND (a.vehicle_id = $1 OR a.vehicle_id IS NULL)
		ORDER BY a.id`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, eventType)
	if err != nil {
		return nil, fmt.Errorf("automations-repo-load-event-triggers: %w", err)
	}
	defer rows.Close()

	var out []trigger.EventAutomation
	for rows.Next() {
		var ea trigger.EventAutomation
		if err := rows.Scan(
			&ea.Automation.ID, &ea.Automation.Name, &ea.Automation.Description,
			&ea.Automation.Enabled, &ea.Automation.VehicleID,
			&ea.Automation.CreatedAt, &ea.Automation.UpdatedAt,
			&ea.Trigger.StepID, &ea.Trigger.EventType,
		); err != nil {
			return nil, fmt.Errorf("automations-repo-load-event-triggers-scan: %w", err)
		}
		out = append(out, ea)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("automations-repo-load-event-triggers-rows: %w", err)
	}
	return out, nil
}

// ── trigger.WebhookRepo ────────────────────────────────────────────────

// GetByWebhookToken looks up an automation by its webhook token. The
// post-142 schema does not yet include a trigger_webhook CTI table, so no
// webhook automations can exist. This correctly returns (nil, nil) — "not
// found" — until the webhook kind and its child table are migrated in.
func (r *AutomationRepo) GetByWebhookToken(ctx context.Context, token string) (*models.AutomationFull, error) {
	log.Debug().Str("token_prefix", safeTokenPrefix(token)).
		Msg("GetByWebhookToken: trigger_webhook CTI table not yet migrated; returning not-found")
	return nil, nil
}

// safeTokenPrefix returns a truncated token for safe logging.
func safeTokenPrefix(token string) string {
	if len(token) <= 8 {
		if len(token) == 0 {
			return ""
		}
		return token[:len(token)/2] + "***"
	}
	return token[:8] + "***"
}
