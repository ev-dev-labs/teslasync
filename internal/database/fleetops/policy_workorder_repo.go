package fleetops

import (
	"context"
	"errors"
	"fmt"

	models "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
	"github.com/jackc/pgx/v5"
)

const chargingPolicySelect = `
	SELECT p.id, p.vehicle_id, v.display_name AS vehicle_display_name,
	       p.name, p.target_soc_pct, p.max_power_w, p.priority,
	       p.effective_from, p.effective_to, p.enabled, p.version,
	       p.created_at, p.updated_at
	FROM fleet_charging_policies p
	JOIN vehicles v ON v.id = p.vehicle_id`

func scanChargingPolicy(row pgx.Row) (*models.FleetChargingPolicy, error) {
	item := &models.FleetChargingPolicy{}
	err := row.Scan(
		&item.ID, &item.VehicleID, &item.VehicleDisplayName, &item.Name,
		&item.TargetSOCPct, &item.MaxPowerW, &item.Priority, &item.EffectiveFrom,
		&item.EffectiveTo, &item.Enabled, &item.Version, &item.CreatedAt, &item.UpdatedAt,
	)
	return item, err
}

type chargingWindowQuerier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func loadChargingWindowsForPolicies(
	ctx context.Context,
	q chargingWindowQuerier,
	policyIDs []int64,
) (map[int64][]models.FleetChargingPolicyWindow, error) {
	itemsByPolicy := make(map[int64][]models.FleetChargingPolicyWindow, len(policyIDs))
	for _, policyID := range policyIDs {
		itemsByPolicy[policyID] = make([]models.FleetChargingPolicyWindow, 0)
	}
	if len(policyIDs) == 0 {
		return itemsByPolicy, nil
	}

	rows, err := q.Query(ctx, `
		SELECT id, charging_policy_id, day_of_week,
		       to_char(start_local_time, 'HH24:MI'),
		       to_char(end_local_time, 'HH24:MI'),
		       created_at, updated_at
		FROM fleet_charging_policy_windows
		WHERE charging_policy_id = ANY($1)
		ORDER BY charging_policy_id, day_of_week, start_local_time, id`, policyIDs)
	if err != nil {
		return nil, fmt.Errorf("list fleet charging policy windows: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var item models.FleetChargingPolicyWindow
		if err := rows.Scan(
			&item.ID, &item.ChargingPolicyID, &item.DayOfWeek,
			&item.StartLocalTime, &item.EndLocalTime, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan fleet charging policy window: %w", err)
		}
		itemsByPolicy[item.ChargingPolicyID] = append(itemsByPolicy[item.ChargingPolicyID], item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate fleet charging policy windows: %w", err)
	}
	return itemsByPolicy, nil
}

func loadChargingWindows(
	ctx context.Context,
	q chargingWindowQuerier,
	policyID int64,
) ([]models.FleetChargingPolicyWindow, error) {
	itemsByPolicy, err := loadChargingWindowsForPolicies(ctx, q, []int64{policyID})
	if err != nil {
		return nil, err
	}
	return itemsByPolicy[policyID], nil
}

func getChargingPolicy(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}, id int64) (*models.FleetChargingPolicy, error) {
	item, err := scanChargingPolicy(q.QueryRow(ctx, chargingPolicySelect+` WHERE p.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get fleet charging policy: %w", err)
	}
	item.Windows, err = loadChargingWindows(ctx, q, item.ID)
	if err != nil {
		return nil, err
	}
	return item, nil
}

func (r *Repository) ListChargingPolicies(ctx context.Context, f ChargingPolicyFilter) ([]models.FleetChargingPolicy, int, error) {
	f.Limit, f.Offset = normalizePage(f.Limit, f.Offset)
	const where = `
		WHERE ($1::bigint IS NULL OR p.vehicle_id = $1)
		  AND ($2::boolean IS NULL OR p.enabled = $2)
		  AND ($3::timestamptz IS NULL OR
		       (p.effective_from <= $3 AND (p.effective_to IS NULL OR p.effective_to > $3)))`
	var total int
	if err := r.db.Pool.QueryRow(ctx,
		`SELECT count(*) FROM fleet_charging_policies p`+where,
		f.VehicleID, f.Enabled, f.ActiveAt,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count fleet charging policies: %w", err)
	}
	rows, err := r.db.Pool.Query(ctx, chargingPolicySelect+where+`
		ORDER BY p.priority, p.effective_from DESC, p.id
		LIMIT $4 OFFSET $5`,
		f.VehicleID, f.Enabled, f.ActiveAt, f.Limit, f.Offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list fleet charging policies: %w", err)
	}
	defer rows.Close()
	items := make([]models.FleetChargingPolicy, 0)
	for rows.Next() {
		item, scanErr := scanChargingPolicy(rows)
		if scanErr != nil {
			return nil, 0, fmt.Errorf("scan fleet charging policy: %w", scanErr)
		}
		items = append(items, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate fleet charging policies: %w", err)
	}
	policyIDs := make([]int64, len(items))
	for i := range items {
		policyIDs[i] = items[i].ID
	}
	windowsByPolicy, err := loadChargingWindowsForPolicies(ctx, r.db.Pool, policyIDs)
	if err != nil {
		return nil, 0, err
	}
	for i := range items {
		items[i].Windows = windowsByPolicy[items[i].ID]
	}
	return items, total, nil
}

func (r *Repository) GetChargingPolicy(ctx context.Context, id int64) (*models.FleetChargingPolicy, error) {
	return getChargingPolicy(ctx, r.db.Pool, id)
}

func insertChargingWindows(ctx context.Context, tx pgx.Tx, policyID int64, windows []models.FleetChargingPolicyWindow) error {
	for _, window := range windows {
		if _, err := tx.Exec(ctx, `
			INSERT INTO fleet_charging_policy_windows
			    (charging_policy_id, day_of_week, start_local_time, end_local_time)
			VALUES ($1, $2, $3::time, $4::time)`,
			policyID, window.DayOfWeek, window.StartLocalTime, window.EndLocalTime,
		); err != nil {
			return classifyPGError(err)
		}
	}
	return nil
}

func (r *Repository) CreateChargingPolicy(ctx context.Context, item *models.FleetChargingPolicy) error {
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if err := advisoryLocks(ctx, tx, vehicleLockKey(item.VehicleID)); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO fleet_charging_policies
			    (vehicle_id, name, target_soc_pct, max_power_w, priority,
			     effective_from, effective_to, enabled)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING id`,
			item.VehicleID, item.Name, item.TargetSOCPct, item.MaxPowerW,
			item.Priority, item.EffectiveFrom, item.EffectiveTo, item.Enabled,
		).Scan(&item.ID); err != nil {
			return classifyPGError(err)
		}
		if err := insertChargingWindows(ctx, tx, item.ID, item.Windows); err != nil {
			return err
		}
		got, err := getChargingPolicy(ctx, tx, item.ID)
		if err != nil {
			return err
		}
		*item = *got
		return nil
	})
	if err != nil {
		return fmt.Errorf("create fleet charging policy: %w", err)
	}
	return nil
}

func (r *Repository) UpdateChargingPolicy(ctx context.Context, item *models.FleetChargingPolicy) error {
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var oldVehicleID int64
		var currentVersion int
		if err := tx.QueryRow(ctx, `
			SELECT vehicle_id, version FROM fleet_charging_policies
			WHERE id = $1 FOR UPDATE`, item.ID,
		).Scan(&oldVehicleID, &currentVersion); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return fmt.Errorf("lock fleet charging policy: %w", err)
		}
		if currentVersion != item.Version {
			return ErrVersionConflict
		}
		if err := advisoryLocks(ctx, tx,
			vehicleLockKey(oldVehicleID), vehicleLockKey(item.VehicleID)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE fleet_charging_policies
			SET vehicle_id = $2, name = $3, target_soc_pct = $4,
			    max_power_w = $5, priority = $6, effective_from = $7,
			    effective_to = $8, enabled = $9, version = version + 1
			WHERE id = $1`,
			item.ID, item.VehicleID, item.Name, item.TargetSOCPct,
			item.MaxPowerW, item.Priority, item.EffectiveFrom,
			item.EffectiveTo, item.Enabled,
		); err != nil {
			return classifyPGError(err)
		}
		if _, err := tx.Exec(ctx,
			`DELETE FROM fleet_charging_policy_windows WHERE charging_policy_id = $1`,
			item.ID,
		); err != nil {
			return fmt.Errorf("replace fleet charging policy windows: %w", err)
		}
		if err := insertChargingWindows(ctx, tx, item.ID, item.Windows); err != nil {
			return err
		}
		got, err := getChargingPolicy(ctx, tx, item.ID)
		if err != nil {
			return err
		}
		*item = *got
		return nil
	})
	if err != nil {
		return fmt.Errorf("update fleet charging policy: %w", err)
	}
	return nil
}

func (r *Repository) DeleteChargingPolicy(ctx context.Context, id int64, version int) error {
	return r.deleteVersioned(ctx, "fleet_charging_policies", id, version)
}

const workOrderSelect = `
	SELECT w.id, w.vehicle_id, v.display_name AS vehicle_display_name,
	       w.cost_center_id, c.name AS cost_center_name,
	       w.title, w.description, w.status, w.severity, w.due_odometer_m,
	       w.due_at, w.scheduled_start_at, w.scheduled_end_at,
	       w.cost_minor, w.currency, w.version, w.created_at, w.updated_at
	FROM fleet_maintenance_work_orders w
	JOIN vehicles v ON v.id = w.vehicle_id
	LEFT JOIN fleet_cost_centers c ON c.id = w.cost_center_id`

func scanWorkOrder(row pgx.Row) (*models.FleetMaintenanceWorkOrder, error) {
	item := &models.FleetMaintenanceWorkOrder{}
	err := row.Scan(
		&item.ID, &item.VehicleID, &item.VehicleDisplayName,
		&item.CostCenterID, &item.CostCenterName, &item.Title, &item.Description,
		&item.Status, &item.Severity, &item.DueOdometerM, &item.DueAt,
		&item.ScheduledStartAt, &item.ScheduledEndAt, &item.CostMinor,
		&item.Currency, &item.Version, &item.CreatedAt, &item.UpdatedAt,
	)
	return item, err
}

func (r *Repository) ListWorkOrders(ctx context.Context, f WorkOrderFilter) ([]models.FleetMaintenanceWorkOrder, int, error) {
	f.Limit, f.Offset = normalizePage(f.Limit, f.Offset)
	const where = `
		WHERE ($1::bigint IS NULL OR w.vehicle_id = $1)
		  AND ($2::bigint IS NULL OR w.cost_center_id = $2)
		  AND ($3 = '' OR w.status = $3)
		  AND ($4 = '' OR w.severity = $4)`
	var total int
	if err := r.db.Pool.QueryRow(ctx,
		`SELECT count(*) FROM fleet_maintenance_work_orders w`+where,
		f.VehicleID, f.CostCenterID, f.Status, f.Severity,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count fleet work orders: %w", err)
	}
	rows, err := r.db.Pool.Query(ctx, workOrderSelect+where+`
		ORDER BY CASE w.severity
		           WHEN 'critical' THEN 0 WHEN 'high' THEN 1
		           WHEN 'medium' THEN 2 ELSE 3 END,
		         w.due_at NULLS LAST, w.id DESC
		LIMIT $5 OFFSET $6`,
		f.VehicleID, f.CostCenterID, f.Status, f.Severity, f.Limit, f.Offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list fleet work orders: %w", err)
	}
	defer rows.Close()
	items := make([]models.FleetMaintenanceWorkOrder, 0)
	for rows.Next() {
		item, scanErr := scanWorkOrder(rows)
		if scanErr != nil {
			return nil, 0, fmt.Errorf("scan fleet work order: %w", scanErr)
		}
		items = append(items, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate fleet work orders: %w", err)
	}
	return items, total, nil
}

func (r *Repository) GetWorkOrder(ctx context.Context, id int64) (*models.FleetMaintenanceWorkOrder, error) {
	item, err := scanWorkOrder(r.db.Pool.QueryRow(ctx, workOrderSelect+` WHERE w.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get fleet work order: %w", err)
	}
	return item, nil
}

func (r *Repository) CreateWorkOrder(ctx context.Context, item *models.FleetMaintenanceWorkOrder) error {
	got, err := scanWorkOrder(r.db.Pool.QueryRow(ctx, `
		WITH inserted AS (
			INSERT INTO fleet_maintenance_work_orders
			    (vehicle_id, cost_center_id, title, description, status, severity,
			     due_odometer_m, due_at, scheduled_start_at, scheduled_end_at,
			     cost_minor, currency)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			RETURNING *
		)
		SELECT i.id, i.vehicle_id, v.display_name, i.cost_center_id, c.name,
		       i.title, i.description, i.status, i.severity, i.due_odometer_m,
		       i.due_at, i.scheduled_start_at, i.scheduled_end_at,
		       i.cost_minor, i.currency, i.version, i.created_at, i.updated_at
		FROM inserted i
		JOIN vehicles v ON v.id = i.vehicle_id
		LEFT JOIN fleet_cost_centers c ON c.id = i.cost_center_id`,
		item.VehicleID, item.CostCenterID, item.Title, item.Description,
		item.Status, item.Severity, item.DueOdometerM, item.DueAt,
		item.ScheduledStartAt, item.ScheduledEndAt, item.CostMinor, item.Currency,
	))
	if err != nil {
		return fmt.Errorf("create fleet work order: %w", classifyPGError(err))
	}
	*item = *got
	return nil
}

func (r *Repository) UpdateWorkOrder(ctx context.Context, item *models.FleetMaintenanceWorkOrder) error {
	got, err := scanWorkOrder(r.db.Pool.QueryRow(ctx, `
		WITH updated AS (
			UPDATE fleet_maintenance_work_orders
			SET vehicle_id = $2, cost_center_id = $3, title = $4,
			    description = $5, status = $6, severity = $7,
			    due_odometer_m = $8, due_at = $9, scheduled_start_at = $10,
			    scheduled_end_at = $11, cost_minor = $12, currency = $13,
			    version = version + 1
			WHERE id = $1 AND version = $14
			RETURNING *
		)
		SELECT u.id, u.vehicle_id, v.display_name, u.cost_center_id, c.name,
		       u.title, u.description, u.status, u.severity, u.due_odometer_m,
		       u.due_at, u.scheduled_start_at, u.scheduled_end_at,
		       u.cost_minor, u.currency, u.version, u.created_at, u.updated_at
		FROM updated u
		JOIN vehicles v ON v.id = u.vehicle_id
		LEFT JOIN fleet_cost_centers c ON c.id = u.cost_center_id`,
		item.ID, item.VehicleID, item.CostCenterID, item.Title, item.Description,
		item.Status, item.Severity, item.DueOdometerM, item.DueAt,
		item.ScheduledStartAt, item.ScheduledEndAt, item.CostMinor,
		item.Currency, item.Version,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return classifyMutationMiss(ctx, r.db.Pool,
			`SELECT EXISTS(SELECT 1 FROM fleet_maintenance_work_orders WHERE id = $1)`,
			item.ID)
	}
	if err != nil {
		return fmt.Errorf("update fleet work order: %w", classifyPGError(err))
	}
	*item = *got
	return nil
}

func (r *Repository) DeleteWorkOrder(ctx context.Context, id int64, version int) error {
	return r.deleteVersioned(ctx, "fleet_maintenance_work_orders", id, version)
}
