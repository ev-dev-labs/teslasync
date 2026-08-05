package fleetops

import (
	"context"
	"fmt"

	models "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
)

func (r *Repository) LoadForecastInputs(ctx context.Context, f ForecastFilter) (*ForecastInputs, error) {
	out := &ForecastInputs{
		Vehicles:     make([]models.FleetForecastVehicle, 0),
		Assignments:  make([]models.FleetVehicleDriverAssignment, 0),
		Reservations: make([]models.FleetReservation, 0),
		WorkOrders:   make([]models.FleetMaintenanceWorkOrder, 0),
		Drives:       make([]models.FleetForecastDrive, 0),
	}

	vehicleRows, err := r.db.Pool.Query(ctx, `
		SELECT id AS vehicle_id, display_name AS vehicle_display_name
		FROM vehicles
		WHERE archived_at IS NULL
		  AND ($1::bigint IS NULL OR id = $1)
		ORDER BY display_name, id`, f.VehicleID)
	if err != nil {
		return nil, fmt.Errorf("load forecast vehicles: %w", err)
	}
	defer vehicleRows.Close()
	for vehicleRows.Next() {
		var item models.FleetForecastVehicle
		if err := vehicleRows.Scan(&item.VehicleID, &item.VehicleDisplayName); err != nil {
			return nil, fmt.Errorf("scan forecast vehicle: %w", err)
		}
		out.Vehicles = append(out.Vehicles, item)
	}
	if err := vehicleRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate forecast vehicles: %w", err)
	}

	assignmentRows, err := r.db.Pool.Query(ctx, assignmentSelect+`
		WHERE ($1::bigint IS NULL OR a.vehicle_id = $1)
		  AND d.status = 'active'
		  AND a.starts_at < $3
		  AND (a.ends_at IS NULL OR a.ends_at > $2)
		ORDER BY a.vehicle_id, a.starts_at`,
		f.VehicleID, f.From, f.To)
	if err != nil {
		return nil, fmt.Errorf("load forecast assignments: %w", err)
	}
	defer assignmentRows.Close()
	for assignmentRows.Next() {
		item, scanErr := scanAssignment(assignmentRows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan forecast assignment: %w", scanErr)
		}
		out.Assignments = append(out.Assignments, *item)
	}
	if err := assignmentRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate forecast assignments: %w", err)
	}

	reservationRows, err := r.db.Pool.Query(ctx, reservationSelect+`
		WHERE ($1::bigint IS NULL OR r.vehicle_id = $1)
		  AND r.status IN ('requested', 'confirmed')
		  AND r.starts_at < $3 AND r.ends_at > $2
		ORDER BY r.vehicle_id, r.starts_at`,
		f.VehicleID, f.From, f.To)
	if err != nil {
		return nil, fmt.Errorf("load forecast reservations: %w", err)
	}
	defer reservationRows.Close()
	for reservationRows.Next() {
		item, scanErr := scanReservation(reservationRows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan forecast reservation: %w", scanErr)
		}
		out.Reservations = append(out.Reservations, *item)
	}
	if err := reservationRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate forecast reservations: %w", err)
	}

	workRows, err := r.db.Pool.Query(ctx, workOrderSelect+`
		WHERE ($1::bigint IS NULL OR w.vehicle_id = $1)
		  AND w.status IN ('scheduled', 'in_progress')
		  AND w.scheduled_start_at IS NOT NULL
		  AND w.scheduled_start_at < $3
		  AND COALESCE(w.scheduled_end_at, $3) > $2
		ORDER BY w.vehicle_id, w.scheduled_start_at`,
		f.VehicleID, f.From, f.To)
	if err != nil {
		return nil, fmt.Errorf("load forecast maintenance: %w", err)
	}
	defer workRows.Close()
	for workRows.Next() {
		item, scanErr := scanWorkOrder(workRows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan forecast work order: %w", scanErr)
		}
		out.WorkOrders = append(out.WorkOrders, *item)
	}
	if err := workRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate forecast work orders: %w", err)
	}

	driveRows, err := r.db.Pool.Query(ctx, `
		SELECT vehicle_id, started_at, ended_at,
		       COALESCE(duration_s, GREATEST(0, EXTRACT(EPOCH FROM ended_at - started_at)::bigint))
		FROM drives
		WHERE ended_at IS NOT NULL
		  AND started_at >= $2 AND started_at < $3
		  AND ($1::bigint IS NULL OR vehicle_id = $1)
		ORDER BY vehicle_id, started_at`,
		f.VehicleID, f.HistoryFrom, f.From)
	if err != nil {
		return nil, fmt.Errorf("load forecast drive history: %w", err)
	}
	defer driveRows.Close()
	for driveRows.Next() {
		var item models.FleetForecastDrive
		if err := driveRows.Scan(
			&item.VehicleID, &item.StartedAt, &item.EndedAt, &item.DurationS,
		); err != nil {
			return nil, fmt.Errorf("scan forecast drive: %w", err)
		}
		out.Drives = append(out.Drives, item)
	}
	if err := driveRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate forecast drives: %w", err)
	}

	return out, nil
}
