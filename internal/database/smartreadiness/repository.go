// Package smartreadiness persists private one-trip charging readiness plans.
package smartreadiness

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	featuredb "github.com/ev-dev-labs/teslasync/internal/database/smartfeature"
	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartfeature"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
)

const (
	maxPlans          = 100
	slowChargingGrace = 5 * time.Minute
	planColumns       = `p.id, p.subject, p.vehicle_id, p.charging_place_id, p.enabled,
		p.notify_at, p.departure_at, p.trip_use_low_pct, p.trip_use_high_pct,
		p.reserve_pct, p.compare_site_rates, p.snoozed_until, p.created_at, p.updated_at, p.version,
		p.outbound_use_low_pct, p.outbound_use_high_pct, p.return_use_low_pct,
		p.return_use_high_pct, p.destination_charge_pct, p.scheduled_start_at, p.scheduled_start_time_zone,
		p.scheduled_power_ceiling_w, p.service_starts_at, p.service_ends_at,
		p.software_starts_at, p.software_ends_at, p.departure_overlap_push, p.early_stop_watch`
)

type Repository struct {
	db *database.DB
}

func NewRepository(db *database.DB) *Repository {
	if db == nil || db.Pool == nil {
		panic("smartreadiness.NewRepository: db and db.Pool must not be nil")
	}
	return &Repository{db: db}
}

func (r *Repository) ListPlans(
	ctx context.Context, subject string, vehicleID int64, limit, offset int,
) ([]domain.Plan, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT `+planColumns+` FROM smart_charging_plans p
		JOIN vehicles v ON v.id = p.vehicle_id AND v.archived_at IS NULL
		WHERE p.subject = $1 AND p.vehicle_id = $2
		ORDER BY p.departure_at DESC, p.id DESC LIMIT $3 OFFSET $4`, subject, vehicleID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list charging readiness plans: %w", err)
	}
	defer rows.Close()
	plans := make([]domain.Plan, 0)
	for rows.Next() {
		plan, scanErr := scanPlan(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan charging readiness plan: %w", scanErr)
		}
		plans = append(plans, *plan)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate charging readiness plans: %w", err)
	}
	return plans, nil
}

func (r *Repository) ListActivePlans(
	ctx context.Context, subject string, vehicleID int64, now time.Time, limit int,
) ([]domain.Plan, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT `+planColumns+` FROM smart_charging_plans p
		JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		JOIN geofences g ON g.id=p.charging_place_id AND g.enabled
		  AND NOT g.needs_review AND g.archived_at IS NULL AND g.is_charging_location
		WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.enabled
		  AND p.notify_at <= $3 AND p.departure_at > $3::timestamptz + INTERVAL '30 minutes'
		  AND (p.snoozed_until IS NULL OR p.snoozed_until <= $3)
		ORDER BY p.departure_at, p.id LIMIT $4`, subject, vehicleID, now, limit)
	if err != nil {
		return nil, fmt.Errorf("list active charging readiness plans: %w", err)
	}
	defer rows.Close()
	plans := make([]domain.Plan, 0)
	for rows.Next() {
		plan, scanErr := scanPlan(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan active charging readiness plan: %w", scanErr)
		}
		plans = append(plans, *plan)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate active charging readiness plans: %w", err)
	}
	return plans, nil
}

func (r *Repository) ListLatestStartPlans(
	ctx context.Context, subject string, vehicleID int64, now time.Time, limit int, workAt *time.Time,
) ([]port.LatestStartPlan, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT `+planColumns+`, access.readiness, access.rates, feature_clock.work_at
		FROM smart_charging_plans p
		JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		JOIN geofences g ON g.id=p.charging_place_id AND g.enabled
		  AND NOT g.needs_review AND g.archived_at IS NULL AND g.is_charging_location
		CROSS JOIN (SELECT COALESCE($5::timestamptz, statement_timestamp()) AS work_at) feature_clock
		CROSS JOIN LATERAL (
		  SELECT smart_feature_current(p.subject,'charging_readiness',feature_clock.work_at) AS readiness,
		         smart_feature_current(p.subject,'site_rates',feature_clock.work_at) AS rates
		) access
		WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.enabled
		  AND (access.readiness OR (p.compare_site_rates AND access.rates))
		  AND p.departure_at > $3::timestamptz + INTERVAL '30 minutes'
		  AND (p.snoozed_until IS NULL OR p.snoozed_until <= $3)
		ORDER BY p.departure_at, p.id LIMIT $4`, subject, vehicleID, now, limit, workAt)
	if err != nil {
		return nil, fmt.Errorf("list latest-start charging plans: %w", err)
	}
	defer rows.Close()
	plans := make([]port.LatestStartPlan, 0)
	for rows.Next() {
		var plan port.LatestStartPlan
		var ratesAllowed bool
		scanErr := scanPlanInto(rows, &plan.Plan, &plan.ReadinessAllowed, &ratesAllowed, &plan.WorkAt)
		if scanErr != nil {
			return nil, fmt.Errorf("scan latest-start charging plan: %w", scanErr)
		}
		plan.CompareSiteRates = plan.CompareSiteRates && ratesAllowed
		plans = append(plans, plan)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate latest-start charging plans: %w", err)
	}
	return plans, nil
}

func (r *Repository) SavePlan(
	ctx context.Context, subject string, plan domain.Plan, now time.Time,
) (*domain.Plan, error) {
	var saved *domain.Plan
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, $2))`, subject, plan.VehicleID); err != nil {
			return fmt.Errorf("lock charging readiness owner: %w", err)
		}
		var id int64
		err := tx.QueryRow(ctx, `
			SELECT id FROM vehicles WHERE id = $1 AND archived_at IS NULL FOR SHARE`, plan.VehicleID).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("check charging readiness vehicle: %w", err)
		}
		if plan.ChargingPlaceID != nil && (plan.ID == 0 || plan.Enabled) {
			err = tx.QueryRow(ctx, `
				SELECT id FROM geofences
				WHERE id = $1 AND enabled AND NOT needs_review
				  AND archived_at IS NULL AND is_charging_location FOR SHARE`,
				*plan.ChargingPlaceID).Scan(&id)
			if errors.Is(err, pgx.ErrNoRows) {
				return port.ErrNotFound
			}
			if err != nil {
				return fmt.Errorf("check charging readiness place: %w", err)
			}
		}
		var next *time.Time
		if plan.Enabled {
			checkAt := plan.NotifyAt
			if checkAt.Before(now) {
				checkAt = now
			}
			next = &checkAt
		}
		var outboundLow, outboundHigh, returnLow, returnHigh, destinationCharge *float64
		if plan.TripLegs != nil {
			outboundLow, outboundHigh = &plan.TripLegs.OutboundUseLowPct, &plan.TripLegs.OutboundUseHighPct
			returnLow, returnHigh = &plan.TripLegs.ReturnUseLowPct, &plan.TripLegs.ReturnUseHighPct
			destinationCharge = plan.TripLegs.DestinationChargePct
		}
		var scheduledAt *time.Time
		var scheduledZone *string
		var powerCeilingW *float64
		if start := plan.ScheduledStart; start != nil {
			scheduledAt, scheduledZone, powerCeilingW = &start.At, &start.TimeZone, start.PowerCeilingW
		}
		var serviceStartsAt, serviceEndsAt, softwareStartsAt, softwareEndsAt *time.Time
		if appointment := plan.ServiceAppointment; appointment != nil {
			serviceStartsAt, serviceEndsAt = &appointment.StartsAt, &appointment.EndsAt
		}
		if install := plan.SoftwareInstall; install != nil {
			softwareStartsAt, softwareEndsAt = &install.StartsAt, &install.EndsAt
		}
		if plan.ID == 0 {
			var count int
			if err := tx.QueryRow(ctx, `
				SELECT count(*) FROM smart_charging_plans WHERE subject = $1 AND vehicle_id = $2`,
				subject, plan.VehicleID).Scan(&count); err != nil {
				return fmt.Errorf("count charging readiness plans: %w", err)
			}
			if count >= maxPlans {
				return port.ErrLimit
			}
			saved, err = scanPlan(tx.QueryRow(ctx, `
				INSERT INTO smart_charging_plans AS p
				  (subject, vehicle_id, charging_place_id, enabled, notify_at, departure_at,
				   trip_use_low_pct, trip_use_high_pct, reserve_pct, compare_site_rates,
				   outbound_use_low_pct, outbound_use_high_pct, return_use_low_pct, return_use_high_pct,
				   destination_charge_pct, next_check_at, created_at, updated_at, scheduled_start_at, scheduled_start_time_zone,
				   scheduled_power_ceiling_w, service_starts_at, service_ends_at, software_starts_at, software_ends_at,
				   departure_overlap_push, early_stop_watch)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
				RETURNING `+planColumns,
				subject, plan.VehicleID, plan.ChargingPlaceID, plan.Enabled, plan.NotifyAt,
				plan.DepartureAt, plan.TripUseLowPct, plan.TripUseHighPct, plan.ReservePct,
				plan.CompareSiteRates, outboundLow, outboundHigh, returnLow, returnHigh, destinationCharge, next, now,
				scheduledAt, scheduledZone, powerCeilingW, serviceStartsAt, serviceEndsAt, softwareStartsAt, softwareEndsAt,
				plan.DepartureOverlapPush, plan.EarlyStopWatch))
		} else {
			// Electing an earlier check preserves the trip evidence's consent version.
			if plan.ExpectedCheckAt != nil {
				var version int64
				var checkAt time.Time
				err := tx.QueryRow(ctx, `
					SELECT version, notify_at FROM smart_charging_plans
					WHERE id=$1 AND subject=$2 AND vehicle_id=$3 FOR UPDATE`,
					plan.ID, subject, plan.VehicleID).Scan(&version, &checkAt)
				if errors.Is(err, pgx.ErrNoRows) {
					return port.ErrNotFound
				}
				if err != nil {
					return fmt.Errorf("check charging plan edit revision: %w", err)
				}
				if version != plan.Version || !checkAt.Equal(*plan.ExpectedCheckAt) {
					return port.ErrPlanChanged
				}
			}
			saved, err = scanPlan(tx.QueryRow(ctx, `
				UPDATE smart_charging_plans p
				SET charging_place_id=$4, enabled=$5, notify_at=$6, departure_at=$7,
				    trip_use_low_pct=$8, trip_use_high_pct=$9, reserve_pct=$10, compare_site_rates=$11,
				    next_check_at=CASE
				      WHEN $12::timestamptz IS NULL THEN NULL
				      WHEN p.snoozed_until > $13::timestamptz THEN GREATEST($12::timestamptz, p.snoozed_until)
				      ELSE $12::timestamptz END,
				    outbound_use_low_pct=$14, outbound_use_high_pct=$15, return_use_low_pct=$16,
				    return_use_high_pct=$17, destination_charge_pct=$18,
				    scheduled_start_at=$19, scheduled_start_time_zone=$20, scheduled_power_ceiling_w=$21,
				    service_starts_at=$22, service_ends_at=$23, software_starts_at=$24, software_ends_at=$25, departure_overlap_push=$26,
				    early_stop_watch=$27, lease_token=NULL, lease_until=NULL,
				    version=version+1, updated_at=$13
				WHERE p.id=$1 AND p.subject=$2 AND p.vehicle_id=$3
				RETURNING `+planColumns,
				plan.ID, subject, plan.VehicleID, plan.ChargingPlaceID, plan.Enabled, plan.NotifyAt,
				plan.DepartureAt, plan.TripUseLowPct, plan.TripUseHighPct, plan.ReservePct,
				plan.CompareSiteRates, next, now, outboundLow, outboundHigh, returnLow, returnHigh, destinationCharge,
				scheduledAt, scheduledZone, powerCeilingW, serviceStartsAt, serviceEndsAt, softwareStartsAt, softwareEndsAt,
				plan.DepartureOverlapPush, plan.EarlyStopWatch))
			if err == nil {
				err = clearReadinessDecisions(ctx, tx, plan.ID)
			}
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("save charging readiness plan: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return saved, nil
}

func (r *Repository) DeletePlan(ctx context.Context, subject string, vehicleID, planID int64) error {
	tag, err := r.db.Pool.Exec(ctx, `
		DELETE FROM smart_charging_plans WHERE subject = $1 AND vehicle_id = $2 AND id = $3`,
		subject, vehicleID, planID)
	if err != nil {
		return fmt.Errorf("delete charging readiness plan: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return port.ErrNotFound
	}
	return nil
}

func (r *Repository) SnoozePlan(
	ctx context.Context, subject string, vehicleID, planID int64, until *time.Time, now time.Time,
) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var id int64
		err := tx.QueryRow(ctx, `
			UPDATE smart_charging_plans
			SET snoozed_until=$4, next_check_at=CASE
			      WHEN NOT enabled THEN NULL
			      WHEN GREATEST(COALESCE($4::timestamptz, $5::timestamptz), notify_at, $5::timestamptz)
			           >= departure_at - INTERVAL '30 minutes' THEN NULL
			      ELSE GREATEST(COALESCE($4::timestamptz, $5::timestamptz), notify_at, $5::timestamptz) END,
			    lease_token=NULL, lease_until=NULL, version=version+1, updated_at=$5
			WHERE id=$1 AND subject=$2 AND vehicle_id=$3
			RETURNING id`, planID, subject, vehicleID, until, now).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("snooze charging readiness plan: %w", err)
		}
		if err := clearReadinessDecisions(ctx, tx, id); err != nil {
			return fmt.Errorf("clear snoozed charging readiness decision: %w", err)
		}
		return nil
	})
}

func clearReadinessDecisions(ctx context.Context, tx pgx.Tx, id int64) error {
	_, err := tx.Exec(ctx, `
		WITH cleared_charging AS (DELETE FROM smart_charging_decisions WHERE plan_id=$1),
		  cleared_conflict AS (DELETE FROM smart_charging_departure_conflicts WHERE plan_id=$1)
		DELETE FROM smart_charging_slow_samples WHERE plan_id=$1`, id)
	return err
}

func (r *Repository) ClaimDue(ctx context.Context, now time.Time, sharedOpenMode bool) (*port.Claim, error) {
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return nil, fmt.Errorf("create charging readiness lease: %w", err)
	}
	token := hex.EncodeToString(random[:])
	claim := port.Claim{Token: token}
	var earlyAllowed bool
	err := scanPlanInto(r.db.Pool.QueryRow(ctx, `
		WITH due AS (
		  SELECT p.id FROM smart_charging_plans p
		  JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		  JOIN geofences g ON g.id=p.charging_place_id AND g.enabled
		    AND NOT g.needs_review AND g.archived_at IS NULL AND g.is_charging_location
		  WHERE p.enabled AND p.next_check_at <= $1
		    AND ((p.subject = $3) = $4)
		    AND (p.snoozed_until IS NULL OR p.snoozed_until <= $1)
		    AND (p.lease_until IS NULL OR p.lease_until <= $1)
		    AND (smart_feature_allowed(p.subject,'charging_readiness')
		      OR (p.early_stop_watch AND NOT $4 AND smart_feature_allowed(p.subject,'early_stop'))
		      OR ((p.service_starts_at IS NOT NULL OR p.software_starts_at IS NOT NULL)
		          AND smart_feature_allowed(p.subject,'departure_overlap')))
		  ORDER BY p.next_check_at, p.id
		  LIMIT 1 FOR UPDATE OF p SKIP LOCKED
		)
		UPDATE smart_charging_plans p
		SET lease_token=$2, lease_until=$1::timestamptz + INTERVAL '2 minutes', feature_claimed_at=statement_timestamp()
		FROM due WHERE p.id=due.id
		RETURNING `+planColumns+`, NOT smart_feature_allowed(p.subject,'charging_readiness'),
		  NOT smart_feature_allowed(p.subject,'departure_overlap'), smart_feature_allowed(p.subject,'early_stop')`,
		now, token, personaldomain.OpenSubject, sharedOpenMode), &claim.Plan, &claim.AdvicePaused, &claim.OverlapPaused, &earlyAllowed)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim due charging readiness plan: %w", err)
	}
	claim.Plan.EarlyStopWatch = claim.Plan.EarlyStopWatch && earlyAllowed
	return &claim, nil
}

func (r *Repository) FinishClaim(
	ctx context.Context, claim port.Claim, decision, overlap domain.Decision, now time.Time,
) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		key := smartfeature.ChargingDecision(string(decision.Kind))
		for _, feature := range []smartfeature.Key{key, smartfeature.DepartureClash} {
			if _, err := featuredb.HoldAllowed(ctx, tx, claim.Plan.Subject, feature); err != nil {
				return err
			}
		}
		var next *time.Time
		interval := time.Minute
		if claim.Plan.EarlyStopWatch {
			interval = domain.EarlyStopCheckInterval
		}
		checkAt := now.UTC().Truncate(interval).Add(interval)
		if decision.Reason != domain.ReasonExpired && checkAt.Before(claim.Plan.DepartureAt.Add(-30*time.Minute)) {
			next = &checkAt
		}
		var id int64
		var claimAt time.Time
		var adviceCurrent, overlapCurrent bool
		err := tx.QueryRow(ctx, `
			UPDATE smart_charging_plans p SET lease_token=NULL, lease_until=NULL, next_check_at=$4
			WHERE p.id=$1 AND p.version=$2 AND p.lease_token=$3 AND p.enabled AND p.lease_until > $5
			RETURNING p.id, p.feature_claimed_at, smart_feature_current(p.subject,$6,p.feature_claimed_at),
			    smart_feature_current(p.subject,'departure_overlap',p.feature_claimed_at)`, claim.Plan.ID, claim.Plan.Version,
			claim.Token, next, now, key).Scan(&id, &claimAt, &adviceCurrent, &overlapCurrent)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrClaimLost
		}
		if err != nil {
			return fmt.Errorf("finish charging readiness claim: %w", err)
		}
		if !claim.OverlapPaused && overlapCurrent && overlap.Reason == domain.ReasonEligible && now.Before(overlap.ExpiresAt) {
			_, err = tx.Exec(ctx, `
				INSERT INTO smart_charging_departure_conflicts (plan_id, observed_at, expires_at, evaluated_at)
				VALUES ($1,$2,$3,$4)
				ON CONFLICT (plan_id) DO UPDATE SET observed_at=EXCLUDED.observed_at,
				  expires_at=EXCLUDED.expires_at, evaluated_at=EXCLUDED.evaluated_at`,
				id, overlap.ObservedAt, overlap.ExpiresAt, now)
			if err == nil {
				_, err = tx.Exec(ctx, `UPDATE smart_charging_plans SET feature_overlap_at=$2 WHERE id=$1`, id, claimAt)
			}
		} else if !claim.OverlapPaused && overlapCurrent {
			_, err = tx.Exec(ctx, `DELETE FROM smart_charging_departure_conflicts WHERE plan_id=$1`, id)
		}
		if err != nil {
			return fmt.Errorf("persist departure conflict decision: %w", err)
		}
		if !adviceCurrent || (claim.AdvicePaused && decision.Kind != domain.DecisionEarlyStop) {
			return nil
		}
		waiting := false
		if decision.Reason == domain.ReasonEligible && decision.Kind == domain.DecisionSlowCharging {
			var firstSeen time.Time
			err := tx.QueryRow(ctx, `
				INSERT INTO smart_charging_slow_samples AS s
				  (plan_id, plan_version, first_seen_at, last_seen_at, feature_checked_at)
				VALUES ($1, $2, $3, $3, $4)
				ON CONFLICT (plan_id) DO UPDATE SET
				  first_seen_at = CASE
				    WHEN s.plan_version = EXCLUDED.plan_version
				      AND EXCLUDED.last_seen_at > s.last_seen_at
				      AND s.last_seen_at >= EXCLUDED.last_seen_at - INTERVAL '90 seconds'
				      AND smart_feature_current($5,'charging_readiness',s.feature_checked_at)
				    THEN s.first_seen_at ELSE EXCLUDED.first_seen_at END,
				  plan_version = EXCLUDED.plan_version, last_seen_at = EXCLUDED.last_seen_at,
				  feature_checked_at = EXCLUDED.feature_checked_at
				RETURNING first_seen_at`, id, claim.Plan.Version, now, claimAt, claim.Plan.Subject).Scan(&firstSeen)
			if err != nil {
				return fmt.Errorf("record charging feasibility sample: %w", err)
			}
			waiting = now.Before(firstSeen.Add(slowChargingGrace))
		} else if _, err := tx.Exec(ctx, `DELETE FROM smart_charging_slow_samples WHERE plan_id=$1`, id); err != nil {
			return fmt.Errorf("clear charging feasibility samples: %w", err)
		}
		if decision.Reason != domain.ReasonEligible || waiting {
			if _, err := tx.Exec(ctx, `DELETE FROM smart_charging_decisions WHERE plan_id=$1`, id); err != nil {
				return fmt.Errorf("clear charging readiness decision: %w", err)
			}
			return nil
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO smart_charging_decisions
			  (plan_id, battery_pct, arrival_low_pct, arrival_high_pct, observed_at, expires_at, evaluated_at, kind, interrupted_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
			ON CONFLICT (plan_id) DO UPDATE SET
			  battery_pct=EXCLUDED.battery_pct, arrival_low_pct=EXCLUDED.arrival_low_pct,
			  arrival_high_pct=EXCLUDED.arrival_high_pct, observed_at=EXCLUDED.observed_at,
			  expires_at=EXCLUDED.expires_at, evaluated_at=EXCLUDED.evaluated_at, kind=EXCLUDED.kind,
			  interrupted_at=EXCLUDED.interrupted_at`,
			id, decision.BatteryPct, decision.ArrivalLowPct, decision.ArrivalHighPct,
			decision.ObservedAt, decision.ExpiresAt, now, decision.Kind, decision.InterruptedAt)
		if err != nil {
			return fmt.Errorf("persist charging readiness decision: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE smart_charging_plans SET feature_readiness_at=$2 WHERE id=$1`, id, claimAt); err != nil {
			return fmt.Errorf("stamp charging readiness decision: %w", err)
		}
		return nil
	})
}

func (r *Repository) ListCandidates(
	ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int,
) ([]port.Candidate, error) {
	return r.listCandidates(ctx, subject, vehicleID, nil, "", now, limit)
}

func (r *Repository) FindCandidate(
	ctx context.Context, subject string, vehicleID, planID int64, kind domain.DecisionKind, now time.Time,
) (*port.Candidate, error) {
	candidates, err := r.listCandidates(ctx, subject, &vehicleID, &planID, kind, now, 1)
	if err != nil || len(candidates) == 0 {
		return nil, err
	}
	return &candidates[0], nil
}

func (r *Repository) listCandidates(
	ctx context.Context, subject string, vehicleID, planID *int64, kind domain.DecisionKind, now time.Time, limit int,
) ([]port.Candidate, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT `+planColumns+`, d.battery_pct, d.arrival_low_pct, d.arrival_high_pct,
		       d.observed_at, d.expires_at, v.display_name, g.name, g.updated_at,
		       d.kind, d.interrupted_at, smart_feature_allowed(p.subject,'early_stop')
		FROM smart_charging_plans p
		JOIN smart_charging_candidate_decisions d ON d.plan_id=p.id
		LEFT JOIN smart_charging_slow_samples s ON s.plan_id=p.id AND s.plan_version=p.version
		  AND s.last_seen_at=d.evaluated_at
		  AND s.first_seen_at <= d.evaluated_at - INTERVAL '5 minutes'
		JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		JOIN geofences g ON g.id=p.charging_place_id AND g.enabled
		  AND NOT g.needs_review AND g.archived_at IS NULL AND g.is_charging_location
		WHERE p.subject=$1 AND p.enabled AND ($2::bigint IS NULL OR p.vehicle_id=$2)
		  AND (p.snoozed_until IS NULL OR p.snoozed_until <= $3)
		  AND d.expires_at > $3 AND p.departure_at > $3::timestamptz + INTERVAL '30 minutes'
		  AND smart_feature_current(p.subject,smart_charging_feature(d.kind),
		    CASE WHEN d.kind='departure_overlap' THEN p.feature_overlap_at ELSE p.feature_readiness_at END)
		  AND (d.kind <> 'slow_charging' OR s.plan_id IS NOT NULL)
		  AND ($5::bigint IS NULL OR p.id=$5) AND ($6 = '' OR d.kind=$6)
		ORDER BY p.departure_at, p.id, d.kind LIMIT $4`, subject, vehicleID, now, limit, planID, kind)
	if err != nil {
		return nil, fmt.Errorf("list charging readiness decisions: %w", err)
	}
	defer rows.Close()
	candidates := make([]port.Candidate, 0)
	for rows.Next() {
		var candidate port.Candidate
		var earlyAllowed bool
		err := scanPlanInto(rows, &candidate.Plan,
			&candidate.Decision.BatteryPct, &candidate.Decision.ArrivalLowPct,
			&candidate.Decision.ArrivalHighPct, &candidate.Decision.ObservedAt,
			&candidate.Decision.ExpiresAt, &candidate.VehicleName, &candidate.PlaceName,
			&candidate.PlaceUpdatedAt, &candidate.Decision.Kind, &candidate.Decision.InterruptedAt, &earlyAllowed)
		if err != nil {
			return nil, fmt.Errorf("scan charging readiness decision: %w", err)
		}
		candidate.Decision.Reason = domain.ReasonEligible
		candidate.Plan.EarlyStopWatch = candidate.Plan.EarlyStopWatch && earlyAllowed
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate charging readiness decisions: %w", err)
	}
	return candidates, nil
}

func scanPlan(row pgx.Row) (*domain.Plan, error) {
	var plan domain.Plan
	if err := scanPlanInto(row, &plan); err != nil {
		return nil, err
	}
	return &plan, nil
}

func scanPlanInto(row pgx.Row, plan *domain.Plan, extras ...any) error {
	var outboundLow, outboundHigh, returnLow, returnHigh, destinationCharge *float64
	var scheduledAt *time.Time
	var scheduledZone *string
	var powerCeilingW *float64
	var serviceStartsAt, serviceEndsAt, softwareStartsAt, softwareEndsAt *time.Time
	dest := []any{
		&plan.ID, &plan.Subject, &plan.VehicleID, &plan.ChargingPlaceID, &plan.Enabled,
		&plan.NotifyAt, &plan.DepartureAt, &plan.TripUseLowPct, &plan.TripUseHighPct,
		&plan.ReservePct, &plan.CompareSiteRates, &plan.SnoozedUntil, &plan.CreatedAt, &plan.UpdatedAt, &plan.Version,
		&outboundLow, &outboundHigh, &returnLow, &returnHigh, &destinationCharge, &scheduledAt, &scheduledZone, &powerCeilingW,
		&serviceStartsAt, &serviceEndsAt, &softwareStartsAt, &softwareEndsAt, &plan.DepartureOverlapPush, &plan.EarlyStopWatch,
	}
	if err := row.Scan(append(dest, extras...)...); err != nil {
		return err
	}
	if outboundLow != nil && outboundHigh != nil && returnLow != nil && returnHigh != nil {
		plan.TripLegs = &domain.TripLegs{
			OutboundUseLowPct: *outboundLow, OutboundUseHighPct: *outboundHigh,
			ReturnUseLowPct: *returnLow, ReturnUseHighPct: *returnHigh, DestinationChargePct: destinationCharge,
		}
	}
	if scheduledAt != nil && scheduledZone != nil {
		plan.ScheduledStart = &domain.ScheduledStart{At: *scheduledAt, TimeZone: *scheduledZone, PowerCeilingW: powerCeilingW}
	}
	if serviceStartsAt != nil && serviceEndsAt != nil {
		plan.ServiceAppointment = &domain.DepartureWindow{StartsAt: *serviceStartsAt, EndsAt: *serviceEndsAt}
	}
	if softwareStartsAt != nil && softwareEndsAt != nil {
		plan.SoftwareInstall = &domain.DepartureWindow{StartsAt: *softwareStartsAt, EndsAt: *softwareEndsAt}
	}
	return nil
}
