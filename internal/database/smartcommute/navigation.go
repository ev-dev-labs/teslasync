package smartcommute

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
	"github.com/jackc/pgx/v5"
)

func (r *Repository) FindNavigationOccurrence(
	ctx context.Context, scope port.NavigationScope, now time.Time,
) (*port.NavigationOccurrence, error) {
	return readNavigationOccurrence(ctx, r.db.Pool, scope, now, "")
}

func readNavigationOccurrence(
	ctx context.Context, db database.DBTX, scope port.NavigationScope, now time.Time, lock string,
) (*port.NavigationOccurrence, error) {
	var occurrence port.NavigationOccurrence
	err := db.QueryRow(ctx, `
		SELECT v.vin, r.origin_latitude, r.origin_longitude, d.departure_at, d.expires_at, COALESCE(a.outcome, '')
		`+trafficScope+`
		JOIN smart_commute_traffic_decisions d ON d.consent_id = c.id AND d.settings_updated_at = s.updated_at
		JOIN smart_commute_traffic_occurrences o ON o.routine_id = r.id AND o.departure_at = d.departure_at
		LEFT JOIN smart_commute_navigation_attempts a ON a.routine_id = r.id AND a.departure_at = d.departure_at
		WHERE r.subject = $1 AND r.vehicle_id = $2 AND r.id = $3
		  AND d.observed_at <= $4 AND d.expires_at > $4 AND NOT o.skipped
		  AND d.arrival_deadline_at IS NULL AND NOT d.route_energy_only
		  AND d.usual_s - d.alternative_s >= c.min_savings_s
		  AND NOT smart_commute_drive_started(r.vehicle_id, o.departure_at - make_interval(secs => c.lead_s), $4)
		`+lock, scope.Subject, scope.VehicleID, scope.RoutineID, now).Scan(
		&occurrence.VIN, &occurrence.Origin.Latitude, &occurrence.Origin.Longitude,
		&occurrence.DepartureAt, &occurrence.ExpiresAt, &occurrence.Outcome,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read actionable commute occurrence: %w", err)
	}
	if occurrence.VIN == "" || domain.TrafficOccurrenceID(scope.RoutineID, occurrence.DepartureAt) != scope.OccurrenceID {
		return nil, port.ErrNotFound
	}
	return &occurrence, nil
}

func (r *Repository) ClaimNavigationAttempt(ctx context.Context, scope port.NavigationScope, now time.Time) (bool, error) {
	var claimed bool
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if err := lockActiveVehicle(ctx, tx, scope.VehicleID); err != nil {
			return err
		}
		if _, err := lockSettings(ctx, tx, scope.Subject, scope.VehicleID); err != nil {
			return err
		}
		occurrence, err := readNavigationOccurrence(ctx, tx, scope, now, `FOR SHARE OF r, c, d, o`)
		if err != nil || occurrence.Outcome != "" {
			return err
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_commute_navigation_attempts (routine_id, departure_at, attempted_at, outcome)
			VALUES ($1, $2, $3, 'delivery_unknown')
			ON CONFLICT (routine_id) DO UPDATE SET departure_at = EXCLUDED.departure_at,
			    attempted_at = EXCLUDED.attempted_at, outcome = EXCLUDED.outcome
			WHERE smart_commute_navigation_attempts.departure_at < EXCLUDED.departure_at`,
			scope.RoutineID, occurrence.DepartureAt, now)
		if err != nil {
			return fmt.Errorf("fence single commute navigation attempt: %w", err)
		}
		claimed = tag.RowsAffected() == 1
		return nil
	})
	return claimed, err
}

func (r *Repository) FinishNavigationAttempt(
	ctx context.Context, scope port.NavigationScope, departure time.Time, outcome domain.NavigationOutcome,
) error {
	_, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_commute_navigation_attempts a SET outcome = $5
		FROM smart_commute_routines r
		WHERE a.routine_id = r.id AND a.routine_id = $1 AND a.departure_at = $2
		  AND r.subject = $3 AND r.vehicle_id = $4 AND a.outcome = 'delivery_unknown'`,
		scope.RoutineID, departure, scope.Subject, scope.VehicleID, outcome)
	if err != nil {
		return fmt.Errorf("persist commute navigation outcome: %w", err)
	}
	return nil
}
