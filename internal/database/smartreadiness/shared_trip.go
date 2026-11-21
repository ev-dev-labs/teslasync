package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
)

var _ port.SharedTripRepository = (*Repository)(nil)

func (r *Repository) SaveSharedTrip(
	ctx context.Context, owner string, draft domain.SharedTripDraft, now time.Time,
) (*domain.SharedTrip, error) {
	ids := make([]int64, 0, len(draft.Nominations))
	subjects := make([]string, 0, len(draft.Nominations))
	for _, entry := range draft.Nominations {
		ids, subjects = append(ids, entry.VehicleID), append(subjects, entry.Subject)
	}
	saved := domain.SharedTrip{}
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var row pgx.Row
		if draft.ID == 0 {
			row = tx.QueryRow(ctx, `
				INSERT INTO smart_shared_trip_plans (owner_subject, departure_at)
				SELECT $1, $2::timestamptz WHERE $2::timestamptz > $3::timestamptz
				RETURNING id, revision, departure_at`, owner, draft.DepartureAt, now)
		} else {
			row = tx.QueryRow(ctx, `
				UPDATE smart_shared_trip_plans
				SET departure_at = $4, revision = revision + 1
				WHERE id = $1 AND owner_subject = $2 AND revision = $3
					AND cancelled_at IS NULL AND departure_at > $5 AND $4::timestamptz > $5
				RETURNING id, revision, departure_at`, draft.ID, owner, draft.Revision, draft.DepartureAt, now)
		}
		if err := scanSharedTrip(row, &saved); err != nil {
			return sharedTripRowError("save shared trip", err)
		}
		if err := lockSharedTripVehicles(ctx, tx, ids); err != nil {
			return err
		}
		if draft.ID != 0 {
			if err := deleteSharedTripEntries(ctx, tx, saved.ID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO smart_shared_trip_entries (trip_id, trip_revision, vehicle_id, subject)
			SELECT $1, $2, n.vehicle_id, n.subject
			FROM unnest($3::bigint[], $4::text[]) AS n(vehicle_id, subject)`,
			saved.ID, saved.Revision, ids, subjects); err != nil {
			return fmt.Errorf("save shared trip nominations: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &saved, nil
}

func (r *Repository) CancelSharedTrip(ctx context.Context, owner string, tripID, revision int64, now time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE smart_shared_trip_plans SET cancelled_at = $4, revision = revision + 1
			WHERE id = $1 AND owner_subject = $2 AND revision = $3
				AND cancelled_at IS NULL AND departure_at > $4`, tripID, owner, revision, now)
		if err != nil {
			return fmt.Errorf("cancel shared trip: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return port.ErrNotFound
		}
		return deleteSharedTripEntries(ctx, tx, tripID)
	})
}

func (r *Repository) ListOwnedSharedTrips(
	ctx context.Context, owner string, now time.Time, limit, offset int,
) ([]domain.SharedTrip, error) {
	limit, offset = boundedSharedTripPage(limit, offset)
	rows, err := r.db.Pool.Query(ctx, `
		SELECT id, revision, departure_at
		FROM smart_shared_trip_plans
		WHERE owner_subject = $1 AND cancelled_at IS NULL AND departure_at > $2
		ORDER BY departure_at, id LIMIT $3 OFFSET $4`, owner, now, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list owned shared trips: %w", err)
	}
	defer rows.Close()
	trips := make([]domain.SharedTrip, 0)
	for rows.Next() {
		var trip domain.SharedTrip
		if err := scanSharedTrip(rows, &trip); err != nil {
			return nil, fmt.Errorf("scan owned shared trip: %w", err)
		}
		trips = append(trips, trip)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate owned shared trips: %w", err)
	}
	return trips, nil
}

func (r *Repository) ListSharedTripInvitations(
	ctx context.Context, subject string, now time.Time, limit, offset int,
) ([]domain.SharedTripInvitation, error) {
	limit, offset = boundedSharedTripPage(limit, offset)
	rows, err := r.db.Pool.Query(ctx, `
		SELECT p.id, p.revision, e.vehicle_id, e.entry_version, p.departure_at, e.evidence_expires_at
		FROM smart_shared_trip_entries e
		JOIN smart_shared_trip_plans p ON p.id = e.trip_id AND p.revision = e.trip_revision
		JOIN vehicles v ON v.id = e.vehicle_id AND v.archived_at IS NULL
		WHERE e.subject = $1 AND e.revoked_at IS NULL AND p.cancelled_at IS NULL AND p.departure_at > $2
		ORDER BY p.departure_at, p.id, e.vehicle_id LIMIT $3 OFFSET $4`, subject, now, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list shared trip invitations: %w", err)
	}
	defer rows.Close()
	invitations := make([]domain.SharedTripInvitation, 0)
	for rows.Next() {
		var invite domain.SharedTripInvitation
		if err := rows.Scan(&invite.TripID, &invite.Revision, &invite.VehicleID, &invite.EntryVersion,
			&invite.DepartureAt, &invite.ConsentExpiresAt); err != nil {
			return nil, fmt.Errorf("scan shared trip invitation: %w", err)
		}
		invite.DepartureAt = invite.DepartureAt.UTC()
		if invite.ConsentExpiresAt != nil {
			expiry := invite.ConsentExpiresAt.UTC()
			invite.ConsentExpiresAt = &expiry
		}
		invitations = append(invitations, invite)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate shared trip invitations: %w", err)
	}
	return invitations, nil
}

func (r *Repository) ConfirmSharedTripVehicle(
	ctx context.Context, subject string, key domain.SharedTripEntryKey, confirmation domain.SharedTripConfirmation,
) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		departure, err := lockSharedTripEntry(ctx, tx, subject, key, confirmation.ConfirmedAt)
		if err != nil {
			return err
		}
		if err := lockSharedTripVehicles(ctx, tx, []int64{key.VehicleID}); err != nil {
			return err
		}
		expiresAt := confirmation.ExpiresAt
		if departure.Before(expiresAt) {
			expiresAt = departure
		}
		tag, err := tx.Exec(ctx, `
			UPDATE smart_shared_trip_entries
			SET entry_version = entry_version + 1, confirmed_at = $6, evidence_expires_at = $7,
				trip_use_low_pct = $8, trip_use_high_pct = $9, reserve_pct = $10,
				schedule_clear = $11, maintenance_clear = $12
			WHERE trip_id = $1 AND trip_revision = $2 AND vehicle_id = $3 AND subject = $4
				AND entry_version = $5 AND revoked_at IS NULL`,
			key.TripID, key.Revision, key.VehicleID, subject, key.EntryVersion,
			confirmation.ConfirmedAt, expiresAt, confirmation.TripUseLowPct, confirmation.TripUseHighPct,
			confirmation.ReservePct, confirmation.ScheduleClear, confirmation.MaintenanceClear)
		if err != nil {
			return fmt.Errorf("confirm shared trip vehicle: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return port.ErrNotFound
		}
		return nil
	})
}

func (r *Repository) WithdrawSharedTripVehicle(
	ctx context.Context, subject string, key domain.SharedTripEntryKey, now time.Time,
) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if _, err := lockSharedTripEntry(ctx, tx, subject, key, now); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			UPDATE smart_shared_trip_entries
			SET entry_version = entry_version + 1, revoked_at = $6,
				confirmed_at = NULL, evidence_expires_at = NULL,
				trip_use_low_pct = NULL, trip_use_high_pct = NULL, reserve_pct = NULL,
				schedule_clear = NULL, maintenance_clear = NULL
			WHERE trip_id = $1 AND trip_revision = $2 AND vehicle_id = $3 AND subject = $4
				AND entry_version = $5 AND revoked_at IS NULL`,
			key.TripID, key.Revision, key.VehicleID, subject, key.EntryVersion, now)
		if err != nil {
			return fmt.Errorf("withdraw shared trip vehicle: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return port.ErrNotFound
		}
		return nil
	})
}

func (r *Repository) ReadSharedTripComparison(
	ctx context.Context, subject string, tripID int64, now time.Time,
) (*port.SharedTripComparisonScope, error) {
	rows, err := r.db.Pool.Query(ctx, `
		WITH accepted AS MATERIALIZED (
			SELECT p.id, p.revision, p.departure_at, e.vehicle_id, e.entry_version, e.subject,
				e.confirmed_at, e.evidence_expires_at, e.trip_use_low_pct, e.trip_use_high_pct,
				e.reserve_pct, e.schedule_clear, e.maintenance_clear
			FROM smart_shared_trip_plans p
			JOIN smart_shared_trip_entries e ON e.trip_id = p.id AND e.trip_revision = p.revision
			JOIN vehicles v ON v.id = e.vehicle_id AND v.archived_at IS NULL
			WHERE p.id = $1 AND p.cancelled_at IS NULL AND p.departure_at > $3
				AND e.revoked_at IS NULL AND e.confirmed_at <= $3 AND e.evidence_expires_at > $3
			ORDER BY e.vehicle_id LIMIT $4
		), audience AS (
			SELECT max(evidence_expires_at) AS expires_at FROM accepted WHERE subject = $2
		)
		SELECT a.id, a.revision, a.departure_at, viewer.expires_at, a.vehicle_id, a.entry_version,
			a.confirmed_at, a.evidence_expires_at, a.trip_use_low_pct, a.trip_use_high_pct,
			a.reserve_pct, a.schedule_clear, a.maintenance_clear
		FROM accepted a CROSS JOIN audience viewer WHERE viewer.expires_at IS NOT NULL
		ORDER BY a.vehicle_id`, tripID, subject, now, domain.MaxSharedTripVehicles+1)
	if err != nil {
		return nil, fmt.Errorf("read authorized shared trip evidence: %w", err)
	}
	defer rows.Close()
	scope := &port.SharedTripComparisonScope{}
	for rows.Next() {
		var e domain.SharedTripConfirmedVehicle
		if err := rows.Scan(&scope.Trip.ID, &scope.Trip.Revision, &scope.Trip.DepartureAt,
			&scope.AccessExpiresAt, &e.VehicleID, &e.EntryVersion, &e.ConfirmedAt, &e.ExpiresAt,
			&e.TripUseLowPct, &e.TripUseHighPct, &e.ReservePct, &e.ScheduleClear, &e.MaintenanceClear); err != nil {
			return nil, fmt.Errorf("scan authorized shared trip evidence: %w", err)
		}
		scope.Confirmed = append(scope.Confirmed, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate authorized shared trip evidence: %w", err)
	}
	if len(scope.Confirmed) == 0 || len(scope.Confirmed) > domain.MaxSharedTripVehicles {
		return nil, port.ErrNotFound
	}
	scope.Trip.DepartureAt = scope.Trip.DepartureAt.UTC()
	return scope, nil
}

// All roster changes and consent writes serialize on the same parent row.
// The child version is checked again by the write after acquiring this lock.
func lockSharedTripEntry(
	ctx context.Context, tx pgx.Tx, subject string, key domain.SharedTripEntryKey, now time.Time,
) (time.Time, error) {
	var departure time.Time
	err := tx.QueryRow(ctx, `
		SELECT p.departure_at
		FROM smart_shared_trip_plans p
		JOIN smart_shared_trip_entries e ON e.trip_id = p.id AND e.trip_revision = p.revision
		WHERE p.id = $1 AND p.revision = $2 AND e.vehicle_id = $3 AND e.subject = $4
			AND e.entry_version = $5 AND p.departure_at > $6
			AND p.cancelled_at IS NULL AND e.revoked_at IS NULL
		FOR UPDATE OF p`, key.TripID, key.Revision, key.VehicleID, subject, key.EntryVersion, now).Scan(&departure)
	return departure, sharedTripRowError("lock shared trip confirmation", err)
}

func lockSharedTripVehicles(ctx context.Context, tx pgx.Tx, ids []int64) error {
	rows, err := tx.Query(ctx, `
		SELECT id FROM vehicles WHERE id = ANY($1::bigint[]) AND archived_at IS NULL ORDER BY id FOR SHARE`, ids)
	if err != nil {
		return fmt.Errorf("lock active shared trip vehicles: %w", err)
	}
	defer rows.Close()
	var count int
	for rows.Next() {
		count++
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read active shared trip vehicles: %w", err)
	}
	if count != len(ids) {
		return port.ErrNotFound
	}
	return nil
}

func deleteSharedTripEntries(ctx context.Context, tx pgx.Tx, tripID int64) error {
	if _, err := tx.Exec(ctx, `DELETE FROM smart_shared_trip_entries WHERE trip_id = $1`, tripID); err != nil {
		return fmt.Errorf("clear superseded shared trip nominations: %w", err)
	}
	return nil
}

func scanSharedTrip(row pgx.Row, trip *domain.SharedTrip) error {
	if err := row.Scan(&trip.ID, &trip.Revision, &trip.DepartureAt); err != nil {
		return err
	}
	trip.DepartureAt = trip.DepartureAt.UTC()
	return nil
}

func sharedTripRowError(operation string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return port.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	return nil
}

func boundedSharedTripPage(limit, offset int) (int, int) {
	return min(max(1, limit), port.MaxSharedTripPageSize), min(max(0, offset), port.MaxSharedTripPageOffset)
}
