package audit

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestUserActivity_RequiresForwardAuthHeader documents the privacy guarantee:
// the per-user activity endpoint refuses to serve
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
