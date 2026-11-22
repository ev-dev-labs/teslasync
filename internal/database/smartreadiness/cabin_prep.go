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
)

var _ port.CabinPrepRepository = (*Repository)(nil)

func (r *Repository) ReadCabinPrep(ctx context.Context, scope port.CabinPrepScope, now time.Time) (domain.CabinPrepPlan, error) {
	record := domain.CabinPrepPlan{VehicleID: scope.VehicleID}
	var departure, at *time.Time
	var count, low, high *int
	var cabin, outside *float64
	var current bool
	err := r.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(p.id,0),p.departure_at,COALESCE(p.time_zone,''),COALESCE(p.target_c,0),
			COALESCE(p.device_id,0),dev.id IS NOT NULL,COALESCE(p.reason,''),
			p.comparable_mornings,p.lead_low_s,p.lead_high_s,p.estimate_at,p.expires_at,p.baseline_cabin_c,p.baseline_outside_c,
			smart_feature_current($1,'cabin_prep',p.feature_checked_at)
		FROM vehicles v
		LEFT JOIN smart_cabin_prep_plans p ON p.vehicle_id=v.id AND p.subject=$1
		LEFT JOIN smart_push_devices dev ON dev.id=p.device_id AND dev.subject=p.subject AND dev.verified_at=p.device_verified_at
		WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID).Scan(
		&record.ID, &departure, &record.TimeZone, &record.TargetC, &record.DeviceID, &record.DeviceReady,
		&record.Reason, &count, &low, &high, &at, &record.ExpiresAt, &cabin, &outside, &current)
	if errors.Is(err, pgx.ErrNoRows) {
		return record, port.ErrNotFound
	}
	if err != nil {
		return record, fmt.Errorf("read private cabin prep plan: %w", err)
	}
	if departure == nil {
		return record, nil
	}
	record.DepartureAt = *departure
	if !current {
		record.Reason, record.ExpiresAt = "", nil
		return record, nil
	}
	if !record.DepartureAt.After(now) || (record.ExpiresAt != nil && !record.ExpiresAt.After(now)) {
		record.Reason, record.ExpiresAt = domain.CabinPrepExpired, nil
	}
	if record.DeviceReady && record.Reason == domain.CabinPrepEligible &&
		count != nil && low != nil && high != nil && at != nil && cabin != nil && outside != nil {
		record.Forecast = &domain.CabinPrepForecast{CabinPrepEstimate: domain.CabinPrepEstimate{
			ComparableMornings: *count, LeadLowS: *low, LeadHighS: *high, ObservedAt: *at, TargetC: record.TargetC,
		}, CabinC: *cabin, OutsideC: *outside}
		record.Estimate = &record.Forecast.CabinPrepEstimate
	}
	return record, nil
}

func (r *Repository) ReplaceCabinPrep(ctx context.Context, scope port.CabinPrepScope, expectedID int64, setup domain.CabinPrepSetup, now, next time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if expectedID != 0 {
			if err := deleteCabinPrep(ctx, tx, scope, expectedID); err != nil {
				return err
			}
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_cabin_prep_plans
				(subject,vehicle_id,departure_at,time_zone,target_c,device_id,device_verified_at,push_title,push_body,created_at,next_check_at)
			SELECT $1,v.id,$4,$5,$6,dev.id,dev.verified_at,$7,$8,$9,$10
			FROM vehicles v JOIN smart_push_devices dev ON dev.id=$3 AND dev.subject=$1 AND dev.verified_at IS NOT NULL
			WHERE v.id=$2 AND v.archived_at IS NULL
			ON CONFLICT (subject,vehicle_id) DO NOTHING`,
			scope.Subject, scope.VehicleID, setup.DeviceID, setup.DepartureAt, setup.TimeZone, setup.TargetC,
			setup.PushTitle, setup.PushBody, now, next)
		if err != nil {
			return fmt.Errorf("schedule private cabin prep: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return port.ErrCabinPrepChanged
		}
		return nil
	})
}

func (r *Repository) DeleteCabinPrep(ctx context.Context, scope port.CabinPrepScope, expectedID int64) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		return deleteCabinPrep(ctx, tx, scope, expectedID)
	})
}

func deleteCabinPrep(ctx context.Context, tx pgx.Tx, scope port.CabinPrepScope, expectedID int64) error {
	tag, err := tx.Exec(ctx, `DELETE FROM smart_cabin_prep_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		scope.Subject, scope.VehicleID, expectedID)
	if err != nil {
		return fmt.Errorf("clear private cabin prep: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return port.ErrCabinPrepChanged
	}
	return nil
}

const currentCabinPlan = ` FROM smart_cabin_prep_plans p
	JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL AND smart_feature_allowed(p.subject,'cabin_prep')
	JOIN smart_push_devices dev ON dev.id=p.device_id AND dev.subject=p.subject AND dev.verified_at=p.device_verified_at `

func (r *Repository) ClaimCabinPrep(ctx context.Context, now, leaseUntil time.Time) (*port.CabinPrepJob, error) {
	var job port.CabinPrepJob
	var count, low, high *int
	var measuredAt *time.Time
	var cabin, ambient *float64
	err := r.db.Pool.QueryRow(ctx, `
		WITH due AS (
			SELECT p.id `+currentCabinPlan+`
			WHERE p.next_check_at<=$1 AND (p.lease_until IS NULL OR p.lease_until<=$1)
				AND p.subject NOT IN ($3,'open-mode')
			ORDER BY p.next_check_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED
		)
		UPDATE smart_cabin_prep_plans p SET lease_until=$2,feature_claimed_at=statement_timestamp() FROM due WHERE p.id=due.id
		RETURNING p.id,p.vehicle_id,p.departure_at,p.time_zone,p.target_c,p.device_id,p.subject,p.lease_until,
			p.comparable_mornings,p.lead_low_s,p.lead_high_s,p.estimate_at,p.baseline_cabin_c,p.baseline_outside_c`,
		now, leaseUntil, personaldomain.OpenSubject).Scan(
		&job.Plan.ID, &job.Plan.VehicleID, &job.Plan.DepartureAt, &job.Plan.TimeZone, &job.Plan.TargetC,
		&job.Plan.DeviceID, &job.Subject, &job.LeaseUntil, &count, &low, &high, &measuredAt, &cabin, &ambient)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim due private cabin prep: %w", err)
	}
	job.Plan.DeviceReady = true
	if count != nil && low != nil && high != nil && measuredAt != nil && cabin != nil && ambient != nil {
		job.Forecast = &domain.CabinPrepForecast{CabinPrepEstimate: domain.CabinPrepEstimate{
			ComparableMornings: *count, LeadLowS: *low, LeadHighS: *high,
			ObservedAt: *measuredAt, TargetC: job.Plan.TargetC,
		}, CabinC: *cabin, OutsideC: *ambient}
	}
	return &job, nil
}

func (r *Repository) CabinPrepStillCurrent(ctx context.Context, job port.CabinPrepJob, now time.Time) (bool, error) {
	var active bool
	err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 `+currentCabinPlan+`
		WHERE p.id=$1 AND p.lease_until=$2 AND p.lease_until>$3
		  AND smart_feature_current(p.subject,'cabin_prep',p.feature_claimed_at))`, job.Plan.ID, job.LeaseUntil, now).
		Scan(&active)
	if err != nil {
		return false, fmt.Errorf("recheck cabin prep lease: %w", err)
	}
	return active, nil
}

func (r *Repository) CabinDriveStarted(ctx context.Context, vehicleID int64, from, to time.Time) (bool, error) {
	var active bool
	err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM drives WHERE vehicle_id=$1 AND started_at BETWEEN $2 AND $3)`, vehicleID, from, to).Scan(&active)
	if err != nil {
		return false, fmt.Errorf("check whether the planned departure already started: %w", err)
	}
	return active, nil
}

func (r *Repository) CabinParkContinuous(ctx context.Context, vehicleID int64, from, to time.Time) (bool, error) {
	var stillParked bool
	err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM signal_log WHERE vehicle_id=$1 AND field='Gear' AND ts=$2
			AND source_emitted_at=ts AND str_value='P'
	) AND NOT EXISTS (
		SELECT 1 FROM signal_log WHERE vehicle_id=$1 AND field='Gear' AND ts>$2 AND ts<=$3
			AND (source_emitted_at IS DISTINCT FROM ts OR str_value IS DISTINCT FROM 'P')
	) AND NOT EXISTS (
		SELECT 1 FROM drives WHERE vehicle_id=$1 AND started_at BETWEEN $2 AND $3
	)`, vehicleID, from, to).Scan(&stillParked)
	if err != nil {
		return false, fmt.Errorf("check recorded Park continuity: %w", err)
	}
	return stillParked, nil
}

func (r *Repository) CabinHVACOffContinuous(ctx context.Context, vehicleID int64, from, to time.Time) (bool, error) {
	var stillOff bool
	err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM signal_log WHERE vehicle_id=$1 AND field='HvacPower' AND ts=$2
			AND source_emitted_at=ts AND bool_value IS FALSE
	) AND NOT EXISTS (
		SELECT 1 FROM signal_log WHERE vehicle_id=$1 AND field='HvacPower' AND ts>$2 AND ts<=$3
			AND (source_emitted_at IS DISTINCT FROM ts OR bool_value IS DISTINCT FROM false)
	)`, vehicleID, from, to).Scan(&stillOff)
	if err != nil {
		return false, fmt.Errorf("check recorded HVAC-off continuity: %w", err)
	}
	return stillOff, nil
}

func (r *Repository) FinishCabinPrep(ctx context.Context, job port.CabinPrepJob, result port.CabinPrepResult, now time.Time) (bool, error) {
	var count, low, high *int
	var at *time.Time
	var cabin, outside *float64
	if f := result.Forecast; f != nil {
		count, low, high, at, cabin, outside = &f.ComparableMornings, &f.LeadLowS, &f.LeadHighS, &f.ObservedAt, &f.CabinC, &f.OutsideC
	}
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_cabin_prep_plans SET
			lease_until=NULL,next_check_at=$4,reason=NULLIF($5,''),feature_checked_at=feature_claimed_at,
			comparable_mornings=$6,lead_low_s=$7,lead_high_s=$8,estimate_at=$9,
			baseline_cabin_c=$10,baseline_outside_c=$11,expires_at=$12
		WHERE id=$1 AND lease_until=$2 AND lease_until>$3 AND smart_feature_current(subject,'cabin_prep',feature_claimed_at)
			AND id IN (SELECT p.id `+currentCabinPlan+` WHERE p.id=$1)`,
		job.Plan.ID, job.LeaseUntil, now, result.NextCheck, result.Reason, count, low, high, at, cabin, outside,
		result.ExpiresAt)
	if err != nil {
		return false, fmt.Errorf("finish cabin prep evaluation: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}
