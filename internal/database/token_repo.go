package database

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/teslasync/teslasync/internal/models"
)

// TokenRepo provides token data access.
type TokenRepo struct {
	db *DB
}

func NewTokenRepo(db *DB) *TokenRepo {
	return &TokenRepo{db: db}
}

func (r *TokenRepo) Upsert(ctx context.Context, t *models.Token) error {
	query := `
		INSERT INTO tokens (id, access_token, refresh_token, expires_at, created_at, updated_at)
		VALUES (1, $1, $2, $3, $4, $4)
		ON CONFLICT (id) DO UPDATE SET
			access_token = EXCLUDED.access_token,
			refresh_token = EXCLUDED.refresh_token,
			expires_at = EXCLUDED.expires_at,
			updated_at = EXCLUDED.updated_at`
	now := time.Now().UTC()
	_, err := r.db.Pool.Exec(ctx, query, t.AccessToken, t.RefreshToken, t.ExpiresAt, now)
	return err
}

func (r *TokenRepo) Get(ctx context.Context) (*models.Token, error) {
	query := `SELECT id, access_token, refresh_token, expires_at, created_at, updated_at FROM tokens WHERE id = 1`
	t := &models.Token{}
	err := r.db.Pool.QueryRow(ctx, query).Scan(&t.ID, &t.AccessToken, &t.RefreshToken, &t.ExpiresAt, &t.CreatedAt, &t.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return t, err
}
