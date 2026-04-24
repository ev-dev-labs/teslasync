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

// ── trigger.MQTTRepo / trigger.SunriseSunsetRepo ───────────────────────

// GetByTriggerType returns all enabled automations whose first trigger step
// matches the given trigger type. The triggerType is mapped to the step kind
// by prefixing "trigger_" (e.g. "mqtt" → kind = "trigger_mqtt"). If the
// resulting kind is not present in the automation_step_kind enum, zero rows
// are returned — this is correct for trigger types that are not yet modeled
// in the CTI schema and will automatically work once the enum is extended.
func (r *AutomationRepo) GetByTriggerType(ctx context.Context, triggerType string) ([]*models.AutomationFull, error) {
	kind := "trigger_" + triggerType

	const query = `
		SELECT a.id, a.name, a.description, a.enabled, a.vehicle_id, a.created_at, a.updated_at
		FROM automations a
		JOIN automation_steps s ON s.automation_id = a.id
		WHERE s.kind::text = $1
		  AND a.enabled = true
		ORDER BY a.id`
	rows, err := r.db.Pool.Query(ctx, query, kind)
	if err != nil {
		return nil, fmt.Errorf("automations-repo-get-by-trigger-type: %w", err)
	}
	defer rows.Close()

	parentByID := make(map[int64]*models.AutomationFull)
	var order []int64
	for rows.Next() {
		var a models.Automation
		if err := rows.Scan(
			&a.ID, &a.Name, &a.Description, &a.Enabled, &a.VehicleID, &a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("automations-repo-get-by-trigger-type-scan: %w", err)
		}
		if _, ok := parentByID[a.ID]; !ok {
			parentByID[a.ID] = &models.AutomationFull{
				Automation: a,
				Steps:      []models.AutomationStep{},
			}
			order = append(order, a.ID)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("automations-repo-get-by-trigger-type-rows: %w", err)
	}

	if len(parentByID) == 0 {
		return nil, nil
	}

	// Load steps for matched automations.
	ids := make([]int64, 0, len(order))
	ids = append(ids, order...)

	const stepsQuery = `
		SELECT id, automation_id, step_order, kind
		FROM automation_steps
		WHERE automation_id = ANY($1)
		ORDER BY automation_id, step_order`
	stepRows, err := r.db.Pool.Query(ctx, stepsQuery, ids)
	if err != nil {
		return nil, fmt.Errorf("automations-repo-get-by-trigger-type-steps: %w", err)
	}
	defer stepRows.Close()

	for stepRows.Next() {
		var s models.AutomationStep
		if err := stepRows.Scan(&s.ID, &s.AutomationID, &s.StepOrder, &s.Kind); err != nil {
			return nil, fmt.Errorf("automations-repo-get-by-trigger-type-steps-scan: %w", err)
		}
		if af, ok := parentByID[s.AutomationID]; ok {
			af.Steps = append(af.Steps, s)
		}
	}
	if err := stepRows.Err(); err != nil {
		return nil, fmt.Errorf("automations-repo-get-by-trigger-type-steps-rows: %w", err)
	}

	out := make([]*models.AutomationFull, 0, len(order))
	for _, id := range order {
		out = append(out, parentByID[id])
	}
	return out, nil
}

// ── trigger.BatteryRepo ────────────────────────────────────────────────

// LoadEnabledBatterySignalTriggers returns all enabled automations whose
// trigger step is a signal trigger on the 'battery_level' signal, scoped to
// the given vehicle (or unscoped, i.e. vehicle_id IS NULL for all-vehicle
// automations). Each result pairs the parent with the typed signal CTI row.
func (r *AutomationRepo) LoadEnabledBatterySignalTriggers(ctx context.Context, vehicleID int64) ([]trigger.BatteryAutomation, error) {
	const query = `
		SELECT a.id, a.name, a.description, a.enabled, a.vehicle_id, a.created_at, a.updated_at,
		       ts.step_id, ts.signal, ts.op, ts.value_text, ts.value_num, ts.value_bool
		FROM automations a
		JOIN automation_steps s ON s.automation_id = a.id
		JOIN automation_step_trigger_signal ts ON ts.step_id = s.id
		WHERE s.kind = 'trigger_signal'
		  AND ts.signal = 'battery_level'
		  AND a.enabled = true
		  AND (a.vehicle_id = $1 OR a.vehicle_id IS NULL)
		ORDER BY a.id`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("automations-repo-load-battery-triggers: %w", err)
	}
	defer rows.Close()

	var out []trigger.BatteryAutomation
	for rows.Next() {
		var ba trigger.BatteryAutomation
		if err := rows.Scan(
			&ba.Automation.ID, &ba.Automation.Name, &ba.Automation.Description,
			&ba.Automation.Enabled, &ba.Automation.VehicleID,
			&ba.Automation.CreatedAt, &ba.Automation.UpdatedAt,
			&ba.Trigger.StepID, &ba.Trigger.Signal, &ba.Trigger.Op,
			&ba.Trigger.ValueText, &ba.Trigger.ValueNum, &ba.Trigger.ValueBool,
		); err != nil {
			return nil, fmt.Errorf("automations-repo-load-battery-triggers-scan: %w", err)
		}
		out = append(out, ba)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("automations-repo-load-battery-triggers-rows: %w", err)
	}
	return out, nil
}

// ── trigger.VehicleStateRepo ───────────────────────────────────────────

// GetEnabledByVehicleAndTrigger returns all enabled automations for a given
// vehicle whose first trigger step matches the specified type. Used by
// VehicleStateTrigger to load event-based automations.
func (r *AutomationRepo) GetEnabledByVehicleAndTrigger(ctx context.Context, vehicleID int64, triggerType string) ([]*models.AutomationFull, error) {
	kind := "trigger_" + triggerType

	const query = `
		SELECT a.id, a.name, a.description, a.enabled, a.vehicle_id, a.created_at, a.updated_at
		FROM automations a
		JOIN automation_steps s ON s.automation_id = a.id
		WHERE s.kind::text = $1
		  AND a.enabled = true
		  AND (a.vehicle_id = $2 OR a.vehicle_id IS NULL)
		ORDER BY a.id`
	rows, err := r.db.Pool.Query(ctx, query, kind, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("automations-repo-get-enabled-by-vehicle-and-trigger: %w", err)
	}
	defer rows.Close()

	parentByID := make(map[int64]*models.AutomationFull)
	var order []int64
	for rows.Next() {
		var a models.Automation
		if err := rows.Scan(
			&a.ID, &a.Name, &a.Description, &a.Enabled, &a.VehicleID, &a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("automations-repo-get-enabled-by-vehicle-scan: %w", err)
		}
		if _, ok := parentByID[a.ID]; !ok {
			parentByID[a.ID] = &models.AutomationFull{
				Automation: a,
				Steps:      []models.AutomationStep{},
			}
			order = append(order, a.ID)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("automations-repo-get-enabled-by-vehicle-rows: %w", err)
	}

	if len(parentByID) == 0 {
		return nil, nil
	}

	ids := make([]int64, 0, len(order))
	ids = append(ids, order...)

	const stepsQuery = `
		SELECT id, automation_id, step_order, kind
		FROM automation_steps
		WHERE automation_id = ANY($1)
		ORDER BY automation_id, step_order`
	stepRows, err := r.db.Pool.Query(ctx, stepsQuery, ids)
	if err != nil {
		return nil, fmt.Errorf("automations-repo-get-enabled-by-vehicle-steps: %w", err)
	}
	defer stepRows.Close()

	for stepRows.Next() {
		var s models.AutomationStep
		if err := stepRows.Scan(&s.ID, &s.AutomationID, &s.StepOrder, &s.Kind); err != nil {
			return nil, fmt.Errorf("automations-repo-get-enabled-by-vehicle-steps-scan: %w", err)
		}
		if af, ok := parentByID[s.AutomationID]; ok {
			af.Steps = append(af.Steps, s)
		}
	}
	if err := stepRows.Err(); err != nil {
		return nil, fmt.Errorf("automations-repo-get-enabled-by-vehicle-steps-rows: %w", err)
	}

	out := make([]*models.AutomationFull, 0, len(order))
	for _, id := range order {
		out = append(out, parentByID[id])
	}
	return out, nil
}

// ── trigger.EnergyRepo ─────────────────────────────────────────────────

// energySignals lists the signal names that map to energy-site data per
// ADR-012. These correspond to fields on models.TeslaEnergyLiveStatus.
var energySignals = []string{
	"solar_power", "battery_level", "grid_power",
	"grid_status", "storm_mode_active",
}

// LoadEnabledEnergySignalTriggers returns all enabled automations whose
// trigger step is a signal trigger on an energy-related signal. The
// energySiteID parameter is currently not directly matchable because the
// post-142 schema scopes automations by vehicle_id, not energy_site_id; a
// mapping table is expected in a future migration. For now all enabled
// energy-signal automations are returned and callers filter by site at
// evaluation time (see EnergyTrigger.OnEnergyUpdate).
func (r *AutomationRepo) LoadEnabledEnergySignalTriggers(ctx context.Context, energySiteID int64) ([]trigger.EnergyAutomation, error) {
	const query = `
		SELECT a.id, a.name, a.description, a.enabled, a.vehicle_id, a.created_at, a.updated_at,
		       ts.step_id, ts.signal, ts.op, ts.value_text, ts.value_num, ts.value_bool
		FROM automations a
		JOIN automation_steps s ON s.automation_id = a.id
		JOIN automation_step_trigger_signal ts ON ts.step_id = s.id
		WHERE s.kind = 'trigger_signal'
		  AND ts.signal = ANY($1)
		  AND a.enabled = true
		ORDER BY a.id`
	rows, err := r.db.Pool.Query(ctx, query, energySignals)
	if err != nil {
		return nil, fmt.Errorf("automations-repo-load-energy-triggers: %w", err)
	}
	defer rows.Close()

	var out []trigger.EnergyAutomation
	for rows.Next() {
		var ea trigger.EnergyAutomation
		if err := rows.Scan(
			&ea.Automation.ID, &ea.Automation.Name, &ea.Automation.Description,
			&ea.Automation.Enabled, &ea.Automation.VehicleID,
			&ea.Automation.CreatedAt, &ea.Automation.UpdatedAt,
			&ea.Trigger.StepID, &ea.Trigger.Signal, &ea.Trigger.Op,
			&ea.Trigger.ValueText, &ea.Trigger.ValueNum, &ea.Trigger.ValueBool,
		); err != nil {
			return nil, fmt.Errorf("automations-repo-load-energy-triggers-scan: %w", err)
		}
		ea.EnergySiteID = energySiteID
		out = append(out, ea)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("automations-repo-load-energy-triggers-rows: %w", err)
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
