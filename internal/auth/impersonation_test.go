// Tests for the impersonation middleware, store, and helpers in
// impersonation.go.
//
// The store covers Mint/Verify roundtrip, expiry, signature
// tampering, and self-target rejection. The middleware covers the
// happy path (cookie + matching admin → header rewrite + claim in
// context), invalid-cookie clearing, admin-binding mismatch (cookie
// carryover on shared browser), and open-mode passthrough.
// RequireNotImpersonating covers both branches.
package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *ImpersonationStore {
	t.Helper()
	store, err := NewImpersonationStore()
	if err != nil {
		t.Fatalf("NewImpersonationStore: %v", err)
	}
	return store
}

func TestImpersonationStore_MintVerifyRoundTrip(t *testing.T) {
	t.Parallel()
	store := newTestStore(t)
	token, expiresAt, err := store.Mint("admin", "target")
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}
	if !expiresAt.After(time.Now()) {
		t.Fatalf("expected expiry in future, got %v", expiresAt)
	}
	claim, err := store.Verify(token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claim.OriginalAdmin != "admin" || claim.Target != "target" {
		t.Fatalf("unexpected claim: %+v", claim)
	}
	if claim.ExpiresAt.IsZero() {
		t.Fatal("expected non-zero expiry in claim")
	}
}

func TestImpersonationStore_MintRejectsBadInputs(t *testing.T) {
	t.Parallel()
	store := newTestStore(t)
	cases := []struct {
		name          string
		originalAdmin string
		target        string
	}{
		{"empty admin", "", "target"},
		{"empty target", "admin", ""},
		{"self target", "same", "same"},
		{"whitespace admin", "  ", "target"},
		{"whitespace target", "admin", "  "},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if _, _, err := store.Mint(tc.originalAdmin, tc.target); err == nil {
				t.Fatal("expected error, got nil")
			}
		})
	}
}

func TestImpersonationStore_VerifyExpired(t *testing.T) {
	t.Parallel()
	store := newTestStore(t)
	// Pin the clock to a known value, mint, then advance past TTL.
	pinned := time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC)
	store.SetNowForTests(func() time.Time { return pinned })
	token, _, err := store.Mint("admin", "target")
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	store.SetNowForTests(func() time.Time { return pinned.Add(ImpersonationTTL + time.Second) })
	if _, err := store.Verify(token); err != ErrImpersonationCookieInvalid {
		t.Fatalf("expected ErrImpersonationCookieInvalid, got %v", err)
	}
}

func TestImpersonationStore_VerifyTampered(t *testing.T) {
	t.Parallel()
	store := newTestStore(t)
	token, _, err := store.Mint("admin", "target")
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	// Flip a single character in the signature segment.
	dot := strings.IndexByte(token, '.')
	if dot < 0 {
		t.Fatalf("malformed token has no dot: %q", token)
	}
	tampered := token[:dot+1] + "A" + token[dot+2:]
	if tampered == token {
		// On the off chance the original signature already started
		// with 'A', flip to 'B' instead.
		tampered = token[:dot+1] + "B" + token[dot+2:]
	}
	if _, err := store.Verify(tampered); err != ErrImpersonationCookieInvalid {
		t.Fatalf("expected ErrImpersonationCookieInvalid, got %v", err)
	}
}

func TestImpersonationStore_VerifyMissing(t *testing.T) {
	t.Parallel()
	store := newTestStore(t)
	if _, err := store.Verify(""); err != ErrImpersonationCookieMissing {
		t.Fatalf("expected ErrImpersonationCookieMissing, got %v", err)
	}
}

func TestImpersonationStore_VerifyMalformed(t *testing.T) {
	t.Parallel()
	store := newTestStore(t)
	cases := []string{
		"no-dot",
		".no-body",
		"no-sig.",
		"!!!.@@@",
	}
	for _, c := range cases {
		c := c
		t.Run(c, func(t *testing.T) {
			t.Parallel()
			if _, err := store.Verify(c); err != ErrImpersonationCookieInvalid {
				t.Fatalf("expected ErrImpersonationCookieInvalid for %q, got %v", c, err)
			}
		})
	}
}

func TestImpersonationStore_VerifyOversize(t *testing.T) {
	t.Parallel()
	store := newTestStore(t)
	huge := strings.Repeat("a", ImpersonationCookieMaxBytes+1)
	if _, err := store.Verify(huge); err != ErrImpersonationCookieInvalid {
		t.Fatalf("expected ErrImpersonationCookieInvalid for oversize, got %v", err)
	}
}

func TestImpersonationMiddleware_OpenModePassthrough(t *testing.T) {
	t.Parallel()
	store := newTestStore(t)
	called := false
	mw := ImpersonationMiddleware("", store)
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		called = true
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if !called {
		t.Fatal("expected next handler called in open mode")
	}
}

func TestImpersonationMiddleware_NoCookiePassthrough(t *testing.T) {
	t.Parallel()
	store := newTestStore(t)
	called := false
	mw := ImpersonationMiddleware("X-Forwarded-User", store)
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		called = true
		if IsImpersonating(r.Context()) {
			t.Fatal("expected no impersonation claim")
		}
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-User", "admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if !called {
		t.Fatal("expected next handler called")
	}
}

func TestImpersonationMiddleware_ValidCookieRewritesHeader(t *testing.T) {
	t.Parallel()
	store := newTestStore(t)
	token, _, err := store.Mint("admin", "target")
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	mw := ImpersonationMiddleware("X-Forwarded-User", store)
	var seenSubject string
	var seenClaim ImpersonationClaim
	var seenOK bool
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seenSubject = r.Header.Get("X-Forwarded-User")
		seenClaim, seenOK = CurrentImpersonationClaim(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-User", "admin")
	req.AddCookie(&http.Cookie{Name: ImpersonationCookieName, Value: token})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if seenSubject != "target" {
		t.Fatalf("expected header rewritten to target, got %q", seenSubject)
	}
	if !seenOK {
		t.Fatal("expected claim in context")
	}
	if seenClaim.OriginalAdmin != "admin" || seenClaim.Target != "target" {
		t.Fatalf("unexpected claim: %+v", seenClaim)
	}
}

func TestImpersonationMiddleware_AdminMismatchClearsCookie(t *testing.T) {
	t.Parallel()
	store := newTestStore(t)
	token, _, err := store.Mint("admin", "target")
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	mw := ImpersonationMiddleware("X-Forwarded-User", store)
	var seenSubject string
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seenSubject = r.Header.Get("X-Forwarded-User")
		if IsImpersonating(r.Context()) {
			t.Fatal("expected no impersonation claim on mismatch")
		}
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	// Different signed-in user — cookie is stale carryover.
	req.Header.Set("X-Forwarded-User", "someone-else")
	req.AddCookie(&http.Cookie{Name: ImpersonationCookieName, Value: token})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if seenSubject != "someone-else" {
		t.Fatalf("expected header preserved for non-admin caller, got %q", seenSubject)
	}
	// Verify a clear-cookie was issued on the response.
	resp := rr.Result()
	defer resp.Body.Close()
	var foundClear bool
	for _, c := range resp.Cookies() {
		if c.Name == ImpersonationCookieName && c.MaxAge < 0 {
			foundClear = true
		}
	}
	if !foundClear {
		t.Fatal("expected Set-Cookie clearing impersonation on mismatch")
	}
}

func TestImpersonationMiddleware_InvalidCookieClears(t *testing.T) {
	t.Parallel()
	store := newTestStore(t)
	mw := ImpersonationMiddleware("X-Forwarded-User", store)
	called := false
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		called = true
		if IsImpersonating(r.Context()) {
			t.Fatal("expected no claim for invalid cookie")
		}
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-User", "admin")
	req.AddCookie(&http.Cookie{Name: ImpersonationCookieName, Value: "garbage.payload"})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if !called {
		t.Fatal("expected next handler called")
	}
	resp := rr.Result()
	defer resp.Body.Close()
	var foundClear bool
	for _, c := range resp.Cookies() {
		if c.Name == ImpersonationCookieName && c.MaxAge < 0 {
			foundClear = true
		}
	}
	if !foundClear {
		t.Fatal("expected clear-cookie for invalid impersonation cookie")
	}
}

func TestRequireNotImpersonating_PassthroughWithoutClaim(t *testing.T) {
	t.Parallel()
	called := false
	h := RequireNotImpersonating()(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		called = true
	}))
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if !called {
		t.Fatal("expected next handler called when not impersonating")
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rr.Code)
	}
}

func TestRequireNotImpersonating_BlocksWithClaim(t *testing.T) {
	t.Parallel()
	called := false
	h := RequireNotImpersonating()(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		called = true
	}))
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	ctx := WithImpersonationForTests(req.Context(), ImpersonationClaim{
		OriginalAdmin: "admin",
		Target:        "target",
		ExpiresAt:     time.Now().Add(time.Minute),
	})
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if called {
		t.Fatal("expected next handler NOT called when impersonating")
	}
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden, got %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, ImpersonationBlockedCode) {
		t.Fatalf("expected response to carry %q, got %s", ImpersonationBlockedCode, body)
	}
}

func TestOriginalAdminSubject(t *testing.T) {
	t.Parallel()
	if got := OriginalAdminSubject(context.Background()); got != "" {
		t.Fatalf("expected empty original admin without claim, got %q", got)
	}
	ctx := WithImpersonationForTests(context.Background(), ImpersonationClaim{
		OriginalAdmin: "admin",
		Target:        "target",
		ExpiresAt:     time.Now().Add(time.Minute),
	})
	if got := OriginalAdminSubject(ctx); got != "admin" {
		t.Fatalf("expected admin, got %q", got)
	}
}

func TestCurrentImpersonationClaim_NilContext(t *testing.T) {
	t.Parallel()
	//nolint:staticcheck // intentionally exercising the nil-context guard
	if _, ok := CurrentImpersonationClaim(nil); ok {
		t.Fatal("expected false for nil context")
	}
}

func TestSetAndClearImpersonationCookie(t *testing.T) {
	t.Parallel()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	SetImpersonationCookie(rr, req, "abc.def")
	cookies := rr.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != ImpersonationCookieName || cookies[0].Value != "abc.def" {
		t.Fatalf("unexpected set-cookie: %+v", cookies)
	}
	if cookies[0].MaxAge <= 0 {
		t.Fatalf("expected positive MaxAge, got %d", cookies[0].MaxAge)
	}
	rr2 := httptest.NewRecorder()
	ClearImpersonationCookie(rr2, req)
	cookies2 := rr2.Result().Cookies()
	if len(cookies2) != 1 || cookies2[0].MaxAge >= 0 {
		t.Fatalf("expected clear with negative MaxAge, got %+v", cookies2)
	}
}
