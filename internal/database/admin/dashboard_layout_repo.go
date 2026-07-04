package admin

import (
	"context"
	"errors"
	"fmt"
	"time"

	dashboardmodel "github.com/ev-dev-labs/teslasync/internal/models/dashboard"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// DashboardLayoutRepo is the data-access layer for the `dashboard_layouts`
// table introduced by migration 000156.
//
// All queries are scoped by the optional (user_id, vehicle_id) tuple so the
// per-vehicle layout switcher can list only the layouts that apply to the
// currently selected vehicle. NULL on either side means "any" — see model
// docs for the global-vs-pinned semantics.
type DashboardLayoutRepo struct {
	pool adminPool
}

func NewDashboardLayoutRepo(db *database.DB) *DashboardLayoutRepo {
	return &DashboardLayoutRepo{pool: db.Pool}
}

// List returns every layout for the user, optionally filtered to a single
// vehicle scope. Passing vehicleID == nil returns ALL layouts for the user
// (both global and per-vehicle); passing a non-nil vehicleID returns layouts
// pinned to that vehicle PLUS the user's globals (vehicle_id IS NULL) so
// the switcher can show "global default" entries even when a vehicle is
// selected.
func (r *DashboardLayoutRepo) List(ctx context.Context, userID *int64, vehicleID *int64) ([]*dashboardmodel.DashboardLayout, error) {
	const query = `
		SELECT id, user_id, vehicle_id, name, is_default, layout, created_at, updated_at
		FROM dashboard_layouts
		WHERE ($1::bigint IS NULL OR user_id IS NULL OR user_id = $1)
		  AND ($2::bigint IS NULL OR vehicle_id IS NULL OR vehicle_id = $2)
		ORDER BY is_default DESC, name ASC, id ASC`

	rows, err := r.pool.Query(ctx, query, userID, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("dashboard_layouts list query: %w", err)
	}
	defer rows.Close()

	var out []*dashboardmodel.DashboardLayout
	for rows.Next() {
		l := &dashboardmodel.DashboardLayout{}
		if err := rows.Scan(
			&l.ID, &l.UserID, &l.VehicleID, &l.Name, &l.IsDefault, &l.Layout,
			&l.CreatedAt, &l.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("dashboard_layouts list scan: %w", err)
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// GetByID fetches a single layout. Returns (nil, nil) if no row matches.
func (r *DashboardLayoutRepo) GetByID(ctx context.Context, id int64) (*dashboardmodel.DashboardLayout, error) {
	const query = `
		SELECT id, user_id, vehicle_id, name, is_default, layout, created_at, updated_at
		FROM dashboard_layouts
		WHERE id = $1`

	l := &dashboardmodel.DashboardLayout{}
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&l.ID, &l.UserID, &l.VehicleID, &l.Name, &l.IsDefault, &l.Layout,
		&l.CreatedAt, &l.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("dashboard_layouts get_by_id: %w", err)
	}
	return l, nil
}

// Create inserts a new layout. The `id`, `created_at`, `updated_at` fields
// on the supplied struct are populated on success.
func (r *DashboardLayoutRepo) Create(ctx context.Context, l *dashboardmodel.DashboardLayout) error {
	const query = `
		INSERT INTO dashboard_layouts (user_id, vehicle_id, name, is_default, layout, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $6)
		RETURNING id, created_at, updated_at`

	now := time.Now().UTC()
	if err := r.pool.QueryRow(ctx, query,
		l.UserID, l.VehicleID, l.Name, l.IsDefault, l.Layout, now,
	).Scan(&l.ID, &l.CreatedAt, &l.UpdatedAt); err != nil {
		return fmt.Errorf("dashboard_layouts create: %w", err)
	}
	return nil
}

// Update mutates an existing row. Only name, layout, and is_default may be
// changed — user_id and vehicle_id are immutable so the (user, vehicle)
// scope of a saved layout doesn't drift.
func (r *DashboardLayoutRepo) Update(ctx context.Context, id int64, name string, layout []byte, isDefault bool) error {
	const query = `
		UPDATE dashboard_layouts
		SET name = $2, layout = $3, is_default = $4, updated_at = $5
		WHERE id = $1`

	now := time.Now().UTC()
	tag, err := r.pool.Exec(ctx, query, id, name, layout, isDefault, now)
	if err != nil {
		return fmt.Errorf("dashboard_layouts update: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// Delete removes a layout by id. Returns pgx.ErrNoRows if the row was
// already gone (so the handler can return 404 cleanly).
func (r *DashboardLayoutRepo) Delete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM dashboard_layouts WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("dashboard_layouts delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// SetDefault marks a single layout as the default for its (user_id,
// vehicle_id) scope, atomically clearing the default flag on every other
// layout in the same scope. Wraps both writes in a transaction so a partial
// failure can never leave two rows flagged as default.
func (r *DashboardLayoutRepo) SetDefault(ctx context.Context, id int64) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("dashboard_layouts set_default begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var userID, vehicleID *int64
	if err := tx.QueryRow(ctx,
		`SELECT user_id, vehicle_id FROM dashboard_layouts WHERE id = $1`, id,
	).Scan(&userID, &vehicleID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return pgx.ErrNoRows
		}
		return fmt.Errorf("dashboard_layouts set_default lookup: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE dashboard_layouts
		SET is_default = false, updated_at = now()
		WHERE id <> $1
		  AND user_id IS NOT DISTINCT FROM $2
		  AND vehicle_id IS NOT DISTINCT FROM $3
		  AND is_default = true`,
		id, userID, vehicleID,
	); err != nil {
		return fmt.Errorf("dashboard_layouts set_default clear: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE dashboard_layouts SET is_default = true, updated_at = now() WHERE id = $1`, id,
	); err != nil {
		return fmt.Errorf("dashboard_layouts set_default set: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("dashboard_layouts set_default commit: %w", err)
	}
	return nil
}
