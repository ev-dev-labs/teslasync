package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	dbauth "github.com/ev-dev-labs/teslasync/internal/database/auth"
)

// Phase-46 / Prompt 31 — middleware + reauth-handler unit tests.
//
// The fixtures here only exercise the in-process pieces (token store,
// HTTP handler shape, header binding, error envelope). Frontend-driven
// flows are exercised under web/src/api/__tests__/client.sudo.test.ts.

const testHeader = "X-Forwarded-User"

func staticTOTPVerifier(want string) TOTPVerifier {
	return func(_ string, code string) error {
		if code == want {
			return nil
		}
		return errors.New("invalid totp")
	}
}

func newTestSudoBundle(t *testing.T, cfg SudoConfig) (*SudoHandler, *dbauth.SudoTokenStore) {
	t.Helper()
	store := dbauth.NewSudoTokenStore(cfg.TTL)
	return NewSudoHandler(cfg, store, staticTOTPVerifier("123456")), store
}

func decodeReauthOK(t *testing.T, body []byte) reauthResponse {
	t.Helper()
	var resp reauthResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode reauth response: %v; body=%s", err, string(body))
	}
	return resp
}

func decodeError(t *testing.T, body []byte) (msg, code string) {
	t.Helper()
	var env struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode error envelope: %v; body=%s", err, string(body))
	}
	return env.Error, env.Code
}

func newReauthRequest(t *testing.T, header, subject string, body any) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	req := httptest.NewRequest(http.MethodPost, "/auth/reauth", &buf)
	if header != "" && subject != "" {
		req.Header.Set(header, subject)
	}
	req.Header.Set("Content-Type", "application/json")
	return req
}

// --- SudoTokenStore (database package) -------------------------------

func TestSudoTokenStore_MintValidate(t *testing.T) {
	store := dbauth.NewSudoTokenStore(50 * time.Millisecond)

	token, exp, err := store.Mint("alice")
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if token == "" {
		t.Fatalf("expected non-empty token")
	}
	if !exp.After(time.Now()) {
		t.Fatalf("exp: must be in the future, got %s (now=%s)", exp, time.Now())
	}

	if err := store.Validate(token, "alice"); err != nil {
		t.Fatalf("validate fresh: %v", err)
	}

	// Wrong subject must fail even with a valid token.
	if err := store.Validate(token, "mallory"); err == nil {
		t.Fatalf("validate cross-subject: expected error, got nil")
	}

	// After TTL the token is rejected. Sleep a little longer than the
	// TTL to dodge clock granularity flakes on slow CI runners.
	time.Sleep(120 * time.Millisecond)
	if err := store.Validate(token, "alice"); err == nil {
		t.Fatalf("validate expired: expected error, got nil")
	}

	// Empty token always rejected.
	if err := store.Validate("", "alice"); err == nil {
		t.Fatalf("validate empty: expected error, got nil")
	}
}

func TestSudoTokenStore_Revoke(t *testing.T) {
	store := dbauth.NewSudoTokenStore(time.Minute)
	token, _, err := store.Mint("alice")
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if err := store.Validate(token, "alice"); err != nil {
		t.Fatalf("pre-revoke validate: %v", err)
	}
	if err := store.Revoke(token); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if err := store.Validate(token, "alice"); err == nil {
		t.Fatalf("post-revoke validate: expected error, got nil")
	}
	// Revoking an unknown token is a no-op.
	if err := store.Revoke("never-minted"); err != nil {
		t.Fatalf("revoke unknown: %v", err)
	}
	// Revoking empty token is a no-op.
	if err := store.Revoke(""); err != nil {
		t.Fatalf("revoke empty: %v", err)
	}
}

func TestSudoTokenStore_Sweep(t *testing.T) {
	store := dbauth.NewSudoTokenStore(50 * time.Millisecond)

	if _, _, err := store.Mint("alice"); err != nil {
		t.Fatalf("mint: %v", err)
	}
	if _, _, err := store.Mint("bob"); err != nil {
		t.Fatalf("mint: %v", err)
	}
	if got := store.Len(); got != 2 {
		t.Fatalf("len: got %d want 2", got)
	}

	time.Sleep(120 * time.Millisecond)
	if removed := store.Sweep(); removed != 2 {
		t.Fatalf("sweep: removed %d want 2", removed)
	}
	if got := store.Len(); got != 0 {
		t.Fatalf("len after sweep: got %d want 0", got)
	}
}

// --- RequireSudo middleware -----------------------------------------

func TestRequireSudo_OpenModePassthrough(t *testing.T) {
	store := dbauth.NewSudoTokenStore(time.Minute)
	mw := RequireSudo(store, SudoConfig{HeaderName: ""})
	called := false
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodDelete, "/x", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !called {
		t.Fatalf("open mode must passthrough")
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status: got %d want 204", rec.Code)
	}
}

func TestRequireSudo_NilStoreReturns500(t *testing.T) {
	mw := RequireSudo(nil, SudoConfig{HeaderName: testHeader})
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatalf("downstream handler must NOT be called when store is nil")
	}))
	req := httptest.NewRequest(http.MethodDelete, "/x", nil)
	req.Header.Set(testHeader, "alice")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: got %d want 500", rec.Code)
	}
}

func TestRequireSudo_MissingTokenReturns401WithCode(t *testing.T) {
	store := dbauth.NewSudoTokenStore(time.Minute)
	mw := RequireSudo(store, SudoConfig{HeaderName: testHeader})
	called := false
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
	}))
	req := httptest.NewRequest(http.MethodDelete, "/x", nil)
	req.Header.Set(testHeader, "alice")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if called {
		t.Fatalf("missing token must NOT invoke downstream handler")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d want 401", rec.Code)
	}
	_, code := decodeError(t, rec.Body.Bytes())
	if code != SudoRequiredCode {
		t.Fatalf("code: got %q want %q", code, SudoRequiredCode)
	}
}

func TestRequireSudo_MissingIdentityHeader(t *testing.T) {
	store := dbauth.NewSudoTokenStore(time.Minute)
	mw := RequireSudo(store, SudoConfig{HeaderName: testHeader})
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatalf("must not invoke downstream handler")
	}))
	req := httptest.NewRequest(http.MethodDelete, "/x", nil)
	// No identity header set — even with a valid token this fails closed.
	token, _, _ := store.Mint("alice")
	req.Header.Set("X-Sudo-Token", token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d want 401", rec.Code)
	}
	_, code := decodeError(t, rec.Body.Bytes())
	if code != SudoRequiredCode {
		t.Fatalf("code: got %q want %q", code, SudoRequiredCode)
	}
}

func TestRequireSudo_ValidTokenAllowsRequest(t *testing.T) {
	store := dbauth.NewSudoTokenStore(time.Minute)
	token, _, _ := store.Mint("alice")
	mw := RequireSudo(store, SudoConfig{HeaderName: testHeader})
	called := false
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodDelete, "/x", nil)
	req.Header.Set(testHeader, "alice")
	req.Header.Set("X-Sudo-Token", token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !called {
		t.Fatalf("valid token must invoke downstream handler")
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status: got %d want 204", rec.Code)
	}
}

func TestRequireSudo_TokenBoundToWrongSubject(t *testing.T) {
	store := dbauth.NewSudoTokenStore(time.Minute)
	token, _, _ := store.Mint("alice")
	mw := RequireSudo(store, SudoConfig{HeaderName: testHeader})
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatalf("cross-subject token must be rejected")
	}))
	req := httptest.NewRequest(http.MethodDelete, "/x", nil)
	req.Header.Set(testHeader, "mallory") // different user
	req.Header.Set("X-Sudo-Token", token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d want 401", rec.Code)
	}
	_, code := decodeError(t, rec.Body.Bytes())
	if code != SudoRequiredCode {
		t.Fatalf("code: got %q want %q", code, SudoRequiredCode)
	}
}

// --- /auth/reauth handler -------------------------------------------

func TestReauth_OpenModeReturnsModeOpenWithoutToken(t *testing.T) {
	h, _ := newTestSudoBundle(t, SudoConfig{HeaderName: "", PasswordHash: "secret"})
	rec := httptest.NewRecorder()
	req := newReauthRequest(t, "", "", reauthRequest{Password: "secret"})
	h.Reauth(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", rec.Code)
	}
	resp := decodeReauthOK(t, rec.Body.Bytes())
	if resp.Mode != "open" {
		t.Fatalf("mode: got %q want open", resp.Mode)
	}
	if resp.SudoToken != "" {
		t.Fatalf("open mode must not mint a token: got %q", resp.SudoToken)
	}
}

func TestReauth_NotConfiguredReturns503(t *testing.T) {
	h, _ := newTestSudoBundle(t, SudoConfig{
		HeaderName:   testHeader,
		PasswordHash: "",
		TOTPSecret:   "",
	})
	rec := httptest.NewRecorder()
	req := newReauthRequest(t, testHeader, "alice", reauthRequest{Password: "x"})
	h.Reauth(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d want 503", rec.Code)
	}
	_, code := decodeError(t, rec.Body.Bytes())
	if code != reauthNotConfiguredCode {
		t.Fatalf("code: got %q want %q", code, reauthNotConfiguredCode)
	}
}

func TestReauth_PasswordMintsToken(t *testing.T) {
	h, store := newTestSudoBundle(t, SudoConfig{
		HeaderName:   testHeader,
		PasswordHash: "correct horse battery staple",
		TTL:          time.Minute,
	})
	rec := httptest.NewRecorder()
	req := newReauthRequest(t, testHeader, "alice",
		reauthRequest{Password: "correct horse battery staple"})
	h.Reauth(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200; body=%s", rec.Code, rec.Body.String())
	}
	resp := decodeReauthOK(t, rec.Body.Bytes())
	if resp.SudoToken == "" {
		t.Fatalf("expected non-empty sudo_token")
	}
	if resp.ExpiresAt == "" {
		t.Fatalf("expected non-empty expires_at")
	}
	if err := store.Validate(resp.SudoToken, "alice"); err != nil {
		t.Fatalf("minted token must validate immediately: %v", err)
	}
}

func TestReauth_WrongPassword(t *testing.T) {
	h, _ := newTestSudoBundle(t, SudoConfig{
		HeaderName:   testHeader,
		PasswordHash: "right",
	})
	rec := httptest.NewRecorder()
	req := newReauthRequest(t, testHeader, "alice", reauthRequest{Password: "wrong"})
	h.Reauth(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d want 401", rec.Code)
	}
	_, code := decodeError(t, rec.Body.Bytes())
	if code != "INVALID_CREDENTIAL" {
		t.Fatalf("code: got %q want INVALID_CREDENTIAL", code)
	}
}

func TestReauth_TOTPMintsToken(t *testing.T) {
	h, store := newTestSudoBundle(t, SudoConfig{
		HeaderName: testHeader,
		TOTPSecret: "JBSWY3DPEHPK3PXP",
	})
	rec := httptest.NewRecorder()
	req := newReauthRequest(t, testHeader, "alice", reauthRequest{TOTPCode: "123456"})
	h.Reauth(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200; body=%s", rec.Code, rec.Body.String())
	}
	resp := decodeReauthOK(t, rec.Body.Bytes())
	if resp.SudoToken == "" {
		t.Fatalf("expected non-empty sudo_token")
	}
	if err := store.Validate(resp.SudoToken, "alice"); err != nil {
		t.Fatalf("minted token must validate immediately: %v", err)
	}
}

func TestReauth_RejectsBothCredentials(t *testing.T) {
	h, _ := newTestSudoBundle(t, SudoConfig{
		HeaderName:   testHeader,
		PasswordHash: "x",
		TOTPSecret:   "JBSWY3DPEHPK3PXP",
	})
	rec := httptest.NewRecorder()
	req := newReauthRequest(t, testHeader, "alice",
		reauthRequest{Password: "x", TOTPCode: "123456"})
	h.Reauth(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400", rec.Code)
	}
}

func TestReauth_RejectsEmptyBody(t *testing.T) {
	h, _ := newTestSudoBundle(t, SudoConfig{
		HeaderName:   testHeader,
		PasswordHash: "x",
	})
	rec := httptest.NewRecorder()
	req := newReauthRequest(t, testHeader, "alice", reauthRequest{})
	h.Reauth(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400", rec.Code)
	}
}

func TestReauth_MissingIdentityHeader(t *testing.T) {
	h, _ := newTestSudoBundle(t, SudoConfig{
		HeaderName:   testHeader,
		PasswordHash: "x",
	})
	rec := httptest.NewRecorder()
	// Build req without setting the identity header.
	body, _ := json.Marshal(reauthRequest{Password: "x"})
	req := httptest.NewRequest(http.MethodPost, "/auth/reauth", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	h.Reauth(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d want 401", rec.Code)
	}
}

func TestReauth_RejectsOversizeBody(t *testing.T) {
	h, _ := newTestSudoBundle(t, SudoConfig{
		HeaderName:   testHeader,
		PasswordHash: "x",
	})
	rec := httptest.NewRecorder()
	// 2KB body — exceeds the 1KB cap on decodeReauthBody.
	huge := strings.Repeat("a", 2048)
	body := []byte(`{"password":"` + huge + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/auth/reauth", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(testHeader, "alice")
	h.Reauth(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400", rec.Code)
	}
}

// --- helpers ---------------------------------------------------------
