package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAppTokenSubjectRoundTrip(t *testing.T) {
	t.Parallel()

	if _, ok := AppTokenSubjectFromContext(t.Context()); ok {
		t.Fatal("empty context must not carry a PAT subject")
	}
	ctx := WithAppTokenSubject(t.Context(), "alice@example.com")
	subject, ok := AppTokenSubjectFromContext(ctx)
	if !ok || subject != "alice@example.com" {
		t.Fatalf("got (%q, %v), want (alice@example.com, true)", subject, ok)
	}
	if _, ok := AppTokenSubjectFromContext(WithAppTokenSubject(t.Context(), "")); ok {
		t.Fatal("empty subject must not read back as present")
	}
}

func TestVerifiedNativeSubjectWithoutBrowserIdentity(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/vehicles", nil)
	req = req.WithContext(WithAppTokenSubject(req.Context(), "alice@example.com"))
	if subject, ok := RequestSubject(req, ""); !ok || subject != "alice@example.com" {
		t.Fatalf("verified native subject lost in open browser mode: %q, %v", subject, ok)
	}
	req.Header.Set("X-Forwarded-User", "target")
	if subject, ok := RequestSubject(req, "X-Forwarded-User"); !ok || subject != "target" {
		t.Fatalf("current verified forwarded identity must take precedence: %q, %v", subject, ok)
	}
}
