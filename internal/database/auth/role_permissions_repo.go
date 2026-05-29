// Package auth persists the (role_id, permission_id, allowed) bindings backing the
// RBAC matrix admin page. Storage is sparse: a missing row means
// "no opinion" and the application code resolves to an implicit deny.
//
// The repo intentionally has a NARROW surface — there are exactly
// three operations the matrix endpoint needs:
//
//   - GetMatrix(ctx, roles)          — load every binding for the supplied roles
//   - UpsertCells(ctx, cells)        — write a batch of (role,perm,allowed) updates
//   - DeleteRole(ctx, role)          — drop every binding for a role (used when a role disappears)
//
// We never list "all rows" — the matrix endpoint always knows which
// roles it cares about (the ones it just resolved from the request),
// so a SELECT on the entire table would be both larger than necessary
// and a foot-gun (a stale row from an old deploy could leak into the
// response).
package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ErrRolePermissionUnknownPermission is returned by UpsertCells when
// any cell carries a permission_id that is not in the supplied
// known-permissions set. The transaction is aborted before any write,
// so a partial update never lands.
var ErrRolePermissionUnknownPermission = errors.New("role_permissions: unknown permission_id")

// ErrRolePermissionEmptyRoleID is returned when UpsertCells receives a
// cell with an empty role_id. We refuse to write the empty string
// because it would silently shadow every read for the implicit
// default role.
var ErrRolePermissionEmptyRoleID = errors.New("role_permissions: role_id required")

// RolePermissionRow is the in-memory projection of one binding row.
// The repo's GetMatrix returns these grouped by role.
type RolePermissionRow struct {
	RoleID       string
	PermissionID string
	Allowed      bool
	UpdatedAt    time.Time
}

// RolePermissionCell is the input shape for UpsertCells. It
// intentionally mirrors the JSON body the SPA sends (role_id +
// permission_id + allowed) so the handler can pass-through after
// validation without re-mapping fields.
type RolePermissionCell struct {
	RoleID       string
	PermissionID string
	Allowed      bool
}

// RolePermissionsRepo wraps the database.DB pool with the narrow
// query surface above.
//
// IMPORTANT — no dependency on internal/auth. Filtering against the
// in-process permission catalog happens at the handler layer; pulling
// the auth package in here would form an import cycle (auth →
// database → auth).
type RolePermissionsRepo struct {
	db *database.DB
}

// NewRolePermissionsRepo returns a repo bound to db. Pass nil for in-
// memory tests that exercise only the validators — the repo's queries
// dereference db.Pool lazily inside each method.
func NewRolePermissionsRepo(db *database.DB) *RolePermissionsRepo {
	return &RolePermissionsRepo{db: db}
}

// GetMatrix loads every binding for the supplied role ids. Rows whose
// permission_id is no longer in the application catalog are NOT
// filtered here — that is the handler's responsibility (so this repo
// stays free of the internal/auth dependency).
//
// roles MUST be non-empty; an empty slice returns an empty map without
// touching the database (the matrix endpoint always passes at least
// the implicit default role).
func (r *RolePermissionsRepo) GetMatrix(ctx context.Context, roles []string) (map[string]map[string]bool, error) {
	out := make(map[string]map[string]bool)
	if len(roles) == 0 {
		return out, nil
	}
	if r == nil || r.db == nil || r.db.Pool == nil {
		return nil, errors.New("role_permissions: repo not connected to a database")
	}

	const q = `
		SELECT role_id, permission_id, allowed
		FROM role_permissions
		WHERE role_id = ANY($1)`
	rows, err := r.db.Pool.Query(ctx, q, roles)
	if err != nil {
		return nil, fmt.Errorf("role_permissions: get matrix: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var rp RolePermissionRow
		if err := rows.Scan(&rp.RoleID, &rp.PermissionID, &rp.Allowed); err != nil {
			return nil, fmt.Errorf("role_permissions: scan row: %w", err)
		}
		bucket, ok := out[rp.RoleID]
		if !ok {
			bucket = make(map[string]bool)
			out[rp.RoleID] = bucket
		}
		bucket[rp.PermissionID] = rp.Allowed
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("role_permissions: iterate rows: %w", err)
	}
	return out, nil
}

// ValidateCells checks every cell against the supplied set of known
// permission IDs. The handler runs this BEFORE opening a transaction
// so a 400 INVALID_PERMISSION can be surfaced without a wasted DB
// round-trip.
//
// known is typically auth.AllPermissionIDs() — passed as a parameter
// (rather than imported here) to break the auth↔database cycle.
//
// Exposed as a function (not method) so tests + handler share the
// validator without needing to construct a repo with a nil pool.
func ValidateCells(cells []RolePermissionCell, known map[string]struct{}) error {
	for i, c := range cells {
		if strings.TrimSpace(c.RoleID) == "" {
			return fmt.Errorf("cell[%d]: %w", i, ErrRolePermissionEmptyRoleID)
		}
		if _, ok := known[c.PermissionID]; !ok {
			return fmt.Errorf("cell[%d] %q: %w", i, c.PermissionID, ErrRolePermissionUnknownPermission)
		}
	}
	return nil
}

// UpsertCells writes a batch of bindings inside a single transaction.
// Either every cell lands or none does; a duplicate (role, perm)
// inside the same batch wins by last-write (Postgres UPSERT semantics
// applied row-by-row in batch order).
//
// The repo does NOT validate against the application catalog — the
// handler is expected to call ValidateCells with the catalog's
// known-IDs set before calling this method. We still trim role IDs
// and refuse empty-string role_id rows as a last-line defence so a
// caller bypassing ValidateCells can't poison the table with
// shadow rows.
func (r *RolePermissionsRepo) UpsertCells(ctx context.Context, cells []RolePermissionCell) error {
	if len(cells) == 0 {
		return nil
	}
	for i, c := range cells {
		if strings.TrimSpace(c.RoleID) == "" {
			return fmt.Errorf("cell[%d]: %w", i, ErrRolePermissionEmptyRoleID)
		}
	}
	if r == nil || r.db == nil || r.db.Pool == nil {
		return errors.New("role_permissions: repo not connected to a database")
	}

	tx, err := r.db.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("role_permissions: begin tx: %w", err)
	}
	defer func() {
		// Rollback is a no-op if the tx has been committed; safe to
		// always call inside the deferred cleanup.
		_ = tx.Rollback(ctx)
	}()

	const q = `
		INSERT INTO role_permissions (role_id, permission_id, allowed, updated_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (role_id, permission_id)
		DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now()`

	for _, c := range cells {
		if _, err := tx.Exec(ctx, q, strings.TrimSpace(c.RoleID), c.PermissionID, c.Allowed); err != nil {
			return fmt.Errorf("role_permissions: upsert (%s,%s): %w", c.RoleID, c.PermissionID, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("role_permissions: commit: %w", err)
	}
	return nil
}

// DeleteRole removes every binding for roleID. Idempotent — returns
// nil even when no rows matched. The handler does not currently
// expose this through the API surface but the repo carries it because
// a future "remove role" UI will need it and adding it now keeps the
// repo's lifecycle complete.
func (r *RolePermissionsRepo) DeleteRole(ctx context.Context, roleID string) error {
	if strings.TrimSpace(roleID) == "" {
		return ErrRolePermissionEmptyRoleID
	}
	if r == nil || r.db == nil || r.db.Pool == nil {
		return errors.New("role_permissions: repo not connected to a database")
	}
	const q = `DELETE FROM role_permissions WHERE role_id = $1`
	if _, err := r.db.Pool.Exec(ctx, q, roleID); err != nil {
		return fmt.Errorf("role_permissions: delete role %q: %w", roleID, err)
	}
	return nil
}

// ListAllRoleIDs returns every distinct role_id with at least one
// binding row, in stable sorted order. The handler unions this with
// the request's claimed roles so the matrix UI can surface roles that
// nobody in the current session claims (typical use case: an admin
// editing a kid account's column).
func (r *RolePermissionsRepo) ListAllRoleIDs(ctx context.Context) ([]string, error) {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return nil, errors.New("role_permissions: repo not connected to a database")
	}
	const q = `SELECT DISTINCT role_id FROM role_permissions ORDER BY role_id`
	rows, err := r.db.Pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("role_permissions: list role ids: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("role_permissions: scan role id: %w", err)
		}
		out = append(out, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("role_permissions: iterate role ids: %w", err)
	}
	return out, nil
}
