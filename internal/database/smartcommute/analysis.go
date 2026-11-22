package smartcommute

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
	"github.com/jackc/pgx/v5"
)

func analyzeLocked(
	ctx context.Context, tx pgx.Tx, subject string, settings domain.Settings, now time.Time, learner port.Learner,
) error {
	if learner == nil {
		return fmt.Errorf("smart commute learner is not configured")
	}
	loc, err := time.LoadLocation(settings.TimeZone)
	if err != nil {
		return fmt.Errorf("load smart commute time zone: %w", err)
	}
	localNow := now.In(loc)
	end := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, loc)
	start := end.AddDate(0, 0, -56)
	rows, err := tx.Query(ctx, `
		SELECT started_at, start_lat, start_lng, end_lat, end_lng
		FROM drives
		WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3
		  AND ended_at IS NOT NULL AND ended_at >= started_at AND ended_at <= $4
		  AND start_lat IS NOT NULL AND start_lng IS NOT NULL
		  AND end_lat IS NOT NULL AND end_lng IS NOT NULL
		ORDER BY started_at DESC, id DESC
		LIMIT $5`, settings.VehicleID, start, end, now, maxObservations+1)
	if err != nil {
		return fmt.Errorf("read bounded completed drives: %w", err)
	}
	observations := make([]domain.DriveObservation, 0)
	for rows.Next() {
		var item domain.DriveObservation
		if err := rows.Scan(&item.StartedAt, &item.Origin.Latitude, &item.Origin.Longitude,
			&item.Destination.Latitude, &item.Destination.Longitude); err != nil {
			rows.Close()
			return fmt.Errorf("scan completed drive: %w", err)
		}
		observations = append(observations, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return fmt.Errorf("iterate completed drives: %w", err)
	}
	if len(observations) > maxObservations {
		return port.ErrTooManyDrives
	}

	existingRows, err := tx.Query(ctx, `
		SELECT `+routineColumns+` FROM smart_commute_routines r
		WHERE r.subject = $1 AND r.vehicle_id = $2 ORDER BY r.id LIMIT $3`,
		subject, settings.VehicleID, maxRoutines+1)
	if err != nil {
		return fmt.Errorf("read existing routine decisions: %w", err)
	}
	existing := make([]domain.Routine, 0)
	for existingRows.Next() {
		item, scanErr := scanRoutine(existingRows)
		if scanErr != nil {
			existingRows.Close()
			return fmt.Errorf("scan existing routine decision: %w", scanErr)
		}
		existing = append(existing, *item)
	}
	err = existingRows.Err()
	existingRows.Close()
	if err != nil {
		return fmt.Errorf("iterate existing routine decisions: %w", err)
	}
	if len(existing) > maxRoutines {
		return fmt.Errorf("too many saved routine decisions")
	}

	changes := learner(observations, existing, now, loc)
	if len(existing)+len(changes.New) > maxRoutines {
		return fmt.Errorf("too many saved routine decisions")
	}
	for _, learned := range changes.New {
		evidence := learned.Evidence
		_, err := tx.Exec(ctx, `
			INSERT INTO smart_commute_routines (
			  subject, vehicle_id, status, weekday, departure_s, time_zone,
			  origin_latitude, origin_longitude, destination_latitude, destination_longitude,
			  evidence_matching_days, evidence_window_start_s, evidence_window_end_s,
			  evidence_first_at, evidence_last_at, created_at, updated_at, feature_checked_at)
			VALUES ($1, $2, 'suggested', $3, $4, $5, $6, $7, $8, $9,
			        $10, $11, $12, $13, $14, $15, $15, statement_timestamp())`,
			subject, settings.VehicleID, learned.Weekday, learned.DepartureS, settings.TimeZone,
			learned.Origin.Latitude, learned.Origin.Longitude,
			learned.Destination.Latitude, learned.Destination.Longitude,
			evidence.MatchingDays, evidence.WindowStartS, evidence.WindowEndS,
			evidence.FirstObservedAt, evidence.LastObservedAt, now)
		if err != nil {
			return fmt.Errorf("persist smart commute suggestion: %w", err)
		}
	}
	for _, refreshed := range changes.Refreshed {
		learned := refreshed.Learned
		evidence := learned.Evidence
		_, err := tx.Exec(ctx, `
			UPDATE smart_commute_routines
			SET weekday = $4, departure_s = $5, origin_latitude = $6, origin_longitude = $7,
			    destination_latitude = $8, destination_longitude = $9,
			    evidence_matching_days = $10, evidence_window_start_s = $11, evidence_window_end_s = $12,
			    evidence_first_at = $13, evidence_last_at = $14, updated_at = $15, feature_checked_at = statement_timestamp()
			WHERE subject = $1 AND vehicle_id = $2 AND id = $3 AND status = 'suggested'`,
			subject, settings.VehicleID, refreshed.ID, learned.Weekday, learned.DepartureS,
			learned.Origin.Latitude, learned.Origin.Longitude,
			learned.Destination.Latitude, learned.Destination.Longitude,
			evidence.MatchingDays, evidence.WindowStartS, evidence.WindowEndS,
			evidence.FirstObservedAt, evidence.LastObservedAt, now)
		if err != nil {
			return fmt.Errorf("refresh smart commute suggestion: %w", err)
		}
	}
	return nil
}
