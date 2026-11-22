package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	personal "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
)

var _ port.WindowRainRepository = (*Repository)(nil)

const noWindowRainDelivery = `NOT EXISTS (SELECT 1 FROM smart_push_window_rain_deliveries sent WHERE sent.plan_id=p.id)`

func (r *Repository) ReadWindowRain(ctx context.Context, scope port.WindowRainScope) (*domain.WindowRainPlan, error) {
	var plan domain.WindowRainPlan
	var created, until, park, observed, forecast, start, end, expiry *time.Time
	var risk domain.WindowRainRisk
	var current bool
	err := r.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(p.id,0),p.created_at,p.watch_until,COALESCE(p.paused,false),COALESCE(p.reason,''),
			COALESCE(p.device_id,0),d.id IS NOT NULL,COALESCE(p.latitude_grid,0),COALESCE(p.longitude_grid,0),
			p.park_observed_at,COALESCE(p.window_position,''),p.window_observed_at,p.forecast_at,p.risk_start_at,p.risk_end_at,p.risk_expires_at,
			smart_feature_current($1,'window_rain',p.feature_checked_at)
		FROM vehicles v
		LEFT JOIN smart_window_rain_plans p ON p.vehicle_id=v.id AND p.subject=$1
		LEFT JOIN smart_push_devices d ON d.id=p.device_id AND d.subject=p.subject AND d.verified_at=p.device_verified_at
		WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID).
		Scan(&plan.ID, &created, &until, &plan.Paused, &plan.Reason, &plan.DeviceID, &plan.DeviceReady,
			&plan.Grid.LatitudeHundredths, &plan.Grid.LongitudeHundredths,
			&park, &risk.Window.Position, &observed, &forecast, &start, &end, &expiry, &current)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read private window rain watch: %w", err)
	}
	if created == nil || until == nil {
		return nil, nil
	}
	plan.CreatedAt, plan.WatchUntil = *created, *until
	if park != nil {
		plan.ParkObservedAt = *park
	}
	if !current {
		plan.Reason = ""
		return &plan, nil
	}
	if observed != nil && forecast != nil && start != nil && end != nil && expiry != nil {
		risk.Window.ObservedAt, risk.ForecastAt, risk.RiskStartAt, risk.RiskEndAt, risk.ExpiresAt =
			*observed, *forecast, *start, *end, *expiry
		plan.Risk = &risk
	}
	return &plan, nil
}

func (r *Repository) ReplaceWindowRain(ctx context.Context, scope port.WindowRainScope, expectedID int64, setup domain.WindowRainSetup, grid domain.WeatherGrid, now, park time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if expectedID != 0 {
			tag, err := tx.Exec(ctx, `DELETE FROM smart_window_rain_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
				scope.Subject, scope.VehicleID, expectedID)
			if err != nil {
				return fmt.Errorf("replace private window rain watch: %w", err)
			}
			if tag.RowsAffected() != 1 {
				return port.ErrWindowRainChanged
			}
		}
		tag, err := tx.Exec(ctx, `INSERT INTO smart_window_rain_plans
			(subject,vehicle_id,created_at,watch_until,latitude_grid,longitude_grid,device_id,device_verified_at,push_title,push_body,next_check_at,reason,park_observed_at)
			SELECT $1,v.id,$4,$5,$6,$7,d.id,d.verified_at,$8,$9,$4,'monitoring',$10
			FROM vehicles v JOIN smart_push_devices d ON d.id=$3 AND d.subject=$1 AND d.verified_at IS NOT NULL
			WHERE v.id=$2 AND v.archived_at IS NULL ON CONFLICT (subject,vehicle_id) DO NOTHING`,
			scope.Subject, scope.VehicleID, setup.DeviceID, now, now.Add(time.Duration(setup.DurationS)*time.Second),
			grid.LatitudeHundredths, grid.LongitudeHundredths, setup.PushTitle, setup.PushBody, park)
		if err != nil {
			return fmt.Errorf("save private outdoor parking watch: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrWindowRainChanged
		}
		return nil
	})
}

func (r *Repository) PauseWindowRain(ctx context.Context, scope port.WindowRainScope, id int64) error {
	tag, err := r.db.Pool.Exec(ctx, `UPDATE smart_window_rain_plans p
		SET paused=true,next_check_at=NULL,lease_until=NULL,reason='monitoring',window_position=NULL,window_observed_at=NULL,
			forecast_at=NULL,risk_start_at=NULL,risk_end_at=NULL,risk_expires_at=NULL,latitude_grid=NULL,longitude_grid=NULL,park_observed_at=NULL
		WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND NOT p.paused
			AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id=p.vehicle_id AND v.archived_at IS NULL)`,
		scope.Subject, scope.VehicleID, id)
	if err != nil {
		return fmt.Errorf("pause private window rain watch: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrWindowRainChanged
	}
	return nil
}

func (r *Repository) DeleteWindowRain(ctx context.Context, scope port.WindowRainScope, id int64) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_window_rain_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		scope.Subject, scope.VehicleID, id)
	if err != nil {
		return fmt.Errorf("clear private window rain watch: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrWindowRainChanged
	}
	return nil
}

func (r *Repository) ClaimWindowRain(ctx context.Context, now, lease time.Time) (*port.WindowRainJob, error) {
	var job port.WindowRainJob
	err := r.db.Pool.QueryRow(ctx, `WITH due AS (
		SELECT p.id FROM smart_window_rain_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		JOIN smart_push_devices d ON d.id=p.device_id AND d.subject=p.subject AND d.verified_at=p.device_verified_at
		WHERE p.next_check_at<=$1 AND (p.lease_until IS NULL OR p.lease_until<=$1)
		  AND p.watch_until>$1 AND NOT p.paused AND p.subject NOT IN ($3,'open-mode')
		  AND smart_feature_allowed(p.subject,'window_rain')
		  AND `+noWindowRainDelivery+`
		ORDER BY p.next_check_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED
	)
	UPDATE smart_window_rain_plans p SET lease_until=$2,feature_claimed_at=statement_timestamp() FROM due WHERE p.id=due.id
	RETURNING p.id,p.subject,p.vehicle_id,p.created_at,p.watch_until,p.latitude_grid,p.longitude_grid,p.lease_until,p.park_observed_at`,
		now, lease, personal.OpenSubject).
		Scan(&job.Plan.ID, &job.Scope.Subject, &job.Scope.VehicleID, &job.Plan.CreatedAt, &job.Plan.WatchUntil,
			&job.Plan.Grid.LatitudeHundredths, &job.Plan.Grid.LongitudeHundredths, &job.LeaseUntil, &job.Plan.ParkObservedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim due outdoor parking watch: %w", err)
	}
	return &job, nil
}

func (r *Repository) WindowRainParkEnded(ctx context.Context, vehicle int64, parkedAt, confirmedAt, now time.Time) (bool, error) {
	var moved bool
	// Drive close debounce can place the incoming drive's end between Park and consent.
	// Recorded motion still invalidates consent even when a departure merges into that drive.
	err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM drives
		WHERE vehicle_id=$1 AND started_at<=$4 AND (ended_at IS NULL OR started_at>=$2 OR ended_at>$3))
		OR EXISTS (SELECT 1 FROM signal_log WHERE vehicle_id=$1 AND ts>=$2 AND ts<=$4
			AND ((field='Gear' AND str_value IS DISTINCT FROM 'P') OR
				(field='VehicleSpeed' AND ts>$2 AND COALESCE(float_value,int_value::float8)<>0)))`,
		vehicle, parkedAt, confirmedAt, now).Scan(&moved)
	if err != nil {
		return false, fmt.Errorf("check whether the confirmed parking session ended: %w", err)
	}
	return moved, nil
}

func (r *Repository) WindowRainLeaseActive(ctx context.Context, job port.WindowRainJob, now time.Time) (bool, error) {
	var active bool
	err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM smart_window_rain_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		JOIN smart_push_devices d ON d.id=p.device_id AND d.subject=p.subject AND d.verified_at=p.device_verified_at
		WHERE p.id=$1 AND p.lease_until=$2 AND p.lease_until>$3 AND p.watch_until>$3 AND NOT p.paused
			AND smart_feature_current(p.subject,'window_rain',p.feature_claimed_at)
			AND `+noWindowRainDelivery+`)`,
		job.Plan.ID, job.LeaseUntil, now).Scan(&active)
	if err != nil {
		return false, fmt.Errorf("recheck outdoor watch permission: %w", err)
	}
	return active, nil
}

func (r *Repository) FinishWindowRain(ctx context.Context, job port.WindowRainJob, check port.WindowRainCheck, now time.Time) (bool, error) {
	var position *domain.WindowPosition
	var observed, forecast, start, end, expiry *time.Time
	if risk := check.Risk; risk != nil {
		position, observed, forecast = &risk.Window.Position, &risk.Window.ObservedAt, &risk.ForecastAt
		start, end, expiry = &risk.RiskStartAt, &risk.RiskEndAt, &risk.ExpiresAt
	}
	tag, err := r.db.Pool.Exec(ctx, `UPDATE smart_window_rain_plans p
		SET lease_until=NULL,feature_checked_at=p.feature_claimed_at,reason=$4,next_check_at=$5,window_position=$6,window_observed_at=$7,
			forecast_at=$8,risk_start_at=$9,risk_end_at=$10,risk_expires_at=$11,
			latitude_grid=CASE WHEN $4='park_changed' THEN NULL ELSE p.latitude_grid END,
			longitude_grid=CASE WHEN $4='park_changed' THEN NULL ELSE p.longitude_grid END,
			park_observed_at=CASE WHEN $4='park_changed' THEN NULL ELSE p.park_observed_at END
		WHERE p.id=$1 AND p.lease_until=$2 AND p.lease_until>$3 AND p.watch_until>$3 AND NOT p.paused
			AND smart_feature_current(p.subject,'window_rain',p.feature_claimed_at)
			AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id=p.vehicle_id AND v.archived_at IS NULL)
			AND EXISTS (SELECT 1 FROM smart_push_devices d WHERE d.id=p.device_id AND d.subject=p.subject AND d.verified_at=p.device_verified_at)
			AND ($4<>'window_rain_risk' OR (
				`+noWindowRainDelivery+` AND NOT EXISTS (SELECT 1 FROM drives
					WHERE vehicle_id=p.vehicle_id AND started_at<=$3
						AND (ended_at IS NULL OR started_at>=p.park_observed_at OR ended_at>p.created_at))
				AND NOT EXISTS (SELECT 1 FROM signal_log WHERE vehicle_id=p.vehicle_id AND ts>=p.park_observed_at AND ts<=$3
					AND ((field='Gear' AND str_value IS DISTINCT FROM 'P') OR
						(field='VehicleSpeed' AND ts>p.park_observed_at AND COALESCE(float_value,int_value::float8)<>0)))))`,
		job.Plan.ID, job.LeaseUntil, now, check.Reason, check.NextCheck, position, observed, forecast, start, end, expiry)
	if err != nil {
		return false, fmt.Errorf("record private rain risk check: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

func (r *Repository) ExpireWindowRain(ctx context.Context, now time.Time) error {
	_, err := r.db.Pool.Exec(ctx, `WITH expired AS (
		SELECT id FROM smart_window_rain_plans WHERE watch_until<=$1 AND latitude_grid IS NOT NULL
		ORDER BY watch_until,id LIMIT 100 FOR UPDATE SKIP LOCKED
	)
	UPDATE smart_window_rain_plans p
	SET reason='expired',next_check_at=NULL,lease_until=NULL,latitude_grid=NULL,longitude_grid=NULL,park_observed_at=NULL,
		window_position=NULL,window_observed_at=NULL,forecast_at=NULL,risk_start_at=NULL,risk_end_at=NULL,risk_expires_at=NULL
	FROM expired WHERE p.id=expired.id`, now)
	if err != nil {
		return fmt.Errorf("forget expired outdoor parking locations: %w", err)
	}
	return nil
}
