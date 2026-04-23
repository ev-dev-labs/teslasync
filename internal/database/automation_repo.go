package database

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/jackc/pgx/v5"
)

// AutomationRepo provides automation data access operations.
type AutomationRepo struct {
	db *DB
}

func NewAutomationRepo(db *DB) *AutomationRepo {
	return &AutomationRepo{db: db}
}

// automationColumns is the SELECT column list shared by read queries.
const automationColumns = `id, name, description, vehicle_id, enabled,
	trigger_type, trigger_config, conditions, actions,
	cooldown_minutes, max_executions_hour, stop_on_failure, notify_on_run, notify_on_failure,
	seasonal_start, seasonal_end, priority,
	last_triggered_at, last_success_at, last_failure_at,
	execution_count, failure_count, consecutive_failures,
	auto_disabled, auto_disabled_reason, preset_id, tags,
	created_at, updated_at`

func scanAutomation(row pgx.Row) (*models.Automation, error) {
	a := &models.Automation{}
	err := row.Scan(
		&a.ID, &a.Name, &a.Description, &a.VehicleID, &a.Enabled,
		&a.TriggerType, &a.TriggerConfig, &a.Conditions, &a.Actions,
		&a.CooldownMinutes, &a.MaxExecutionsHour, &a.StopOnFailure, &a.NotifyOnRun, &a.NotifyOnFailure,
		&a.SeasonalStart, &a.SeasonalEnd, &a.Priority,
		&a.LastTriggeredAt, &a.LastSuccessAt, &a.LastFailureAt,
		&a.ExecutionCount, &a.FailureCount, &a.ConsecutiveFailures,
		&a.AutoDisabled, &a.AutoDisabledReason, &a.PresetID, &a.Tags,
		&a.CreatedAt, &a.UpdatedAt,
	)
	return a, err
}

func (r *AutomationRepo) Create(ctx context.Context, a *models.Automation) error {
	now := time.Now().UTC()
	query := `INSERT INTO automations (
		name, description, vehicle_id, enabled,
		trigger_type, trigger_config, conditions, actions,
		cooldown_minutes, max_executions_hour, stop_on_failure, notify_on_run, notify_on_failure,
		seasonal_start, seasonal_end, priority,
		preset_id, tags, created_at, updated_at
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
	RETURNING id, created_at, updated_at`
	return r.db.Pool.QueryRow(ctx, query,
		a.Name, a.Description, a.VehicleID, a.Enabled,
		a.TriggerType, a.TriggerConfig, a.Conditions, a.Actions,
		a.CooldownMinutes, a.MaxExecutionsHour, a.StopOnFailure, a.NotifyOnRun, a.NotifyOnFailure,
		a.SeasonalStart, a.SeasonalEnd, a.Priority,
		a.PresetID, a.Tags, now,
	).Scan(&a.ID, &a.CreatedAt, &a.UpdatedAt)
}

func (r *AutomationRepo) GetByID(ctx context.Context, id int64) (*models.Automation, error) {
	query := fmt.Sprintf(`SELECT %s FROM automations WHERE id = $1`, automationColumns)
	a, err := scanAutomation(r.db.Pool.QueryRow(ctx, query, id))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("automations-repo-get-by-id: %w", err)
	}
	return a, nil
}

func (r *AutomationRepo) GetAll(ctx context.Context, enabledOnly bool) ([]*models.Automation, error) {
	query := fmt.Sprintf(`SELECT %s FROM automations`, automationColumns)
	if enabledOnly {
		query += ` WHERE enabled = true AND auto_disabled = false`
	}
	query += ` ORDER BY priority ASC, id ASC LIMIT 1000`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("get all automations: %w", err)
	}
	defer rows.Close()

	var results []*models.Automation
	for rows.Next() {
		a := &models.Automation{}
		if err := rows.Scan(
			&a.ID, &a.Name, &a.Description, &a.VehicleID, &a.Enabled,
			&a.TriggerType, &a.TriggerConfig, &a.Conditions, &a.Actions,
			&a.CooldownMinutes, &a.MaxExecutionsHour, &a.StopOnFailure, &a.NotifyOnRun, &a.NotifyOnFailure,
			&a.SeasonalStart, &a.SeasonalEnd, &a.Priority,
			&a.LastTriggeredAt, &a.LastSuccessAt, &a.LastFailureAt,
			&a.ExecutionCount, &a.FailureCount, &a.ConsecutiveFailures,
			&a.AutoDisabled, &a.AutoDisabledReason, &a.PresetID, &a.Tags,
			&a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan automation: %w", err)
		}
		results = append(results, a)
	}
	return results, rows.Err()
}

func (r *AutomationRepo) GetByVehicle(ctx context.Context, vehicleID int64) ([]*models.Automation, error) {
	query := fmt.Sprintf(`SELECT %s FROM automations WHERE vehicle_id = $1 OR vehicle_id IS NULL ORDER BY priority ASC, id ASC LIMIT 500`, automationColumns)
	rows, err := r.db.Pool.Query(ctx, query, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("get automations by vehicle: %w", err)
	}
	defer rows.Close()

	var results []*models.Automation
	for rows.Next() {
		a := &models.Automation{}
		if err := rows.Scan(
			&a.ID, &a.Name, &a.Description, &a.VehicleID, &a.Enabled,
			&a.TriggerType, &a.TriggerConfig, &a.Conditions, &a.Actions,
			&a.CooldownMinutes, &a.MaxExecutionsHour, &a.StopOnFailure, &a.NotifyOnRun, &a.NotifyOnFailure,
			&a.SeasonalStart, &a.SeasonalEnd, &a.Priority,
			&a.LastTriggeredAt, &a.LastSuccessAt, &a.LastFailureAt,
			&a.ExecutionCount, &a.FailureCount, &a.ConsecutiveFailures,
			&a.AutoDisabled, &a.AutoDisabledReason, &a.PresetID, &a.Tags,
			&a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan automation: %w", err)
		}
		results = append(results, a)
	}
	return results, rows.Err()
}

func (r *AutomationRepo) GetByTriggerType(ctx context.Context, triggerType string) ([]*models.Automation, error) {
	query := fmt.Sprintf(`SELECT %s FROM automations WHERE trigger_type = $1 AND enabled = true AND auto_disabled = false ORDER BY priority ASC, id ASC LIMIT 500`, automationColumns)
	rows, err := r.db.Pool.Query(ctx, query, triggerType)
	if err != nil {
		return nil, fmt.Errorf("get automations by trigger: %w", err)
	}
	defer rows.Close()

	var results []*models.Automation
	for rows.Next() {
		a := &models.Automation{}
		if err := rows.Scan(
			&a.ID, &a.Name, &a.Description, &a.VehicleID, &a.Enabled,
			&a.TriggerType, &a.TriggerConfig, &a.Conditions, &a.Actions,
			&a.CooldownMinutes, &a.MaxExecutionsHour, &a.StopOnFailure, &a.NotifyOnRun, &a.NotifyOnFailure,
			&a.SeasonalStart, &a.SeasonalEnd, &a.Priority,
			&a.LastTriggeredAt, &a.LastSuccessAt, &a.LastFailureAt,
			&a.ExecutionCount, &a.FailureCount, &a.ConsecutiveFailures,
			&a.AutoDisabled, &a.AutoDisabledReason, &a.PresetID, &a.Tags,
			&a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan automation: %w", err)
		}
		results = append(results, a)
	}
	return results, rows.Err()
}

// GetEnabledByVehicleAndTrigger returns enabled automations matching a specific
// vehicle (or global, vehicle_id IS NULL) and trigger type.
func (r *AutomationRepo) GetEnabledByVehicleAndTrigger(ctx context.Context, vehicleID int64, triggerType string) ([]*models.Automation, error) {
	query := fmt.Sprintf(
		`SELECT %s FROM automations
		 WHERE (vehicle_id = $1 OR vehicle_id IS NULL)
		   AND trigger_type = $2
		   AND enabled = true
		   AND auto_disabled = false
		 ORDER BY priority ASC, id ASC LIMIT 500`,
		automationColumns,
	)
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, triggerType)
	if err != nil {
		return nil, fmt.Errorf("get enabled automations by vehicle and trigger: %w", err)
	}
	defer rows.Close()

	var results []*models.Automation
	for rows.Next() {
		a := &models.Automation{}
		if err := rows.Scan(
			&a.ID, &a.Name, &a.Description, &a.VehicleID, &a.Enabled,
			&a.TriggerType, &a.TriggerConfig, &a.Conditions, &a.Actions,
			&a.CooldownMinutes, &a.MaxExecutionsHour, &a.StopOnFailure, &a.NotifyOnRun, &a.NotifyOnFailure,
			&a.SeasonalStart, &a.SeasonalEnd, &a.Priority,
			&a.LastTriggeredAt, &a.LastSuccessAt, &a.LastFailureAt,
			&a.ExecutionCount, &a.FailureCount, &a.ConsecutiveFailures,
			&a.AutoDisabled, &a.AutoDisabledReason, &a.PresetID, &a.Tags,
			&a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan automation: %w", err)
		}
		results = append(results, a)
	}
	return results, rows.Err()
}

// GetByWebhookToken looks up an enabled automation by its webhook_token
// stored inside the trigger_config JSONB column.
func (r *AutomationRepo) GetByWebhookToken(ctx context.Context, token string) (*models.Automation, error) {
	query := fmt.Sprintf(
		`SELECT %s FROM automations
		 WHERE trigger_type = 'webhook'
		   AND trigger_config->>'webhook_token' = $1
		 LIMIT 1`,
		automationColumns,
	)
	a, err := scanAutomation(r.db.Pool.QueryRow(ctx, query, token))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get automation by webhook token: %w", err)
	}
	return a, nil
}

func (r *AutomationRepo) Update(ctx context.Context, a *models.Automation) error {
	now := time.Now().UTC()
	query := `UPDATE automations SET
		name=$2, description=$3, vehicle_id=$4, enabled=$5,
		trigger_type=$6, trigger_config=$7, conditions=$8, actions=$9,
		cooldown_minutes=$10, max_executions_hour=$11, stop_on_failure=$12, notify_on_run=$13, notify_on_failure=$14,
		seasonal_start=$15, seasonal_end=$16, priority=$17,
		preset_id=$18, tags=$19, updated_at=$20
	WHERE id=$1`
	_, err := r.db.Pool.Exec(ctx, query,
		a.ID,
		a.Name, a.Description, a.VehicleID, a.Enabled,
		a.TriggerType, a.TriggerConfig, a.Conditions, a.Actions,
		a.CooldownMinutes, a.MaxExecutionsHour, a.StopOnFailure, a.NotifyOnRun, a.NotifyOnFailure,
		a.SeasonalStart, a.SeasonalEnd, a.Priority,
		a.PresetID, a.Tags, now,
	)
	if err != nil {
		return fmt.Errorf("update automation %d: %w", a.ID, err)
	}
	a.UpdatedAt = now
	return nil
}

func (r *AutomationRepo) SetEnabled(ctx context.Context, id int64, enabled bool) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE automations SET enabled=$2, updated_at=$3 WHERE id=$1`,
		id, enabled, time.Now().UTC())
	return err
}

func (r *AutomationRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM automations WHERE id = $1`, id)
	return err
}

// IncrementExecution updates counters and timestamps after an execution completes.
func (r *AutomationRepo) IncrementExecution(ctx context.Context, id int64, success bool) error {
	now := time.Now().UTC()
	if success {
		_, err := r.db.Pool.Exec(ctx,
			`UPDATE automations SET
				execution_count = execution_count + 1,
				last_triggered_at = $2, last_success_at = $2,
				consecutive_failures = 0, updated_at = $2
			WHERE id = $1`,
			id, now)
		return err
	}
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE automations SET
			execution_count = execution_count + 1,
			failure_count = failure_count + 1,
			consecutive_failures = consecutive_failures + 1,
			last_triggered_at = $2, last_failure_at = $2, updated_at = $2
		WHERE id = $1`,
		id, now)
	return err
}

// SetAutoDisabled marks an automation as auto-disabled with a reason.
func (r *AutomationRepo) SetAutoDisabled(ctx context.Context, id int64, reason string) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE automations SET auto_disabled=true, auto_disabled_reason=$2, enabled=false, updated_at=$3 WHERE id=$1`,
		id, reason, time.Now().UTC())
	return err
}

// ReEnable clears the auto-disabled state, re-enables the automation, and
// resets the consecutive failure counter. Only affects auto-disabled automations.
func (r *AutomationRepo) ReEnable(ctx context.Context, id int64) error {
	tag, err := r.db.Pool.Exec(ctx,
		`UPDATE automations SET
			auto_disabled=false, auto_disabled_reason=NULL,
			enabled=true, consecutive_failures=0, updated_at=$2
		WHERE id=$1 AND auto_disabled=true`,
		id, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("re-enable automation %d: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("automation %d is not auto-disabled", id)
	}
	return nil
}
