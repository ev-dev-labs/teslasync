package costtrend

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/costtrend"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/costtrend"
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
	var settings domain.Settings
	var id *int64
	err := r.pool.QueryRow(ctx, `
		SELECT p.id,COALESCE(p.time_zone,''),COALESCE(p.currency,''),COALESCE(p.material_change_minor,0),
			p.next_check_at IS NULL,p.last_checked_at
		FROM vehicles v
		LEFT JOIN smart_charging_cost_plans p ON p.vehicle_id=v.id AND p.subject=$1
		WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID).
		Scan(&id, &settings.TimeZone, &settings.Currency, &settings.MaterialChangeMinor, &settings.Paused, &out.LastCheckedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, port.ErrNotFound
	}
	if err != nil {
		return out, fmt.Errorf("read charging cost plan: %w", err)
	}
	if id == nil {
		return out, nil
	}
	settings.ID = *id
	out.Settings = &settings
	if settings.Paused {
		return out, nil
	}
	var digest domain.Digest
	a := &digest.Attribution
	a.Currency = settings.Currency
	err = r.pool.QueryRow(ctx, `
		SELECT d.prior_from,d.current_from,d.through,d.checked_at,d.expires_at,d.comparable_sites,
			d.distance_minor,d.purchase_intensity_minor,d.site_mix_minor,d.effective_price_minor,d.unattributed_minor,
			d.prior_sessions,d.prior_recorded_costs,d.prior_compared_sessions,
			d.prior_recorded_spend_minor,d.prior_compared_spend_minor,d.prior_distance_m,
			d.current_sessions,d.current_recorded_costs,d.current_compared_sessions,
			d.current_recorded_spend_minor,d.current_compared_spend_minor,d.current_distance_m
		FROM smart_charging_cost_digests d JOIN smart_charging_cost_plans p ON p.id=d.plan_id
		JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		WHERE p.id=$1 AND p.subject=$2 AND p.vehicle_id=$3 AND p.next_check_at IS NOT NULL
			AND d.dismissed_at IS NULL AND d.expires_at>$4
			AND smart_feature_current(p.subject,'charging_cost_digest',d.feature_checked_at)`, settings.ID, scope.Subject, scope.VehicleID, now).
		Scan(&digest.PriorFrom, &digest.CurrentFrom, &digest.Through, &digest.CheckedAt, &digest.ExpiresAt, &a.ComparableSites,
			&a.DistanceMinor, &a.PurchaseIntensityMinor, &a.SiteMixMinor, &a.EffectivePriceMinor, &a.UnattributedMinor,
			&a.Prior.Sessions, &a.Prior.RecordedCosts, &a.Prior.ComparedSessions,
			&a.Prior.RecordedSpendMinor, &a.Prior.ComparedSpendMinor, &a.Prior.RecordedDistanceM,
			&a.Current.Sessions, &a.Current.RecordedCosts, &a.Current.ComparedSessions,
			&a.Current.RecordedSpendMinor, &a.Current.ComparedSpendMinor, &a.Current.RecordedDistanceM)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, fmt.Errorf("read charging cost digest: %w", err)
	}
	out.Digest = &digest
	return out, nil
}

func (r *Repository) Replace(ctx context.Context, scope port.Scope, settings domain.Settings, next *time.Time) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var checked, cycle *time.Time
		if settings.ID != 0 {
			err := tx.QueryRow(ctx, `DELETE FROM smart_charging_cost_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3
				RETURNING last_checked_at,next_cycle_at`, scope.Subject, scope.VehicleID, settings.ID).Scan(&checked, &cycle)
			if errors.Is(err, pgx.ErrNoRows) {
				return port.ErrChanged
			}
			if err != nil {
				return fmt.Errorf("replace charging cost plan: %w", err)
			}
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_charging_cost_plans
				(subject,vehicle_id,time_zone,currency,material_change_minor,next_check_at,last_checked_at,next_cycle_at)
			SELECT $1,id,$3,$4,$5,CASE WHEN $6::timestamptz IS NOT NULL THEN GREATEST($6,$8::timestamptz) END,$7,$8
			FROM vehicles WHERE id=$2 AND archived_at IS NULL
			ON CONFLICT (subject,vehicle_id) DO NOTHING`, scope.Subject, scope.VehicleID,
			settings.TimeZone, settings.Currency, settings.MaterialChangeMinor, next, checked, cycle)
		if err != nil {
			return fmt.Errorf("save charging cost plan: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrChanged
		}
		return nil
	})
}

func (r *Repository) Delete(ctx context.Context, scope port.Scope, settingsID int64) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM smart_charging_cost_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		scope.Subject, scope.VehicleID, settingsID)
	if err != nil {
		return fmt.Errorf("clear charging cost plan: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrChanged
	}
	return nil
}

func (r *Repository) Dismiss(ctx context.Context, scope port.Scope, settingsID int64, through, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE smart_charging_cost_digests d SET dismissed_at=$5
		FROM smart_charging_cost_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND p.id=d.plan_id AND d.through=$4
			AND d.checked_at<=$5 AND d.expires_at>$5 AND d.dismissed_at IS NULL AND p.next_check_at IS NOT NULL`,
		scope.Subject, scope.VehicleID, settingsID, through, now)
	if err != nil {
		return fmt.Errorf("dismiss charging cost digest: %w", err)
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
			SELECT p.id FROM smart_charging_cost_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
			WHERE p.next_check_at<=$1 AND (p.lease_until IS NULL OR p.lease_until<=$1)
				AND p.subject NOT IN ($3,'open-mode')
				AND smart_feature_allowed(p.subject,'charging_cost_digest')
			ORDER BY p.next_check_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED
		)
		UPDATE smart_charging_cost_plans p SET lease_until=$2,feature_claimed_at=statement_timestamp() FROM due WHERE p.id=due.id
		RETURNING p.id,p.subject,p.vehicle_id,p.time_zone,p.currency,p.material_change_minor,p.lease_until`,
		now, lease, personal.OpenSubject).
		Scan(&job.ID, &job.Subject, &job.VehicleID, &job.TimeZone, &job.Currency, &job.MaterialChangeMinor, &job.Lease)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim monthly charging cost plan: %w", err)
	}
	return &job, nil
}

func (r *Repository) Finish(ctx context.Context, job port.Job, checkedAt, next time.Time, digest *domain.Digest) (bool, error) {
	var published bool
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE smart_charging_cost_plans p SET lease_until=NULL,last_checked_at=$3,next_check_at=$4,next_cycle_at=$4
			FROM vehicles v WHERE p.id=$1 AND p.lease_until=$2 AND $3<p.lease_until
				AND p.next_check_at IS NOT NULL AND p.vehicle_id=v.id AND v.archived_at IS NULL
				AND smart_feature_current(p.subject,'charging_cost_digest',p.feature_claimed_at)`,
			job.ID, job.Lease, checkedAt, next)
		if err != nil {
			return fmt.Errorf("finish monthly charging cost check: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return nil
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_charging_cost_digests WHERE plan_id=$1 AND expires_at<=$2`,
			job.ID, checkedAt); err != nil {
			return fmt.Errorf("prune expired charging cost digest: %w", err)
		}
		if digest == nil || !checkedAt.Before(digest.ExpiresAt) {
			return nil
		}
		a := digest.Attribution
		tag, err = tx.Exec(ctx, `
			INSERT INTO smart_charging_cost_digests (
				plan_id,prior_from,current_from,through,checked_at,expires_at,comparable_sites,
				distance_minor,purchase_intensity_minor,site_mix_minor,effective_price_minor,unattributed_minor,
				prior_sessions,prior_recorded_costs,prior_compared_sessions,prior_recorded_spend_minor,prior_compared_spend_minor,prior_distance_m,
				current_sessions,current_recorded_costs,current_compared_sessions,current_recorded_spend_minor,current_compared_spend_minor,current_distance_m,
				feature_checked_at
			) SELECT p.id,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,p.feature_claimed_at
			FROM smart_charging_cost_plans p WHERE p.id=$1
			ON CONFLICT (plan_id) DO NOTHING`, job.ID, digest.PriorFrom, digest.CurrentFrom, digest.Through, digest.CheckedAt, digest.ExpiresAt,
			a.ComparableSites, a.DistanceMinor, a.PurchaseIntensityMinor, a.SiteMixMinor, a.EffectivePriceMinor, a.UnattributedMinor,
			a.Prior.Sessions, a.Prior.RecordedCosts, a.Prior.ComparedSessions, a.Prior.RecordedSpendMinor, a.Prior.ComparedSpendMinor, a.Prior.RecordedDistanceM,
			a.Current.Sessions, a.Current.RecordedCosts, a.Current.ComparedSessions, a.Current.RecordedSpendMinor, a.Current.ComparedSpendMinor, a.Current.RecordedDistanceM)
		if err != nil {
			return fmt.Errorf("publish monthly charging cost digest: %w", err)
		}
		published = tag.RowsAffected() == 1
		return nil
	})
	return published && err == nil, err
}
