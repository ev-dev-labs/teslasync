package sharing

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// tokenPool is the minimal pgx surface TokenRepo needs. Declared locally so
// tests can supply a fake without a live PostgreSQL or a pgxmock dependency
// (the codebase vendors neither) — mirrors guardPool / vehicleStatesPool.
// *pgxpool.Pool satisfies it, so NewTokenRepo can bind the real pool.
type tokenPool interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// ErrShareTokenNotFound is returned by Delete when no row matched the token —
// either the token never existed or was already revoked. Exposing a sentinel
// lets the handler map "already gone" to 404 with errors.Is instead of a
// string compare, and keeps it distinguishable from a real database fault.
var ErrShareTokenNotFound = errors.New("share token not found")

// TokenRepo provides share token data access.
type TokenRepo struct {
	pool tokenPool
}

// NewTokenRepo binds the repo to a database pool. A nil db or pool at
// construction is a wiring bug, not a runtime condition — fail fast, matching
// the NewGuardRepo / NewVehicleStatesRepo precedent.
func NewTokenRepo(db *database.DB) *TokenRepo {
	if db == nil || db.Pool == nil {
		panic("sharing.NewTokenRepo: db and db.Pool must not be nil")
	}
	return &TokenRepo{pool: db.Pool}
}

// insertTokenSQL and its peers are package-level constants so the SQL-shape
// tests can assert column names, filters, and RETURNING clauses without a live
// database — a mistyped column would otherwise only surface at runtime.
const insertTokenSQL = `
		INSERT INTO share_tokens (token, drive_id, created_by, title, description,
			include_map, include_telemetry, include_speed, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, created_at`

const selectTokenColumns = `id, token, drive_id, created_by, title, description,
			include_map, include_telemetry, include_speed, views, expires_at, created_at`

const getByTokenSQL = `
		SELECT ` + selectTokenColumns + `
		FROM share_tokens WHERE token = $1`

const listByDriveSQL = `
		SELECT ` + selectTokenColumns + `
		FROM share_tokens WHERE drive_id = $1
		ORDER BY created_at DESC`

const incrementViewsSQL = `UPDATE share_tokens SET views = views + 1 WHERE id = $1`

const deleteTokenSQL = `DELETE FROM share_tokens WHERE token = $1`

const deleteExpiredSQL = `DELETE FROM share_tokens WHERE expires_at IS NOT NULL AND expires_at < $1`

// generateToken produces a cryptographically random 16-byte hex token (32 chars).
func generateToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// Create inserts a new share token for a drive, generating a unique token and
// populating st.Token/st.ID/st.CreatedAt in place.
func (r *TokenRepo) Create(ctx context.Context, st *drivemodel.ShareToken) error {
	if st == nil {
		return fmt.Errorf("create share token: nil token")
	}
	if st.DriveID <= 0 {
		return fmt.Errorf("create share token: invalid drive id %d", st.DriveID)
	}

	token, err := generateToken()
	if err != nil {
		return err
	}
	st.Token = token

	if err := r.pool.QueryRow(ctx, insertTokenSQL,
		st.Token, st.DriveID, st.CreatedBy, st.Title, st.Description,
		st.IncludeMap, st.IncludeTelemetry, st.IncludeSpeed, st.ExpiresAt,
	).Scan(&st.ID, &st.CreatedAt); err != nil {
		return fmt.Errorf("create share token: %w", err)
	}
	return nil
}

// GetByToken retrieves a share token by its public token string. Returns
// (nil, nil) when no token matches so the caller can distinguish "not found"
// (404) from a real error (500).
func (r *TokenRepo) GetByToken(ctx context.Context, token string) (*drivemodel.ShareToken, error) {
	if token == "" {
		return nil, nil
	}

	st := &drivemodel.ShareToken{}
	err := r.pool.QueryRow(ctx, getByTokenSQL, token).Scan(
		&st.ID, &st.Token, &st.DriveID, &st.CreatedBy, &st.Title, &st.Description,
		&st.IncludeMap, &st.IncludeTelemetry, &st.IncludeSpeed, &st.Views,
		&st.ExpiresAt, &st.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get share token: %w", err)
	}
	return st, nil
}

// ListByDrive returns all share tokens for a given drive, newest first.
func (r *TokenRepo) ListByDrive(ctx context.Context, driveID int64) ([]*drivemodel.ShareToken, error) {
	rows, err := r.pool.Query(ctx, listByDriveSQL, driveID)
	if err != nil {
		return nil, fmt.Errorf("list share tokens: %w", err)
	}
	defer rows.Close()

	var tokens []*drivemodel.ShareToken
	for rows.Next() {
		st := &drivemodel.ShareToken{}
		if err := rows.Scan(
			&st.ID, &st.Token, &st.DriveID, &st.CreatedBy, &st.Title, &st.Description,
			&st.IncludeMap, &st.IncludeTelemetry, &st.IncludeSpeed, &st.Views,
			&st.ExpiresAt, &st.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan share token: %w", err)
		}
		tokens = append(tokens, st)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list share tokens: rows iteration: %w", err)
	}
	return tokens, nil
}

// IncrementViews atomically increments the view counter for a share token.
func (r *TokenRepo) IncrementViews(ctx context.Context, id int64) error {
	if id <= 0 {
		return fmt.Errorf("increment share token views: invalid id %d", id)
	}
	if _, err := r.pool.Exec(ctx, incrementViewsSQL, id); err != nil {
		return fmt.Errorf("increment share token views: %w", err)
	}
	return nil
}

// Delete removes a share token by its token string. Returns
// [ErrShareTokenNotFound] when no row matched (unknown or already-revoked
// token) so callers can map that to 404 without treating it as a fault.
func (r *TokenRepo) Delete(ctx context.Context, token string) error {
	if token == "" {
		return fmt.Errorf("delete share token: empty token")
	}
	tag, err := r.pool.Exec(ctx, deleteTokenSQL, token)
	if err != nil {
		return fmt.Errorf("delete share token: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrShareTokenNotFound
	}
	return nil
}

// DeleteExpired removes all share tokens past their expiry, returning the
// number of rows deleted.
func (r *TokenRepo) DeleteExpired(ctx context.Context) (int64, error) {
	tag, err := r.pool.Exec(ctx, deleteExpiredSQL, time.Now().UTC())
	if err != nil {
		return 0, fmt.Errorf("delete expired share tokens: %w", err)
	}
	return tag.RowsAffected(), nil
}
