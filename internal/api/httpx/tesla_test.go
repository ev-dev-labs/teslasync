package httpx_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// TestWriteTeslaTokenExpired_PropagatesCode verifies the contract
// between this canonical 401 response and the frontend's distinct
// TeslaAuthExpiredError surface.
//
// The SPA distinguishes "Tesla third-party OAuth grant expired" from
// "Authentik session expired" purely by the JSON body's `code` field
// (HTTP status is 401 in both cases). If this code drifts, the
// reauth banner stops firing and users see a generic 401 toast with
// no recovery path — a silent regression we must catch in CI.
func TestWriteTeslaTokenExpired_PropagatesCode(t *testing.T) {
	rec := httptest.NewRecorder()
	httpx.WriteTeslaTokenExpired(rec)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}

	ct := rec.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json...", ct)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}

	if got := body["code"]; got != httpx.ErrCodeTeslaTokenExpired {
		t.Errorf("body.code = %q, want %q", got, httpx.ErrCodeTeslaTokenExpired)
	}
	if got := body["code"]; got != "TESLA_TOKEN_EXPIRED" {
		t.Errorf("body.code literal = %q, want TESLA_TOKEN_EXPIRED (frontend matches on this exact string)", got)
	}
	if body["error"] == "" {
		t.Errorf("body.error is empty, want a human-readable message")
	}
}

// TestErrCodeTeslaTokenExpired_ConstantPin pins the wire value of the
// error code so accidental renames are caught without grepping the
// frontend. web/src/lib/resilience.ts matches this string byte-for-byte.
func TestErrCodeTeslaTokenExpired_ConstantPin(t *testing.T) {
	if httpx.ErrCodeTeslaTokenExpired != "TESLA_TOKEN_EXPIRED" {
		t.Errorf("ErrCodeTeslaTokenExpired = %q, want %q (frontend resilience.ts depends on this exact string)",
			httpx.ErrCodeTeslaTokenExpired, "TESLA_TOKEN_EXPIRED")
	}
}
