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

// alertRuleColumns is the canonical SELECT column list, kept in sync with
// scanAlertRule below. Add new columns here AND in scanAlertRule when extending
// the schema (migration 000158_alert_rule_kinds added kind/metric_*).
const alertRuleColumns = `id, name, description, enabled, vehicle_id, signal_name, op,
	value_num, value_text, value_bool, value_min, value_max,
	severity, cooldown_min, trigger_mode, snoozed_until,
	kind, metric_id, metric_window, metric_threshold, metric_op,
	created_at, updated_at`

func scanAlertRule(row interface{ Scan(dest ...any) error }, ar *models.AlertRule) error {
	return row.Scan(
		&ar.ID, &ar.Name, &ar.Description, &ar.Enabled, &ar.VehicleID,
		&ar.SignalName, &ar.Op, &ar.ValueNum, &ar.ValueText, &ar.ValueBool,
		&ar.ValueMin, &ar.ValueMax, &ar.Severity, &ar.CooldownMin,
		&ar.TriggerMode, &ar.SnoozedUntil,
		&ar.Kind, &ar.MetricID, &ar.MetricWindow, &ar.MetricThreshold, &ar.MetricOp,
		&ar.CreatedAt, &ar.UpdatedAt,
	)
}

func (r *AlertRuleRepo) GetAll(ctx context.Context) ([]*models.AlertRule, error) {
	query := `SELECT ` + alertRuleColumns + ` FROM alert_rules ORDER BY id LIMIT 1000`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []*models.AlertRule
	for rows.Next() {
		ar := &models.AlertRule{}
		if err := scanAlertRule(rows, ar); err != nil {
			return nil, err
		}
		rules = append(rules, ar)
	}
	return rules, rows.Err()
}

// GetEnabledByKind returns enabled rules of a specific kind. Used by the
// computed-metric scheduled evaluator to skip signal rules cheaply via the
// idx_alert_rules_kind_enabled partial index.
func (r *AlertRuleRepo) GetEnabledByKind(ctx context.Context, kind string) ([]*models.AlertRule, error) {
	query := `SELECT ` + alertRuleColumns + ` FROM alert_rules
		WHERE kind = $1 AND enabled = TRUE ORDER BY id LIMIT 1000`
	rows, err := r.db.Pool.Query(ctx, query, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []*models.AlertRule
	for rows.Next() {
		ar := &models.AlertRule{}
		if err := scanAlertRule(rows, ar); err != nil {
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
		trigger_mode=$15, snoozed_until=$16,
		kind=$17, metric_id=$18, metric_window=$19, metric_threshold=$20, metric_op=$21,
		updated_at=$22
		WHERE id=$1`,
		id, rule.Name, rule.Description, rule.Enabled, rule.VehicleID,
		rule.SignalName, rule.Op, rule.ValueNum, rule.ValueText, rule.ValueBool,
		rule.ValueMin, rule.ValueMax, rule.Severity, rule.CooldownMin,
		rule.TriggerMode, rule.SnoozedUntil,
		rule.Kind, rule.MetricID, rule.MetricWindow, rule.MetricThreshold, rule.MetricOp,
		time.Now().UTC())
	return err
}

func (r *AlertRuleRepo) GetByID(ctx context.Context, id int64) (*models.AlertRule, error) {
	query := `SELECT ` + alertRuleColumns + ` FROM alert_rules WHERE id = $1`
	ar := &models.AlertRule{}
	err := scanAlertRule(r.db.Pool.QueryRow(ctx, query, id), ar)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return ar, err
}

func (r *AlertRuleRepo) Create(ctx context.Context, rule *models.AlertRule) error {
	if rule.Kind == "" {
		rule.Kind = models.AlertRuleKindSignal
	}
	query := `INSERT INTO alert_rules (name, description, enabled, vehicle_id, signal_name, op,
		value_num, value_text, value_bool, value_min, value_max,
		severity, cooldown_min, trigger_mode, snoozed_until,
		kind, metric_id, metric_window, metric_threshold, metric_op,
		created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
			$16, $17, $18, $19, $20, NOW(), NOW())
		RETURNING id, created_at, updated_at`
	return r.db.Pool.QueryRow(ctx, query, rule.Name, rule.Description, rule.Enabled,
		rule.VehicleID, rule.SignalName, rule.Op, rule.ValueNum, rule.ValueText,
		rule.ValueBool, rule.ValueMin, rule.ValueMax, rule.Severity, rule.CooldownMin,
		rule.TriggerMode, rule.SnoozedUntil,
		rule.Kind, rule.MetricID, rule.MetricWindow, rule.MetricThreshold, rule.MetricOp).
		Scan(&rule.ID, &rule.CreatedAt, &rule.UpdatedAt)
}

func (r *AlertRuleRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM alert_rules WHERE id = $1`, id)
	return err
}

// FilterExistingIDs returns the subset of `ids` that exist in alert_rules.
// Used by bulk handlers to surface {id, "not_found"} per-id failures.
func (r *AlertRuleRepo) FilterExistingIDs(ctx context.Context, ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.db.Pool.Query(ctx, `SELECT id FROM alert_rules WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]int64, 0, len(ids))
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// BulkSetEnabled toggles `enabled` for every rule in `ids` inside a single
// transaction. Returns the actual rows-affected count. Bumps updated_at
// so the audit trail reflects the action.
func (r *AlertRuleRepo) BulkSetEnabled(ctx context.Context, ids []int64, enabled bool) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var updated int64
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx,
			`UPDATE alert_rules SET enabled = $2, updated_at = NOW() WHERE id = ANY($1)`,
			ids, enabled)
		if err != nil {
			return err
		}
		updated = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return 0, err
	}
	return updated, nil
}

// SetSnooze sets snoozed_until on a rule. Pass nil to clear the snooze.
// updated_at is bumped so the audit trail reflects the action.
func (r *AlertRuleRepo) SetSnooze(ctx context.Context, id int64, until *time.Time) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE alert_rules SET snoozed_until = $2, updated_at = NOW() WHERE id = $1`,
		id, until)
	return err
}
