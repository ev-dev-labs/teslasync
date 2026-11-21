// Package subscriptionrenewal provides the PostgreSQL adapter for private renewal reviews.
package subscriptionrenewal

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	renewal "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/subscriptionrenewal"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/subscriptionrenewal"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) FindCandidates(ctx context.Context, subject string, vehicle *int64, now time.Time, limit int) ([]port.Candidate, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT o.id::text,s.id,v.id,v.display_name,o.published_at,p.expires_at
		FROM smart_subscription_renewal_plans p
		JOIN smart_subscription_renewal_occurrences o ON o.subscription_id=p.subscription_id AND o.renewal_day=p.renewal_day
		JOIN vehicle_subscriptions s ON s.id=p.subscription_id AND s.version=p.subscription_version
		JOIN vehicles v ON v.id=s.vehicle_id AND v.archived_at IS NULL
		WHERE s.subject=$1 AND ($2::bigint IS NULL OR v.id=$2) AND o.dismissed_at IS NULL
		    AND NOT p.paused AND p.next_check_at IS NULL AND o.published_at<=$3 AND p.expires_at>$3
		    AND s.kind='subscription' AND s.started_at<=$3 AND (s.ended_at IS NULL OR s.ended_at>p.expires_at)
		ORDER BY p.expires_at,s.id LIMIT $4`, subject, vehicle, now, limit)
	if err != nil {
		return nil, fmt.Errorf("list private upcoming renewals: %w", err)
	}
	candidates, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (port.Candidate, error) {
		var c port.Candidate
		err := row.Scan(&c.OccurrenceID, &c.SubscriptionID, &c.VehicleID, &c.VehicleName, &c.PublishedAt, &c.ExpiresAt)
		return c, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan private upcoming renewals: %w", err)
	}
	return candidates, nil
}

func (r *Repository) Read(ctx context.Context, scope port.Scope) (domain.Subscription, *port.Plan, error) {
	var s domain.Subscription
	var p port.Plan
	err := r.pool.QueryRow(ctx, `
		SELECT s.id,s.vehicle_id,s.name,s.kind,s.billing_period,s.price_minor,s.currency,s.usage_metric,
		    s.started_at,s.ended_at,s.version,
		    COALESCE(p.revision::text,''),COALESCE(p.subscription_version,0),COALESCE(to_char(p.renewal_day,'YYYY-MM-DD'),''),
		    COALESCE(p.time_zone,''),COALESCE(p.lead_days,0),COALESCE(p.paused,false),p.next_check_at,
		    o.published_at,o.dismissed_at IS NOT NULL
		FROM vehicle_subscriptions s JOIN vehicles v ON v.id=s.vehicle_id AND v.archived_at IS NULL
		LEFT JOIN smart_subscription_renewal_plans p ON p.subscription_id=s.id
		LEFT JOIN smart_subscription_renewal_occurrences o ON o.subscription_id=p.subscription_id AND o.renewal_day=p.renewal_day
		WHERE s.subject=$1 AND s.vehicle_id=$2 AND s.id=$3`, scope.Subject, scope.VehicleID, scope.SubscriptionID).
		Scan(&s.ID, &s.VehicleID, &s.Name, &s.Kind, &s.BillingPeriod, &s.PriceMinor, &s.Currency, &s.UsageMetric,
			&s.StartedAt, &s.EndedAt, &s.Version, &p.Revision, &p.SubscriptionVersion, &p.RenewalDay,
			&p.TimeZone, &p.LeadDays, &p.Paused, &p.NextCheckAt, &p.ReviewedAt, &p.Dismissed)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, nil, port.ErrNotFound
	}
	if err != nil {
		return s, nil, fmt.Errorf("read scoped renewal settings: %w", err)
	}
	if p.Revision == "" {
		return s, nil, nil
	}
	return s, &p, nil
}

func (r *Repository) Replace(ctx context.Context, scope port.Scope, p port.Plan, next, expires time.Time) error {
	if p.Revision == "" {
		tag, err := r.pool.Exec(ctx, `
			INSERT INTO smart_subscription_renewal_plans
			    (subscription_id,subscription_version,renewal_day,time_zone,lead_days,paused,next_check_at,expires_at)
			SELECT s.id,s.version,$5::text::date,$6,$7,false,$8,$9
			FROM vehicle_subscriptions s JOIN vehicles v ON v.id=s.vehicle_id AND v.archived_at IS NULL
			WHERE s.subject=$1 AND s.vehicle_id=$2 AND s.id=$3 AND s.version=$4
			    AND s.kind='subscription' AND s.started_at<$9 AND (s.ended_at IS NULL OR s.ended_at>$9)
			ON CONFLICT (subscription_id) DO NOTHING`,
			scope.Subject, scope.VehicleID, scope.SubscriptionID, p.SubscriptionVersion, p.RenewalDay,
			p.TimeZone, p.LeadDays, next, expires)
		if err != nil {
			return fmt.Errorf("create private renewal schedule: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrChanged
		}
		return nil
	}
	var nextCheck *time.Time
	if !p.Paused {
		nextCheck = &next
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE smart_subscription_renewal_plans p SET revision=DEFAULT,subscription_version=s.version,
		    renewal_day=$6::text::date,time_zone=$7,lead_days=$8,paused=$9,next_check_at=$10,
		    expires_at=$11,lease_until=NULL
		FROM vehicle_subscriptions s JOIN vehicles v ON v.id=s.vehicle_id AND v.archived_at IS NULL
		WHERE s.subject=$1 AND s.vehicle_id=$2 AND s.id=$3 AND s.version=$4 AND p.subscription_id=s.id
		    AND p.revision=$5::text::uuid AND ($9 OR (s.kind='subscription' AND s.started_at<$11 AND (s.ended_at IS NULL OR s.ended_at>$11)))`,
		scope.Subject, scope.VehicleID, scope.SubscriptionID, p.SubscriptionVersion, p.Revision, p.RenewalDay,
		p.TimeZone, p.LeadDays, p.Paused, nextCheck, expires)
	if err != nil {
		return fmt.Errorf("replace private renewal schedule: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrChanged
	}
	return nil
}

func (r *Repository) Delete(ctx context.Context, scope port.Scope, revision string) error {
	tag, err := r.pool.Exec(ctx, `
		DELETE FROM smart_subscription_renewal_plans p USING vehicle_subscriptions s
		WHERE s.subject=$1 AND s.vehicle_id=$2 AND s.id=$3 AND p.subscription_id=s.id AND p.revision=$4::text::uuid`,
		scope.Subject, scope.VehicleID, scope.SubscriptionID, revision)
	if err != nil {
		return fmt.Errorf("clear private renewal schedule: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrChanged
	}
	return nil
}

func (r *Repository) Dismiss(ctx context.Context, scope port.Scope, rev string, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		WITH changed AS (
		    UPDATE smart_subscription_renewal_plans p SET revision=DEFAULT,lease_until=NULL,next_check_at=NULL
		    FROM vehicle_subscriptions s JOIN vehicles v ON v.id=s.vehicle_id AND v.archived_at IS NULL,
		        smart_subscription_renewal_occurrences o
		    WHERE s.subject=$1 AND s.vehicle_id=$2 AND s.id=$3 AND p.subscription_id=s.id
		        AND p.subscription_version=s.version AND p.revision=$4::text::uuid AND NOT p.paused AND p.next_check_at IS NULL
		        AND p.expires_at>$5 AND o.subscription_id=p.subscription_id AND o.renewal_day=p.renewal_day
		        AND o.dismissed_at IS NULL AND o.published_at<=$5
		    RETURNING p.subscription_id,p.renewal_day
		)
		UPDATE smart_subscription_renewal_occurrences o SET dismissed_at=$5 FROM changed c
		WHERE o.subscription_id=c.subscription_id AND o.renewal_day=c.renewal_day`,
		scope.Subject, scope.VehicleID, scope.SubscriptionID, rev, now)
	if err != nil {
		return fmt.Errorf("dismiss private renewal: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrChanged
	}
	return nil
}

func (r *Repository) Claim(ctx context.Context, now, lease time.Time) (*port.Job, error) {
	var j port.Job
	s := &j.Subscription
	err := r.pool.QueryRow(ctx, `
		WITH due AS (
		    SELECT p.subscription_id,s.subject,s.vehicle_id,s.name,s.kind,s.billing_period,s.price_minor,
		        s.currency,s.usage_metric,s.started_at,s.ended_at,s.version
		    FROM smart_subscription_renewal_plans p JOIN vehicle_subscriptions s ON s.id=p.subscription_id
		    JOIN vehicles v ON v.id=s.vehicle_id AND v.archived_at IS NULL
		    WHERE p.next_check_at<=$1 AND NOT p.paused AND (p.lease_until IS NULL OR p.lease_until<=$1)
		        AND p.subscription_version=s.version AND s.subject NOT IN ($3,$4)
		    ORDER BY p.next_check_at,p.subscription_id LIMIT 1 FOR UPDATE OF p SKIP LOCKED
		)
		UPDATE smart_subscription_renewal_plans p SET lease_until=$2 FROM due
		WHERE p.subscription_id=due.subscription_id
		RETURNING due.subscription_id,due.subject,due.vehicle_id,due.name,due.kind,due.billing_period,due.price_minor,
		    due.currency,due.usage_metric,due.started_at,due.ended_at,due.version,p.revision::text,
		    to_char(p.renewal_day,'YYYY-MM-DD'),p.time_zone,p.lead_days,p.lease_until`,
		now, lease, personal.OpenSubject, domain.LegacyOpenSubject).
		Scan(&j.SubscriptionID, &j.Subject, &j.VehicleID, &s.Name, &s.Kind, &s.BillingPeriod, &s.PriceMinor,
			&s.Currency, &s.UsageMetric, &s.StartedAt, &s.EndedAt, &s.Version, &j.Revision,
			&j.RenewalDay, &j.TimeZone, &j.LeadDays, &j.Lease)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim due private renewal: %w", err)
	}
	s.ID, s.VehicleID, j.SubscriptionVersion = j.SubscriptionID, j.VehicleID, s.Version
	return &j, nil
}

func (r *Repository) Finish(ctx context.Context, j port.Job, now time.Time, ready bool) (bool, error) {
	var published bool
	err := r.pool.QueryRow(ctx, `
		WITH held AS (
		    UPDATE smart_subscription_renewal_plans p SET next_check_at=NULL,lease_until=NULL
		    FROM vehicle_subscriptions s JOIN vehicles v ON v.id=s.vehicle_id AND v.archived_at IS NULL
		    WHERE s.subject=$1 AND s.vehicle_id=$2 AND s.id=$3 AND p.subscription_id=s.id
		        AND p.revision=$4::text::uuid AND p.subscription_version=s.version AND s.version=$5
		        AND p.lease_until=$6 AND p.lease_until>$7 AND NOT p.paused
		    RETURNING p.subscription_id,p.renewal_day,p.expires_at
		), published AS (
		    INSERT INTO smart_subscription_renewal_occurrences(subscription_id,renewal_day,published_at)
		    SELECT subscription_id,renewal_day,$7 FROM held WHERE $8 AND expires_at>$7
		    ON CONFLICT (subscription_id,renewal_day) DO NOTHING RETURNING subscription_id
		)
		SELECT EXISTS (SELECT 1 FROM published)`,
		j.Subject, j.VehicleID, j.SubscriptionID, j.Revision, j.SubscriptionVersion, j.Lease, now, ready).Scan(&published)
	if err != nil {
		return false, fmt.Errorf("finish fenced private renewal: %w", err)
	}
	return published, nil
}

func (r *Repository) Observations(ctx context.Context, scope port.Scope, p port.Plan, s domain.Subscription, w renewal.Window, now time.Time) ([]renewal.Observation, error) {
	var rows []renewal.Observation
	err := pgx.BeginTxFunc(ctx, r.pool, pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}, func(tx pgx.Tx) error {
		var id int64
		err := tx.QueryRow(ctx, `
			SELECT p.subscription_id FROM smart_subscription_renewal_plans p
			JOIN vehicle_subscriptions s ON s.id=p.subscription_id
			JOIN vehicles v ON v.id=s.vehicle_id AND v.archived_at IS NULL
			JOIN smart_subscription_renewal_occurrences o ON o.subscription_id=p.subscription_id AND o.renewal_day=p.renewal_day
			WHERE s.subject=$1 AND s.vehicle_id=$2 AND s.id=$3 AND p.revision=$4::text::uuid
			    AND s.version=$5 AND p.subscription_version=s.version AND o.dismissed_at IS NULL AND NOT p.paused
			    AND p.next_check_at IS NULL AND o.published_at<=$6 AND p.expires_at>$6`,
			scope.Subject, scope.VehicleID, scope.SubscriptionID, p.Revision, s.Version, now).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrChanged
		}
		if err != nil {
			return fmt.Errorf("check renewal observation scope: %w", err)
		}
		from := w.ObservationFrom(s)
		if !renewal.HasObservations(s.UsageMetric) || !from.Before(w.Through) {
			return nil
		}
		query := `
			SELECT id,started_at,ended_at,distance_m FROM drives
			WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<$3 AND ended_at>started_at AND ended_at<=$3
			ORDER BY started_at,id LIMIT $4`
		if s.UsageMetric == domain.UsageChargingSessions {
			query = `
				SELECT id,started_at,ended_at,NULL::double precision FROM charging_sessions
				WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<$3 AND ended_at>started_at AND ended_at<=$3
				ORDER BY started_at,id LIMIT $4`
		}
		evidence, err := tx.Query(ctx, query, scope.VehicleID, from, w.Through, renewal.MaxObservations+1)
		if err != nil {
			return fmt.Errorf("read bounded renewal observations: %w", err)
		}
		rows, err = pgx.CollectRows(evidence, func(row pgx.CollectableRow) (renewal.Observation, error) {
			var data renewal.Observation
			err := row.Scan(&data.ID, &data.StartedAt, &data.EndedAt, &data.DistanceM)
			return data, err
		})
		if err != nil {
			return fmt.Errorf("scan renewal observations: %w", err)
		}
		return nil
	})
	return rows, err
}
