package smartcommute

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
	"github.com/jackc/pgx/v5"
)

const trafficScope = `
	FROM smart_commute_traffic_consent c
	JOIN smart_commute_routines r ON r.id = c.routine_id AND r.status = 'confirmed'
	JOIN smart_commute_settings s
	  ON s.subject = r.subject AND s.vehicle_id = r.vehicle_id
	  AND s.enabled AND s.local_analysis_enabled AND NOT s.paused
	JOIN vehicles v ON v.id = r.vehicle_id AND v.archived_at IS NULL`

func (r *Repository) ClaimTrafficCheck(ctx context.Context, now time.Time, sharedOpenMode bool, next port.NextTrafficCheck) (*port.TrafficCheck, error) {
	var claim *port.TrafficCheck
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var check port.TrafficCheck
		var latitudes, longitudes []float64
		routine, err := scanRoutineWithExtras(tx.QueryRow(ctx, `
			SELECT `+routineColumns+`, c.id, r.subject, s.time_zone, s.updated_at,
			       c.latitudes, c.longitudes, c.lead_s, c.min_savings_s, c.check_at, c.departure_at,
			       c.arrival_deadline_s, c.compare_route_energy
			`+trafficScope+`
			WHERE c.check_at <= $1 AND (r.subject = $2) = $3
			ORDER BY c.check_at, c.id
			LIMIT 1 FOR UPDATE OF c SKIP LOCKED`, now, personal.OpenSubject, sharedOpenMode),
			&check.ConsentID, &check.Subject, &check.Settings.TimeZone, &check.SettingsUpdatedAt,
			&latitudes, &longitudes, &check.Consent.LeadS, &check.Consent.MinSavingsS,
			&check.Consent.CheckAt, &check.Consent.DepartureAt, &check.Consent.ArrivalDeadlineS, &check.Consent.CompareRouteEnergy)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("select one due commute check: %w", err)
		}
		check.Routine = *routine
		check.Settings.VehicleID = routine.VehicleID
		check.Settings.Enabled = true
		check.Settings.LocalAnalysisEnabled = true
		if len(latitudes) == len(longitudes) && len(latitudes) <= domain.MaxTrafficTracePoints {
			check.Consent.Trace = make([]domain.Point, len(latitudes))
			for i, latitude := range latitudes {
				check.Consent.Trace[i] = domain.Point{Latitude: latitude, Longitude: longitudes[i]}
			}
		}
		nextCheck, nextDeparture, ok := next(check)
		if !ok || !nextCheck.After(now) || !nextDeparture.After(check.Consent.DepartureAt) {
			if _, err := tx.Exec(ctx, `DELETE FROM smart_commute_traffic_consent WHERE id = $1`, check.ConsentID); err != nil {
				return fmt.Errorf("clear unschedulable commute consent: %w", err)
			}
			check.AlreadyChecked = true
			claim = &check
			return nil
		}
		if _, err := tx.Exec(ctx, `
			UPDATE smart_commute_traffic_consent SET check_at = $2, departure_at = $3 WHERE id = $1`,
			check.ConsentID, nextCheck, nextDeparture); err != nil {
			return fmt.Errorf("advance commute check cursor: %w", err)
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_commute_traffic_occurrences (routine_id, departure_at)
			VALUES ($1, $2)
			ON CONFLICT (routine_id) DO UPDATE SET departure_at = EXCLUDED.departure_at, skipped = false
			WHERE smart_commute_traffic_occurrences.departure_at < EXCLUDED.departure_at`,
			check.Routine.ID, check.Consent.DepartureAt)
		if err != nil {
			return fmt.Errorf("reserve commute occurrence: %w", err)
		}
		check.AlreadyChecked = tag.RowsAffected() == 0
		claim = &check
		return nil
	})
	return claim, err
}

const claimedTrafficScope = trafficScope + `
	JOIN smart_commute_traffic_occurrences o ON o.routine_id = r.id
	WHERE c.id = $1 AND r.id = $2 AND r.subject = $3 AND r.vehicle_id = $4
	  AND s.updated_at = $5 AND o.departure_at = $6 AND NOT o.skipped
	  AND c.departure_at > o.departure_at`

func (r *Repository) SkipTrafficToday(ctx context.Context, subject string, vehicleID, routineID int64, now time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var zone string
		var next time.Time
		var last *time.Time
		err := tx.QueryRow(ctx, `
			SELECT r.time_zone, c.departure_at, o.departure_at
			`+trafficScope+`
			LEFT JOIN smart_commute_traffic_occurrences o ON o.routine_id = r.id
			WHERE r.subject = $1 AND r.vehicle_id = $2 AND r.id = $3
			FOR UPDATE OF c`, subject, vehicleID, routineID).Scan(&zone, &next, &last)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock commute occurrence to skip: %w", err)
		}
		loc, err := time.LoadLocation(zone)
		if err != nil {
			return fmt.Errorf("load routine time zone for skip: %w", err)
		}
		departure := next
		if last != nil && last.After(now) && last.Before(next) {
			departure = *last
		}
		day, plannedDay := now.In(loc), departure.In(loc)
		if !departure.After(now) || day.Year() != plannedDay.Year() || day.YearDay() != plannedDay.YearDay() {
			return port.ErrNotFound
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO smart_commute_traffic_occurrences (routine_id, departure_at, skipped)
			VALUES ($1, $2, true)
			ON CONFLICT (routine_id) DO UPDATE SET departure_at = EXCLUDED.departure_at, skipped = true
			WHERE smart_commute_traffic_occurrences.departure_at <= EXCLUDED.departure_at`, routineID, departure)
		if err != nil {
			return fmt.Errorf("skip scheduled commute occurrence: %w", err)
		}
		return nil
	})
}

func (r *Repository) VerifyTrafficCheck(ctx context.Context, check port.TrafficCheck) error {
	var allowed bool
	if err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 `+claimedTrafficScope+`)`,
		check.ConsentID, check.Routine.ID, check.Subject, check.Routine.VehicleID,
		check.SettingsUpdatedAt, check.Consent.DepartureAt).Scan(&allowed); err != nil {
		return fmt.Errorf("recheck claimed commute consent: %w", err)
	}
	if !allowed {
		return port.ErrTrafficClaimLost
	}
	return nil
}

func (r *Repository) RecordTrafficDecision(
	ctx context.Context, check port.TrafficCheck, decision domain.TrafficDecision, now time.Time,
) (bool, error) {
	tag, err := r.db.Pool.Exec(ctx, `
		INSERT INTO smart_commute_traffic_decisions
		  (consent_id, departure_at, settings_updated_at, usual_s, alternative_s, observed_at, expires_at,
		   arrival_deadline_at, latest_departure_at, route_energy, route_energy_only)
		SELECT c.id, o.departure_at, s.updated_at, $7, $8, $9, $10, $12, $13, $14, $15
		`+claimedTrafficScope+` AND $10::timestamptz > $11 AND ($14::jsonb IS NULL OR c.compare_route_energy)
		ON CONFLICT (consent_id) DO UPDATE SET
		    departure_at = EXCLUDED.departure_at, settings_updated_at = EXCLUDED.settings_updated_at,
		    usual_s = EXCLUDED.usual_s, alternative_s = EXCLUDED.alternative_s,
		    observed_at = EXCLUDED.observed_at, expires_at = EXCLUDED.expires_at,
		    arrival_deadline_at = EXCLUDED.arrival_deadline_at, latest_departure_at = EXCLUDED.latest_departure_at,
		    route_energy = EXCLUDED.route_energy, route_energy_only = EXCLUDED.route_energy_only
		WHERE smart_commute_traffic_decisions.departure_at < EXCLUDED.departure_at`,
		check.ConsentID, check.Routine.ID, check.Subject, check.Routine.VehicleID,
		check.SettingsUpdatedAt, check.Consent.DepartureAt, decision.UsualS,
		decision.AlternativeS, decision.ObservedAt, decision.ExpiresAt, now,
		decision.ArrivalDeadlineAt, decision.LatestDepartureAt, decision.RouteEnergy, decision.RouteEnergyOnly)
	if err != nil {
		return false, fmt.Errorf("persist claimed commute comparison: %w", err)
	}
	return tag.RowsAffected() != 0, nil
}

func (r *Repository) ListTrafficDecisions(
	ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int,
) ([]domain.TrafficDecision, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT r.id, r.vehicle_id, r.name, v.display_name, r.time_zone, d.departure_at,
		       d.usual_s, d.alternative_s, d.observed_at, d.expires_at, r.origin_latitude, r.origin_longitude,
		       d.arrival_deadline_at, d.latest_departure_at, d.route_energy, d.route_energy_only
		`+trafficScope+`
		JOIN smart_commute_traffic_decisions d ON d.consent_id = c.id AND d.settings_updated_at = s.updated_at
		JOIN smart_commute_traffic_occurrences o ON o.routine_id = r.id AND o.departure_at = d.departure_at
		WHERE r.subject = $1 AND ($2::bigint IS NULL OR r.vehicle_id = $2)
		  AND d.expires_at > $3 AND NOT o.skipped
		ORDER BY d.departure_at, r.id LIMIT $4`, subject, vehicleID, now, limit)
	if err != nil {
		return nil, fmt.Errorf("list current private commute comparisons: %w", err)
	}
	result, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.TrafficDecision, error) {
		var item domain.TrafficDecision
		err := row.Scan(&item.RoutineID, &item.VehicleID, &item.RoutineName, &item.VehicleName, &item.TimeZone, &item.DepartureAt,
			&item.UsualS, &item.AlternativeS, &item.ObservedAt, &item.ExpiresAt, &item.Origin.Latitude, &item.Origin.Longitude,
			&item.ArrivalDeadlineAt, &item.LatestDepartureAt, &item.RouteEnergy, &item.RouteEnergyOnly)
		return item, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan current private commute comparisons: %w", err)
	}
	return result, nil
}
