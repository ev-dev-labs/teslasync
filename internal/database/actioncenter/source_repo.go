// Package actioncenter implements PostgreSQL adapters for the Action Center.
package actioncenter

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	fleetdb "github.com/ev-dev-labs/teslasync/internal/database/fleetops"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	fleetmodels "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
)

type workOrderLister interface {
	ListWorkOrders(ctx context.Context, filter fleetdb.WorkOrderFilter) ([]fleetmodels.FleetMaintenanceWorkOrder, int, error)
}

type SourceRepository struct {
	q          database.DBTX
	workOrders workOrderLister
}

func NewSourceRepository(db *database.DB) *SourceRepository {
	if db == nil || db.Pool == nil {
		panic("actioncenter.NewSourceRepository: db and db.Pool must not be nil")
	}
	return &SourceRepository{
		q:          db.Pool,
		workOrders: fleetdb.NewRepository(db),
	}
}

func (r *SourceRepository) ListActiveAlerts(
	ctx context.Context,
	vehicleID *int64,
	since time.Time,
	limit int,
) ([]domain.AlertRecord, error) {
	const query = `
		SELECT nl.id, nl.alert_id, ar.vehicle_id, v.display_name,
		       nl.title, nl.message, COALESCE(NULLIF(nl.severity, ''), ar.severity, 'info'),
		       nl.status, nl.created_at
		FROM notification_logs nl
		LEFT JOIN alert_rules ar ON ar.id = nl.alert_id
		LEFT JOIN vehicles v ON v.id = ar.vehicle_id
		WHERE nl.alert_id IS NOT NULL
		  AND nl.acknowledged_at IS NULL
		  AND nl.archived_at IS NULL
		  AND nl.created_at >= $1
		  AND ($2::bigint IS NULL OR ar.vehicle_id = $2)
		ORDER BY nl.created_at DESC, nl.id DESC
		LIMIT $3`
	rows, err := r.q.Query(ctx, query, since, vehicleID, limit)
	if err != nil {
		return nil, fmt.Errorf("list action center active alerts: %w", err)
	}
	defer rows.Close()

	items := make([]domain.AlertRecord, 0)
	for rows.Next() {
		var item domain.AlertRecord
		var alertID *int64
		var vehicleIDValue *int64
		var vehicleName *string
		if err := rows.Scan(
			&item.LogID, &alertID, &vehicleIDValue, &vehicleName,
			&item.Title, &item.Message, &item.Severity, &item.DeliveryStatus,
			&item.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan action center active alert: %w", err)
		}
		if alertID != nil {
			item.AlertID = *alertID
		}
		if vehicleIDValue != nil {
			name := "Vehicle"
			if vehicleName != nil && *vehicleName != "" {
				name = *vehicleName
			}
			item.Vehicle = &domain.VehicleRef{ID: *vehicleIDValue, DisplayName: name}
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate action center active alerts: %w", err)
	}
	return items, nil
}

func (r *SourceRepository) ListStaleChargingSessions(
	ctx context.Context,
	vehicleID *int64,
	cutoff time.Time,
	limit int,
) ([]domain.ChargingRecord, error) {
	const query = `
		SELECT cs.id, cs.vehicle_id, v.display_name, cs.started_at,
		       cs.start_soc_pct, cs.start_place
		FROM charging_sessions cs
		JOIN vehicles v ON v.id = cs.vehicle_id
		WHERE cs.ended_at IS NULL
		  AND cs.started_at < $1
		  AND v.archived_at IS NULL
		  AND ($2::bigint IS NULL OR cs.vehicle_id = $2)
		ORDER BY cs.started_at ASC, cs.id ASC
		LIMIT $3`
	rows, err := r.q.Query(ctx, query, cutoff, vehicleID, limit)
	if err != nil {
		return nil, fmt.Errorf("list action center stale charging sessions: %w", err)
	}
	defer rows.Close()

	items := make([]domain.ChargingRecord, 0)
	for rows.Next() {
		var item domain.ChargingRecord
		if err := rows.Scan(
			&item.SessionID, &item.Vehicle.ID, &item.Vehicle.DisplayName,
			&item.StartedAt, &item.StartSocPct, &item.StartPlace,
		); err != nil {
			return nil, fmt.Errorf("scan action center stale charging session: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate action center stale charging sessions: %w", err)
	}
	return items, nil
}

func (r *SourceRepository) ListActiveWorkOrders(
	ctx context.Context,
	vehicleID *int64,
	limit int,
) ([]domain.WorkOrderRecord, error) {
	// Reuse fleet operations' canonical work-order reader rather than
	// duplicating its joins, severity order, or persistence contract.
	statuses := []string{"open", "scheduled", "in_progress"}
	items := make([]domain.WorkOrderRecord, 0, limit*len(statuses))
	for _, status := range statuses {
		rows, _, err := r.workOrders.ListWorkOrders(ctx, fleetdb.WorkOrderFilter{
			VehicleID: vehicleID,
			Status:    status,
			Limit:     limit,
			Offset:    0,
		})
		if err != nil {
			return nil, fmt.Errorf("list action center %s work orders: %w", status, err)
		}
		for _, row := range rows {
			items = append(items, domain.WorkOrderRecord{
				ID:               row.ID,
				Vehicle:          domain.VehicleRef{ID: row.VehicleID, DisplayName: row.VehicleDisplayName},
				Title:            row.Title,
				Description:      row.Description,
				Status:           row.Status,
				Severity:         row.Severity,
				DueAt:            row.DueAt,
				ScheduledStartAt: row.ScheduledStartAt,
				ScheduledEndAt:   row.ScheduledEndAt,
				CostMinor:        row.CostMinor,
				Currency:         row.Currency,
				UpdatedAt:        row.UpdatedAt,
			})
		}
	}
	severityWeight := map[string]int{"critical": 4, "high": 3, "medium": 2, "low": 1}
	sort.SliceStable(items, func(i, j int) bool {
		if severityWeight[items[i].Severity] != severityWeight[items[j].Severity] {
			return severityWeight[items[i].Severity] > severityWeight[items[j].Severity]
		}
		if items[i].DueAt == nil {
			return false
		}
		if items[j].DueAt == nil {
			return true
		}
		if !items[i].DueAt.Equal(*items[j].DueAt) {
			return items[i].DueAt.Before(*items[j].DueAt)
		}
		return items[i].ID > items[j].ID
	})
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (r *SourceRepository) ListSignalHealth(
	ctx context.Context,
	vehicleID *int64,
	from, to time.Time,
	limit int,
) ([]domain.SignalHealthRecord, error) {
	const query = `
		SELECT v.id, v.display_name, latest.latest_at
		FROM vehicles v
		LEFT JOIN LATERAL (
			SELECT sl.ts AS latest_at
			FROM signal_log sl
			WHERE sl.vehicle_id = v.id
			  AND sl.ts >= $1
			  AND sl.ts <= $2
			ORDER BY sl.ts DESC
			LIMIT 1
		) latest ON true
		WHERE v.archived_at IS NULL
		  AND ($3::bigint IS NULL OR v.id = $3)
		ORDER BY latest.latest_at ASC NULLS FIRST, v.id ASC
		LIMIT $4`
	rows, err := r.q.Query(ctx, query, from, to, vehicleID, limit)
	if err != nil {
		return nil, fmt.Errorf("list action center signal health: %w", err)
	}
	defer rows.Close()

	items := make([]domain.SignalHealthRecord, 0)
	for rows.Next() {
		var item domain.SignalHealthRecord
		if err := rows.Scan(&item.Vehicle.ID, &item.Vehicle.DisplayName, &item.LatestSignalAt); err != nil {
			return nil, fmt.Errorf("scan action center signal health: %w", err)
		}
		item.CheckedAt = to
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate action center signal health: %w", err)
	}
	return items, nil
}
