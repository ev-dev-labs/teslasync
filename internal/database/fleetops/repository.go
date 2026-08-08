package fleetops

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	models "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrNotFound          = errors.New("fleet operations record not found")
	ErrConflict          = errors.New("fleet operations conflict")
	ErrVersionConflict   = errors.New("fleet operations version conflict")
	ErrDriverUnavailable = errors.New("driver is not assigned for the reservation period")
)

type DriverFilter struct {
	Status string
	Search string
	Limit  int
	Offset int
}

type CostCenterFilter struct {
	Active *bool
	Search string
	Limit  int
	Offset int
}

type AssignmentFilter struct {
	VehicleID *int64
	DriverID  *int64
	At        *time.Time
	Limit     int
	Offset    int
}

type ReservationFilter struct {
	VehicleID    *int64
	DriverID     *int64
	CostCenterID *int64
	Status       string
	From         *time.Time
	To           *time.Time
	Limit        int
	Offset       int
}

type ChargingPolicyFilter struct {
	VehicleID *int64
	Enabled   *bool
	ActiveAt  *time.Time
	Limit     int
	Offset    int
}

type WorkOrderFilter struct {
	VehicleID    *int64
	CostCenterID *int64
	Status       string
	Severity     string
	Limit        int
	Offset       int
}

type ForecastFilter struct {
	VehicleID   *int64
	From        time.Time
	To          time.Time
	HistoryFrom time.Time
}

type ForecastInputs struct {
	Vehicles     []models.FleetForecastVehicle
	Assignments  []models.FleetVehicleDriverAssignment
	Reservations []models.FleetReservation
	WorkOrders   []models.FleetMaintenanceWorkOrder
	Drives       []models.FleetForecastDrive
}

type Repository struct {
	db *database.DB
}

func NewRepository(db *database.DB) *Repository {
	if db == nil || db.Pool == nil {
		panic("fleetops.NewRepository: db and db.Pool must not be nil")
	}
	return &Repository{db: db}
}

func normalizePage(limit, offset int) (int, int) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func classifyPGError(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23P01", "23505", "23503":
			return fmt.Errorf("%w: %v", ErrConflict, err)
		}
	}
	return err
}

func classifyMutationMiss(ctx context.Context, q database.DBTX, existsSQL string, id int64) error {
	var exists bool
	if err := q.QueryRow(ctx, existsSQL, id).Scan(&exists); err != nil {
		return fmt.Errorf("classify optimistic update: %w", err)
	}
	if exists {
		return ErrVersionConflict
	}
	return ErrNotFound
}

func advisoryLocks(ctx context.Context, tx pgx.Tx, keys ...string) error {
	sort.Strings(keys)
	for _, key := range keys {
		if key == "" {
			continue
		}
		if _, err := tx.Exec(ctx,
			`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, key,
		); err != nil {
			return fmt.Errorf("acquire fleet operation lock: %w", err)
		}
	}
	return nil
}

func vehicleLockKey(id int64) string { return fmt.Sprintf("fleetops:vehicle:%d", id) }
func driverLockKey(id int64) string  { return fmt.Sprintf("fleetops:driver:%d", id) }

const driverColumns = `id, display_name, reference_code, status, version, created_at, updated_at`

func scanDriver(row pgx.Row) (*models.FleetDriver, error) {
	item := &models.FleetDriver{}
	err := row.Scan(
		&item.ID, &item.DisplayName, &item.ReferenceCode, &item.Status,
		&item.Version, &item.CreatedAt, &item.UpdatedAt,
	)
	return item, err
}

func (r *Repository) ListDrivers(ctx context.Context, f DriverFilter) ([]models.FleetDriver, int, error) {
	f.Limit, f.Offset = normalizePage(f.Limit, f.Offset)
	search := strings.TrimSpace(f.Search)
	const countSQL = `
		SELECT count(*)
		FROM fleet_drivers
		WHERE ($1 = '' OR status = $1)
		  AND ($2 = '' OR display_name ILIKE '%' || $2 || '%' OR reference_code ILIKE '%' || $2 || '%')`
	var total int
	if err := r.db.Pool.QueryRow(ctx, countSQL, f.Status, search).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count fleet drivers: %w", err)
	}
	const listSQL = `
		SELECT ` + driverColumns + `
		FROM fleet_drivers
		WHERE ($1 = '' OR status = $1)
		  AND ($2 = '' OR display_name ILIKE '%' || $2 || '%' OR reference_code ILIKE '%' || $2 || '%')
		ORDER BY display_name, id
		LIMIT $3 OFFSET $4`
	rows, err := r.db.Pool.Query(ctx, listSQL, f.Status, search, f.Limit, f.Offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list fleet drivers: %w", err)
	}
	defer rows.Close()
	items := make([]models.FleetDriver, 0)
	for rows.Next() {
		item, scanErr := scanDriver(rows)
		if scanErr != nil {
			return nil, 0, fmt.Errorf("scan fleet driver: %w", scanErr)
		}
		items = append(items, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate fleet drivers: %w", err)
	}
	return items, total, nil
}

func (r *Repository) GetDriver(ctx context.Context, id int64) (*models.FleetDriver, error) {
	item, err := scanDriver(r.db.Pool.QueryRow(ctx,
		`SELECT `+driverColumns+` FROM fleet_drivers WHERE id = $1`, id,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get fleet driver: %w", err)
	}
	return item, nil
}

func (r *Repository) CreateDriver(ctx context.Context, item *models.FleetDriver) error {
	got, err := scanDriver(r.db.Pool.QueryRow(ctx, `
		INSERT INTO fleet_drivers (display_name, reference_code, status)
		VALUES ($1, $2, $3)
		RETURNING `+driverColumns,
		item.DisplayName, item.ReferenceCode, item.Status,
	))
	if err != nil {
		return fmt.Errorf("create fleet driver: %w", classifyPGError(err))
	}
	*item = *got
	return nil
}

func (r *Repository) UpdateDriver(ctx context.Context, item *models.FleetDriver) error {
	got, err := scanDriver(r.db.Pool.QueryRow(ctx, `
		UPDATE fleet_drivers
		SET display_name = $2, reference_code = $3, status = $4, version = version + 1
		WHERE id = $1 AND version = $5
		RETURNING `+driverColumns,
		item.ID, item.DisplayName, item.ReferenceCode, item.Status, item.Version,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return classifyMutationMiss(ctx, r.db.Pool,
			`SELECT EXISTS(SELECT 1 FROM fleet_drivers WHERE id = $1)`, item.ID)
	}
	if err != nil {
		return fmt.Errorf("update fleet driver: %w", classifyPGError(err))
	}
	*item = *got
	return nil
}

func (r *Repository) DeleteDriver(ctx context.Context, id int64, version int) error {
	return r.deleteVersioned(ctx, "fleet_drivers", id, version)
}

const costCenterColumns = `id, code, name, active, version, created_at, updated_at`

func scanCostCenter(row pgx.Row) (*models.FleetCostCenter, error) {
	item := &models.FleetCostCenter{}
	err := row.Scan(
		&item.ID, &item.Code, &item.Name, &item.Active, &item.Version,
		&item.CreatedAt, &item.UpdatedAt,
	)
	return item, err
}

func (r *Repository) ListCostCenters(ctx context.Context, f CostCenterFilter) ([]models.FleetCostCenter, int, error) {
	f.Limit, f.Offset = normalizePage(f.Limit, f.Offset)
	search := strings.TrimSpace(f.Search)
	const countSQL = `
		SELECT count(*) FROM fleet_cost_centers
		WHERE ($1::boolean IS NULL OR active = $1)
		  AND ($2 = '' OR code ILIKE '%' || $2 || '%' OR name ILIKE '%' || $2 || '%')`
	var total int
	if err := r.db.Pool.QueryRow(ctx, countSQL, f.Active, search).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count fleet cost centers: %w", err)
	}
	const listSQL = `
		SELECT ` + costCenterColumns + ` FROM fleet_cost_centers
		WHERE ($1::boolean IS NULL OR active = $1)
		  AND ($2 = '' OR code ILIKE '%' || $2 || '%' OR name ILIKE '%' || $2 || '%')
		ORDER BY name, id LIMIT $3 OFFSET $4`
	rows, err := r.db.Pool.Query(ctx, listSQL, f.Active, search, f.Limit, f.Offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list fleet cost centers: %w", err)
	}
	defer rows.Close()
	items := make([]models.FleetCostCenter, 0)
	for rows.Next() {
		item, scanErr := scanCostCenter(rows)
		if scanErr != nil {
			return nil, 0, fmt.Errorf("scan fleet cost center: %w", scanErr)
		}
		items = append(items, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate fleet cost centers: %w", err)
	}
	return items, total, nil
}

func (r *Repository) GetCostCenter(ctx context.Context, id int64) (*models.FleetCostCenter, error) {
	item, err := scanCostCenter(r.db.Pool.QueryRow(ctx,
		`SELECT `+costCenterColumns+` FROM fleet_cost_centers WHERE id = $1`, id,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get fleet cost center: %w", err)
	}
	return item, nil
}

func (r *Repository) CreateCostCenter(ctx context.Context, item *models.FleetCostCenter) error {
	got, err := scanCostCenter(r.db.Pool.QueryRow(ctx, `
		INSERT INTO fleet_cost_centers (code, name, active)
		VALUES ($1, $2, $3)
		RETURNING `+costCenterColumns,
		item.Code, item.Name, item.Active,
	))
	if err != nil {
		return fmt.Errorf("create fleet cost center: %w", classifyPGError(err))
	}
	*item = *got
	return nil
}

func (r *Repository) UpdateCostCenter(ctx context.Context, item *models.FleetCostCenter) error {
	got, err := scanCostCenter(r.db.Pool.QueryRow(ctx, `
		UPDATE fleet_cost_centers
		SET code = $2, name = $3, active = $4, version = version + 1
		WHERE id = $1 AND version = $5
		RETURNING `+costCenterColumns,
		item.ID, item.Code, item.Name, item.Active, item.Version,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return classifyMutationMiss(ctx, r.db.Pool,
			`SELECT EXISTS(SELECT 1 FROM fleet_cost_centers WHERE id = $1)`, item.ID)
	}
	if err != nil {
		return fmt.Errorf("update fleet cost center: %w", classifyPGError(err))
	}
	*item = *got
	return nil
}

func (r *Repository) DeleteCostCenter(ctx context.Context, id int64, version int) error {
	return r.deleteVersioned(ctx, "fleet_cost_centers", id, version)
}

func (r *Repository) deleteVersioned(ctx context.Context, table string, id int64, version int) error {
	queries := map[string]struct {
		deleteSQL string
		existsSQL string
	}{
		"fleet_drivers": {
			`DELETE FROM fleet_drivers WHERE id = $1 AND version = $2`,
			`SELECT EXISTS(SELECT 1 FROM fleet_drivers WHERE id = $1)`,
		},
		"fleet_cost_centers": {
			`DELETE FROM fleet_cost_centers WHERE id = $1 AND version = $2`,
			`SELECT EXISTS(SELECT 1 FROM fleet_cost_centers WHERE id = $1)`,
		},
		"fleet_vehicle_driver_assignments": {
			`DELETE FROM fleet_vehicle_driver_assignments WHERE id = $1 AND version = $2`,
			`SELECT EXISTS(SELECT 1 FROM fleet_vehicle_driver_assignments WHERE id = $1)`,
		},
		"fleet_reservations": {
			`DELETE FROM fleet_reservations WHERE id = $1 AND version = $2`,
			`SELECT EXISTS(SELECT 1 FROM fleet_reservations WHERE id = $1)`,
		},
		"fleet_charging_policies": {
			`DELETE FROM fleet_charging_policies WHERE id = $1 AND version = $2`,
			`SELECT EXISTS(SELECT 1 FROM fleet_charging_policies WHERE id = $1)`,
		},
		"fleet_maintenance_work_orders": {
			`DELETE FROM fleet_maintenance_work_orders WHERE id = $1 AND version = $2`,
			`SELECT EXISTS(SELECT 1 FROM fleet_maintenance_work_orders WHERE id = $1)`,
		},
	}
	query, ok := queries[table]
	if !ok {
		return fmt.Errorf("delete versioned: unsupported table")
	}
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, execErr := tx.Exec(ctx, query.deleteSQL, id, version)
		if execErr != nil {
			return classifyPGError(execErr)
		}
		if tag.RowsAffected() == 0 {
			return classifyMutationMiss(ctx, tx, query.existsSQL, id)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete %s: %w", table, err)
	}
	return nil
}
