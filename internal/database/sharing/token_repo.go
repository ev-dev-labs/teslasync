package sharing

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// TokenRepo provides share token data access.
type TokenRepo struct {
	db *database.DB
}

func NewTokenRepo(db *database.DB) *TokenRepo {
	return &TokenRepo{db: db}
}

// generateToken produces a cryptographically random 16-byte hex token (32 chars).
func generateToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// Create inserts a new share token for a drive, generating a unique token.
func (r *TokenRepo) Create(ctx context.Context, st *drivemodel.ShareToken) error {
	token, err := generateToken()
	if err != nil {
		return err
	}
	st.Token = token

	query := `
		INSERT INTO share_tokens (token, drive_id, created_by, title, description,
			include_map, include_telemetry, include_speed, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, created_at`
	return r.db.Pool.QueryRow(ctx, query,
		st.Token, st.DriveID, st.CreatedBy, st.Title, st.Description,
		st.IncludeMap, st.IncludeTelemetry, st.IncludeSpeed, st.ExpiresAt,
	).Scan(&st.ID, &st.CreatedAt)
}

// GetByToken retrieves a share token by its public token string.
func (r *TokenRepo) GetByToken(ctx context.Context, token string) (*drivemodel.ShareToken, error) {
	st := &drivemodel.ShareToken{}
	query := `
		SELECT id, token, drive_id, created_by, title, description,
			include_map, include_telemetry, include_speed, views, expires_at, created_at
		FROM share_tokens WHERE token = $1`
	err := r.db.Pool.QueryRow(ctx, query, token).Scan(
		&st.ID, &st.Token, &st.DriveID, &st.CreatedBy, &st.Title, &st.Description,
		&st.IncludeMap, &st.IncludeTelemetry, &st.IncludeSpeed, &st.Views,
		&st.ExpiresAt, &st.CreatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get share token: %w", err)
	}
	return st, nil
}

// ListByDrive returns all share tokens for a given drive.
func (r *TokenRepo) ListByDrive(ctx context.Context, driveID int64) ([]*drivemodel.ShareToken, error) {
	query := `
		SELECT id, token, drive_id, created_by, title, description,
			include_map, include_telemetry, include_speed, views, expires_at, created_at
		FROM share_tokens WHERE drive_id = $1
		ORDER BY created_at DESC`
	rows, err := r.db.Pool.Query(ctx, query, driveID)
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
	return tokens, rows.Err()
}

// IncrementViews atomically increments the view counter.
func (r *TokenRepo) IncrementViews(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, `UPDATE share_tokens SET views = views + 1 WHERE id = $1`, id)
	return err
}

// Delete removes a share token by its token string.
func (r *TokenRepo) Delete(ctx context.Context, token string) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM share_tokens WHERE token = $1`, token)
	if err != nil {
		return fmt.Errorf("delete share token: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("share token not found")
	}
	return nil
}

// DeleteExpired removes all share tokens past their expiry.
func (r *TokenRepo) DeleteExpired(ctx context.Context) (int64, error) {
	tag, err := r.db.Pool.Exec(ctx,
		`DELETE FROM share_tokens WHERE expires_at IS NOT NULL AND expires_at < $1`,
		time.Now().UTC(),
	)
	if err != nil {
		return 0, fmt.Errorf("delete expired share tokens: %w", err)
	}
	return tag.RowsAffected(), nil
}
