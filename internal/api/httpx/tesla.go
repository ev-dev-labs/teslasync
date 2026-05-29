package httpx

import "net/http"

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
