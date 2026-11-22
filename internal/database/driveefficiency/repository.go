// Package driveefficiency persists scoped weekly drive reviews and worker leases.
package driveefficiency

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/driveefficiency"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	port "github.com/ev-dev-labs/teslasync/internal/port/driveefficiency"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct{ pool *pgxpool.Pool }

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

func (r *Repository) Read(ctx context.Context, s port.Scope, now time.Time) (port.State, error) {
	var state port.State
	err := pgx.BeginTxFunc(ctx, r.pool, pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}, func(tx pgx.Tx) error {
		var plan domain.Settings
		err := tx.QueryRow(ctx, `
			SELECT COALESCE(p.revision,0),COALESCE(p.time_zone,''),p.next_check_at
			FROM vehicles v LEFT JOIN smart_weekly_drive_efficiency_plans p ON p.vehicle_id=v.id AND p.subject=$1
			WHERE v.id=$2 AND v.archived_at IS NULL`, s.Subject, s.VehicleID).
			Scan(&plan.Revision, &plan.TimeZone, &plan.NextCheckAt)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return port.ErrNotFound
		case err != nil:
			return fmt.Errorf("read private efficiency plan: %w", err)
		case plan.Revision == 0:
			return nil
		}
		plan.Paused = plan.NextCheckAt == nil
		state.Plan = &plan
		if plan.Paused {
			return nil
		}
		var d domain.Digest
		err = tx.QueryRow(ctx, `
			SELECT e.reference_drive_id,e.baseline_from,e.recent_from,e.recent_until,e.observed_until,e.expires_at,
			    e.baseline_days,e.recent_days,e.baseline_low_wh_per_m,e.baseline_high_wh_per_m,
			    e.recent_low_wh_per_m,e.recent_high_wh_per_m,e.higher,e.dismissed_at IS NOT NULL
			FROM smart_weekly_drive_efficiency_digests e JOIN drives d ON d.id=e.reference_drive_id
			WHERE e.plan_revision=$1 AND d.vehicle_id=$2 AND e.expires_at>$3 AND e.published_at<=$3
			    AND smart_feature_current($4,'drive_efficiency',e.feature_checked_at)`,
			plan.Revision, s.VehicleID, now, s.Subject).
			Scan(&d.ReferenceDriveID, &d.BaselineFrom, &d.RecentFrom, &d.RecentUntil, &d.ObservedUntil, &d.ExpiresAt,
				&d.BaselineDays, &d.RecentDays, &d.Baseline.LowWhPerM, &d.Baseline.HighWhPerM,
				&d.Recent.LowWhPerM, &d.Recent.HighWhPerM, &d.Higher, &state.Dismissed)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("read private efficiency digest: %w", err)
		}
		if !state.Dismissed {
			state.Digest = &d
		}
		return nil
	})
	return state, err
}

func (r *Repository) Replace(ctx context.Context, s port.Scope, plan domain.Settings) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var lastCycle *time.Time
		if plan.Revision != 0 {
			var previousZone string
			err := tx.QueryRow(ctx, `
				DELETE FROM smart_weekly_drive_efficiency_plans p USING vehicles v
				WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.revision=$3 AND v.id=p.vehicle_id AND v.archived_at IS NULL
				RETURNING p.time_zone,p.last_week`, s.Subject, s.VehicleID, plan.Revision).Scan(&previousZone, &lastCycle)
			if errors.Is(err, pgx.ErrNoRows) {
				return port.ErrChanged
			}
			if err != nil {
				return fmt.Errorf("replace private efficiency plan: %w", err)
			}
			if plan.Paused {
				plan.TimeZone = previousZone
			}
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_weekly_drive_efficiency_plans(subject,vehicle_id,time_zone,next_check_at,last_week)
			SELECT $1,id,$3,$4,$5 FROM vehicles WHERE id=$2 AND archived_at IS NULL
			ON CONFLICT (subject,vehicle_id) DO NOTHING`,
			s.Subject, s.VehicleID, plan.TimeZone, plan.NextCheckAt, lastCycle)
		if err != nil {
			return fmt.Errorf("save private efficiency plan: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrChanged
		}
		return nil
	})
}

func (r *Repository) Delete(ctx context.Context, s port.Scope, revision int64) error {
	tag, err := r.pool.Exec(ctx, `
		DELETE FROM smart_weekly_drive_efficiency_plans WHERE subject=$1 AND vehicle_id=$2 AND revision=$3`,
		s.Subject, s.VehicleID, revision)
	if err != nil {
		return fmt.Errorf("clear private efficiency plan: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrChanged
	}
	return nil
}

func (r *Repository) Dismiss(ctx context.Context, s port.Scope, revision int64, until, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE smart_weekly_drive_efficiency_digests e SET dismissed_at=$5
		FROM smart_weekly_drive_efficiency_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.revision=$3 AND e.plan_revision=p.revision
		    AND p.next_check_at IS NOT NULL AND e.recent_until=$4 AND e.published_at<=$5 AND e.expires_at>$5
		    AND e.dismissed_at IS NULL`, s.Subject, s.VehicleID, revision, until, now)
	if err != nil {
		return fmt.Errorf("dismiss private efficiency digest: %w", err)
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
		    SELECT p.revision FROM smart_weekly_drive_efficiency_plans p JOIN vehicles v ON v.id=p.vehicle_id
		    WHERE v.archived_at IS NULL AND p.next_check_at<=$1 AND (p.lease_until IS NULL OR p.lease_until<=$1)
		        AND p.subject NOT IN ($3,'open-mode')
		        AND smart_feature_allowed(p.subject,'drive_efficiency')
		    ORDER BY p.next_check_at,p.revision LIMIT 1 FOR UPDATE OF p SKIP LOCKED
		)
		UPDATE smart_weekly_drive_efficiency_plans p SET lease_until=$2,feature_claimed_at=statement_timestamp()
		FROM due WHERE p.revision=due.revision
		RETURNING p.subject,p.vehicle_id,p.revision,p.time_zone,p.lease_until,COALESCE(to_char(p.last_week,'YYYY-MM-DD'),'')`,
		now, lease, personal.OpenSubject).
		Scan(&job.Subject, &job.VehicleID, &job.Revision, &job.TimeZone, &job.Lease, &job.LastWeek)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim due private efficiency review: %w", err)
	}
	return &job, nil
}

const activeLease = `FROM smart_weekly_drive_efficiency_plans p
	JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
	WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.revision=$3 AND p.lease_until=$4 AND p.lease_until>$5
	    AND smart_feature_current(p.subject,'drive_efficiency',p.feature_claimed_at)`

func (r *Repository) Current(ctx context.Context, j port.Job, now time.Time) (bool, error) {
	var current bool
	if err := r.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 `+activeLease+`)`, j.Subject, j.VehicleID, j.Revision, j.Lease, now).
		Scan(&current); err != nil {
		return false, fmt.Errorf("check private efficiency lease: %w", err)
	}
	return current, nil
}

func (r *Repository) Drives(ctx context.Context, j port.Job, w domain.Window, now time.Time, limit int) ([]port.Drive, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id,started_at,ended_at,distance_m FROM drives
		WHERE vehicle_id=$2 AND started_at>=$6 AND started_at<$7 AND ended_at<$7
		    AND ended_at BETWEEN started_at + INTERVAL '3 minutes' AND started_at + INTERVAL '2 hours'
		    AND distance_m BETWEEN 5000 AND 200000 AND EXISTS (SELECT 1 `+activeLease+`)
		ORDER BY started_at,id LIMIT $8`, j.Subject, j.VehicleID, j.Revision, j.Lease, now, w.BaselineFrom, w.RecentUntil, limit)
	if err != nil {
		return nil, fmt.Errorf("read bounded efficiency drive candidates: %w", err)
	}
	drives, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (port.Drive, error) {
		var d port.Drive
		err := row.Scan(&d.ID, &d.StartedAt, &d.EndedAt, &d.DistanceM)
		return d, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan efficiency drive candidates: %w", err)
	}
	return drives, nil
}

func (r *Repository) Finish(ctx context.Context, j port.Job, now, next time.Time, cycle string, d *domain.Digest) (bool, error) {
	var published bool
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE smart_weekly_drive_efficiency_plans p SET lease_until=NULL,next_check_at=$6,
			    last_week=GREATEST(p.last_week,NULLIF($7,'')::date)
			FROM vehicles v WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.revision=$3 AND p.lease_until=$4
			    AND p.lease_until>$5 AND v.id=p.vehicle_id AND v.archived_at IS NULL
			    AND smart_feature_current(p.subject,'drive_efficiency',p.feature_claimed_at)`,
			j.Subject, j.VehicleID, j.Revision, j.Lease, now, next, cycle)
		if err != nil {
			return fmt.Errorf("complete private efficiency lease: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return nil
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_weekly_drive_efficiency_digests WHERE plan_revision=$1 AND expires_at<=$2`,
			j.Revision, now); err != nil {
			return fmt.Errorf("remove expired efficiency digest: %w", err)
		}
		if d == nil || !now.Before(d.ExpiresAt) {
			return nil
		}
		tag, err = tx.Exec(ctx, `
			INSERT INTO smart_weekly_drive_efficiency_digests
			    (plan_revision,reference_drive_id,baseline_from,recent_from,recent_until,observed_until,published_at,expires_at,
			     baseline_days,recent_days,baseline_low_wh_per_m,baseline_high_wh_per_m,recent_low_wh_per_m,recent_high_wh_per_m,higher,feature_checked_at)
			SELECT $1,d.id,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,p.feature_claimed_at
			FROM drives d JOIN smart_weekly_drive_efficiency_plans p ON p.revision=$1
			WHERE d.id=$2 AND d.vehicle_id=$3 AND d.ended_at=$7 AND d.ended_at<$6
			ON CONFLICT (plan_revision) DO NOTHING`,
			j.Revision, d.ReferenceDriveID, j.VehicleID, d.BaselineFrom, d.RecentFrom, d.RecentUntil, d.ObservedUntil, now,
			d.ExpiresAt, d.BaselineDays, d.RecentDays, d.Baseline.LowWhPerM, d.Baseline.HighWhPerM, d.Recent.LowWhPerM, d.Recent.HighWhPerM, d.Higher)
		if err != nil {
			return fmt.Errorf("publish qualified efficiency digest: %w", err)
		}
		published = tag.RowsAffected() == 1
		return nil
	})
	return published && err == nil, err
}
