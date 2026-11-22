package smartreadiness

import (
	"context"
	"fmt"
	"time"

	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
)

var _ port.ParkReserveWindows = (*Repository)(nil)

func (r *Repository) ParkReserveWindows(ctx context.Context, vehicleID int64, earliest, now time.Time, stay time.Duration) ([]port.ParkReserveWindow, error) {
	rows, err := r.db.Pool.Query(ctx, `
		WITH adjacent AS (
			SELECT d.started_at,d.ended_at AS park_start,
				LEAD(d.started_at) OVER w AS park_end, LEAD(d.ended_at) OVER w AS next_completed_at
			FROM drives d JOIN vehicles v ON v.id=d.vehicle_id AND v.archived_at IS NULL
			WHERE d.vehicle_id=$1 AND d.started_at>=$2::timestamptz-INTERVAL '1 day' AND d.started_at<$3
			WINDOW w AS (ORDER BY d.started_at,d.id)
		)
		SELECT a.park_start,a.park_end FROM adjacent a
		WHERE a.park_start>a.started_at AND a.park_start>=$2 AND a.next_completed_at>a.park_end
			AND a.next_completed_at<=$3
			AND a.park_end-a.park_start BETWEEN ($4::double precision*0.8)*INTERVAL '1 second'
				AND ($4::double precision*1.2)*INTERVAL '1 second'+INTERVAL '90 minutes'
			AND NOT EXISTS (
				SELECT 1 FROM charging_sessions s WHERE s.vehicle_id=$1 AND s.started_at<a.park_end
					AND (s.ended_at IS NULL OR s.ended_at>a.park_start)
			)
			AND NOT EXISTS (
				SELECT 1 FROM drives d WHERE d.vehicle_id=$1 AND d.started_at<a.park_end
					AND (d.ended_at IS NULL OR d.ended_at>a.park_start)
			)
		ORDER BY a.park_end DESC LIMIT 18`, vehicleID, earliest, now, stay.Seconds())
	if err != nil {
		return nil, fmt.Errorf("list bounded drive-bracketed parks: %w", err)
	}
	windows, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (port.ParkReserveWindow, error) {
		var window port.ParkReserveWindow
		err := row.Scan(&window.Start, &window.End)
		return window, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan drive-bracketed parks: %w", err)
	}
	return windows, nil
}
