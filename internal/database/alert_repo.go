package database

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AlertRuleRepo provides alert rule data access.
type AlertRuleRepo struct {
	db *DB
}

func NewAlertRuleRepo(db *DB) *AlertRuleRepo {
	return &AlertRuleRepo{db: db}
}

func (r *AlertRuleRepo) GetAll(ctx context.Context) ([]*models.AlertRule, error) {
	query := `SELECT id, name, description, enabled, vehicle_id, signal_name, op,
		value_num, value_text, value_bool, value_min, value_max,
		severity, cooldown_min, trigger_mode, snoozed_until, created_at, updated_at
		FROM alert_rules ORDER BY id LIMIT 1000`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []*models.AlertRule
	for rows.Next() {
		ar := &models.AlertRule{}
		if err := rows.Scan(&ar.ID, &ar.Name, &ar.Description, &ar.Enabled, &ar.VehicleID,
			&ar.SignalName, &ar.Op, &ar.ValueNum, &ar.ValueText, &ar.ValueBool,
			&ar.ValueMin, &ar.ValueMax, &ar.Severity, &ar.CooldownMin,
			&ar.TriggerMode, &ar.SnoozedUntil,
			&ar.CreatedAt, &ar.UpdatedAt); err != nil {
			return nil, err
		}
		rules = append(rules, ar)
	}
	return rules, rows.Err()
}

func (r *AlertRuleRepo) Update(ctx context.Context, id int64, rule *models.AlertRule) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE alert_rules SET name=$2, description=$3, enabled=$4, vehicle_id=$5,
		signal_name=$6, op=$7, value_num=$8, value_text=$9, value_bool=$10,
		value_min=$11, value_max=$12, severity=$13, cooldown_min=$14,
		trigger_mode=$15, snoozed_until=$16, updated_at=$17
		WHERE id=$1`,
		id, rule.Name, rule.Description, rule.Enabled, rule.VehicleID,
		rule.SignalName, rule.Op, rule.ValueNum, rule.ValueText, rule.ValueBool,
		rule.ValueMin, rule.ValueMax, rule.Severity, rule.CooldownMin,
		rule.TriggerMode, rule.SnoozedUntil, time.Now().UTC())
	return err
}

func (r *AlertRuleRepo) GetByID(ctx context.Context, id int64) (*models.AlertRule, error) {
	query := `SELECT id, name, description, enabled, vehicle_id, signal_name, op,
		value_num, value_text, value_bool, value_min, value_max,
		severity, cooldown_min, trigger_mode, snoozed_until, created_at, updated_at
		FROM alert_rules WHERE id = $1`
	ar := &models.AlertRule{}
	err := r.db.Pool.QueryRow(ctx, query, id).Scan(&ar.ID, &ar.Name, &ar.Description,
		&ar.Enabled, &ar.VehicleID, &ar.SignalName, &ar.Op,
		&ar.ValueNum, &ar.ValueText, &ar.ValueBool, &ar.ValueMin, &ar.ValueMax,
		&ar.Severity, &ar.CooldownMin, &ar.TriggerMode, &ar.SnoozedUntil,
		&ar.CreatedAt, &ar.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return ar, err
}

func (r *AlertRuleRepo) Create(ctx context.Context, rule *models.AlertRule) error {
	query := `INSERT INTO alert_rules (name, description, enabled, vehicle_id, signal_name, op,
		value_num, value_text, value_bool, value_min, value_max,
		severity, cooldown_min, trigger_mode, snoozed_until, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
		RETURNING id, created_at, updated_at`
	return r.db.Pool.QueryRow(ctx, query, rule.Name, rule.Description, rule.Enabled,
		rule.VehicleID, rule.SignalName, rule.Op, rule.ValueNum, rule.ValueText,
		rule.ValueBool, rule.ValueMin, rule.ValueMax, rule.Severity, rule.CooldownMin,
		rule.TriggerMode, rule.SnoozedUntil).
		Scan(&rule.ID, &rule.CreatedAt, &rule.UpdatedAt)
}

func (r *AlertRuleRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM alert_rules WHERE id = $1`, id)
	return err
}

// SetSnooze sets snoozed_until on a rule. Pass nil to clear the snooze.
// updated_at is bumped so the audit trail reflects the action.
func (r *AlertRuleRepo) SetSnooze(ctx context.Context, id int64, until *time.Time) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE alert_rules SET snoozed_until = $2, updated_at = NOW() WHERE id = $1`,
		id, until)
	return err
}
