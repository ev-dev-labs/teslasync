package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/domain/user"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

type userRepository struct {
	pool pgxPool
}

func NewUserRepository(pool *pgxpool.Pool) repository.UserRepository {
	return &userRepository{pool: pool}
}

func (r *userRepository) GetByID(ctx context.Context, id string) (*user.User, error) {
	return r.scanOne(ctx, queries.GetUserByID, id)
}

func (r *userRepository) GetByEmail(ctx context.Context, email string) (*user.User, error) {
	return r.scanOne(ctx, queries.GetUserByEmail, email)
}

func (r *userRepository) Save(ctx context.Context, u *user.User) error {
	_, err := r.pool.Exec(ctx, queries.UpsertUser,
		u.ID, u.Email, u.DisplayName, u.AvatarURL,
		u.TeslaTokenEncrypted, u.TeslaRefreshTokenEncrypted,
		u.TokenExpiresAt, u.CreatedAt, u.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("saving user %s: %w", u.ID, err)
	}
	return nil
}

func (r *userRepository) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, queries.DeleteUser, id)
	if err != nil {
		return fmt.Errorf("deleting user %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("user %s: %w", id, domain.ErrNotFound)
	}
	return nil
}

func (r *userRepository) scanOne(ctx context.Context, query string, arg any) (*user.User, error) {
	var u user.User
	err := r.pool.QueryRow(ctx, query, arg).Scan(
		&u.ID, &u.Email, &u.DisplayName, &u.AvatarURL,
		&u.TeslaTokenEncrypted, &u.TeslaRefreshTokenEncrypted,
		&u.TokenExpiresAt, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("user: %w", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning user: %w", err)
	}
	return &u, nil
}
