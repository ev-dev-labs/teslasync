package auth

import (
	"context"
	"time"

	authmodel "github.com/ev-dev-labs/teslasync/internal/models/auth"

	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// TokenRepo provides token data access with optional encryption.
type TokenRepo struct {
	db  *database.DB
	enc *crypto.Encryptor
}

func NewTokenRepo(db *database.DB, enc ...*crypto.Encryptor) *TokenRepo {
	var e *crypto.Encryptor
	if len(enc) > 0 {
		e = enc[0]
	}
	return &TokenRepo{db: db, enc: e}
}

func (r *TokenRepo) Upsert(ctx context.Context, t *authmodel.Token) error {
	query := `
		INSERT INTO tokens (id, access_token, refresh_token, expires_at, created_at, updated_at)
		VALUES (1, $1, $2, $3, $4, $4)
		ON CONFLICT (id) DO UPDATE SET
			access_token = EXCLUDED.access_token,
			refresh_token = EXCLUDED.refresh_token,
			expires_at = EXCLUDED.expires_at,
			updated_at = EXCLUDED.updated_at`
	now := time.Now().UTC()
	accessEnc := crypto.EncryptIfEnabled(r.enc, t.AccessToken)
	refreshEnc := crypto.EncryptIfEnabled(r.enc, t.RefreshToken)
	_, err := r.db.Pool.Exec(ctx, query, accessEnc, refreshEnc, t.ExpiresAt, now)
	return err
}

func (r *TokenRepo) Get(ctx context.Context) (*authmodel.Token, error) {
	query := `SELECT id, access_token, refresh_token, expires_at, created_at, updated_at FROM tokens WHERE id = 1`
	t := &authmodel.Token{}
	err := r.db.Pool.QueryRow(ctx, query).Scan(&t.ID, &t.AccessToken, &t.RefreshToken, &t.ExpiresAt, &t.CreatedAt, &t.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	t.AccessToken = crypto.DecryptIfEnabled(r.enc, t.AccessToken)
	t.RefreshToken = crypto.DecryptIfEnabled(r.enc, t.RefreshToken)
	return t, nil
}

func (r *TokenRepo) Delete(ctx context.Context) error {
	_, err := r.db.Pool.Exec(ctx, "DELETE FROM tokens WHERE id = 1")
	return err
}
