package admin

import (
	"context"
	"errors"
	"fmt"

	dashboardmodel "github.com/ev-dev-labs/teslasync/internal/models/dashboard"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgconn"
)

// SavedViewsRepo is the data-access layer for the `saved_views` table introduced
// by migration 000164.
//
// The repo follows the same single-user / future-multi-tenant pattern as
// PinnedRepo: a `*int64` user scope (NULL meaning the install-wide
// bucket) rather than enforcing a non-zero user id.
type SavedViewsRepo struct {
	pool adminPool
}

func NewSavedViewsRepo(db *database.DB) *SavedViewsRepo {
	return &SavedViewsRepo{pool: db.Pool}
}

// SavedViewListFilter narrows a List call to a (user, route) bucket.
type SavedViewListFilter struct {
	UserID *int64
	Route  string
}

// ErrSavedViewAlreadyExists is returned by Create / Update when the
// (user, route, name) tuple is already taken. The handler maps this to
// HTTP 409 so the frontend can prompt for a new name without retrying.
var ErrSavedViewAlreadyExists = errors.New("saved view name already exists")

// List returns the views matching the filter, ordered with pinned rows
// first then by sort_order ascending then by id ascending so the order
// is stable across reloads.
func (r *SavedViewsRepo) List(ctx context.Context, f SavedViewListFilter) ([]*dashboardmodel.SavedView, error) {
	const query = `
		SELECT id, user_id, name, route, query, is_default, is_pinned, sort_order, created_at, updated_at
		FROM saved_views
		WHERE COALESCE(user_id, 0) = COALESCE($1, 0)
		  AND route = $2
		ORDER BY is_pinned DESC, sort_order ASC, id ASC`

	rows, err := r.pool.Query(ctx, query, f.UserID, f.Route)
	if err != nil {
		return nil, fmt.Errorf("saved_views list query: %w", err)
	}
	defer rows.Close()

	var out []*dashboardmodel.SavedView
	for rows.Next() {
		v := &dashboardmodel.SavedView{}
		if scanErr := rows.Scan(
			&v.ID, &v.UserID, &v.Name, &v.Route, &v.Query,
			&v.IsDefault, &v.IsPinned, &v.SortOrder,
			&v.CreatedAt, &v.UpdatedAt,
		); scanErr != nil {
			return nil, fmt.Errorf("saved_views list scan: %w", scanErr)
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("saved_views list iter: %w", err)
	}
	return out, nil
}

// GetByID fetches a single view. Returns (nil, nil) when no row matches
// so callers can return a clean 404 without unwrapping pgx-specific
// errors.
func (r *SavedViewsRepo) GetByID(ctx context.Context, id int64) (*dashboardmodel.SavedView, error) {
	const query = `
		SELECT id, user_id, name, route, query, is_default, is_pinned, sort_order, created_at, updated_at
		FROM saved_views
		WHERE id = $1`

	v := &dashboardmodel.SavedView{}
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&v.ID, &v.UserID, &v.Name, &v.Route, &v.Query,
		&v.IsDefault, &v.IsPinned, &v.SortOrder,
		&v.CreatedAt, &v.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("saved_views get_by_id: %w", err)
	}
	return v, nil
}

// Create inserts a new saved view. When the request marks the view as
// default, the prior default for the same (user, route) is flipped to
// false in the same transaction so the partial unique index is never
// violated.
func (r *SavedViewsRepo) Create(ctx context.Context, v *dashboardmodel.SavedView) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("saved_views create begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if v.IsDefault {
		if err := clearDefaultTx(ctx, tx, v.UserID, v.Route); err != nil {
			return err
		}
	}

	const insert = `
		INSERT INTO saved_views (user_id, name, route, query, is_default, is_pinned, sort_order)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at, updated_at`
	if err := tx.QueryRow(ctx, insert,
		v.UserID, v.Name, v.Route, v.Query, v.IsDefault, v.IsPinned, v.SortOrder,
	).Scan(&v.ID, &v.CreatedAt, &v.UpdatedAt); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrSavedViewAlreadyExists
		}
		return fmt.Errorf("saved_views create insert: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("saved_views create commit: %w", err)
	}
	return nil
}

// SavedViewUpdate is the patch shape for Update. Nil fields are left
// untouched. Marking IsDefault=true clears the prior default for the
// same (user, route) atomically.
type SavedViewUpdate struct {
	Name      *string
	Query     *string
	IsDefault *bool
	IsPinned  *bool
	SortOrder *int
}

// Update applies a partial patch to a saved view. Returns pgx.ErrNoRows
// when the id is unknown so the handler can return 404 cleanly.
func (r *SavedViewsRepo) Update(ctx context.Context, id int64, patch SavedViewUpdate) (*dashboardmodel.SavedView, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("saved_views update begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Load current row inside the txn so the (user_id, route) tuple we use
	// when clearing the prior default is consistent with the row we're
	// updating — even if a concurrent writer renamed it.
	var (
		userID *int64
		route  string
	)
	err = tx.QueryRow(ctx, `SELECT user_id, route FROM saved_views WHERE id = $1`, id).
		Scan(&userID, &route)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, pgx.ErrNoRows
	}
	if err != nil {
		return nil, fmt.Errorf("saved_views update load: %w", err)
	}

	if patch.IsDefault != nil && *patch.IsDefault {
		if err := clearDefaultTx(ctx, tx, userID, route); err != nil {
			return nil, err
		}
	}

	const update = `
		UPDATE saved_views SET
		    name       = COALESCE($2, name),
		    query      = COALESCE($3, query),
		    is_default = COALESCE($4, is_default),
		    is_pinned  = COALESCE($5, is_pinned),
		    sort_order = COALESCE($6, sort_order),
		    updated_at = now()
		WHERE id = $1
		RETURNING id, user_id, name, route, query, is_default, is_pinned, sort_order, created_at, updated_at`

	v := &dashboardmodel.SavedView{}
	if err := tx.QueryRow(ctx, update,
		id, patch.Name, patch.Query, patch.IsDefault, patch.IsPinned, patch.SortOrder,
	).Scan(
		&v.ID, &v.UserID, &v.Name, &v.Route, &v.Query,
		&v.IsDefault, &v.IsPinned, &v.SortOrder,
		&v.CreatedAt, &v.UpdatedAt,
	); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrSavedViewAlreadyExists
		}
		return nil, fmt.Errorf("saved_views update exec: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("saved_views update commit: %w", err)
	}
	return v, nil
}

// Delete removes a saved view by id. Returns pgx.ErrNoRows when the row
// was already gone so the handler can return 404 cleanly.
func (r *SavedViewsRepo) Delete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM saved_views WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("saved_views delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// clearDefaultTx flips is_default to false for every row in the same
// (user, route) bucket. Called inside Create / Update when the new row
// claims the default slot, so the partial unique index can never trip.
func clearDefaultTx(ctx context.Context, tx pgx.Tx, userID *int64, route string) error {
	_, err := tx.Exec(ctx, `
		UPDATE saved_views
		SET is_default = FALSE, updated_at = now()
		WHERE COALESCE(user_id, 0) = COALESCE($1, 0)
		  AND route = $2
		  AND is_default = TRUE`,
		userID, route,
	)
	if err != nil {
		return fmt.Errorf("saved_views clear default: %w", err)
	}
	return nil
}
