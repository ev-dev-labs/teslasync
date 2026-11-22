package monthlytariff

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/monthlytariff"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/monthlytariff"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const termsJoins = `
	LEFT JOIN geofences g ON g.id=p.site_id AND g.updated_at=p.site_revision AND g.enabled
	    AND NOT g.needs_review AND g.archived_at IS NULL AND g.is_charging_location
	LEFT JOIN utility_tariffs cur ON cur.id=p.current_tariff_id AND cur.version=p.current_version
	    AND cur.subject=p.subject AND cur.is_current AND cur.structure IN ('flat','tou')
	    AND cur.demand_charge_minor_per_w=0 AND cur.export_price_minor_per_wh=0
	LEFT JOIN utility_tariffs alt ON alt.id=p.alternative_tariff_id AND alt.version=p.alternative_version
	    AND alt.subject=p.subject AND NOT alt.is_current AND alt.structure IN ('flat','tou')
	    AND alt.demand_charge_minor_per_w=0 AND alt.export_price_minor_per_wh=0 AND alt.currency=cur.currency`

const validTerms = `g.id IS NOT NULL AND cur.id IS NOT NULL AND alt.id IS NOT NULL`

func (r *Repository) Read(ctx context.Context, scope port.Scope, now time.Time) (domain.Review, error) {
	var out domain.Review
	err := pgx.BeginTxFunc(ctx, r.pool, pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}, func(tx pgx.Tx) error {
		var settings domain.Settings
		err := tx.QueryRow(ctx, `
			SELECT COALESCE(p.id,0),COALESCE(p.site_id,0),COALESCE(p.site_revision,'epoch'),
				COALESCE(p.current_tariff_id,0),COALESCE(p.current_version,0),
				COALESCE(p.alternative_tariff_id,0),COALESCE(p.alternative_version,0),
				COALESCE(p.time_zone,''),COALESCE(p.minimum_savings_minor,0),COALESCE(p.switch_fee_minor,0),
				p.next_check_at IS NULL,p.last_checked_at,COALESCE(cur.currency::text,''),
				COALESCE(g.name,''),COALESCE(cur.name,''),COALESCE(alt.name,''),NOT (`+validTerms+`)
			FROM vehicles v
			LEFT JOIN smart_monthly_tariff_plans p ON p.vehicle_id=v.id AND p.subject=$1`+termsJoins+`
			WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID).
			Scan(&settings.ID, &settings.SiteID, &settings.SiteRevision, &settings.CurrentTariffID, &settings.CurrentVersion,
				&settings.AlternativeID, &settings.AlternativeVersion, &settings.TimeZone, &settings.MinimumMinor,
				&settings.SwitchFeeMinor, &settings.Paused, &out.LastCheckedAt, &out.Currency,
				&out.SiteName, &out.CurrentName, &out.AlternativeName, &out.NeedsReview)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("read monthly tariff plan: %w", err)
		}
		if settings.ID == 0 {
			out.NeedsReview = false
			return nil
		}
		out.Settings = &settings
		if settings.Paused || out.NeedsReview {
			return nil
		}
		digest, err := readDigest(ctx, tx, scope.Subject, settings, now)
		out.Digest = digest
		return err
	})
	return out, err
}

func readDigest(ctx context.Context, tx pgx.Tx, subject string, settings domain.Settings, now time.Time) (*domain.Digest, error) {
	var digest domain.Digest
	c := &digest.Comparison
	c.SwitchFeeMinor = settings.SwitchFeeMinor
	err := tx.QueryRow(ctx, `
		SELECT month_from,month_through,checked_at,expires_at,days,sessions,energy_wh,
			current_low_minor,current_high_minor,alt_low_minor,alt_high_minor,current_fixed_minor,alt_fixed_minor,
			saving_low_minor,saving_high_minor
		FROM smart_monthly_tariff_digests WHERE plan_id=$1 AND dismissed_at IS NULL AND checked_at<=$2 AND expires_at>$2
		    AND smart_feature_current($3,'monthly_tariff',feature_checked_at)`,
		settings.ID, now, subject).Scan(&digest.From, &digest.Through, &digest.CheckedAt, &digest.ExpiresAt, &c.Days, &c.Sessions, &c.EnergyWh,
		&c.Current.LowerMinor, &c.Current.UpperMinor, &c.Alternative.LowerMinor, &c.Alternative.UpperMinor,
		&c.CurrentFixedMinor, &c.AltFixedMinor, &c.NetSavings.LowerMinor, &c.NetSavings.UpperMinor)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read monthly tariff digest: %w", err)
	}
	return &digest, nil
}

func (r *Repository) Replace(ctx context.Context, scope port.Scope, s domain.Settings, next *time.Time) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var checked, cycle *time.Time
		if s.ID != 0 {
			err := tx.QueryRow(ctx, `DELETE FROM smart_monthly_tariff_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3
				RETURNING last_checked_at,next_cycle_at`, scope.Subject, scope.VehicleID, s.ID).Scan(&checked, &cycle)
			if errors.Is(err, pgx.ErrNoRows) {
				return port.ErrChanged
			}
			if err != nil {
				return fmt.Errorf("replace monthly tariff plan: %w", err)
			}
		}
		tag, err := tx.Exec(ctx, `
			WITH offered AS (
				SELECT $1::text AS subject,$2::bigint AS vehicle_id,$3::bigint AS site_id,$4::timestamptz AS site_revision,
					$5::bigint AS current_tariff_id,$6::int AS current_version,$7::bigint AS alternative_tariff_id,
					$8::int AS alternative_version
			)
			INSERT INTO smart_monthly_tariff_plans
				(subject,vehicle_id,site_id,site_revision,current_tariff_id,current_version,alternative_tariff_id,
				alternative_version,time_zone,minimum_savings_minor,switch_fee_minor,next_check_at,last_checked_at,next_cycle_at)
			SELECT p.subject,p.vehicle_id,p.site_id,p.site_revision,p.current_tariff_id,p.current_version,p.alternative_tariff_id,
				p.alternative_version,$9,$10,$11,CASE WHEN $12::timestamptz IS NOT NULL THEN GREATEST($12,$14::timestamptz) END,$13,$14
			FROM offered p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL`+termsJoins+`
			WHERE $12 IS NULL OR (`+validTerms+`)
			ON CONFLICT (subject,vehicle_id) DO NOTHING`, scope.Subject, scope.VehicleID, s.SiteID, s.SiteRevision,
			s.CurrentTariffID, s.CurrentVersion, s.AlternativeID, s.AlternativeVersion, s.TimeZone,
			s.MinimumMinor, s.SwitchFeeMinor, next, checked, cycle)
		if err != nil {
			return fmt.Errorf("save monthly tariff plan: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrChanged
		}
		return nil
	})
}

func (r *Repository) Delete(ctx context.Context, scope port.Scope, id int64) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM smart_monthly_tariff_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		scope.Subject, scope.VehicleID, id)
	if err != nil {
		return fmt.Errorf("clear monthly tariff plan: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrChanged
	}
	return nil
}

func (r *Repository) Dismiss(ctx context.Context, scope port.Scope, id int64, through, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE smart_monthly_tariff_digests d SET dismissed_at=$5
		FROM smart_monthly_tariff_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL`+termsJoins+`
		WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND p.id=d.plan_id AND d.month_through=$4
			AND d.checked_at<=$5 AND d.expires_at>$5 AND d.dismissed_at IS NULL AND p.next_check_at IS NOT NULL
			AND `+validTerms, scope.Subject, scope.VehicleID, id, through, now)
	if err != nil {
		return fmt.Errorf("dismiss monthly tariff digest: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrChanged
	}
	return nil
}

func (r *Repository) Claim(ctx context.Context, now, lease time.Time) (*port.Job, error) {
	var j port.Job
	err := r.pool.QueryRow(ctx, `
		WITH due AS (
			SELECT p.id FROM smart_monthly_tariff_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
			WHERE p.next_check_at<=$1 AND (p.lease_until IS NULL OR p.lease_until<=$1) AND p.subject NOT IN ($3,'open-mode')
				AND smart_feature_allowed(p.subject,'monthly_tariff')
			ORDER BY p.next_check_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED
		)
		UPDATE smart_monthly_tariff_plans p SET lease_until=$2,feature_claimed_at=statement_timestamp() FROM due WHERE p.id=due.id
		RETURNING p.id,p.subject,p.vehicle_id,p.site_id,p.site_revision,p.current_tariff_id,p.current_version,
			p.alternative_tariff_id,p.alternative_version,p.time_zone,p.minimum_savings_minor,p.switch_fee_minor,p.lease_until`,
		now, lease, personal.OpenSubject).Scan(&j.ID, &j.Subject, &j.VehicleID, &j.SiteID, &j.SiteRevision, &j.CurrentTariffID,
		&j.CurrentVersion, &j.AlternativeID, &j.AlternativeVersion, &j.TimeZone, &j.MinimumMinor, &j.SwitchFeeMinor, &j.Lease)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim monthly tariff plan: %w", err)
	}
	return &j, nil
}

func (r *Repository) Finish(ctx context.Context, job port.Job, now, next time.Time, digest *domain.Digest) (bool, error) {
	var published bool
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE smart_monthly_tariff_plans p SET lease_until=NULL,last_checked_at=$3,next_check_at=$4,next_cycle_at=$4
			FROM vehicles v WHERE p.id=$1 AND p.lease_until=$2 AND $3<p.lease_until
				AND p.next_check_at IS NOT NULL AND p.vehicle_id=v.id AND v.archived_at IS NULL
				AND smart_feature_current(p.subject,'monthly_tariff',p.feature_claimed_at)`,
			job.ID, job.Lease, now, next)
		if err != nil {
			return fmt.Errorf("finish monthly tariff check: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return nil
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_monthly_tariff_digests WHERE plan_id=$1 AND expires_at<=$2`, job.ID, now); err != nil {
			return fmt.Errorf("prune expired monthly tariff digest: %w", err)
		}
		if digest == nil || !now.Before(digest.ExpiresAt) {
			return nil
		}
		c := digest.Comparison
		tag, err = tx.Exec(ctx, `
			INSERT INTO smart_monthly_tariff_digests (
				plan_id,month_from,month_through,checked_at,expires_at,days,sessions,energy_wh,current_low_minor,
				current_high_minor,alt_low_minor,alt_high_minor,current_fixed_minor,alt_fixed_minor,saving_low_minor,saving_high_minor,feature_checked_at
			)
			SELECT p.id,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,p.feature_claimed_at
			FROM smart_monthly_tariff_plans p`+termsJoins+` WHERE p.id=$1 AND `+validTerms+`
			ON CONFLICT (plan_id) DO NOTHING`, job.ID, digest.From, digest.Through, digest.CheckedAt, digest.ExpiresAt,
			c.Days, c.Sessions, c.EnergyWh, c.Current.LowerMinor, c.Current.UpperMinor, c.Alternative.LowerMinor, c.Alternative.UpperMinor,
			c.CurrentFixedMinor, c.AltFixedMinor, c.NetSavings.LowerMinor, c.NetSavings.UpperMinor)
		if err != nil {
			return fmt.Errorf("publish monthly tariff digest: %w", err)
		}
		published = tag.RowsAffected() == 1
		return nil
	})
	return published && err == nil, err
}
