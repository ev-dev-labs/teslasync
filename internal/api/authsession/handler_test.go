package authsession

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// Phase-46 / Prompt 05 — Handler unit tests.

func decodeAuthSessionBody(t *testing.T, body []byte) authSessionResponse {
	t.Helper()
	var resp authSessionResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode: %v; body=%s", err, string(body))
	}
	return resp
}

func TestAuthSessionOpenMode(t *testing.T) {
	cfg := &config.Config{Auth: config.AuthConfig{ForwardAuthHeader: ""}}
	h := NewHandler(cfg)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/session", nil)
	h.Session(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}
	resp := decodeAuthSessionBody(t, rec.Body.Bytes())
	if resp.Mode != "open" {
		t.Fatalf("mode: got %q, want open", resp.Mode)
	}
	if !resp.Authenticated {
		t.Fatalf("authenticated: open mode must report authenticated=true")
	}
	if resp.ExpiresAt != nil || resp.ExpiresIn != nil {
		t.Fatalf("open mode must omit expiry fields: %+v", resp)
	}
	if resp.User != nil {
		t.Fatalf("open mode must omit user payload: %+v", resp.User)
	}
	if resp.Renewable {
		t.Fatalf("open mode must report renewable=false")
	}
}

func TestAuthSessionUnauthenticatedReturns200(t *testing.T) {
	cfg := &config.Config{Auth: config.AuthConfig{ForwardAuthHeader: "X-Forwarded-User"}}
	h := NewHandler(cfg)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/session", nil)
	// No X-Forwarded-User header set — simulates expired session.
	h.Session(rec, req)

	// CRITICAL contract: must NOT 401, otherwise the polling SPA hits
	// the same expired-session path that brought it here, infinite loop.
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (no 401 even when unauthenticated)", rec.Code)
	}
	resp := decodeAuthSessionBody(t, rec.Body.Bytes())
	if resp.Authenticated {
		t.Fatalf("authenticated: got true, want false when header missing")
	}
	if resp.Mode != "session" {
		t.Fatalf("mode: got %q, want session", resp.Mode)
	}
}

func TestAuthSessionAuthenticatedNoExpiryHeader(t *testing.T) {
	cfg := &config.Config{Auth: config.AuthConfig{ForwardAuthHeader: "X-Forwarded-User"}}
	h := NewHandler(cfg)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/session", nil)
	req.Header.Set("X-Forwarded-User", "alice@example.com")
	h.Session(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}
	resp := decodeAuthSessionBody(t, rec.Body.Bytes())
	if !resp.Authenticated {
		t.Fatalf("authenticated: got false, want true")
	}
	if resp.User == nil || resp.User.Sub != "alice@example.com" {
		t.Fatalf("user: got %+v, want sub=alice@example.com", resp.User)
	}
	if resp.ExpiresAt != nil || resp.ExpiresIn != nil {
		t.Fatalf("expiry: should be nil when proxy does not surface it; got at=%v in=%v",
			derefStringPtr(resp.ExpiresAt), derefInt64Ptr(resp.ExpiresIn))
	}
	if !resp.Renewable {
		t.Fatalf("renewable: provider mode should report renewable=true")
	}
}

func TestAuthSessionExpiryRFC3339(t *testing.T) {
	cfg := &config.Config{Auth: config.AuthConfig{ForwardAuthHeader: "X-Forwarded-User"}}
	h := NewHandler(cfg)
	fixed := time.Date(2025, 5, 4, 12, 0, 0, 0, time.UTC)
	h.now = func() time.Time { return fixed }

	expiresAt := fixed.Add(45 * time.Second).Format(time.RFC3339)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/session", nil)
	req.Header.Set("X-Forwarded-User", "alice@example.com")
	req.Header.Set("X-Auth-Request-Email", "alice@corp.example")
	req.Header.Set("X-Auth-Request-Expires-At", expiresAt)
	h.Session(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}
	resp := decodeAuthSessionBody(t, rec.Body.Bytes())
	if resp.ExpiresAt == nil || *resp.ExpiresAt != expiresAt {
		t.Fatalf("expires_at: got %v, want %s", derefStringPtr(resp.ExpiresAt), expiresAt)
	}
	if resp.ExpiresIn == nil || *resp.ExpiresIn != 45 {
		t.Fatalf("expires_in: got %v, want 45", derefInt64Ptr(resp.ExpiresIn))
	}
	if resp.User == nil || resp.User.Email != "alice@corp.example" {
		t.Fatalf("email: got %+v, want alice@corp.example", resp.User)
	}
}

func TestAuthSessionExpiryUnixSeconds(t *testing.T) {
	cfg := &config.Config{Auth: config.AuthConfig{ForwardAuthHeader: "X-Forwarded-User"}}
	h := NewHandler(cfg)
	fixed := time.Date(2025, 5, 4, 12, 0, 0, 0, time.UTC)
	h.now = func() time.Time { return fixed }

	expiresUnix := fixed.Add(120 * time.Second).Unix()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/session", nil)
	req.Header.Set("X-Forwarded-User", "bob@example.com")
	req.Header.Set("X-Auth-Request-Expires-At", strconv.FormatInt(expiresUnix, 10))
	h.Session(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}
	resp := decodeAuthSessionBody(t, rec.Body.Bytes())
	if resp.ExpiresIn == nil || *resp.ExpiresIn != 120 {
		t.Fatalf("expires_in: got %v, want 120", derefInt64Ptr(resp.ExpiresIn))
	}
}

func TestAuthSessionExpiryGarbledHeader(t *testing.T) {
	cfg := &config.Config{Auth: config.AuthConfig{ForwardAuthHeader: "X-Forwarded-User"}}
	h := NewHandler(cfg)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/session", nil)
	req.Header.Set("X-Forwarded-User", "alice@example.com")
	req.Header.Set("X-Auth-Request-Expires-At", "not-a-date")
	h.Session(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}
	resp := decodeAuthSessionBody(t, rec.Body.Bytes())
	if !resp.Authenticated {
		t.Fatalf("authenticated: got false, want true (garbled expiry should not affect auth)")
	}
	if resp.ExpiresAt != nil || resp.ExpiresIn != nil {
		t.Fatalf("expiry: should be nil on parse failure; got at=%v in=%v",
			derefStringPtr(resp.ExpiresAt), derefInt64Ptr(resp.ExpiresIn))
	}
}

func TestAuthSessionExpiryMillisecondHeader(t *testing.T) {
	cfg := &config.Config{Auth: config.AuthConfig{ForwardAuthHeader: "X-Forwarded-User"}}
	h := NewHandler(cfg)
	fixed := time.Date(2025, 5, 4, 12, 0, 0, 0, time.UTC)
	h.now = func() time.Time { return fixed }

	// 60s ahead, expressed as Unix milliseconds.
	expiresMs := fixed.Add(60 * time.Second).UnixMilli()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/session", nil)
	req.Header.Set("X-Forwarded-User", "alice@example.com")
	req.Header.Set("X-Auth-Request-Expires-At", strconv.FormatInt(expiresMs, 10))
	h.Session(rec, req)

	resp := decodeAuthSessionBody(t, rec.Body.Bytes())
	if resp.ExpiresIn == nil || *resp.ExpiresIn != 60 {
		t.Fatalf("expires_in (ms input): got %v, want 60", derefInt64Ptr(resp.ExpiresIn))
	}
}

// --- helpers ---

func derefStringPtr(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

func derefInt64Ptr(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}
