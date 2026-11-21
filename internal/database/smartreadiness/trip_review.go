package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var _ port.TripReviewRepository = (*Repository)(nil)

const reviewOwnedPlan = `p.id = $1 AND p.subject = $2 AND p.vehicle_id = $3`
const reviewFrom = ` FROM smart_trip_reviews b
	JOIN smart_charging_plans p ON p.id = b.plan_id AND p.version = b.plan_version AND p.enabled
	` + stopPlanJoins + ` AND o.updated_at = b.origin_updated_at
	JOIN journey_sessions j ON j.id = b.journey_id AND j.vehicle_id = p.vehicle_id
	JOIN geofences d ON d.id = b.destination_id AND d.enabled AND NOT d.needs_review
	  AND d.archived_at IS NULL AND d.updated_at = b.destination_updated_at
	LEFT JOIN geofences c ON c.id = b.stop_place_id AND c.enabled AND NOT c.needs_review
	  AND c.archived_at IS NULL AND c.is_charging_location AND c.updated_at = b.stop_place_updated_at`
const reviewWhere = ` WHERE ` + reviewOwnedPlan + ` AND (b.stop_place_id IS NULL OR c.id IS NOT NULL)
	AND (b.planned_arrival_pct > 0 OR b.explicit_arrival_baseline)`
const unambiguousJourney = ` AND NOT EXISTS (
	SELECT 1 FROM journey_sessions other
	WHERE other.vehicle_id = j.vehicle_id AND other.id <> j.id
	  AND other.started_at < j.ended_at AND (other.ended_at IS NULL OR other.ended_at > j.started_at)
)`

func (r *Repository) HasTripReview(ctx context.Context, key domain.StopPlanKey) (bool, error) {
	var has bool
	err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM smart_trip_reviews b JOIN smart_charging_plans p ON p.id = b.plan_id
		JOIN vehicles v ON v.id = p.vehicle_id AND v.archived_at IS NULL WHERE `+reviewOwnedPlan+`)`,
		key.PlanID, key.Subject, key.VehicleID).Scan(&has)
	if err != nil {
		return false, fmt.Errorf("check saved trip review: %w", err)
	}
	return has, nil
}

func (r *Repository) ReplaceTripReview(ctx context.Context, key domain.StopPlanKey, setup domain.TripReviewSetup, now time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var planID int64
		err := tx.QueryRow(ctx, `SELECT p.id FROM smart_charging_plans p
			`+stopPlanJoins+`
			JOIN journey_sessions j ON j.id = $6 AND j.vehicle_id = p.vehicle_id AND j.status = 'planned'
			  AND j.started_at IS NULL AND j.ended_at IS NULL
			JOIN geofences d ON d.id = $8 AND d.id <> o.id AND d.enabled AND NOT d.needs_review AND d.archived_at IS NULL
			LEFT JOIN geofences c ON c.id = $10 AND c.id <> d.id AND c.id <> o.id AND c.is_charging_location
			  AND c.enabled AND NOT c.needs_review AND c.archived_at IS NULL AND c.updated_at = $11
			WHERE `+stopPlanWhere+` AND p.version = $5 AND o.updated_at = $7 AND d.updated_at = $9
			  AND ($10::bigint IS NULL OR c.id IS NOT NULL)
			FOR UPDATE OF p, j`, key.PlanID, key.Subject, key.VehicleID, now, setup.PlanVersion,
			setup.JourneyID, setup.OriginUpdatedAt, setup.DestinationID, setup.DestinationUpdatedAt,
			setup.StopPlaceID, setup.StopPlaceUpdatedAt).Scan(&planID)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock plan and journey for review setup: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_trip_reviews WHERE plan_id = $1`, planID); err != nil {
			return fmt.Errorf("replace trip review setup: %w", err)
		}
		_, err = tx.Exec(ctx, `INSERT INTO smart_trip_reviews (plan_id, journey_id, plan_version, saved_at, origin_updated_at,
			destination_id, destination_updated_at, stop_place_id, stop_place_updated_at, planned_arrival_pct, planned_stop_s, explicit_arrival_baseline)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`, planID, setup.JourneyID, setup.PlanVersion, now,
			setup.OriginUpdatedAt, setup.DestinationID, setup.DestinationUpdatedAt, setup.StopPlaceID, setup.StopPlaceUpdatedAt,
			setup.PlannedArrivalPct, setup.PlannedStopS)
		if err != nil {
			return fmt.Errorf("save trip review setup: %w", err)
		}
		return nil
	})
}

func (r *Repository) DeleteTripReview(ctx context.Context, key domain.StopPlanKey) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_trip_reviews b USING smart_charging_plans p
		WHERE b.plan_id = p.id AND `+reviewOwnedPlan, key.PlanID, key.Subject, key.VehicleID)
	if err != nil {
		return fmt.Errorf("remove private trip review: %w", err)
	}
	return nil
}

func (r *Repository) ReadTripReview(ctx context.Context, key domain.StopPlanKey, now time.Time) (*domain.TripReviewSnapshot, error) {
	return readTripReview(ctx, r.db.Pool, key, now)
}

func readTripReview(ctx context.Context, db database.DBTX, key domain.StopPlanKey, now time.Time) (*domain.TripReviewSnapshot, error) {
	var value domain.TripReviewSnapshot
	var status string
	var started, ended *time.Time
	setup, baseline, journey := &value.Setup, &value.Baseline, &value.Journey
	err := db.QueryRow(ctx, `
		SELECT b.revision, b.journey_id, b.plan_version, b.origin_updated_at, b.destination_id,
		  b.destination_updated_at, b.stop_place_id, b.stop_place_updated_at, b.planned_arrival_pct, b.planned_stop_s,
		  p.vehicle_id, o.id, b.saved_at, p.departure_at, j.status, j.started_at, j.ended_at
		`+reviewFrom+reviewWhere, key.PlanID, key.Subject, key.VehicleID).
		Scan(&value.ScopedRevision, &setup.JourneyID, &setup.PlanVersion, &setup.OriginUpdatedAt, &setup.DestinationID,
			&setup.DestinationUpdatedAt, &setup.StopPlaceID, &setup.StopPlaceUpdatedAt, &setup.PlannedArrivalPct, &setup.PlannedStopS,
			&baseline.VehicleID, &baseline.OriginPlaceID, &baseline.SavedAt, &baseline.DepartureAt, &status, &started, &ended)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read saved trip review: %w", err)
	}
	if status == "planned" && baseline.DepartureAt.After(now) {
		value.SimilarAdjustment, err = readSimilarTripAdjustment(ctx, db, key, value, now)
		return &value, err
	}
	if status != "completed" || started == nil || ended == nil ||
		!ended.After(*started) || !now.Before(ended.Add(30*24*time.Hour)) || ended.After(now) ||
		ended.Sub(*started) > 24*time.Hour || !started.After(baseline.SavedAt) {
		return &value, nil
	}
	baseline.JourneyID, baseline.DestinationID = setup.JourneyID, setup.DestinationID
	baseline.PlannedArrivalPct, baseline.PlannedStopS = setup.PlannedArrivalPct, setup.PlannedStopS
	if setup.StopPlaceID != nil {
		baseline.StopPlaceID = *setup.StopPlaceID
	}
	journey.ID, journey.VehicleID, journey.StartedAt, journey.EndedAt = setup.JourneyID, baseline.VehicleID, *started, *ended
	if err := loadTripReviewEvidence(ctx, db, journey); err != nil {
		return nil, err
	}
	var revision int64
	var adjustment domain.TripReviewAdjustment
	var adjustmentAt *time.Time
	err = db.QueryRow(ctx, `SELECT b.revision, a.saved_at, COALESCE(a.extra_stop_s, 0), COALESCE(a.extra_arrival_pct, 0)
		`+reviewFrom+` LEFT JOIN smart_trip_review_adjustments a ON a.review_revision = b.revision
		 AND a.arrival_observed_at IS NOT NULL
		`+reviewWhere+` AND b.revision = $4 AND j.status = 'completed' AND j.started_at = $5 AND j.ended_at = $6`+unambiguousJourney,
		key.PlanID, key.Subject, key.VehicleID, value.ScopedRevision, *started, *ended).
		Scan(&revision, &adjustmentAt, &adjustment.ExtraStopS, &adjustment.ExtraArrivalPct)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("recheck trip review scope: %w", err)
	}
	if adjustmentAt != nil {
		adjustment.SavedAt = *adjustmentAt
		value.Adjustment = &adjustment
	}
	value.HasCompleted = true
	return &value, nil
}

func readSimilarTripAdjustment(
	ctx context.Context, db database.DBTX, key domain.StopPlanKey, current domain.TripReviewSnapshot, now time.Time,
) (*domain.SimilarTripReviewAdjustment, error) {
	var adjustment domain.SimilarTripReviewAdjustment
	err := db.QueryRow(ctx, `SELECT a.saved_at, a.extra_stop_s, a.extra_arrival_pct, j.ended_at + INTERVAL '720 hours' `+reviewFrom+`
		JOIN smart_trip_review_adjustments a ON a.review_revision = b.revision AND a.arrival_observed_at IS NOT NULL
		WHERE p.id <> $1 AND p.subject = $2 AND p.vehicle_id = $3 AND o.id = $4 AND d.id = $5
		  AND (b.stop_place_id IS NULL OR c.id IS NOT NULL)
		  AND b.stop_place_id IS NOT DISTINCT FROM $6::bigint
		  AND j.status = 'completed' AND j.ended_at <= $7 AND j.ended_at > $7::timestamptz - INTERVAL '720 hours'
		  AND EXISTS (SELECT 1 FROM smart_trip_reviews active JOIN smart_charging_plans ap
		    ON active.plan_id = ap.id AND active.plan_version = ap.version
		    WHERE ap.id = $1 AND ap.subject = $2 AND ap.vehicle_id = $3 AND active.revision = $8)`+unambiguousJourney+`
		ORDER BY a.saved_at DESC LIMIT 1`, key.PlanID, key.Subject, key.VehicleID, current.Baseline.OriginPlaceID,
		current.Setup.DestinationID, current.Setup.StopPlaceID, now, current.ScopedRevision).
		Scan(&adjustment.SavedAt, &adjustment.ExtraStopS, &adjustment.ExtraArrivalPct, &adjustment.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read similar private trip adjustment: %w", err)
	}
	return &adjustment, nil
}

func loadTripReviewEvidence(ctx context.Context, db database.DBTX, journey *domain.TripReviewJourney) error {
	drives, err := db.Query(ctx, `WITH legs AS (
		SELECT id, start_geofence_id, end_geofence_id, started_at, ended_at FROM drives
		WHERE vehicle_id = $1 AND started_at BETWEEN $2::timestamptz - INTERVAL '24 hours' AND $3
		  AND (ended_at IS NULL OR ended_at > $2) ORDER BY started_at, id LIMIT 3
	)
	SELECT COALESCE(d.start_geofence_id, 0), COALESCE(d.end_geofence_id, 0),
		d.started_at, COALESCE(d.ended_at, d.started_at), battery.pct, battery.source_emitted_at
	FROM legs d
	LEFT JOIN LATERAL (
		SELECT COALESCE(float_value, int_value::float8) AS pct, source_emitted_at FROM signal_log
		WHERE vehicle_id = $1 AND field = 'BatteryLevel'
		  AND ts >= greatest(d.started_at, d.ended_at - INTERVAL '2 minutes') AND ts <= d.ended_at
		  AND source_emitted_at BETWEEN greatest(d.started_at, d.ended_at - INTERVAL '2 minutes') AND d.ended_at
		ORDER BY source_emitted_at DESC, ts DESC LIMIT 1
	) battery ON true
	ORDER BY d.started_at, d.id`, journey.VehicleID, journey.StartedAt, journey.EndedAt)
	if err != nil {
		return fmt.Errorf("query recorded trip drive legs: %w", err)
	}
	journey.Drives, err = pgx.CollectRows(drives, func(row pgx.CollectableRow) (domain.TripReviewDrive, error) {
		var d domain.TripReviewDrive
		err := row.Scan(&d.OriginPlaceID, &d.DestinationID, &d.StartedAt, &d.EndedAt, &d.EndChargePct, &d.EndChargeObservedAt)
		return d, err
	})
	if err != nil {
		return fmt.Errorf("scan recorded trip drive legs: %w", err)
	}
	charges, err := db.Query(ctx, `SELECT COALESCE(geofence_id, 0), started_at, COALESCE(ended_at, started_at)
		FROM charging_sessions
		WHERE vehicle_id = $1 AND started_at BETWEEN $2::timestamptz - INTERVAL '24 hours' AND $3
		  AND (ended_at IS NULL OR ended_at > $2)
		ORDER BY started_at, id LIMIT 2`, journey.VehicleID, journey.StartedAt, journey.EndedAt)
	if err != nil {
		return fmt.Errorf("query recorded trip charging sessions: %w", err)
	}
	journey.ChargeSessions, err = pgx.CollectRows(charges, func(row pgx.CollectableRow) (domain.TripReviewCharge, error) {
		var c domain.TripReviewCharge
		err := row.Scan(&c.PlaceID, &c.StartedAt, &c.EndedAt)
		return c, err
	})
	if err != nil {
		return fmt.Errorf("scan recorded trip charging sessions: %w", err)
	}
	return nil
}

func (r *Repository) SaveTripAdjustment(
	ctx context.Context, key domain.StopPlanKey, now time.Time,
	choose func(domain.TripReviewSnapshot) (*domain.TripReviewAdjustment, error),
) error {
	err := pgx.BeginTxFunc(ctx, r.db.Pool, pgx.TxOptions{IsoLevel: pgx.Serializable}, func(tx pgx.Tx) error {
		snapshot, err := readTripReview(ctx, tx, key, now)
		if err != nil {
			return err
		}
		if snapshot == nil || !snapshot.HasCompleted {
			return port.ErrNotFound
		}
		adjustment, err := choose(*snapshot)
		if err != nil || adjustment == nil {
			return err
		}
		legs := snapshot.Journey.Drives
		if len(legs) == 0 || legs[len(legs)-1].EndChargeObservedAt == nil {
			return port.ErrNotFound
		}
		_, err = tx.Exec(ctx, `INSERT INTO smart_trip_review_adjustments
			(review_revision, saved_at, extra_stop_s, extra_arrival_pct, arrival_observed_at) VALUES ($1,$2,$3,$4,$5)
			ON CONFLICT (review_revision) DO UPDATE SET saved_at=EXCLUDED.saved_at, extra_stop_s=EXCLUDED.extra_stop_s,
			  extra_arrival_pct=EXCLUDED.extra_arrival_pct, arrival_observed_at=EXCLUDED.arrival_observed_at
			WHERE smart_trip_review_adjustments.arrival_observed_at IS NULL`,
			snapshot.ScopedRevision, adjustment.SavedAt, adjustment.ExtraStopS, adjustment.ExtraArrivalPct, legs[len(legs)-1].EndChargeObservedAt)
		return err
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && (pgErr.Code == "40001" || pgErr.Code == "23503") {
		return port.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("save private trip planning adjustment: %w", err)
	}
	return nil
}
