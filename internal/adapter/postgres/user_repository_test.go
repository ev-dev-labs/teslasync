package postgres

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/domain/user"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

func userRow(u user.User) []any {
	return []any{
		u.ID, u.Email, u.DisplayName, u.AvatarURL,
		u.TeslaTokenEncrypted, u.TeslaRefreshTokenEncrypted,
		u.TokenExpiresAt, u.CreatedAt, u.UpdatedAt,
	}
}

func sampleUser() user.User {
	base := time.Date(2026, 9, 10, 11, 12, 13, 0, time.UTC)
	return user.User{
		ID:                         "7",
		Email:                      "alice@example.com",
		DisplayName:                "Alice",
		AvatarURL:                  "https://cdn.example.com/a.png",
		TeslaTokenEncrypted:        "enc-access-token",
		TeslaRefreshTokenEncrypted: "enc-refresh-token",
		TokenExpiresAt:             base.Add(time.Hour),
		CreatedAt:                  base,
		UpdatedAt:                  base.Add(time.Minute),
	}
}

func TestNewUserRepository(t *testing.T) {
	t.Parallel()
	repo := NewUserRepository(lazyPool(t))
	if repo == nil {
		t.Fatal("NewUserRepository returned nil")
	}
	var _ repository.UserRepository = repo
	if _, ok := repo.(*userRepository); !ok {
		t.Fatalf("returned %T, want *userRepository", repo)
	}
}

func TestUserRepository_singleRowGetters(t *testing.T) {
	t.Parallel()
	want := sampleUser()
	row := userRow(want)

	runGetter(t, "GetByID", row, want, queries.GetUserByID, "7", "scanning user",
		func(pool *fakePool) (*user.User, error) {
			return (&userRepository{pool: pool}).GetByID(context.Background(), "7")
		})
	runGetter(t, "GetByEmail", row, want, queries.GetUserByEmail, "alice@example.com", "scanning user",
		func(pool *fakePool) (*user.User, error) {
			return (&userRepository{pool: pool}).GetByEmail(context.Background(), "alice@example.com")
		})
}

func TestUserRepository_Save(t *testing.T) {
	t.Parallel()
	u := sampleUser()
	execBoom := errors.New("unique violation")

	t.Run("success", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{}
		if err := (&userRepository{pool: pool}).Save(context.Background(), &u); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if pool.execN != 1 {
			t.Fatalf("execN = %d, want 1", pool.execN)
		}
		if pool.execSQL != queries.UpsertUser {
			t.Errorf("SQL = %q, want UpsertUser", pool.execSQL)
		}
		wantArgs := []any{
			u.ID, u.Email, u.DisplayName, u.AvatarURL,
			u.TeslaTokenEncrypted, u.TeslaRefreshTokenEncrypted,
			u.TokenExpiresAt, u.CreatedAt, u.UpdatedAt,
		}
		if !reflect.DeepEqual(pool.execArgs, wantArgs) {
			t.Errorf("exec args = %v,\nwant %v", pool.execArgs, wantArgs)
		}
	})

	t.Run("exec_error", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{execErr: execBoom}
		err := (&userRepository{pool: pool}).Save(context.Background(), &u)
		if !errors.Is(err, execBoom) {
			t.Fatalf("error = %v, want wrap of execBoom", err)
		}
		if !strings.Contains(err.Error(), "saving user 7") {
			t.Errorf("error %q missing context 'saving user 7'", err)
		}
	})
}

func TestUserRepository_Delete(t *testing.T) {
	t.Parallel()
	execBoom := errors.New("fk violation")

	cases := []struct {
		name       string
		tag        string
		execErr    error
		wantErr    error
		wantErrSub string
	}{
		{name: "deleted", tag: "DELETE 1"},
		{name: "not_found", tag: "DELETE 0", wantErr: domain.ErrNotFound, wantErrSub: "user 7"},
		{name: "exec_error", execErr: execBoom, wantErr: execBoom, wantErrSub: "deleting user 7"},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{tag: newCommandTag(c.tag), execErr: c.execErr}
			err := (&userRepository{pool: pool}).Delete(context.Background(), "7")

			if pool.execN != 1 {
				t.Fatalf("execN = %d, want 1", pool.execN)
			}
			if pool.execSQL != queries.DeleteUser {
				t.Errorf("SQL = %q, want DeleteUser", pool.execSQL)
			}
			if len(pool.execArgs) != 1 || argAt(pool.execArgs, 0) != "7" {
				t.Errorf("args = %v, want [7]", pool.execArgs)
			}

			if c.wantErr != nil {
				if !errors.Is(err, c.wantErr) {
					t.Fatalf("error = %v, want wrap of %v", err, c.wantErr)
				}
				if !strings.Contains(err.Error(), c.wantErrSub) {
					t.Errorf("error %q missing context %q", err, c.wantErrSub)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
