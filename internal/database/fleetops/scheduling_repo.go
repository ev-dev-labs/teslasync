package fleetops

import (
	"context"
	"errors"
	"fmt"
	"time"

	models "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
	"github.com/jackc/pgx/v5"
)

const assignmentSelect = `
	SELECT a.id, a.vehicle_id, v.display_name AS vehicle_display_name,
	       a.driver_id, d.display_name AS driver_display_name,
	       a.starts_at, a.ends_at, a.notes, a.version, a.created_at, a.updated_at
	FROM fleet_vehicle_driver_assignments a
	JOIN vehicles v ON v.id = a.vehicle_id
	JOIN fleet_drivers d ON d.id = a.driver_id`

func scanAssignment(row pgx.Row) (*models.FleetVehicleDriverAssignment, error) {
	item := &models.FleetVehicleDriverAssignment{}
	err := row.Scan(
		&item.ID, &item.VehicleID, &item.VehicleDisplayName,
		&item.DriverID, &item.DriverDisplayName, &item.StartsAt, &item.EndsAt,
		&item.Notes, &item.Version, &item.CreatedAt, &item.UpdatedAt,
	)
	return item, err
}

func getAssignment(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, id int64) (*models.FleetVehicleDriverAssignment, error) {
	item, err := scanAssignment(q.QueryRow(ctx, assignmentSelect+` WHERE a.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get fleet assignment: %w", err)
	}
	return item, nil
}

func (r *Repository) ListAssignments(ctx context.Context, f AssignmentFilter) ([]models.FleetVehicleDriverAssignment, int, error) {
	f.Limit, f.Offset = normalizePage(f.Limit, f.Offset)
	const countSQL = `
		SELECT count(*)
		FROM fleet_vehicle_driver_assignments a
		WHERE ($1::bigint IS NULL OR a.vehicle_id = $1)
		  AND ($2::bigint IS NULL OR a.driver_id = $2)
		  AND ($3::timestamptz IS NULL OR
		       (a.starts_at <= $3 AND (a.ends_at IS NULL OR a.ends_at > $3)))`
	var total int
	if err := r.db.Pool.QueryRow(ctx, countSQL, f.VehicleID, f.DriverID, f.At).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count fleet assignments: %w", err)
	}
	const listSuffix = `
		WHERE ($1::bigint IS NULL OR a.vehicle_id = $1)
		  AND ($2::bigint IS NULL OR a.driver_id = $2)
		  AND ($3::timestamptz IS NULL OR
		       (a.starts_at <= $3 AND (a.ends_at IS NULL OR a.ends_at > $3)))
		ORDER BY a.starts_at DESC, a.id DESC
		LIMIT $4 OFFSET $5`
	rows, err := r.db.Pool.Query(ctx, assignmentSelect+listSuffix,
		f.VehicleID, f.DriverID, f.At, f.Limit, f.Offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list fleet assignments: %w", err)
	}
	defer rows.Close()
	items := make([]models.FleetVehicleDriverAssignment, 0)
	for rows.Next() {
		item, scanErr := scanAssignment(rows)
		if scanErr != nil {
			return nil, 0, fmt.Errorf("scan fleet assignment: %w", scanErr)
		}
		items = append(items, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate fleet assignments: %w", err)
	}
	return items, total, nil
}

func (r *Repository) GetAssignment(ctx context.Context, id int64) (*models.FleetVehicleDriverAssignment, error) {
	return getAssignment(ctx, r.db.Pool, id)
}

func (r *Repository) CreateAssignment(ctx context.Context, item *models.FleetVehicleDriverAssignment) error {
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if err := advisoryLocks(ctx, tx,
			vehicleLockKey(item.VehicleID), driverLockKey(item.DriverID)); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `
			INSERT INTO fleet_vehicle_driver_assignments
			    (vehicle_id, driver_id, starts_at, ends_at, notes)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id`,
			item.VehicleID, item.DriverID, item.StartsAt, item.EndsAt, item.Notes,
		).Scan(&item.ID)
		if err != nil {
			return classifyPGError(err)
		}
		got, err := getAssignment(ctx, tx, item.ID)
		if err != nil {
			return err
		}
		*item = *got
		return nil
	})
	if err != nil {
		return fmt.Errorf("create fleet assignment: %w", err)
	}
	return nil
}

func (r *Repository) UpdateAssignment(ctx context.Context, item *models.FleetVehicleDriverAssignment) error {
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var oldVehicleID, oldDriverID int64
		var oldStartsAt time.Time
		var oldEndsAt *time.Time
		if err := tx.QueryRow(ctx, `
			SELECT vehicle_id, driver_id, starts_at, ends_at
			FROM fleet_vehicle_driver_assignments
			WHERE id = $1 FOR UPDATE`, item.ID,
		).Scan(&oldVehicleID, &oldDriverID, &oldStartsAt, &oldEndsAt); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return fmt.Errorf("lock fleet assignment: %w", err)
		}
		if err := advisoryLocks(ctx, tx,
			vehicleLockKey(oldVehicleID), driverLockKey(oldDriverID),
			vehicleLockKey(item.VehicleID), driverLockKey(item.DriverID)); err != nil {
			return err
		}
		var invalidatesReservation bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1
				FROM fleet_reservations r
				WHERE r.vehicle_id = $1 AND r.driver_id = $2
				  AND r.status IN ('requested', 'confirmed')
				  AND r.starts_at >= $7
				  AND ($8::timestamptz IS NULL OR r.ends_at <= $8)
				  AND NOT (
				      $3 = $1 AND $4 = $2
				      AND $5 <= r.starts_at
				      AND ($6::timestamptz IS NULL OR $6 >= r.ends_at)
				  )
			)`,
			oldVehicleID, oldDriverID, item.VehicleID, item.DriverID,
			item.StartsAt, item.EndsAt, oldStartsAt, oldEndsAt,
		).Scan(&invalidatesReservation); err != nil {
			return fmt.Errorf("check assignment reservations: %w", err)
		}
		if invalidatesReservation {
			return ErrConflict
		}
		tag, err := tx.Exec(ctx, `
			UPDATE fleet_vehicle_driver_assignments
			SET vehicle_id = $2, driver_id = $3, starts_at = $4, ends_at = $5,
			    notes = $6, version = version + 1
			WHERE id = $1 AND version = $7`,
			item.ID, item.VehicleID, item.DriverID, item.StartsAt, item.EndsAt,
			item.Notes, item.Version,
		)
		if err != nil {
			return classifyPGError(err)
		}
		if tag.RowsAffected() == 0 {
			return ErrVersionConflict
		}
		got, err := getAssignment(ctx, tx, item.ID)
		if err != nil {
			return err
		}
		*item = *got
		return nil
	})
	if err != nil {
		return fmt.Errorf("update fleet assignment: %w", err)
	}
	return nil
}

func (r *Repository) DeleteAssignment(ctx context.Context, id int64, version int) error {
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var vehicleID, driverID int64
		var currentVersion int
		var startsAt time.Time
		var endsAt *time.Time
		if err := tx.QueryRow(ctx, `
			SELECT vehicle_id, driver_id, version, starts_at, ends_at
			FROM fleet_vehicle_driver_assignments
			WHERE id = $1 FOR UPDATE`, id,
		).Scan(&vehicleID, &driverID, &currentVersion, &startsAt, &endsAt); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return fmt.Errorf("lock fleet assignment for delete: %w", err)
		}
		if currentVersion != version {
			return ErrVersionConflict
		}
		if err := advisoryLocks(ctx, tx,
			vehicleLockKey(vehicleID), driverLockKey(driverID)); err != nil {
			return err
		}
		var hasReservations bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM fleet_reservations
				WHERE vehicle_id = $1 AND driver_id = $2
				  AND status IN ('requested', 'confirmed')
				  AND starts_at >= $3
				  AND ($4::timestamptz IS NULL OR ends_at <= $4)
			)`, vehicleID, driverID, startsAt, endsAt,
		).Scan(&hasReservations); err != nil {
			return fmt.Errorf("check assignment delete reservations: %w", err)
		}
		if hasReservations {
			return ErrConflict
		}
		if _, err := tx.Exec(ctx,
			`DELETE FROM fleet_vehicle_driver_assignments WHERE id = $1`, id,
		); err != nil {
			return classifyPGError(err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete fleet assignment: %w", err)
	}
	return nil
}

const reservationSelect = `
	SELECT r.id, r.vehicle_id, v.display_name AS vehicle_display_name,
	       r.driver_id, d.display_name AS driver_display_name,
	       r.cost_center_id, c.name AS cost_center_name,
	       r.title, r.purpose, r.starts_at, r.ends_at, r.status,
	       r.version, r.created_at, r.updated_at
	FROM fleet_reservations r
	JOIN vehicles v ON v.id = r.vehicle_id
	LEFT JOIN fleet_drivers d ON d.id = r.driver_id
	LEFT JOIN fleet_cost_centers c ON c.id = r.cost_center_id`

func scanReservation(row pgx.Row) (*models.FleetReservation, error) {
	item := &models.FleetReservation{}
	err := row.Scan(
		&item.ID, &item.VehicleID, &item.VehicleDisplayName,
		&item.DriverID, &item.DriverDisplayName, &item.CostCenterID,
		&item.CostCenterName, &item.Title, &item.Purpose, &item.StartsAt,
		&item.EndsAt, &item.Status, &item.Version, &item.CreatedAt, &item.UpdatedAt,
	)
	return item, err
}

func getReservation(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, id int64) (*models.FleetReservation, error) {
	item, err := scanReservation(q.QueryRow(ctx, reservationSelect+` WHERE r.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get fleet reservation: %w", err)
	}
	return item, nil
}

func (r *Repository) ListReservations(ctx context.Context, f ReservationFilter) ([]models.FleetReservation, int, error) {
	f.Limit, f.Offset = normalizePage(f.Limit, f.Offset)
	const where = `
		WHERE ($1::bigint IS NULL OR r.vehicle_id = $1)
		  AND ($2::bigint IS NULL OR r.driver_id = $2)
		  AND ($3::bigint IS NULL OR r.cost_center_id = $3)
		  AND ($4 = '' OR r.status = $4)
		  AND ($5::timestamptz IS NULL OR r.ends_at > $5)
		  AND ($6::timestamptz IS NULL OR r.starts_at < $6)`
	var total int
	if err := r.db.Pool.QueryRow(ctx,
		`SELECT count(*) FROM fleet_reservations r`+where,
		f.VehicleID, f.DriverID, f.CostCenterID, f.Status, f.From, f.To,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count fleet reservations: %w", err)
	}
	rows, err := r.db.Pool.Query(ctx, reservationSelect+where+`
		ORDER BY r.starts_at, r.id LIMIT $7 OFFSET $8`,
		f.VehicleID, f.DriverID, f.CostCenterID, f.Status, f.From, f.To,
		f.Limit, f.Offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list fleet reservations: %w", err)
	}
	defer rows.Close()
	items := make([]models.FleetReservation, 0)
	for rows.Next() {
		item, scanErr := scanReservation(rows)
		if scanErr != nil {
			return nil, 0, fmt.Errorf("scan fleet reservation: %w", scanErr)
		}
		items = append(items, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate fleet reservations: %w", err)
	}
	return items, total, nil
}

func (r *Repository) GetReservation(ctx context.Context, id int64) (*models.FleetReservation, error) {
	return getReservation(ctx, r.db.Pool, id)
}

func ensureDriverAssigned(ctx context.Context, tx pgx.Tx, item *models.FleetReservation) error {
	if item.DriverID == nil || (item.Status != "requested" && item.Status != "confirmed") {
		return nil
	}
	var available bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM fleet_vehicle_driver_assignments a
			JOIN fleet_drivers d ON d.id = a.driver_id
			WHERE a.vehicle_id = $1 AND a.driver_id = $2 AND d.status = 'active'
			  AND a.starts_at <= $3
			  AND (a.ends_at IS NULL OR a.ends_at >= $4)
		)`,
		item.VehicleID, *item.DriverID, item.StartsAt, item.EndsAt,
	).Scan(&available); err != nil {
		return fmt.Errorf("check reservation assignment availability: %w", err)
	}
	if !available {
		return ErrDriverUnavailable
	}
	return nil
}

func reservationLockKeys(item *models.FleetReservation) []string {
	keys := []string{vehicleLockKey(item.VehicleID)}
	if item.DriverID != nil {
		keys = append(keys, driverLockKey(*item.DriverID))
	}
	return keys
}

func (r *Repository) CreateReservation(ctx context.Context, item *models.FleetReservation) error {
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if err := advisoryLocks(ctx, tx, reservationLockKeys(item)...); err != nil {
			return err
		}
		if err := ensureDriverAssigned(ctx, tx, item); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO fleet_reservations
			    (vehicle_id, driver_id, cost_center_id, title, purpose, starts_at, ends_at, status)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING id`,
			item.VehicleID, item.DriverID, item.CostCenterID, item.Title,
			item.Purpose, item.StartsAt, item.EndsAt, item.Status,
		).Scan(&item.ID); err != nil {
			return classifyPGError(err)
		}
		got, err := getReservation(ctx, tx, item.ID)
		if err != nil {
			return err
		}
		*item = *got
		return nil
	})
	if err != nil {
		return fmt.Errorf("create fleet reservation: %w", err)
	}
	return nil
}

func (r *Repository) UpdateReservation(ctx context.Context, item *models.FleetReservation) error {
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		old, err := getReservationForUpdate(ctx, tx, item.ID)
		if err != nil {
			return err
		}
		keys := append(reservationLockKeys(old), reservationLockKeys(item)...)
		if err := advisoryLocks(ctx, tx, keys...); err != nil {
			return err
		}
		if err := ensureDriverAssigned(ctx, tx, item); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			UPDATE fleet_reservations
			SET vehicle_id = $2, driver_id = $3, cost_center_id = $4,
			    title = $5, purpose = $6, starts_at = $7, ends_at = $8,
			    status = $9, version = version + 1
			WHERE id = $1 AND version = $10`,
			item.ID, item.VehicleID, item.DriverID, item.CostCenterID,
			item.Title, item.Purpose, item.StartsAt, item.EndsAt,
			item.Status, item.Version,
		)
		if err != nil {
			return classifyPGError(err)
		}
		if tag.RowsAffected() == 0 {
			return ErrVersionConflict
		}
		got, err := getReservation(ctx, tx, item.ID)
		if err != nil {
			return err
		}
		*item = *got
		return nil
	})
	if err != nil {
		return fmt.Errorf("update fleet reservation: %w", err)
	}
	return nil
}

func getReservationForUpdate(ctx context.Context, tx pgx.Tx, id int64) (*models.FleetReservation, error) {
	item := &models.FleetReservation{}
	err := tx.QueryRow(ctx, `
		SELECT id, vehicle_id, driver_id, starts_at, ends_at
		FROM fleet_reservations WHERE id = $1 FOR UPDATE`, id,
	).Scan(&item.ID, &item.VehicleID, &item.DriverID, &item.StartsAt, &item.EndsAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lock fleet reservation: %w", err)
	}
	return item, nil
}

func (r *Repository) DeleteReservation(ctx context.Context, id int64, version int) error {
	return r.deleteVersioned(ctx, "fleet_reservations", id, version)
}
