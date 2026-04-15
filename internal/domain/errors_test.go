package domain

import (
	"errors"
	"testing"
)

func TestValidationErrors_Error(t *testing.T) {
	tests := []struct {
		name string
		errs ValidationErrors
		want string
	}{
		{
			name: "empty",
			errs: ValidationErrors{},
			want: "validation failed",
		},
		{
			name: "single field",
			errs: ValidationErrors{
				{Field: "vin", Message: "must be 17 characters"},
			},
			want: "validation failed: vin: must be 17 characters",
		},
		{
			name: "multiple fields",
			errs: ValidationErrors{
				{Field: "vin", Message: "must be 17 characters"},
				{Field: "year", Message: "out of range"},
			},
			want: "validation failed: vin: must be 17 characters; year: out of range",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.errs.Error()
			if got != tt.want {
				t.Errorf("Error() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestValidationErrors_Unwrap(t *testing.T) {
	ve := ValidationErrors{{Field: "x", Message: "bad"}}
	if !errors.Is(ve, ErrValidation) {
		t.Error("expected ValidationErrors to unwrap to ErrValidation")
	}
}

func TestDomainErrorSentinels(t *testing.T) {
	sentinels := []error{
		ErrNotFound,
		ErrConflict,
		ErrUnauthorized,
		ErrForbidden,
		ErrValidation,
		ErrRateLimited,
		ErrExternalAPI,
	}
	for _, s := range sentinels {
		if s == nil {
			t.Error("sentinel error should not be nil")
		}
	}
	// Verify they are distinct
	for i := 0; i < len(sentinels); i++ {
		for j := i + 1; j < len(sentinels); j++ {
			if errors.Is(sentinels[i], sentinels[j]) {
				t.Errorf("sentinel %v should not match %v", sentinels[i], sentinels[j])
			}
		}
	}
}
