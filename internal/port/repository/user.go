package repository

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/domain/user"
)

// UserRepository defines the persistence interface for users.
type UserRepository interface {
	GetByID(ctx context.Context, id string) (*user.User, error)
	GetByEmail(ctx context.Context, email string) (*user.User, error)
	Save(ctx context.Context, u *user.User) error
	Delete(ctx context.Context, id string) error
}
