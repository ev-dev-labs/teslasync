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

var _ port.OvernightDrainRepository = (*Repository)(nil)

func (r *Repository) OvernightWakeRequest(ctx context.Context, vehicleID int64, from, to time.Time) (*time.Time, error) {
	var observed *time.Time
	err := r.db.Pool.QueryRow(ctx, `
		SELECT min(wake_requested_at) FROM command_logs
		WHERE vehicle_id=$1 AND wake_requested_at BETWEEN $2 AND $3
			AND command IN ('wake','wake_up') AND status='success'`,
		vehicleID, from, to).Scan(&observed)
	if err != nil {
		return nil, fmt.Errorf("read same-vehicle wake request time: %w", err)
	}
	return observed, nil
}

const noOvernightBaselineActivity = `NOT EXISTS (
	SELECT 1 FROM unnest(e.baseline_starts,e.baseline_ends) AS n(start_at,end_at)
	WHERE EXISTS (
		SELECT 1 FROM drives d WHERE d.vehicle_id=p.vehicle_id AND d.started_at<n.end_at
			AND (d.ended_at IS NULL OR d.ended_at>n.start_at)
	) OR EXISTS (
		SELECT 1 FROM charging_sessions c WHERE c.vehicle_id=p.vehicle_id AND c.started_at<n.end_at
			AND (c.ended_at IS NULL OR c.ended_at>n.start_at)
	)
)`

func (r *Repository) ReadOvernightDrain(ctx context.Context, scope port.OvernightDrainScope, now time.Time) (domain.OvernightDrainSettings, error) {
	var out domain.OvernightDrainSettings
	var plan domain.OvernightDrainPlan
	var evidence domain.OvernightDrainReview
	var morning, expiry, start, end, sentry, climate, wake *time.Time
	err := r.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(p.id,0),COALESCE(p.time_zone,''),p.next_check_at IS NULL,
		       e.morning_at,e.expires_at,e.start_at,e.end_at,COALESCE(e.measured_loss_pct,0),
		       COALESCE(e.typical_low_pct,0),COALESCE(e.typical_high_pct,0),COALESCE(cardinality(e.baseline_starts),0),
		       e.sentry_at,e.climate_at,e.wake_request_at,e.baseline_starts,e.baseline_ends,e.evidence_fingerprint
		FROM vehicles v
		LEFT JOIN smart_overnight_drain_plans p ON p.vehicle_id=v.id AND p.subject=$1
		LEFT JOIN smart_overnight_drain_reviews e ON e.plan_id=p.id AND e.expires_at>$3
			AND e.dismissed_at IS NULL AND p.next_check_at IS NOT NULL AND e.evidence_fingerprint IS NOT NULL
			AND `+noOvernightBaselineActivity+`
		WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID, now).
		Scan(&plan.ID, &plan.TimeZone, &plan.Paused, &morning, &expiry, &start, &end,
			&evidence.MeasuredLossPct, &evidence.TypicalLossLowPct, &evidence.TypicalLossHighPct, &evidence.ComparableNights, &sentry, &climate, &wake,
			&evidence.BaselineStarts, &evidence.BaselineEnds, &evidence.EvidenceFingerprint)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, port.ErrNotFound
	}
	if err != nil {
		return out, fmt.Errorf("read private overnight drain review: %w", err)
	}
	if plan.ID != 0 {
		out.Plan = &plan
	}
	if morning != nil && expiry != nil && start != nil && end != nil {
		evidence.MorningAt, evidence.ExpiresAt, evidence.StartAt, evidence.EndAt = *morning, *expiry, *start, *end
		for _, event := range []struct {
			kind domain.OvernightFactor
			at   *time.Time
		}{{domain.OvernightSentry, sentry}, {domain.OvernightClimate, climate}, {domain.OvernightWakeRequested, wake}} {
			if event.at != nil {
				evidence.Factors = append(evidence.Factors, domain.OvernightFactorObservation{Kind: event.kind, ObservedAt: *event.at})
			}
		}
		plan.Review = &evidence
	}
	return out, nil
}

func (r *Repository) ReplaceOvernightDrain(ctx context.Context, scope port.OvernightDrainScope, expectedID int64, zone string, next *time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if expectedID != 0 {
			tag, err := tx.Exec(ctx, `DELETE FROM smart_overnight_drain_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
				scope.Subject, scope.VehicleID, expectedID)
			if err != nil {
				return fmt.Errorf("replace private overnight drain plan: %w", err)
			}
			if tag.RowsAffected() != 1 {
				return port.ErrOvernightDrainChanged
			}
		}
		tag, err := tx.Exec(ctx, `INSERT INTO smart_overnight_drain_plans(subject,vehicle_id,time_zone,next_check_at)
			SELECT $1,id,$3,$4 FROM vehicles WHERE id=$2 AND archived_at IS NULL
			ON CONFLICT (subject,vehicle_id) DO NOTHING`, scope.Subject, scope.VehicleID, zone, next)
		if err != nil {
			return fmt.Errorf("save private overnight drain plan: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrOvernightDrainChanged
		}
		return nil
	})
}

func (r *Repository) DeleteOvernightDrain(ctx context.Context, scope port.OvernightDrainScope, id int64) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_overnight_drain_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		scope.Subject, scope.VehicleID, id)
	if err != nil {
		return fmt.Errorf("clear private overnight drain plan: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrOvernightDrainChanged
	}
	return nil
}

func (r *Repository) DismissOvernightDrain(ctx context.Context, scope port.OvernightDrainScope, id int64, morning, now time.Time) error {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_overnight_drain_reviews e SET dismissed_at=$5
		FROM smart_overnight_drain_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND e.plan_id=p.id AND e.morning_at=$4
			AND p.next_check_at IS NOT NULL AND e.expires_at>$5 AND e.dismissed_at IS NULL`, scope.Subject, scope.VehicleID, id, morning, now)
	if err != nil {
		return fmt.Errorf("dismiss private overnight drain review: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrOvernightDrainChanged
	}
	return nil
}

func (r *Repository) ClaimOvernightDrain(ctx context.Context, now, lease time.Time) (*port.DueOvernightDrain, error) {
	var job port.DueOvernightDrain
	err := r.db.Pool.QueryRow(ctx, `WITH due AS (
		SELECT p.id FROM smart_overnight_drain_plans p
		JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		WHERE p.next_check_at<=$1 AND (p.lease_until IS NULL OR p.lease_until<=$1)
		  AND p.subject NOT IN ($3,'open-mode')
		ORDER BY p.next_check_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED
	)
	UPDATE smart_overnight_drain_plans p SET lease_until=$2 FROM due WHERE p.id=due.id
	RETURNING p.id,p.vehicle_id,p.time_zone,p.lease_until`, now, lease, personaldomain.OpenSubject).
		Scan(&job.PlanID, &job.VehicleID, &job.TimeZone, &job.Lease)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim due private overnight drain check: %w", err)
	}
	return &job, nil
}

func (r *Repository) FinishOvernightDrain(ctx context.Context, job port.DueOvernightDrain, checked, next time.Time, e *domain.OvernightDrainReview) (bool, error) {
	var published bool
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE smart_overnight_drain_plans p SET lease_until=NULL,next_check_at=$4
			FROM vehicles v WHERE p.id=$1 AND p.lease_until=$2 AND $3<p.lease_until
				AND p.next_check_at IS NOT NULL AND p.vehicle_id=v.id AND v.archived_at IS NULL`,
			job.PlanID, job.Lease, checked, next)
		if err != nil {
			return fmt.Errorf("finish private overnight drain check: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
		if e == nil {
			if _, err := tx.Exec(ctx, `DELETE FROM smart_overnight_drain_reviews WHERE plan_id=$1 AND expires_at<=$2`, job.PlanID, checked); err != nil {
				return fmt.Errorf("prune expired overnight drain review: %w", err)
			}
			return nil
		}
		at := make(map[domain.OvernightFactor]time.Time, len(e.Factors))
		for _, event := range e.Factors {
			at[event.Kind] = event.ObservedAt
		}
		observed := func(kind domain.OvernightFactor) *time.Time {
			value, ok := at[kind]
			if !ok {
				return nil
			}
			return &value
		}
		tag, err = tx.Exec(ctx, `
			INSERT INTO smart_overnight_drain_reviews AS existing
				(plan_id,morning_at,expires_at,start_at,end_at,measured_loss_pct,typical_low_pct,typical_high_pct,
				 baseline_starts,baseline_ends,sentry_at,climate_at,wake_request_at,evidence_fingerprint)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
			ON CONFLICT (plan_id) DO UPDATE SET morning_at=EXCLUDED.morning_at,expires_at=EXCLUDED.expires_at,
				start_at=EXCLUDED.start_at,end_at=EXCLUDED.end_at,measured_loss_pct=EXCLUDED.measured_loss_pct,
				typical_low_pct=EXCLUDED.typical_low_pct,typical_high_pct=EXCLUDED.typical_high_pct,
				baseline_starts=EXCLUDED.baseline_starts,baseline_ends=EXCLUDED.baseline_ends,
				sentry_at=EXCLUDED.sentry_at,climate_at=EXCLUDED.climate_at,wake_request_at=EXCLUDED.wake_request_at,
				evidence_fingerprint=EXCLUDED.evidence_fingerprint,dismissed_at=NULL
			WHERE existing.morning_at<EXCLUDED.morning_at`,
			job.PlanID, e.MorningAt, e.ExpiresAt, e.StartAt, e.EndAt, e.MeasuredLossPct, e.TypicalLossLowPct, e.TypicalLossHighPct,
			e.BaselineStarts, e.BaselineEnds, observed(domain.OvernightSentry), observed(domain.OvernightClimate), observed(domain.OvernightWakeRequested),
			e.EvidenceFingerprint)
		if err != nil {
			return fmt.Errorf("publish private overnight drain review: %w", err)
		}
		published = tag.RowsAffected() == 1
		return nil
	})
	return published && err == nil, err
}
