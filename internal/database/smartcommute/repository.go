// Package smartcommute persists private routine decisions and local analysis.
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

const (
	maxObservations = 2000
	maxRoutines     = 1000
	routineColumns  = `r.id, r.vehicle_id, r.status, r.name, r.weekday, r.departure_s,
		r.time_zone, r.origin_latitude, r.origin_longitude, r.destination_latitude,
		r.destination_longitude, r.evidence_matching_days, r.evidence_window_start_s,
		r.evidence_window_end_s, r.evidence_first_at, r.evidence_last_at, r.snoozed_until, r.created_at, r.updated_at`
)

type Repository struct {
	db *database.DB
}

func NewRepository(db *database.DB) *Repository {
	if db == nil || db.Pool == nil {
		panic("smartcommute.NewRepository: db and db.Pool must not be nil")
	}
	return &Repository{db: db}
}

func (r *Repository) Read(ctx context.Context, subject string, vehicleID int64, now time.Time) (*domain.Snapshot, error) {
	var active bool
	if err := r.db.Pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM vehicles WHERE id = $1 AND archived_at IS NULL)`,
		vehicleID,
	).Scan(&active); err != nil {
		return nil, fmt.Errorf("check smart commute vehicle: %w", err)
	}
	if !active {
		return nil, port.ErrNotFound
	}
	result := &domain.Snapshot{
		Settings: domain.Settings{VehicleID: vehicleID},
		Routines: []domain.Routine{},
	}
	err := r.db.Pool.QueryRow(ctx, `
		SELECT enabled, local_analysis_enabled, paused, time_zone
		FROM smart_commute_settings
		WHERE subject = $1 AND vehicle_id = $2`, subject, vehicleID,
	).Scan(&result.Settings.Enabled, &result.Settings.LocalAnalysisEnabled,
		&result.Settings.Paused, &result.Settings.TimeZone)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read smart commute settings: %w", err)
	}
	rows, err := r.db.Pool.Query(ctx, `
		SELECT `+routineColumns+`, c.lead_s, c.min_savings_s,
		       coalesce(s.enabled AND NOT s.paused AND planned.departure_at > $3
		         AND (planned.departure_at AT TIME ZONE r.time_zone)::date =
		             ($3::timestamptz AT TIME ZONE r.time_zone)::date
		         AND NOT coalesce(o.skipped AND o.departure_at = planned.departure_at, false), false)
		FROM smart_commute_routines r
		JOIN smart_commute_settings s ON s.subject = r.subject AND s.vehicle_id = r.vehicle_id
		JOIN vehicles v ON v.id = r.vehicle_id AND v.archived_at IS NULL
		LEFT JOIN smart_commute_traffic_consent c ON c.routine_id = r.id
		LEFT JOIN smart_commute_traffic_occurrences o ON o.routine_id = r.id AND c.id IS NOT NULL
		CROSS JOIN LATERAL (
		  SELECT CASE WHEN o.departure_at > $3 AND o.departure_at < c.departure_at
		              THEN o.departure_at ELSE c.departure_at END AS departure_at
		) planned
		WHERE r.subject = $1 AND r.vehicle_id = $2
		  AND (r.status = 'confirmed' OR (
		    r.status = 'suggested' AND s.enabled AND s.local_analysis_enabled AND NOT s.paused
		    AND r.evidence_last_at > $3::timestamptz - INTERVAL '56 days'))
		ORDER BY r.status, r.weekday, r.departure_s, r.id
		LIMIT $4`, subject, vehicleID, now, maxRoutines)
	if err != nil {
		return nil, fmt.Errorf("read smart commute routines: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var leadS *int
		var minSavingsS *int64
		var canSkip bool
		item, scanErr := scanRoutineWithExtras(rows, &leadS, &minSavingsS, &canSkip)
		if scanErr != nil {
			return nil, fmt.Errorf("scan smart commute routine: %w", scanErr)
		}
		if item.SnoozedUntil != nil && !item.SnoozedUntil.After(now) {
			item.SnoozedUntil = nil
		}
		if leadS != nil && minSavingsS != nil {
			item.TrafficConsent = &domain.TrafficConsentSummary{LeadS: *leadS, MinSavingsS: *minSavingsS, CanSkip: canSkip}
		}
		result.Routines = append(result.Routines, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate smart commute routines: %w", err)
	}
	return result, nil
}

func (r *Repository) SaveSettings(
	ctx context.Context, subject string, settings domain.Settings, now time.Time, learner port.Learner,
) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if err := lockActiveVehicle(ctx, tx, settings.VehicleID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO smart_commute_settings (subject, vehicle_id, created_at, updated_at)
			VALUES ($1, $2, $3, $3)
			ON CONFLICT (subject, vehicle_id) DO NOTHING`, subject, settings.VehicleID, now)
		if err != nil {
			return fmt.Errorf("initialize smart commute settings: %w", err)
		}
		previous, err := lockSettings(ctx, tx, subject, settings.VehicleID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			UPDATE smart_commute_settings
			SET enabled = $3, local_analysis_enabled = $4, paused = $5,
			    time_zone = $6, updated_at = $7
			WHERE subject = $1 AND vehicle_id = $2`,
			subject, settings.VehicleID, settings.Enabled, settings.LocalAnalysisEnabled,
			settings.Paused, settings.TimeZone, now)
		if err != nil {
			return fmt.Errorf("save smart commute settings: %w", err)
		}
		if !settings.Enabled || !settings.LocalAnalysisEnabled {
			if _, err := tx.Exec(ctx, `
				DELETE FROM smart_commute_traffic_consent c USING smart_commute_routines r
				WHERE c.routine_id = r.id AND r.subject = $1 AND r.vehicle_id = $2`,
				subject, settings.VehicleID); err != nil {
				return fmt.Errorf("revoke traffic consent for disabled analysis: %w", err)
			}
		}
		if !settings.Enabled || !settings.LocalAnalysisEnabled || previous.TimeZone != settings.TimeZone {
			if _, err := tx.Exec(ctx, `
				DELETE FROM smart_commute_routines
				WHERE subject = $1 AND vehicle_id = $2 AND status = 'suggested'`,
				subject, settings.VehicleID); err != nil {
				return fmt.Errorf("invalidate smart commute suggestions: %w", err)
			}
		}
		if !settings.Enabled || !settings.LocalAnalysisEnabled || settings.Paused {
			return nil
		}
		return analyzeLocked(ctx, tx, subject, settings, now, learner)
	})
}

func (r *Repository) Analyze(
	ctx context.Context, subject string, vehicleID int64, now time.Time, learner port.Learner,
) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if err := lockActiveVehicle(ctx, tx, vehicleID); err != nil {
			return err
		}
		settings, err := lockSettings(ctx, tx, subject, vehicleID)
		if err != nil {
			if errors.Is(err, port.ErrNotFound) {
				return port.ErrDisabled
			}
			return err
		}
		if !settings.Enabled || !settings.LocalAnalysisEnabled || settings.Paused {
			return port.ErrDisabled
		}
		return analyzeLocked(ctx, tx, subject, *settings, now, learner)
	})
}

func (r *Repository) DeleteAll(ctx context.Context, subject string, vehicleID int64) error {
	_, err := r.db.Pool.Exec(ctx, `
		DELETE FROM smart_commute_settings WHERE subject = $1 AND vehicle_id = $2`, subject, vehicleID)
	if err != nil {
		return fmt.Errorf("delete smart commute data: %w", err)
	}
	return nil
}

func lockActiveVehicle(ctx context.Context, tx pgx.Tx, vehicleID int64) error {
	var id int64
	err := tx.QueryRow(ctx, `
		SELECT id FROM vehicles WHERE id = $1 AND archived_at IS NULL FOR SHARE`, vehicleID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return port.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("lock smart commute vehicle: %w", err)
	}
	return nil
}

func lockSettings(ctx context.Context, tx pgx.Tx, subject string, vehicleID int64) (*domain.Settings, error) {
	settings := &domain.Settings{VehicleID: vehicleID}
	err := tx.QueryRow(ctx, `
		SELECT enabled, local_analysis_enabled, paused, time_zone
		FROM smart_commute_settings WHERE subject = $1 AND vehicle_id = $2 FOR UPDATE`,
		subject, vehicleID,
	).Scan(&settings.Enabled, &settings.LocalAnalysisEnabled, &settings.Paused, &settings.TimeZone)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lock smart commute settings: %w", err)
	}
	return settings, nil
}

func scanRoutine(row pgx.Row) (*domain.Routine, error) {
	return scanRoutineWithExtras(row)
}

func scanRoutineWithExtras(row pgx.Row, extras ...any) (*domain.Routine, error) {
	var item domain.Routine
	var count, startS, endS *int
	var firstAt, lastAt *time.Time
	destinations := []any{
		&item.ID, &item.VehicleID, &item.Status, &item.Name, &item.Weekday, &item.DepartureS,
		&item.TimeZone, &item.Origin.Latitude, &item.Origin.Longitude,
		&item.Destination.Latitude, &item.Destination.Longitude,
		&count, &startS, &endS, &firstAt, &lastAt, &item.SnoozedUntil, &item.CreatedAt, &item.UpdatedAt,
	}
	err := row.Scan(append(destinations, extras...)...)
	if err != nil {
		return nil, err
	}
	if count != nil && startS != nil && endS != nil && firstAt != nil && lastAt != nil {
		item.Evidence = &domain.Evidence{
			MatchingDays: *count, WindowStartS: *startS, WindowEndS: *endS,
			FirstObservedAt: firstAt.UTC(), LastObservedAt: lastAt.UTC(),
		}
	}
	if item.SnoozedUntil != nil {
		value := item.SnoozedUntil.UTC()
		item.SnoozedUntil = &value
	}
	item.CreatedAt = item.CreatedAt.UTC()
	item.UpdatedAt = item.UpdatedAt.UTC()
	return &item, nil
}
