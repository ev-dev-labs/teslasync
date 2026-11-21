package mileageterm

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/mileageterm"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/mileageterm"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) Read(ctx context.Context, scope port.Scope, now time.Time) (domain.Review, error) {
	var out domain.Review
	err := pgx.BeginTxFunc(ctx, r.pool, pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}, func(tx pgx.Tx) error {
		var plan domain.Settings
		err := tx.QueryRow(ctx, `
			SELECT COALESCE(p.id,0),COALESCE(p.time_zone,''),COALESCE(to_char(p.first_day,'YYYY-MM-DD'),''),
			    COALESCE(to_char(p.end_day,'YYYY-MM-DD'),''),COALESCE(p.opening_odometer_m,0),
			    COALESCE(p.allowance_m,0),COALESCE(p.minimum_overage_m,0),COALESCE(p.paused,false),p.last_checked_at,p.next_check_at
			FROM vehicles v LEFT JOIN smart_mileage_term_plans p ON p.vehicle_id=v.id AND p.subject=$1
			WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID).Scan(
			&plan.ID, &plan.TimeZone, &plan.FirstDay, &plan.EndDay, &plan.OpeningM, &plan.AllowanceM,
			&plan.MinimumM, &plan.Paused, &out.LastCheckedAt, &out.NextCheckAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("read private mileage term: %w", err)
		}
		if plan.ID == 0 {
			return nil
		}
		out.Settings = &plan
		if plan.Paused {
			return nil
		}
		digest := new(domain.Digest)
		p := &digest.Projection
		err = tx.QueryRow(ctx, `
			SELECT month_through,checked_at,expires_at,evidence_from,observed_at,observed_days,used_m,allowed_to_date_m,lower_m,upper_m
			FROM smart_mileage_term_digests WHERE plan_id=$1 AND dismissed_at IS NULL AND checked_at<=$2 AND expires_at>$2`,
			plan.ID, now).Scan(&digest.Through, &digest.CheckedAt, &digest.ExpiresAt, &p.EvidenceFrom, &p.ObservedAt, &p.ObservedDays,
			&p.UsedM, &p.AllowedToDateM, &p.LowerM, &p.UpperM)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("read private mileage digest: %w", err)
		}
		out.Digest = digest
		return nil
	})
	return out, err
}

func (r *Repository) Replace(ctx context.Context, scope port.Scope, s domain.Settings, next *time.Time, cutoff time.Time) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var checked, cycle *time.Time
		if s.ID != 0 {
			err := tx.QueryRow(ctx, `
				DELETE FROM smart_mileage_term_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3
				RETURNING CASE WHEN time_zone=$4 AND first_day=$5::text::date AND end_day=$6::text::date
				    AND opening_odometer_m=$7 AND allowance_m=$8 AND minimum_overage_m=$9 THEN last_checked_at END,next_cycle_at`,
				scope.Subject, scope.VehicleID, s.ID, s.TimeZone, s.FirstDay, s.EndDay, s.OpeningM, s.AllowanceM, s.MinimumM).
				Scan(&checked, &cycle)
			if errors.Is(err, pgx.ErrNoRows) {
				return port.ErrChanged
			}
			if err != nil {
				return fmt.Errorf("replace private mileage term: %w", err)
			}
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_mileage_term_plans
			    (subject,vehicle_id,time_zone,first_day,end_day,opening_odometer_m,allowance_m,minimum_overage_m,
			    paused,next_check_at,last_checked_at,next_cycle_at)
			SELECT $1,v.id,$3,$4::text::date,$5::text::date,$6,$7,$8,$9,
			    CASE WHEN $10::timestamptz IS NOT NULL AND GREATEST($10,$12::timestamptz)<$13
			        THEN GREATEST($10,$12::timestamptz) END,$11,$12
			FROM vehicles v WHERE v.id=$2 AND v.archived_at IS NULL ON CONFLICT (subject,vehicle_id) DO NOTHING`,
			scope.Subject, scope.VehicleID, s.TimeZone, s.FirstDay, s.EndDay, s.OpeningM, s.AllowanceM,
			s.MinimumM, s.Paused, next, checked, cycle, cutoff)
		if err != nil {
			return fmt.Errorf("save private mileage term: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrChanged
		}
		return nil
	})
}

func (r *Repository) Delete(ctx context.Context, scope port.Scope, id int64) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM smart_mileage_term_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		scope.Subject, scope.VehicleID, id)
	if err != nil {
		return fmt.Errorf("clear private mileage term: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrChanged
	}
	return nil
}

func (r *Repository) Dismiss(ctx context.Context, scope port.Scope, id int64, through, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE smart_mileage_term_digests d SET dismissed_at=$5
		FROM smart_mileage_term_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND NOT p.paused AND p.id=d.plan_id AND d.month_through=$4
		    AND d.checked_at<=$5 AND d.expires_at>$5 AND d.dismissed_at IS NULL`, scope.Subject, scope.VehicleID, id, through, now)
	if err != nil {
		return fmt.Errorf("dismiss private mileage digest: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrChanged
	}
	return nil
}

func (r *Repository) Claim(ctx context.Context, now, lease time.Time) (*port.Job, error) {
	var job port.Job
	err := r.pool.QueryRow(ctx, `
		WITH due AS (
		    SELECT p.id FROM smart_mileage_term_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		    WHERE p.next_check_at<=$1 AND (p.lease_until IS NULL OR p.lease_until<=$1) AND p.subject NOT IN ($3,'open-mode')
		    ORDER BY p.next_check_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED
		)
		UPDATE smart_mileage_term_plans p SET lease_until=$2 FROM due WHERE p.id=due.id
		RETURNING p.id,p.subject,p.vehicle_id,p.time_zone,to_char(p.first_day,'YYYY-MM-DD'),to_char(p.end_day,'YYYY-MM-DD'),
		    p.opening_odometer_m,p.allowance_m,p.minimum_overage_m,p.lease_until`, now, lease, personal.OpenSubject).
		Scan(&job.ID, &job.Subject, &job.VehicleID, &job.TimeZone, &job.FirstDay, &job.EndDay,
			&job.OpeningM, &job.AllowanceM, &job.MinimumM, &job.Lease)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim private mileage term: %w", err)
	}
	return &job, nil
}

func (r *Repository) ReadObservations(ctx context.Context, job port.Job, from, through, now time.Time) ([]domain.Observation, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT DISTINCT observation.ts,observation.float_value
		FROM smart_mileage_term_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		JOIN drives d ON d.vehicle_id=v.id
		JOIN LATERAL (
		    SELECT s.ts,s.float_value
		    FROM signal_log s
		    WHERE s.vehicle_id=d.vehicle_id AND s.field='Odometer' AND s.float_value IS NOT NULL
		        AND s.ts>=GREATEST(d.started_at,$4) AND s.ts<=d.ended_at AND s.ts<$5 AND s.source_emitted_at=s.ts
		        AND s.received_at BETWEEN s.ts-INTERVAL '2 minutes' AND s.ts+INTERVAL '2 minutes' AND s.received_at<=$3
		    ORDER BY s.ts DESC LIMIT 1
		) observation ON true
		WHERE p.id=$1 AND p.lease_until=$2 AND p.lease_until>$3 AND NOT p.paused
		    AND d.started_at>=$4::timestamptz-INTERVAL '1 day' AND d.started_at<$5
		    AND d.ended_at>=$4 AND d.ended_at<$5 AND d.ended_at>d.started_at
		ORDER BY observation.ts DESC LIMIT $6`, job.ID, job.Lease, now, from, through, domain.MaxSamples+1)
	if err != nil {
		return nil, fmt.Errorf("read term odometer observations: %w", err)
	}
	result, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Observation, error) {
		var observation domain.Observation
		err := row.Scan(&observation.At, &observation.OdometerM)
		return observation, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan term odometer observations: %w", err)
	}
	return result, nil
}

func (r *Repository) Finish(ctx context.Context, job port.Job, now, nextCycle time.Time, next *time.Time, digest *domain.Digest) (bool, error) {
	var published bool
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE smart_mileage_term_plans p SET lease_until=NULL,last_checked_at=$3,next_check_at=$4,next_cycle_at=$5
			FROM vehicles v WHERE p.id=$1 AND p.lease_until=$2 AND p.lease_until>$3
			    AND NOT p.paused AND p.vehicle_id=v.id AND v.archived_at IS NULL`, job.ID, job.Lease, now, next, nextCycle)
		if err != nil {
			return fmt.Errorf("finish private mileage check: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return nil
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_mileage_term_digests WHERE plan_id=$1 AND expires_at<=$2`, job.ID, now); err != nil {
			return fmt.Errorf("prune expired mileage digest: %w", err)
		}
		if digest == nil || !now.Before(digest.ExpiresAt) {
			return nil
		}
		p := digest.Projection
		tag, err = tx.Exec(ctx, `
			INSERT INTO smart_mileage_term_digests (plan_id,month_through,checked_at,expires_at,evidence_from,observed_at,observed_days,
			    used_m,allowed_to_date_m,lower_m,upper_m)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (plan_id) DO NOTHING`, job.ID, digest.Through,
			digest.CheckedAt, digest.ExpiresAt, p.EvidenceFrom, p.ObservedAt, p.ObservedDays, p.UsedM, p.AllowedToDateM, p.LowerM, p.UpperM)
		if err != nil {
			return fmt.Errorf("publish private mileage digest: %w", err)
		}
		published = tag.RowsAffected() == 1
		return nil
	})
	return published && err == nil, err
}
