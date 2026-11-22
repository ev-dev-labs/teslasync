package smartreadiness

import (
	"context"
	"fmt"
	"time"

	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

var _ port.CabinDepartureHistory = (*Repository)(nil)

func (r *Repository) CabinDepartures(ctx context.Context, vehicleID int64, now, departure time.Time, loc *time.Location) ([]time.Time, error) {
	if loc == nil || vehicleID <= 0 || !departure.After(now) {
		return nil, nil
	}
	local := departure.In(loc)
	minute := local.Hour()*60 + local.Minute()
	weekend := local.Weekday() == time.Saturday || local.Weekday() == time.Sunday
	rows, err := r.db.Pool.Query(ctx, `
		WITH morning AS (
			SELECT d.id,d.started_at,timezone($4::text,d.started_at) AS local_start
			FROM drives d
			JOIN vehicles v ON v.id=d.vehicle_id AND v.archived_at IS NULL
			WHERE d.vehicle_id=$1 AND d.started_at >= $2::timestamptz-INTERVAL '45 days'
				AND d.started_at<$2 AND d.ended_at>d.started_at AND d.ended_at<=$2
				AND d.started_at<$3
		), first_morning_departures AS (
			SELECT DISTINCT ON (local_start::date) started_at
			FROM morning m
			WHERE (EXTRACT(ISODOW FROM local_start)>=6)=$5
				AND (EXTRACT(HOUR FROM local_start)*60+EXTRACT(MINUTE FROM local_start)) BETWEEN $6::int AND $7::int
				AND NOT EXISTS (
					SELECT 1 FROM drives prior WHERE prior.vehicle_id=$1 AND prior.id<>m.id
						AND prior.started_at<m.started_at
						AND (prior.ended_at IS NULL OR prior.ended_at>m.started_at-INTERVAL '40 minutes')
				)
			ORDER BY local_start::date DESC, started_at, id
		)
		SELECT started_at FROM first_morning_departures ORDER BY started_at DESC LIMIT 12`,
		vehicleID, now, time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc), loc.String(), weekend,
		minute-60, minute+45)
	if err != nil {
		return nil, fmt.Errorf("list comparable completed cabin departures: %w", err)
	}
	defer rows.Close()
	at := make([]time.Time, 0, 12)
	for rows.Next() {
		var start time.Time
		if err := rows.Scan(&start); err != nil {
			return nil, fmt.Errorf("scan completed cabin departure: %w", err)
		}
		at = append(at, start)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate comparable completed cabin departures: %w", err)
	}
	return at, nil
}
