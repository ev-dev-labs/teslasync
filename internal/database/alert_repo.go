package database

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AlertRepo provides alert data access operations.
type AlertRepo struct {
	db *DB
}

func NewAlertRepo(db *DB) *AlertRepo {
	return &AlertRepo{db: db}
}

func (r *AlertRepo) Create(ctx context.Context, a *models.Alert) error {
	query := `INSERT INTO alerts (vehicle_id, type, severity, title, message, is_read, created_at)
		VALUES ($1, $2, $3, $4, $5, false, $6) RETURNING id`
	now := time.Now().UTC()
	return r.db.Pool.QueryRow(ctx, query, a.VehicleID, a.Type, a.Severity, a.Title, a.Message, now).Scan(&a.ID)
}

func (r *AlertRepo) GetAll(ctx context.Context, limit, offset int) ([]*models.Alert, error) {
	query := `SELECT id, vehicle_id, type, severity, title, message, is_read, created_at
		FROM alerts ORDER BY created_at DESC LIMIT $1 OFFSET $2`
	rows, err := r.db.Pool.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var alerts []*models.Alert
	for rows.Next() {
		a := &models.Alert{}
		if err := rows.Scan(&a.ID, &a.VehicleID, &a.Type, &a.Severity, &a.Title, &a.Message, &a.IsRead, &a.CreatedAt); err != nil {
			return nil, err
		}
		alerts = append(alerts, a)
	}
	return alerts, rows.Err()
}

func (r *AlertRepo) MarkRead(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, `UPDATE alerts SET is_read = true WHERE id = $1`, id)
	return err
}

// AlertRuleRepo provides alert rule data access.
type AlertRuleRepo struct {
	db *DB
}

func NewAlertRuleRepo(db *DB) *AlertRuleRepo {
	return &AlertRuleRepo{db: db}
}

func (r *AlertRuleRepo) GetAll(ctx context.Context) ([]*models.AlertRule, error) {
	query := `SELECT id, name, type, enabled, threshold, vehicle_id, created_at, updated_at,
		conditions, COALESCE(cooldown_min, 15), for_duration_s, COALESCE(severity, 'warning'), COALESCE(msg_template, ''), notify_channels, last_fired_at, COALESCE(fire_count, 0), tags
		FROM alert_rules ORDER BY id LIMIT 1000`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []*models.AlertRule
	for rows.Next() {
		ar := &models.AlertRule{}
		if err := rows.Scan(&ar.ID, &ar.Name, &ar.Type, &ar.Enabled, &ar.Threshold, &ar.VehicleID, &ar.CreatedAt, &ar.UpdatedAt,
			&ar.Conditions, &ar.CooldownMin, &ar.ForDurationS, &ar.Severity, &ar.MsgTemplate, &ar.NotifyChannels, &ar.LastFiredAt, &ar.FireCount, &ar.Tags); err != nil {
			return nil, err
		}
		rules = append(rules, ar)
	}
	return rules, rows.Err()
}

func (r *AlertRuleRepo) UpdateFireState(ctx context.Context, ruleID int64, firedAt time.Time, fireCount int) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE alert_rules SET last_fired_at=$2, fire_count=$3 WHERE id=$1`,
		ruleID, firedAt, fireCount)
	return err
}

func (r *AlertRuleRepo) Update(ctx context.Context, id int64, enabled bool, threshold float64) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE alert_rules SET enabled=$2, threshold=$3, updated_at=$4 WHERE id=$1`,
		id, enabled, threshold, time.Now().UTC())
	return err
}

func (r *AlertRuleRepo) GetByID(ctx context.Context, id int64) (*models.AlertRule, error) {
	query := `SELECT id, name, type, enabled, threshold, vehicle_id, created_at, updated_at
		FROM alert_rules WHERE id = $1`
	ar := &models.AlertRule{}
	err := r.db.Pool.QueryRow(ctx, query, id).Scan(&ar.ID, &ar.Name, &ar.Type, &ar.Enabled, &ar.Threshold, &ar.VehicleID, &ar.CreatedAt, &ar.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return ar, err
}

func (r *AlertRuleRepo) Create(ctx context.Context, rule *models.AlertRule) error {
	condJSON, _ := json.Marshal(rule.Conditions)
	query := `INSERT INTO alert_rules (name, type, enabled, threshold, vehicle_id, conditions, cooldown_min, severity, msg_template, notify_channels, tags, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()) RETURNING id, created_at, updated_at`
	return r.db.Pool.QueryRow(ctx, query, rule.Name, rule.Type, rule.Enabled, rule.Threshold, rule.VehicleID,
		condJSON, rule.CooldownMin, rule.Severity, rule.MsgTemplate, rule.NotifyChannels, rule.Tags).
		Scan(&rule.ID, &rule.CreatedAt, &rule.UpdatedAt)
}

func (r *AlertRuleRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM alert_rules WHERE id = $1`, id)
	return err
}
