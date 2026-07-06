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

// PinnedRepo is the data-access layer for the `pinned_items` table introduced
// by migration 000162.
//
// Today the install is single-user, so the repo accepts a `*int64` user
// scope (NULL meaning "every pin") rather than enforcing a non-zero user
// id. When multi-tenancy lands the handler will start passing a real
// user id and the same queries keep working.
type PinnedRepo struct {
	pool adminPool
}

func NewPinnedRepo(db *database.DB) *PinnedRepo {
	return &PinnedRepo{pool: db.Pool}
}

// PinnedListFilter narrows a List call to a (user, type) bucket and an
// optional context string. Empty context means "any context"; pass a
// non-nil pointer to a string (including the empty string) to filter on
// an exact context value.
type PinnedListFilter struct {
	UserID   *int64
	ItemType dashboardmodel.PinnedItemType
	// Context filters the results when non-nil. *Context == "" matches rows
	// whose context column IS NULL (the canonical "no context" state).
	Context *string
}

// List returns the pinned rows matching the filter, ordered by position
// ascending then id ascending so the order is stable across reloads.
func (r *PinnedRepo) List(ctx context.Context, f PinnedListFilter) ([]*dashboardmodel.PinnedItem, error) {
	const query = `
		SELECT id, user_id, item_type, item_id, position, pinned_at, context
		FROM pinned_items
		WHERE COALESCE(user_id, 0) = COALESCE($1, 0)
		  AND item_type = $2
		  AND ($3::boolean IS FALSE
		       OR COALESCE(context, '') = COALESCE($4, ''))
		ORDER BY position ASC, id ASC`

	hasContext := f.Context != nil
	contextValue := ""
	if hasContext {
		contextValue = *f.Context
	}

	rows, err := r.pool.Query(ctx, query, f.UserID, string(f.ItemType), hasContext, contextValue)
	if err != nil {
		return nil, fmt.Errorf("pinned_items list query: %w", err)
	}
	defer rows.Close()

	var out []*dashboardmodel.PinnedItem
	for rows.Next() {
		p := &dashboardmodel.PinnedItem{}
		if scanErr := rows.Scan(
			&p.ID, &p.UserID, &p.ItemType, &p.ItemID, &p.Position, &p.PinnedAt, &p.Context,
		); scanErr != nil {
			return nil, fmt.Errorf("pinned_items list scan: %w", scanErr)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("pinned_items list iter: %w", err)
	}
	return out, nil
}

// GetByID fetches a single row. Returns (nil, nil) when no row matches so
// callers can return a clean 404 without unwrapping pgx-specific errors.
func (r *PinnedRepo) GetByID(ctx context.Context, id int64) (*dashboardmodel.PinnedItem, error) {
	const query = `
		SELECT id, user_id, item_type, item_id, position, pinned_at, context
		FROM pinned_items
		WHERE id = $1`

	p := &dashboardmodel.PinnedItem{}
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&p.ID, &p.UserID, &p.ItemType, &p.ItemID, &p.Position, &p.PinnedAt, &p.Context,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("pinned_items get_by_id: %w", err)
	}
	return p, nil
}

// ErrPinnedAlreadyExists is returned by Create when the (user, type, id,
// context) tuple is already pinned. The handler maps this to HTTP 409 so
// the frontend can refetch and reconcile rather than retry.
var ErrPinnedAlreadyExists = errors.New("pinned item already exists")

// Create inserts a new pin at position 0 and shifts every other pin in
// the same (user, type, context) bucket down by one. Wrapped in a
// transaction so a partial failure can never leave the bucket with two
// rows at the same position.
func (r *PinnedRepo) Create(ctx context.Context, p *dashboardmodel.PinnedItem) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("pinned_items create begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		UPDATE pinned_items
		SET position = position + 1
		WHERE COALESCE(user_id, 0) = COALESCE($1, 0)
		  AND item_type = $2
		  AND COALESCE(context, '') = COALESCE($3, '')`,
		p.UserID, string(p.ItemType), p.Context,
	); err != nil {
		return fmt.Errorf("pinned_items create shift: %w", err)
	}

	const insert = `
		INSERT INTO pinned_items (user_id, item_type, item_id, position, context)
		VALUES ($1, $2, $3, 0, $4)
		RETURNING id, position, pinned_at`
	if err := tx.QueryRow(ctx, insert,
		p.UserID, string(p.ItemType), p.ItemID, p.Context,
	).Scan(&p.ID, &p.Position, &p.PinnedAt); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrPinnedAlreadyExists
		}
		return fmt.Errorf("pinned_items create insert: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("pinned_items create commit: %w", err)
	}
	return nil
}

// UpdatePosition sets the absolute display position for a single pin.
// No reshuffling — the caller (frontend drag handler) owns the order and
// is expected to issue one PATCH per moved item with the new index.
// Returns pgx.ErrNoRows when the id is unknown.
func (r *PinnedRepo) UpdatePosition(ctx context.Context, id int64, position int) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE pinned_items SET position = $2 WHERE id = $1`,
		id, position,
	)
	if err != nil {
		return fmt.Errorf("pinned_items update_position: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// Delete removes a pin by id. Returns pgx.ErrNoRows when the row was
// already gone so the handler can return 404 cleanly.
func (r *PinnedRepo) Delete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM pinned_items WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("pinned_items delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
