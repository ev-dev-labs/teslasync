package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
)

var _ port.TripStopRepository = (*Repository)(nil)

const stopPlanJoins = `
	JOIN vehicles v ON v.id = p.vehicle_id AND v.archived_at IS NULL
	JOIN geofences o ON o.id = p.charging_place_id AND o.enabled AND NOT o.needs_review
	  AND o.archived_at IS NULL AND o.is_charging_location`

const stopPlanWhere = `p.id = $1 AND p.subject = $2 AND p.vehicle_id = $3 AND p.enabled
	AND p.departure_at > $4 AND (p.snoozed_until IS NULL OR p.snoozed_until <= $4)`

const stopScopeFrom = ` FROM smart_trip_stop_scopes s
	JOIN smart_charging_plans p ON p.id = s.plan_id AND p.version = s.plan_version
	` + stopPlanJoins + `
	JOIN geofences d ON d.id = s.destination_place_id AND d.enabled AND NOT d.needs_review
	  AND d.archived_at IS NULL AND d.updated_at = s.destination_updated_at`

const stopScopeWhere = ` WHERE ` + stopPlanWhere + ` AND o.updated_at = s.origin_updated_at
	AND (SELECT count(*) FROM smart_trip_stop_places a WHERE a.scope_id = s.id) = s.approved_place_count
	AND NOT EXISTS (
	  SELECT 1 FROM smart_trip_stop_places a LEFT JOIN geofences g
	    ON g.id = a.place_id AND g.enabled AND NOT g.needs_review AND g.archived_at IS NULL
	    AND g.is_charging_location AND g.updated_at = a.place_updated_at
	  WHERE a.scope_id = s.id AND g.id IS NULL
	)`

func (r *Repository) HasStopSetup(ctx context.Context, key domain.StopPlanKey) (bool, error) {
	var has bool
	err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM smart_trip_stop_scopes s JOIN smart_charging_plans p ON p.id = s.plan_id
		JOIN vehicles v ON v.id = p.vehicle_id AND v.archived_at IS NULL
		WHERE p.id = $1 AND p.subject = $2 AND p.vehicle_id = $3)`,
		key.PlanID, key.Subject, key.VehicleID).Scan(&has)
	if err != nil {
		return false, fmt.Errorf("check for saved trip stop setup: %w", err)
	}
	return has, nil
}

func (r *Repository) ReadStopScope(ctx context.Context, key domain.StopPlanKey, now time.Time) (*domain.StopComparisonScope, error) {
	var scope domain.StopComparisonScope
	var origin, destination systemmodel.Geofence
	var approvedCount int
	err := r.db.Pool.QueryRow(ctx, `
		SELECT s.id, p.version, s.origin_updated_at, s.destination_updated_at, p.departure_at, p.reserve_pct, lim.next_check_at,
		  s.destination_place_id, s.capacity_wh, s.start_pct, s.limit_pct, s.high_usage_wh_per_m,
		  o.polygon_wkt, d.polygon_wkt, s.approved_place_count
		`+stopScopeFrom+`
		LEFT JOIN smart_trip_stop_check_limits lim ON lim.plan_id = p.id
		`+stopScopeWhere, key.PlanID, key.Subject, key.VehicleID, now).
		Scan(&scope.ID, &scope.Input.PlanVersion, &scope.Input.OriginUpdatedAt, &scope.Input.DestinationUpdatedAt,
			&scope.DepartureAt, &scope.ReservePct, &scope.NextCheckAt,
			&scope.Input.DestinationPlaceID, &scope.Input.CapacityWh, &scope.Input.StartPct,
			&scope.Input.LimitPct, &scope.Input.HighUsageWhPerM, &origin.PolygonWKT, &destination.PolygonWKT, &approvedCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read trip comparison consent: %w", err)
	}
	scope.Origin.Latitude, scope.Origin.Longitude = origin.Centroid()
	scope.Destination.Latitude, scope.Destination.Longitude = destination.Centroid()
	rows, err := r.db.Pool.Query(ctx, `
		SELECT a.place_id, a.place_updated_at, a.time_zone, g.name, g.polygon_wkt,
		  array_agg(w.arrived_at ORDER BY w.arrived_at) FILTER (WHERE w.arrived_at IS NOT NULL),
		  array_agg(w.wait_s ORDER BY w.arrived_at) FILTER (WHERE w.arrived_at IS NOT NULL)
		`+stopScopeFrom+`
		JOIN smart_trip_stop_places a ON a.scope_id = s.id
		JOIN geofences g ON g.id = a.place_id
		LEFT JOIN smart_trip_stop_waits w USING (scope_id, place_id)
		`+stopScopeWhere+` AND s.id = $5
		GROUP BY a.place_id, a.place_updated_at, a.time_zone, g.name, g.polygon_wkt ORDER BY a.place_id`,
		key.PlanID, key.Subject, key.VehicleID, now, scope.ID)
	if err != nil {
		return nil, fmt.Errorf("read approved trip stops: %w", err)
	}
	scope.ReviewedStops, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.ReviewedStop, error) {
		var stop domain.ReviewedStop
		var place systemmodel.Geofence
		var arrivals []time.Time
		var waits []int32
		if err := row.Scan(&stop.PlaceID, &stop.PlaceUpdatedAt, &stop.TimeZone, &stop.Name, &place.PolygonWKT, &arrivals, &waits); err != nil {
			return stop, err
		}
		stop.Location.Latitude, stop.Location.Longitude = place.Centroid()
		stop.RadiusM = place.Radius()
		stop.Waits = make([]domain.StopWaitObservation, len(arrivals))
		for i, at := range arrivals {
			stop.Waits[i] = domain.StopWaitObservation{ArrivedAt: at.UTC(), WaitS: int64(waits[i])}
		}
		return stop, nil
	})
	if err != nil {
		return nil, fmt.Errorf("scan approved trip stops: %w", err)
	}
	if len(scope.ReviewedStops) != approvedCount {
		return nil, nil
	}
	for _, stop := range scope.ReviewedStops {
		scope.Input.Stops = append(scope.Input.Stops, stop.StopSetup)
	}
	return &scope, nil
}

func (r *Repository) ReplaceStopSetup(
	ctx context.Context, key domain.StopPlanKey, setup domain.StopComparisonInput, now time.Time,
) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var originID, version int64
		var originRevision, destinationRevision time.Time
		var reservePct float64
		err := tx.QueryRow(ctx, `
			SELECT o.id, p.version, o.updated_at, d.updated_at, p.reserve_pct
			FROM smart_charging_plans p `+stopPlanJoins+`
			JOIN geofences d ON d.id = $5 AND d.id <> o.id AND d.enabled AND NOT d.needs_review AND d.archived_at IS NULL
			WHERE `+stopPlanWhere+` FOR UPDATE OF p`,
			key.PlanID, key.Subject, key.VehicleID, now, setup.DestinationPlaceID).
			Scan(&originID, &version, &originRevision, &destinationRevision, &reservePct)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("verify trip plan for stop setup: %w", err)
		}
		if version != setup.PlanVersion || !originRevision.Equal(setup.OriginUpdatedAt) ||
			!destinationRevision.Equal(setup.DestinationUpdatedAt) {
			return port.ErrStopSetup
		}
		if setup.StartPct <= reservePct || setup.LimitPct <= reservePct {
			return port.ErrStopSetup
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_trip_stop_scopes WHERE plan_id = $1`, key.PlanID); err != nil {
			return fmt.Errorf("replace previous trip stop consent: %w", err)
		}
		var scopeID int64
		err = tx.QueryRow(ctx, `INSERT INTO smart_trip_stop_scopes (
			plan_id, plan_version, origin_updated_at, destination_place_id, destination_updated_at,
			capacity_wh, start_pct, limit_pct, high_usage_wh_per_m, approved_place_count)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
			key.PlanID, version, originRevision, setup.DestinationPlaceID, destinationRevision,
			setup.CapacityWh, setup.StartPct, setup.LimitPct, setup.HighUsageWhPerM, len(setup.Stops)).Scan(&scopeID)
		if err != nil {
			return fmt.Errorf("save trip stop consent: %w", err)
		}
		for _, stop := range setup.Stops {
			if stop.PlaceID == originID {
				return port.ErrStopSetup
			}
			if err := saveReviewedTripStop(ctx, tx, scopeID, stop); err != nil {
				return err
			}
		}
		return nil
	})
}

func saveReviewedTripStop(ctx context.Context, tx pgx.Tx, scopeID int64, stop domain.StopSetup) error {
	tag, err := tx.Exec(ctx, `INSERT INTO smart_trip_stop_places (scope_id, place_id, place_updated_at, time_zone)
		SELECT $1, id, updated_at, $3 FROM geofences
		WHERE id = $2 AND updated_at = $4 AND enabled AND NOT needs_review AND archived_at IS NULL AND is_charging_location`,
		scopeID, stop.PlaceID, stop.TimeZone, stop.PlaceUpdatedAt)
	if err != nil {
		return fmt.Errorf("save reviewed trip stop: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return port.ErrStopSetup
	}
	arrivals, waits := make([]time.Time, len(stop.Waits)), make([]int32, len(stop.Waits))
	for i, wait := range stop.Waits {
		arrivals[i], waits[i] = wait.ArrivedAt, int32(wait.WaitS) // bounded to four hours by the service
	}
	_, err = tx.Exec(ctx, `INSERT INTO smart_trip_stop_waits (scope_id, place_id, arrived_at, wait_s)
		SELECT $1, $2, arrived_at, wait_s FROM unnest($3::timestamptz[], $4::integer[]) AS w(arrived_at, wait_s)`,
		scopeID, stop.PlaceID, arrivals, waits)
	if err != nil {
		return fmt.Errorf("save trip stop wait observations: %w", err)
	}
	return nil
}

func (r *Repository) DeleteStopSetup(ctx context.Context, key domain.StopPlanKey) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var planID int64
		err := tx.QueryRow(ctx, `SELECT id FROM smart_charging_plans
			WHERE id = $1 AND subject = $2 AND vehicle_id = $3 FOR UPDATE`,
			key.PlanID, key.Subject, key.VehicleID).Scan(&planID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("lock consented trip plan for revocation: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_trip_stop_scopes WHERE plan_id = $1`, planID); err != nil {
			return fmt.Errorf("revoke stop routing consent: %w", err)
		}
		return nil
	})
}

func (r *Repository) CheckStopScope(ctx context.Context, key domain.StopPlanKey, scopeID int64, now time.Time) error {
	var id int64
	err := r.db.Pool.QueryRow(ctx, `SELECT s.id`+stopScopeFrom+stopScopeWhere+` AND s.id = $5`,
		key.PlanID, key.Subject, key.VehicleID, now, scopeID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return port.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("recheck trip stop consent: %w", err)
	}
	return nil
}

func (r *Repository) ClaimStopComparison(
	ctx context.Context, key domain.StopPlanKey, scopeID int64, now, next time.Time,
) (bool, error) {
	var claimed bool
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var planID int64
		err := tx.QueryRow(ctx, `SELECT p.id`+stopScopeFrom+stopScopeWhere+` AND s.id = $5 FOR UPDATE OF p, s`,
			key.PlanID, key.Subject, key.VehicleID, now, scopeID).Scan(&planID)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock trip stop comparison: %w", err)
		}
		tag, err := tx.Exec(ctx, `INSERT INTO smart_trip_stop_check_limits AS lim (plan_id, next_check_at) VALUES ($1, $2)
			ON CONFLICT (plan_id) DO UPDATE SET next_check_at = EXCLUDED.next_check_at WHERE lim.next_check_at <= $3`,
			planID, next, now)
		if err != nil {
			return fmt.Errorf("claim trip stop comparison: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
		if _, err := tx.Exec(ctx, `UPDATE smart_trip_stop_scopes SET last_compared_at = NULL, result_expires_at = NULL
			WHERE id = $1`, scopeID); err != nil {
			return fmt.Errorf("clear expired trip stop comparison: %w", err)
		}
		claimed = true
		return nil
	})
	return claimed, err
}

func (r *Repository) ListStopChargeSessions(
	ctx context.Context, key domain.StopPlanKey, scopeID, placeID int64, now time.Time,
) ([]domain.SitePerformanceSession, error) {
	rows, err := r.db.Pool.Query(ctx, `
		WITH sessions AS MATERIALIZED (
		  SELECT c.id, c.vehicle_id, c.started_at, c.ended_at, c.start_soc_pct, c.end_soc_pct,
		    c.charger_type, c.cable_type, c.start_lat, c.start_lng
		  `+stopScopeFrom+`
		  JOIN smart_trip_stop_places a ON a.scope_id = s.id AND a.place_id = $6
		  JOIN charging_sessions c ON c.vehicle_id = p.vehicle_id AND c.geofence_id = a.place_id
		  `+stopScopeWhere+` AND s.id = $5
		    AND c.started_at >= $4::timestamptz - INTERVAL '180 days' AND c.ended_at <= $4
		    AND c.ended_at > c.started_at AND c.start_lat IS NOT NULL AND c.start_lng IS NOT NULL
		  ORDER BY c.ended_at DESC, c.id DESC LIMIT 32
		)`+measuredSessionMeters, key.PlanID, key.Subject, key.VehicleID, now, scopeID, placeID)
	if err != nil {
		return nil, fmt.Errorf("query trip stop charging evidence: %w", err)
	}
	return readMeasuredSessions(rows)
}

func (r *Repository) ReadStopComparison(
	ctx context.Context, key domain.StopPlanKey, scopeID int64, now time.Time,
) (*domain.StopComparisonResult, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT s.last_compared_at, s.result_expires_at, res.place_id, g.name, res.detour_m, res.detour_s,
		  res.arrive_at, res.station_arrival_wh, res.destination_charge_wh, res.expected_wait_s,
		  res.estimated_charge_s, res.wait_sample_count, res.charge_sample_count
		`+stopScopeFrom+`
		JOIN smart_trip_stop_results res ON res.scope_id = s.id
		JOIN geofences g ON g.id = res.place_id
		`+stopScopeWhere+` AND s.id = $5 AND s.result_expires_at > $4
		ORDER BY res.rank`, key.PlanID, key.Subject, key.VehicleID, now, scopeID)
	if err != nil {
		return nil, fmt.Errorf("read saved trip stop comparison: %w", err)
	}
	var result domain.StopComparisonResult
	result.Stops, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.ChargingStopComparison, error) {
		var stop domain.ChargingStopComparison
		err := row.Scan(&result.ComparedAt, &result.ExpiresAt, &stop.PlaceID, &stop.PlaceName, &stop.DetourM,
			&stop.DetourS, &stop.ArriveAt, &stop.StationArrivalWh, &stop.DestinationChargeWh,
			&stop.ExpectedWaitS, &stop.EstimatedChargeS, &stop.WaitSampleCount, &stop.ChargeSampleCount)
		return stop, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan saved trip stop comparison: %w", err)
	}
	if len(result.Stops) < 2 {
		return nil, nil
	}
	return &result, nil
}

func (r *Repository) SaveStopComparison(
	ctx context.Context, key domain.StopPlanKey, scopeID int64, result domain.StopComparisonResult,
) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE smart_trip_stop_scopes target
			SET last_compared_at = $4, result_expires_at = $6
			WHERE target.id = $5 AND target.last_compared_at IS NULL
			AND EXISTS (SELECT 1 FROM smart_trip_stop_check_limits lim WHERE lim.plan_id = target.plan_id AND lim.next_check_at > $4)
			AND EXISTS (SELECT 1 `+stopScopeFrom+stopScopeWhere+` AND s.id = target.id)`,
			key.PlanID, key.Subject, key.VehicleID, result.ComparedAt, scopeID, result.ExpiresAt)
		if err != nil {
			return fmt.Errorf("finalize trip stop comparison: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrNotFound
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_trip_stop_results WHERE scope_id = $1`, scopeID); err != nil {
			return fmt.Errorf("clear previous trip stop results: %w", err)
		}
		for i, stop := range result.Stops {
			_, err := tx.Exec(ctx, `INSERT INTO smart_trip_stop_results (
				scope_id, place_id, rank, detour_m, detour_s, arrive_at, station_arrival_wh, destination_charge_wh,
				expected_wait_s, estimated_charge_s, wait_sample_count, charge_sample_count)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
				scopeID, stop.PlaceID, i+1, stop.DetourM, stop.DetourS, stop.ArriveAt, stop.StationArrivalWh,
				stop.DestinationChargeWh, stop.ExpectedWaitS, stop.EstimatedChargeS, stop.WaitSampleCount, stop.ChargeSampleCount)
			if err != nil {
				return fmt.Errorf("save qualified trip stop result: %w", err)
			}
		}
		return nil
	})
}
