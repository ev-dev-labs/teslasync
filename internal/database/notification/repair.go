package notification

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type VehicleRepair struct {
	LogID     int64
	VehicleID int64
}

// RepairVehicleLinks is offline-only. Friendly names and a rule's current
// multi-vehicle scope are not identity evidence. Single-vehicle scope is usable
// only when the rule has not changed since the notification was created.
func (r *NotificationRepo) RepairVehicleLinks(ctx context.Context, apply bool, limit int) ([]VehicleRepair, error) {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return nil, fmt.Errorf("repair notification vehicles: database required")
	}
	if limit < 1 || limit > 10000 {
		return nil, fmt.Errorf("repair notification vehicles: limit must be 1..10000")
	}
	tx, err := r.db.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return nil, fmt.Errorf("begin notification repair: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rows, err := tx.Query(ctx, `WITH candidates AS (
		SELECT target.id, known.vehicle_id
		FROM notification_logs target
		JOIN notification_logs known ON known.trigger_id = target.trigger_id
		WHERE target.vehicle_id IS NULL AND known.vehicle_id IS NOT NULL
		UNION
		SELECT target.id, v.id
		FROM notification_logs target
		JOIN vehicles v ON v.created_at <= target.created_at
			AND v.vin <> '' AND starts_with(target.title, v.vin || ' — ')
		WHERE target.vehicle_id IS NULL
		UNION
		SELECT target.id, scope.vehicle_id
		FROM notification_logs target
		JOIN alert_rules rule ON rule.id = target.alert_id
		JOIN alert_rule_vehicles scope ON scope.rule_id = rule.id
		WHERE target.vehicle_id IS NULL AND NOT rule.all_vehicles
			AND rule.updated_at <= target.created_at
			AND (SELECT COUNT(*) FROM alert_rule_vehicles single_scope WHERE single_scope.rule_id = rule.id) = 1
	), unambiguous AS (
		SELECT id, MIN(vehicle_id) AS vehicle_id FROM candidates
		GROUP BY id HAVING COUNT(DISTINCT vehicle_id) = 1
	)
	SELECT id, vehicle_id FROM unambiguous ORDER BY id LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("plan notification vehicle repair: %w", err)
	}
	plan := make([]VehicleRepair, 0)
	for rows.Next() {
		var item VehicleRepair
		if err := rows.Scan(&item.LogID, &item.VehicleID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan notification repair: %w", err)
		}
		plan = append(plan, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read notification repair: %w", err)
	}
	if !apply {
		return plan, nil
	}
	for _, item := range plan {
		result, err := tx.Exec(ctx, `UPDATE notification_logs SET vehicle_id = $1 WHERE id = $2 AND vehicle_id IS NULL`, item.VehicleID, item.LogID)
		if err != nil {
			return nil, fmt.Errorf("repair notification %d: %w", item.LogID, err)
		}
		if result.RowsAffected() == 0 {
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO notification_log_events (notification_log_id, actor, kind, note)
			VALUES ($1, 'offline-notification-repair', 'commented', $2)`,
			item.LogID, fmt.Sprintf("Restored vehicle %d from unambiguous retained identity evidence. Message unchanged: original template parameters were not stored.", item.VehicleID)); err != nil {
			return nil, fmt.Errorf("audit notification repair %d: %w", item.LogID, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit notification repair: %w", err)
	}
	return plan, nil
}
