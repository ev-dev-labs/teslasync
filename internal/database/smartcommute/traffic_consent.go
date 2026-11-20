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

func (r *Repository) FindTrafficDrive(
	ctx context.Context, subject string, vehicleID, routineID, driveID int64, now time.Time,
) (*port.TrafficDrive, error) {
	var drive port.TrafficDrive
	routine, err := scanRoutineWithExtras(r.db.Pool.QueryRow(ctx, `
		SELECT `+routineColumns+`, s.enabled, s.paused, s.local_analysis_enabled, s.time_zone, d.started_at, d.ended_at
		FROM smart_commute_routines r
		JOIN smart_commute_settings s ON s.subject = r.subject AND s.vehicle_id = r.vehicle_id
		JOIN vehicles v ON v.id = r.vehicle_id AND v.archived_at IS NULL
		JOIN drives d ON d.vehicle_id = v.id AND d.id = $4
		WHERE r.subject = $1 AND r.vehicle_id = $2 AND r.id = $3
		  AND r.status = 'confirmed' AND s.enabled AND NOT s.paused AND s.local_analysis_enabled
		  AND d.ended_at <= $5 AND d.started_at >= $5::timestamptz - INTERVAL '56 days'`,
		subject, vehicleID, routineID, driveID, now),
		&drive.Settings.Enabled, &drive.Settings.Paused, &drive.Settings.LocalAnalysisEnabled,
		&drive.Settings.TimeZone, &drive.StartedAt, &drive.EndedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find eligible representative drive: %w", err)
	}
	drive.Routine = *routine
	drive.Settings.VehicleID = vehicleID
	return &drive, nil
}

func (r *Repository) SaveTrafficConsent(
	ctx context.Context, subject string, routine domain.Routine, consent domain.TrafficConsent, now time.Time,
) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if err := lockActiveVehicle(ctx, tx, routine.VehicleID); err != nil {
			return err
		}
		settings, err := lockSettings(ctx, tx, subject, routine.VehicleID)
		if err != nil {
			return err
		}
		if !settings.Enabled || settings.Paused || !settings.LocalAnalysisEnabled {
			return port.ErrDisabled
		}
		var updatedAt time.Time
		err = tx.QueryRow(ctx, `
			SELECT updated_at FROM smart_commute_routines
			WHERE id = $1 AND subject = $2 AND vehicle_id = $3 AND status = 'confirmed'
			FOR UPDATE`, routine.ID, subject, routine.VehicleID).Scan(&updatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock representative routine: %w", err)
		}
		if !updatedAt.Equal(routine.UpdatedAt) {
			return port.ErrTrafficPreviewChanged
		}
		latitudes := make([]float64, len(consent.Trace))
		longitudes := make([]float64, len(consent.Trace))
		for i, point := range consent.Trace {
			latitudes[i], longitudes[i] = point.Latitude, point.Longitude
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_commute_traffic_consent WHERE routine_id = $1`, routine.ID); err != nil {
			return fmt.Errorf("invalidate earlier traffic consent: %w", err)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO smart_commute_traffic_consent
			  (routine_id, latitudes, longitudes, lead_s, min_savings_s, check_at, departure_at, consented_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			routine.ID, latitudes, longitudes, consent.LeadS, consent.MinSavingsS, consent.CheckAt, consent.DepartureAt, now)
		if err != nil {
			return fmt.Errorf("save reviewed traffic consent: %w", err)
		}
		return nil
	})
}

func (r *Repository) DeleteTrafficConsent(ctx context.Context, subject string, vehicleID, routineID int64) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if _, err := lockSettings(ctx, tx, subject, vehicleID); err != nil {
			return err
		}
		var exists bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM smart_commute_routines WHERE id = $1 AND subject = $2 AND vehicle_id = $3)`,
			routineID, subject, vehicleID).Scan(&exists); err != nil {
			return fmt.Errorf("check traffic consent owner: %w", err)
		}
		if !exists {
			return port.ErrNotFound
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_commute_traffic_consent WHERE routine_id = $1`, routineID); err != nil {
			return fmt.Errorf("revoke traffic consent: %w", err)
		}
		return nil
	})
}
