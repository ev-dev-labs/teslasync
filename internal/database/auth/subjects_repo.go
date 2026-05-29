// Package auth persists subjects observed behind the configured
// FORWARD_AUTH_HEADER. Downstream tables that need a stable per-user
// foreign-key target (TOTP credentials, RBAC bindings, vehicle settings
// overrides, future user preferences, …) should reference
// auth_subjects(subject) ON DELETE CASCADE rather than invent their own
// users(id) column; TeslaSync has no users table because the upstream
// proxy is the sole identity authority.
//
// Open-mode policy
// ----------------
// In open mode (no FORWARD_AUTH_HEADER configured) no rows are
// recorded — the recorder middleware is a passthrough. The repo
// itself is still safe to construct so the wiring path is uniform.
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

// AuthSubjectRow is the in-memory projection of a row in auth_subjects.
//
// DisplayName + Notes are operator-editable optional fields, surfaced
// as nullable in Go (nil == NULL) so the JSON layer can omitempty them
// without lying about a present-but-empty string.
type AuthSubjectRow struct {
	Subject     string
	FirstSeenAt time.Time
	LastSeenAt  time.Time
	DisplayName *string
	Notes       *string
}

// ErrAuthSubjectNotFound is returned by Get when no row matches the
// supplied subject. Callers map this to 404 or to "first time we've
// seen this subject" depending on the operation.
var ErrAuthSubjectNotFound = errors.New("auth_subject: not found")

// AuthSubjectsRepo is the data-access layer for auth_subjects.
//
// The repo owns no in-memory state of its own — the recorder
// middleware does its own debounce so we never spam the DB with
// per-request UPSERTs.
type AuthSubjectsRepo struct {
	db *database.DB
}

// NewAuthSubjectsRepo wires the repo to a database pool.
//
// db may be nil for tests that exercise only the helpers exported
// from this file; methods that touch the pool then return a guard
// error rather than dereference nil.
func NewAuthSubjectsRepo(db *database.DB) *AuthSubjectsRepo {
	return &AuthSubjectsRepo{db: db}
}

// Upsert records a sighting of subject, inserting a fresh row on first
// observation or bumping last_seen_at to the supplied instant on
// subsequent ones. Returning the resolved row lets callers piggyback
// on the same round-trip when they need the operator-edited
// display_name (none of the current callers do, but it keeps the API
// flexible without an extra Get round-trip).
//
// subject is normalised by trimming surrounding whitespace; the empty
// string is rejected with a guard error so a misconfigured proxy
// stripping the header value can never plant a phantom "" subject in
// the table.
func (r *AuthSubjectsRepo) Upsert(ctx context.Context, subject string, now time.Time) (*AuthSubjectRow, error) {
	subject = strings.TrimSpace(subject)
	if subject == "" {
		return nil, errors.New("auth_subjects upsert: empty subject")
	}
	if r == nil || r.db == nil || r.db.Pool == nil {
		return nil, errors.New("auth_subjects repo not configured")
	}
	const query = `
		INSERT INTO auth_subjects (subject, first_seen_at, last_seen_at)
		VALUES ($1, $2, $2)
		ON CONFLICT (subject) DO UPDATE
		SET last_seen_at = EXCLUDED.last_seen_at
		RETURNING subject, first_seen_at, last_seen_at, display_name, notes`
	row := r.db.Pool.QueryRow(ctx, query, subject, now)
	out := &AuthSubjectRow{}
	if err := row.Scan(
		&out.Subject,
		&out.FirstSeenAt,
		&out.LastSeenAt,
		&out.DisplayName,
		&out.Notes,
	); err != nil {
		return nil, fmt.Errorf("auth_subjects upsert: %w", err)
	}
	return out, nil
}

// Get returns the stored row for subject, or ErrAuthSubjectNotFound
// when no row exists. Used by the future admin "users" panel and by
// any handler that needs the operator-curated display_name without
// falling back to the raw header value.
func (r *AuthSubjectsRepo) Get(ctx context.Context, subject string) (*AuthSubjectRow, error) {
	subject = strings.TrimSpace(subject)
	if subject == "" {
		return nil, ErrAuthSubjectNotFound
	}
	if r == nil || r.db == nil || r.db.Pool == nil {
		return nil, errors.New("auth_subjects repo not configured")
	}
	const query = `
		SELECT subject, first_seen_at, last_seen_at, display_name, notes
		FROM auth_subjects
		WHERE subject = $1`
	row := r.db.Pool.QueryRow(ctx, query, subject)
	out := &AuthSubjectRow{}
	if err := row.Scan(
		&out.Subject,
		&out.FirstSeenAt,
		&out.LastSeenAt,
		&out.DisplayName,
		&out.Notes,
	); err != nil {
		if isNoRowsError(err) {
			return nil, ErrAuthSubjectNotFound
		}
		return nil, fmt.Errorf("auth_subjects get: %w", err)
	}
	return out, nil
}

// List returns every recorded subject ordered by last_seen_at DESC.
// Used by the future admin panel; cardinality is bounded by the
// number of distinct human operators, so we deliberately don't
// paginate at this layer.
func (r *AuthSubjectsRepo) List(ctx context.Context) ([]AuthSubjectRow, error) {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return nil, errors.New("auth_subjects repo not configured")
	}
	const query = `
		SELECT subject, first_seen_at, last_seen_at, display_name, notes
		FROM auth_subjects
		ORDER BY last_seen_at DESC, subject ASC`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("auth_subjects list: %w", err)
	}
	defer rows.Close()
	out := make([]AuthSubjectRow, 0, 8)
	for rows.Next() {
		var row AuthSubjectRow
		if err := rows.Scan(
			&row.Subject,
			&row.FirstSeenAt,
			&row.LastSeenAt,
			&row.DisplayName,
			&row.Notes,
		); err != nil {
			return nil, fmt.Errorf("auth_subjects scan: %w", err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("auth_subjects iterate: %w", err)
	}
	return out, nil
}

func isNoRowsError(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
