package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestUserActivity_RequiresForwardAuthHeader documents the privacy guarantee
// from Phase-40 / Prompt 49: the per-user activity endpoint refuses to serve
// when the deployment isn't running behind a ForwardAuth identity provider,
// rather than silently collapsing every "anonymous" caller into one shared
// feed.
func TestUserActivity_RequiresForwardAuthHeader(t *testing.T) {
	h := &AuditHandler{db: nil, forwardAuthHeader: ""}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me/activity", nil)

	h.UserActivity(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when ForwardAuthHeader unset, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unexpected non-JSON body: %v (body=%s)", err, rec.Body.String())
	}
	if body["error"] == "" {
		t.Fatalf("expected an error message, got %q", rec.Body.String())
	}
}

// TestUserActivity_RequiresIdentityHeaderValue covers the case where the
// header is configured (so the deployment claims to have auth) but the
// request itself didn't carry the value — almost certainly a misconfigured
// upstream. Returning 401 instead of an empty list keeps the user from
// thinking "I have no activity" when in reality their identity is missing.
func TestUserActivity_RequiresIdentityHeaderValue(t *testing.T) {
	h := &AuditHandler{db: nil, forwardAuthHeader: "X-Forwarded-User"}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me/activity", nil)
	// Note: no X-Forwarded-User header set.

	h.UserActivity(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when identity header empty, got %d (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestActorFromRequest(t *testing.T) {
	tests := []struct {
		name       string
		headerName string
		setHeader  string
		want       string
	}{
		{name: "no header configured", headerName: "", setHeader: "user@example.com", want: ""},
		{name: "header configured but missing", headerName: "X-Forwarded-User", setHeader: "", want: ""},
		{name: "header present", headerName: "X-Forwarded-User", setHeader: "user@example.com", want: "user@example.com"},
		{name: "header value trimmed", headerName: "X-Forwarded-User", setHeader: "  user@example.com  ", want: "user@example.com"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.setHeader != "" {
				req.Header.Set("X-Forwarded-User", tt.setHeader)
			}
			got := actorFromRequest(req, tt.headerName)
			if got != tt.want {
				t.Fatalf("actorFromRequest = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestClientIP(t *testing.T) {
	tests := []struct {
		name     string
		xff      string
		remote   string
		wantHost string
	}{
		{name: "remote addr only", remote: "10.0.0.1:54321", wantHost: "10.0.0.1"},
		{name: "ipv6 remote addr", remote: "[::1]:54321", wantHost: "::1"},
		{name: "xff single", xff: "203.0.113.5", remote: "10.0.0.1:54321", wantHost: "203.0.113.5"},
		{name: "xff chain prefers leftmost", xff: "203.0.113.5, 10.0.0.2", remote: "10.0.0.1:54321", wantHost: "203.0.113.5"},
		{name: "xff with whitespace", xff: "  203.0.113.5  ", remote: "10.0.0.1:54321", wantHost: "203.0.113.5"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tt.remote
			if tt.xff != "" {
				req.Header.Set("X-Forwarded-For", tt.xff)
			}
			if got := clientIP(req); got != tt.wantHost {
				t.Fatalf("clientIP = %q, want %q", got, tt.wantHost)
			}
		})
	}
}
