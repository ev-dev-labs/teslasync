package httpx

import (
	"errors"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// ErrCodeTeslaTokenExpired is the machine-readable wire code that the
// TeslaSync SPA matches on to drive its <TeslaReauthBanner> recovery
// UI when the user's third-party Tesla refresh token has expired and
// the backend can no longer act on their behalf without a fresh
// OAuth grant.
//
// This string value is part of the frontend wire contract:
// web/src/lib/resilience.ts matches it byte-for-byte. Renaming
// requires a coordinated frontend change. The cross-package test in
// httpx/tesla_test.go pins the literal so accidental drift fails CI.
const ErrCodeTeslaTokenExpired = "TESLA_TOKEN_EXPIRED"

// TeslaBudgetFailure is the safe public mapping for a Fleet API budget error.
type TeslaBudgetFailure struct {
	StatusCode int
	Category   string
	Message    string
}

// ClassifyTeslaBudgetError distinguishes daily exhaustion from an unavailable
// budget evidence store. The returned message is safe for public responses.
func ClassifyTeslaBudgetError(err error) (TeslaBudgetFailure, bool) {
	switch {
	case errors.Is(err, tesla.ErrBudgetExceeded):
		return TeslaBudgetFailure{
			StatusCode: http.StatusTooManyRequests,
			Category:   "budget_exceeded",
			Message:    "Tesla Fleet API daily budget exhausted; retry after the UTC reset",
		}, true
	case errors.Is(err, tesla.ErrBudgetUnavailable):
		return TeslaBudgetFailure{
			StatusCode: http.StatusServiceUnavailable,
			Category:   "budget_unavailable",
			Message:    "Tesla Fleet API budget evidence is temporarily unavailable",
		}, true
	default:
		return TeslaBudgetFailure{}, false
	}
}

// WriteTeslaTokenExpired writes the canonical 401 response that the
// SPA translates into a TeslaAuthExpiredError and surfaces via the
// <TeslaReauthBanner> recovery UI.
//
// Use this from any handler whose underlying call returned
// tesla.ErrUnauthorized — i.e. the user's third-party Tesla refresh
// token has expired. Distinct from the generic
// "Authentik session expired" 401 path; the SPA differentiates the
// two purely by inspecting the JSON body's `code` field.
func WriteTeslaTokenExpired(w http.ResponseWriter) {
	WriteErrorCode(w, http.StatusUnauthorized, "Tesla account disconnected", ErrCodeTeslaTokenExpired)
}
