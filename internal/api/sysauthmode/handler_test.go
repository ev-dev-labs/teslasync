// Handler unit tests.
//
// Covers open mode, forward-auth with and without a subject header, provider
// hints, constructor trimming, and the always-200 contract the SPA relies on.
package sysauthmode

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSystemAuthMode_OpenMode(t *testing.T) {
	h := NewHandler("", "")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/system/auth-mode", nil)
	// Even with a header set, open-mode wiring must IGNORE it.
	req.Header.Set("X-Forwarded-User", "alice")

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body AuthModeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Mode != AuthModeOpen {
		t.Fatalf("mode: got %q, want %q", body.Mode, AuthModeOpen)
	}
	if body.SubjectHeader != "" {
		t.Fatalf("subject_header: got %q, want empty in open mode", body.SubjectHeader)
	}
	if body.Subject != nil {
		t.Fatalf("subject: got %v, want nil in open mode", *body.Subject)
	}
	if body.ProviderHint != "" {
		t.Fatalf("provider_hint: got %q, want empty", body.ProviderHint)
	}
	if body.Capabilities.StepUpReauth ||
		body.Capabilities.TOTPEnrollment ||
		body.Capabilities.SessionList ||
		body.Capabilities.Impersonation ||
		body.Capabilities.RBAC {
		t.Fatalf("capabilities: any-true in open mode; got %+v", body.Capabilities)
	}
}

func TestSystemAuthMode_ForwardAuthMissingHeader(t *testing.T) {
	h := NewHandler("X-Forwarded-User", "")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/system/auth-mode", nil)
	// No header set.

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body AuthModeResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &body)

	if body.Mode != AuthModeForward {
		t.Fatalf("mode: got %q, want %q", body.Mode, AuthModeForward)
	}
	if body.SubjectHeader != "X-Forwarded-User" {
		t.Fatalf("subject_header: got %q, want X-Forwarded-User", body.SubjectHeader)
	}
	if body.Subject != nil {
		t.Fatalf("subject: got %v, want nil when header missing", *body.Subject)
	}
	if !body.Capabilities.StepUpReauth {
		t.Fatalf("capabilities.step_up_reauth must be true in forward-auth mode")
	}
}

func TestSystemAuthMode_ForwardAuthHeaderPresent(t *testing.T) {
	h := NewHandler("X-Forwarded-User", "authentik")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/system/auth-mode", nil)
	req.Header.Set("X-Forwarded-User", "  alice  ")

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body AuthModeResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &body)

	if body.Mode != AuthModeForward {
		t.Fatalf("mode: got %q, want %q", body.Mode, AuthModeForward)
	}
	if body.Subject == nil || *body.Subject != "alice" {
		t.Fatalf("subject: got %v, want pointer to %q", body.Subject, "alice")
	}
	if body.ProviderHint != "authentik" {
		t.Fatalf("provider_hint: got %q, want authentik", body.ProviderHint)
	}
	if !body.Capabilities.TOTPEnrollment ||
		!body.Capabilities.SessionList ||
		!body.Capabilities.Impersonation ||
		!body.Capabilities.RBAC {
		t.Fatalf("capabilities: forward-auth must enable everything; got %+v", body.Capabilities)
	}
}

func TestSystemAuthMode_TrimsConstructorInputs(t *testing.T) {
	h := NewHandler("  X-Forwarded-User\n", "  authentik\t")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/system/auth-mode", nil)
	req.Header.Set("X-Forwarded-User", "alice")

	h.ServeHTTP(rec, req)

	var body AuthModeResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.SubjectHeader != "X-Forwarded-User" {
		t.Fatalf("subject_header: got %q, want X-Forwarded-User", body.SubjectHeader)
	}
	if body.ProviderHint != "authentik" {
		t.Fatalf("provider_hint: got %q, want authentik", body.ProviderHint)
	}
}

func TestSystemAuthMode_AlwaysReturns200(t *testing.T) {
	// The contract endpoint must never 4xx/5xx — the SPA falls back to
	// "service down" copy if it cannot read it. Smoke-test both modes
	// here so a future refactor that introduces an early 4xx fails
	// the build.
	for _, mode := range []struct {
		name  string
		hdr   string
		setOn bool
	}{
		{"open mode + no header", "", false},
		{"open mode + spurious header", "", true},
		{"forward-auth + no header", "X-Forwarded-User", false},
		{"forward-auth + header", "X-Forwarded-User", true},
	} {
		t.Run(mode.name, func(t *testing.T) {
			h := NewHandler(mode.hdr, "")
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/system/auth-mode", nil)
			if mode.setOn {
				req.Header.Set("X-Forwarded-User", "alice")
			}
			h.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status: got %d, want 200", rec.Code)
			}
		})
	}
}
