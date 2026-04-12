package user

import (
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/domain"
)

func TestUserValidation(t *testing.T) {
	tests := []struct {
		name    string
		user    User
		wantErr bool
	}{
		{
			name:    "valid user",
			user:    User{Email: "test@example.com", DisplayName: "Test User"},
			wantErr: false,
		},
		{
			name:    "empty email",
			user:    User{Email: "", DisplayName: "Test User"},
			wantErr: true,
		},
		{
			name:    "invalid email",
			user:    User{Email: "notanemail", DisplayName: "Test User"},
			wantErr: true,
		},
		{
			name:    "empty display name",
			user:    User{Email: "test@example.com", DisplayName: ""},
			wantErr: true,
		},
		{
			name:    "display name too long",
			user:    User{Email: "test@example.com", DisplayName: string(make([]byte, 101))},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.user.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err != nil && !errors.Is(err, domain.ErrValidation) {
				t.Errorf("expected error to wrap domain.ErrValidation, got: %v", err)
			}
		})
	}
}
