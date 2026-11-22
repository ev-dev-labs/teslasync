package smartcommute

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
	"github.com/jackc/pgx/v5"
)

func (r *Repository) CreateRoutine(
	ctx context.Context, subject string, input domain.RoutineInput, now time.Time,
) (*domain.Routine, error) {
	var result *domain.Routine
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if err := lockEnabledSettings(ctx, tx, subject, input.VehicleID); err != nil {
			return err
		}
		var count int
		if err := tx.QueryRow(ctx, `
			SELECT count(*) FROM smart_commute_routines WHERE subject = $1 AND vehicle_id = $2`,
			subject, input.VehicleID).Scan(&count); err != nil {
			return fmt.Errorf("count smart commute routines: %w", err)
		}
		if count >= maxRoutines {
			return fmt.Errorf("too many saved routine decisions")
		}
		item, err := scanRoutine(tx.QueryRow(ctx, `
			INSERT INTO smart_commute_routines AS r (
			  subject, vehicle_id, status, name, weekday, departure_s, time_zone,
			  origin_latitude, origin_longitude, destination_latitude, destination_longitude,
			  created_at, updated_at)
			VALUES ($1, $2, 'confirmed', $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
			RETURNING `+routineColumns,
			subject, input.VehicleID, input.Name, input.Weekday, input.DepartureS, input.TimeZone,
			input.Origin.Latitude, input.Origin.Longitude,
			input.Destination.Latitude, input.Destination.Longitude, now))
		if err != nil {
			return fmt.Errorf("create smart commute routine: %w", err)
		}
		result = item
		return nil
	})
	return result, err
}

func (r *Repository) ConfirmRoutine(
	ctx context.Context, subject string, routineID int64, input domain.RoutineInput, now time.Time,
) (*domain.Routine, error) {
	var result *domain.Routine
	var previous domain.RoutineStatus
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if err := lockEnabledSettings(ctx, tx, subject, input.VehicleID); err != nil {
			return err
		}
		item, err := scanRoutineWithExtras(tx.QueryRow(ctx, `
			WITH prior AS (
			  SELECT id, status FROM smart_commute_routines
			  WHERE subject = $1 AND vehicle_id = $2 AND id = $3
			  FOR UPDATE
			)
			UPDATE smart_commute_routines AS r
			SET status = 'confirmed', name = $4, weekday = $5, departure_s = $6,
			    time_zone = $7, origin_latitude = $8, origin_longitude = $9,
			    destination_latitude = $10, destination_longitude = $11,
			    evidence_matching_days = NULL, evidence_window_start_s = NULL,
			    evidence_window_end_s = NULL, evidence_first_at = NULL, evidence_last_at = NULL,
			    snoozed_until = NULL, updated_at = $12
			FROM prior
			WHERE r.id = prior.id
			  AND (prior.status = 'confirmed' OR (
			    prior.status = 'suggested' AND r.evidence_last_at > $12::timestamptz - INTERVAL '56 days'
			    AND smart_feature_current(r.subject,'commute_learning',r.feature_checked_at)
			    AND EXISTS (
			      SELECT 1 FROM smart_commute_settings s
			      WHERE s.subject = r.subject AND s.vehicle_id = r.vehicle_id
			        AND s.local_analysis_enabled AND NOT s.paused
			    )
			  ))
			RETURNING `+routineColumns+`, prior.status`,
			subject, input.VehicleID, routineID, input.Name, input.Weekday, input.DepartureS,
			input.TimeZone, input.Origin.Latitude, input.Origin.Longitude,
			input.Destination.Latitude, input.Destination.Longitude, now), &previous)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("confirm smart commute routine: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_commute_traffic_consent WHERE routine_id = $1`, routineID); err != nil {
			return fmt.Errorf("revoke traffic consent for edited routine: %w", err)
		}
		result = item
		return nil
	})
	r.recordSuggestionResolution(previous, domain.RoutineConfirmed, err)
	return result, err
}

func (r *Repository) DeclineRoutine(
	ctx context.Context, subject string, vehicleID, routineID int64, now time.Time,
) error {
	var previous domain.RoutineStatus
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if err := lockEnabledSettings(ctx, tx, subject, vehicleID); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `
			WITH prior AS (
			  SELECT id, status FROM smart_commute_routines
			  WHERE subject = $1 AND vehicle_id = $2 AND id = $3
			  FOR UPDATE
			)
			UPDATE smart_commute_routines AS r SET status = 'declined', snoozed_until = NULL, updated_at = $4
			FROM prior
			WHERE r.id = prior.id
			  AND (prior.status = 'declined' OR (
			    prior.status = 'suggested' AND r.evidence_last_at > $4::timestamptz - INTERVAL '56 days'
			    AND EXISTS (
			      SELECT 1 FROM smart_commute_settings s
			      WHERE s.subject = r.subject AND s.vehicle_id = r.vehicle_id
			        AND s.local_analysis_enabled AND NOT s.paused
			    )
			  ))
			RETURNING prior.status`,
			subject, vehicleID, routineID, now).Scan(&previous)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("decline smart commute routine: %w", err)
		}
		return nil
	})
	r.recordSuggestionResolution(previous, domain.RoutineDeclined, err)
	return err
}

func (r *Repository) SnoozeRoutine(
	ctx context.Context, subject string, vehicleID, routineID int64, until *time.Time, now time.Time,
) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if err := lockEnabledSettings(ctx, tx, subject, vehicleID); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			UPDATE smart_commute_routines AS r SET snoozed_until = $5, updated_at = $4
			WHERE subject = $1 AND vehicle_id = $2 AND id = $3
			  AND status = 'suggested' AND evidence_last_at > $4::timestamptz - INTERVAL '56 days'
			  AND EXISTS (
			    SELECT 1 FROM smart_commute_settings s
			    WHERE s.subject = r.subject AND s.vehicle_id = r.vehicle_id
			      AND s.local_analysis_enabled AND NOT s.paused
			  )`, subject, vehicleID, routineID, now, until)
		if err != nil {
			return fmt.Errorf("snooze smart commute suggestion: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return port.ErrNotFound
		}
		return nil
	})
}

func (r *Repository) DeleteRoutine(ctx context.Context, subject string, vehicleID, routineID int64) error {
	tag, err := r.db.Pool.Exec(ctx, `
		DELETE FROM smart_commute_routines WHERE subject = $1 AND vehicle_id = $2 AND id = $3`,
		subject, vehicleID, routineID)
	if err != nil {
		return fmt.Errorf("delete smart commute routine: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return port.ErrNotFound
	}
	return nil
}

func (r *Repository) ListSuggestions(
	ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int,
) ([]domain.SuggestedRoutine, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT `+routineColumns+`, v.display_name
		FROM smart_commute_routines r
		JOIN smart_commute_settings s ON s.subject = r.subject AND s.vehicle_id = r.vehicle_id
		JOIN vehicles v ON v.id = r.vehicle_id AND v.archived_at IS NULL
		WHERE r.subject = $1 AND ($2::bigint IS NULL OR r.vehicle_id = $2)
		  AND s.enabled AND s.local_analysis_enabled AND NOT s.paused
		  AND r.status = 'suggested' AND r.evidence_last_at > $3::timestamptz - INTERVAL '56 days'
		  AND smart_feature_current(r.subject,'commute_learning',r.feature_checked_at)
		  AND (r.snoozed_until IS NULL OR r.snoozed_until <= $3::timestamptz)
		ORDER BY r.evidence_last_at DESC, r.id DESC
		LIMIT $4`, subject, vehicleID, now, limit)
	if err != nil {
		return nil, fmt.Errorf("list private smart commute suggestions: %w", err)
	}
	defer rows.Close()
	result := make([]domain.SuggestedRoutine, 0)
	for rows.Next() {
		var vehicleName string
		item, scanErr := scanRoutineWithExtras(rows, &vehicleName)
		if scanErr != nil {
			return nil, fmt.Errorf("scan private smart commute suggestion: %w", scanErr)
		}
		result = append(result, domain.SuggestedRoutine{Routine: *item, VehicleName: vehicleName})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate private smart commute suggestions: %w", err)
	}
	return result, nil
}

func lockEnabledSettings(ctx context.Context, tx pgx.Tx, subject string, vehicleID int64) error {
	if err := lockActiveVehicle(ctx, tx, vehicleID); err != nil {
		return err
	}
	settings, err := lockSettings(ctx, tx, subject, vehicleID)
	if errors.Is(err, port.ErrNotFound) {
		return port.ErrDisabled
	}
	if err != nil {
		return err
	}
	if !settings.Enabled {
		return port.ErrDisabled
	}
	return nil
}
