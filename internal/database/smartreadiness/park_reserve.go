package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var _ port.ParkReserveRepository = (*Repository)(nil)

func (r *Repository) ReadParkReserve(ctx context.Context, scope port.ParkReserveScope) (*domain.ParkReservePlan, error) {
	plan := domain.ParkReservePlan{VehicleID: scope.VehicleID}
	var created, returns, actionUntil, observed *time.Time
	var count, low, high *int
	var battery, outside *float64
	var sentry *string
	err := r.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(p.id,0),p.created_at,p.return_at,p.action_until,COALESCE(p.reserve_pct,0),
			p.device_id,d.id IS NOT NULL,COALESCE(p.reason,''),
			p.estimate_at,p.comparable_episodes,p.start_battery_pct,p.return_low_pct,p.return_high_pct,p.outside_c,p.sentry_mode
		FROM vehicles v
		LEFT JOIN smart_park_reserve_plans p ON p.vehicle_id=v.id AND p.subject=$1
		LEFT JOIN smart_push_devices d ON d.id=p.device_id AND d.subject=p.subject AND d.verified_at=p.device_verified_at
		WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID).
		Scan(&plan.ID, &created, &returns, &actionUntil, &plan.ReservePct, &plan.DeviceID, &plan.DeviceReady,
			&plan.Reason, &observed, &count, &battery, &low, &high, &outside, &sentry)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read private park reserve: %w", err)
	}
	if plan.ID == 0 || created == nil || returns == nil || actionUntil == nil {
		return nil, nil
	}
	plan.CreatedAt, plan.ReturnAt, plan.ActionUntil = *created, *returns, *actionUntil
	if observed != nil && count != nil && battery != nil && low != nil && high != nil && outside != nil && sentry != nil {
		plan.Forecast = &domain.ParkReserveForecast{
			ParkReserveEstimate: domain.ParkReserveEstimate{
				ObservedAt: *observed, ComparableEpisodes: *count, StartBatteryPct: *battery,
				ReturnLowPct: *low, ReturnHighPct: *high, ReserveRisk: plan.Reason == domain.ParkReserveAtRisk,
			},
			OutsideC: *outside, SentryMode: *sentry,
		}
		plan.Estimate = &plan.Forecast.ParkReserveEstimate
	}
	return &plan, nil
}

func (r *Repository) ReplaceParkReserve(ctx context.Context, scope port.ParkReserveScope, expectedID int64, setup domain.ParkReserveSetup, now, actionUntil time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if expectedID != 0 {
			if err := deleteParkReserve(ctx, tx, scope, expectedID); err != nil {
				return err
			}
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_park_reserve_plans (
				subject,vehicle_id,return_at,reserve_pct,created_at,action_until,device_id,device_verified_at,push_title,push_body,next_check_at)
			SELECT $1,v.id,$4,$5,$6,$7,d.id,d.verified_at,NULLIF($8,''),NULLIF($9,''),$6
			FROM vehicles v
			LEFT JOIN smart_push_devices d ON d.id=$3 AND d.subject=$1 AND d.verified_at IS NOT NULL
			WHERE v.id=$2 AND v.archived_at IS NULL AND ($3::bigint IS NULL OR d.id IS NOT NULL)
			ON CONFLICT (subject,vehicle_id) DO NOTHING`,
			scope.Subject, scope.VehicleID, setup.DeviceID, setup.ReturnAt, setup.ReservePct, now, actionUntil, setup.PushTitle, setup.PushBody)
		if err != nil {
			return fmt.Errorf("save private park reserve: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrParkReserveChanged
		}
		return nil
	})
}

func (r *Repository) DeleteParkReserve(ctx context.Context, scope port.ParkReserveScope, expectedID int64) error {
	return deleteParkReserve(ctx, r.db.Pool, scope, expectedID)
}

func deleteParkReserve(ctx context.Context, exec interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, scope port.ParkReserveScope, expectedID int64) error {
	tag, err := exec.Exec(ctx, `DELETE FROM smart_park_reserve_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		scope.Subject, scope.VehicleID, expectedID)
	if err != nil {
		return fmt.Errorf("clear private park reserve: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrParkReserveChanged
	}
	return nil
}

func (r *Repository) ClaimParkReserve(ctx context.Context, now, leaseUntil time.Time) (*port.ParkReserveJob, error) {
	var job port.ParkReserveJob
	err := r.db.Pool.QueryRow(ctx, `WITH due AS (
			SELECT p.id FROM smart_park_reserve_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
			WHERE p.next_check_at<=$1 AND (p.lease_until IS NULL OR p.lease_until<=$1) AND p.subject NOT IN ($3,'open-mode')
			ORDER BY p.next_check_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED
		)
		UPDATE smart_park_reserve_plans p SET lease_until=$2 FROM due WHERE p.id=due.id
		RETURNING p.id,p.vehicle_id,p.created_at,p.return_at,p.action_until,p.reserve_pct,p.lease_until`,
		now, leaseUntil, personaldomain.OpenSubject).
		Scan(&job.Plan.ID, &job.Plan.VehicleID, &job.Plan.CreatedAt, &job.Plan.ReturnAt,
			&job.Plan.ActionUntil, &job.Plan.ReservePct, &job.LeaseUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim due park reserve: %w", err)
	}
	return &job, nil
}

func (r *Repository) ParkReserveActivity(ctx context.Context, vehicleID int64, since, now time.Time) (bool, error) {
	var changed bool
	err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM drives WHERE vehicle_id=$1 AND started_at<=$3 AND (ended_at IS NULL OR ended_at>$2)
		) OR EXISTS (
			SELECT 1 FROM charging_sessions WHERE vehicle_id=$1 AND started_at<=$3 AND (ended_at IS NULL OR ended_at>$2)
		)`, vehicleID, since, now).Scan(&changed)
	if err != nil {
		return false, fmt.Errorf("check for travel or charging after long-park setup: %w", err)
	}
	return changed, nil
}

func (r *Repository) FinishParkReserve(ctx context.Context, job port.ParkReserveJob, result port.ParkReserveResult, now time.Time) (bool, error) {
	var observed *time.Time
	var count, low, high *int
	var battery, outside *float64
	var sentry *string
	if f := result.Forecast; f != nil {
		observed, count, battery, low, high, outside, sentry = &f.ObservedAt, &f.ComparableEpisodes, &f.StartBatteryPct,
			&f.ReturnLowPct, &f.ReturnHighPct, &f.OutsideC, &f.SentryMode
	}
	tag, err := r.db.Pool.Exec(ctx, `UPDATE smart_park_reserve_plans p
		SET reason=NULLIF($4,''),next_check_at=$5,lease_until=NULL,estimate_at=$6,comparable_episodes=$7,
			start_battery_pct=$8,return_low_pct=$9,return_high_pct=$10,outside_c=$11,sentry_mode=$12
		WHERE p.id=$1 AND p.lease_until=$2 AND p.lease_until>$3
			AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id=p.vehicle_id AND v.archived_at IS NULL)`,
		job.Plan.ID, job.LeaseUntil, now, result.Reason, result.NextCheck, observed, count, battery, low, high, outside, sentry)
	if err != nil {
		return false, fmt.Errorf("persist private park reserve estimate: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}
