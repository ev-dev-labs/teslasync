package domain

import (
	"errors"
	"fmt"
	"strings"
)

// Domain error sentinels — every error in the domain layer wraps one of these.
// Handler middleware maps these to HTTP status codes.
var (
	ErrNotFound     = errors.New("not found")
	ErrConflict     = errors.New("conflict")
	ErrUnauthorized = errors.New("unauthorized")
	ErrForbidden    = errors.New("forbidden")
	ErrValidation   = errors.New("validation failed")
	ErrRateLimited  = errors.New("rate limited")
	ErrExternalAPI  = errors.New("external api error")
)

// ValidationError carries field-level validation detail.
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// ValidationErrors is a collection of field-level validation errors.
type ValidationErrors []ValidationError

// Error implements the error interface, joining all field messages.
func (ve ValidationErrors) Error() string {
	if len(ve) == 0 {
		return "validation failed"
	}
	msgs := make([]string, len(ve))
	for i, e := range ve {
		msgs[i] = fmt.Sprintf("%s: %s", e.Field, e.Message)
	}
	return fmt.Sprintf("validation failed: %s", strings.Join(msgs, "; "))
}

// Unwrap returns the sentinel ErrValidation so errors.Is works.
func (ve ValidationErrors) Unwrap() error {
	return ErrValidation
}
