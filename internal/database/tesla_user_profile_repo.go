package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// TeslaUserProfileRepo provides data access for the Tesla account owner's profile.
type TeslaUserProfileRepo struct {
	db *DB
}

// NewTeslaUserProfileRepo creates a new repository.
func NewTeslaUserProfileRepo(db *DB) *TeslaUserProfileRepo {
	return &TeslaUserProfileRepo{db: db}
}

// Get returns the stored Tesla user profile (single-row table).
func (r *TeslaUserProfileRepo) Get(ctx context.Context) (*models.TeslaUserProfile, error) {
	p := &models.TeslaUserProfile{}
	query := `SELECT id, email, full_name, profile_image_url, raw_json, fetched_at, created_at, updated_at
		FROM tesla_user_profiles ORDER BY updated_at DESC LIMIT 1`
	err := r.db.Pool.QueryRow(ctx, query).Scan(
		&p.ID, &p.Email, &p.FullName, &p.ProfileImageURL, &p.RawJSON,
		&p.FetchedAt, &p.CreatedAt, &p.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user profile: %w", err)
	}
	return p, nil
}

// Upsert replaces the stored Tesla user profile (single-row table).
func (r *TeslaUserProfileRepo) Upsert(ctx context.Context, p *models.TeslaUserProfile) error {
	now := time.Now().UTC()

	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM tesla_user_profiles`); err != nil {
		return fmt.Errorf("delete old profile: %w", err)
	}

	err = tx.QueryRow(ctx, `INSERT INTO tesla_user_profiles
		(email, full_name, profile_image_url, raw_json, fetched_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
		p.Email, p.FullName, p.ProfileImageURL, p.RawJSON, now, now,
	).Scan(&p.ID)
	if err != nil {
		return fmt.Errorf("insert profile: %w", err)
	}

	p.FetchedAt = now
	p.CreatedAt = now
	p.UpdatedAt = now

	return tx.Commit(ctx)
}
