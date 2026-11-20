package smartcommute

import (
	"context"
	"fmt"
	"time"

	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
	"github.com/jackc/pgx/v5"
)

var _ port.RouteEnergyHistory = (*Repository)(nil)

func (r *Repository) RouteEnergyDrives(
	ctx context.Context, check port.TrafficCheck, from, until time.Time, limit int,
) ([]port.RouteEnergyDrive, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT d.id, d.started_at, d.ended_at
		FROM drives d
		WHERE d.vehicle_id = $4 AND d.started_at >= $7 AND d.ended_at <= $8
		  AND d.ended_at > d.started_at AND d.ended_at <= d.started_at + INTERVAL '3 hours'
		  AND d.start_lat BETWEEN -90 AND 90 AND d.start_lng BETWEEN -180 AND 180
		  AND d.end_lat BETWEEN -90 AND 90 AND d.end_lng BETWEEN -180 AND 180
		  AND EXISTS (
			SELECT 1 `+claimedTrafficScope+`
			  AND c.compare_route_energy
			  AND ABS(d.start_lat - r.origin_latitude) <= 0.004
			  AND ABS(d.end_lat - r.destination_latitude) <= 0.004
			  AND LEAST(ABS(d.start_lng - r.origin_longitude), 360 - ABS(d.start_lng - r.origin_longitude))
			      * COS(RADIANS(r.origin_latitude)) <= 0.004
			  AND LEAST(ABS(d.end_lng - r.destination_longitude), 360 - ABS(d.end_lng - r.destination_longitude))
			      * COS(RADIANS(r.destination_latitude)) <= 0.004
		  )
		ORDER BY d.ended_at DESC, d.id DESC LIMIT $9`,
		check.ConsentID, check.Routine.ID, check.Subject, check.Routine.VehicleID,
		check.SettingsUpdatedAt, check.Consent.DepartureAt, from, until, limit)
	if err != nil {
		return nil, fmt.Errorf("list bounded completed drives for route energy: %w", err)
	}
	drives, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (port.RouteEnergyDrive, error) {
		var drive port.RouteEnergyDrive
		err := row.Scan(&drive.ID, &drive.StartedAt, &drive.EndedAt)
		return drive, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan completed route energy drive: %w", err)
	}
	return drives, nil
}
