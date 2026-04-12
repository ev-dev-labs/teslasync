package middleware

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/domain"
)

func TestMapDomainError(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"not found", domain.ErrNotFound, http.StatusNotFound, "NOT_FOUND"},
		{"conflict", domain.ErrConflict, http.StatusConflict, "CONFLICT"},
		{"unauthorized", domain.ErrUnauthorized, http.StatusUnauthorized, "UNAUTHORIZED"},
		{"forbidden", domain.ErrForbidden, http.StatusForbidden, "FORBIDDEN"},
		{"validation", domain.ErrValidation, http.StatusBadRequest, "VALIDATION_ERROR"},
		{"rate limited", domain.ErrRateLimited, http.StatusTooManyRequests, "RATE_LIMITED"},
		{"external api", domain.ErrExternalAPI, http.StatusBadGateway, "EXTERNAL_API_ERROR"},
		{"unknown error", errors.New("unknown"), http.StatusInternalServerError, "INTERNAL"},
		{"wrapped not found", fmt.Errorf("vehicle 123: %w", domain.ErrNotFound), http.StatusNotFound, "NOT_FOUND"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, apiErr := MapDomainError(tt.err)
			if status != tt.wantStatus {
				t.Errorf("status = %d, want %d", status, tt.wantStatus)
			}
			if apiErr.Code != tt.wantCode {
				t.Errorf("code = %q, want %q", apiErr.Code, tt.wantCode)
			}
		})
	}
}

func TestMapDomainError_ValidationErrors(t *testing.T) {
	ve := domain.ValidationErrors{
		{Field: "vin", Message: "must be 17 characters"},
		{Field: "name", Message: "required"},
	}
	status, apiErr := MapDomainError(ve)
	if status != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", status)
	}
	if apiErr.Code != "VALIDATION_ERROR" {
		t.Errorf("expected VALIDATION_ERROR, got %q", apiErr.Code)
	}
	if len(apiErr.Details) != 2 {
		t.Errorf("expected 2 details, got %d", len(apiErr.Details))
	}
}

func TestHandleError(t *testing.T) {
	w := httptest.NewRecorder()
	HandleError(w, domain.ErrNotFound)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}
