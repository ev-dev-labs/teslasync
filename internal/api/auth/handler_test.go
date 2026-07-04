// Unit tests for the Tesla OAuth handler.
//
// The handler talks to two ports: a tokenStore (token persistence) and a
// teslaAuthClient (Tesla OAuth). Both are faked here so the suite runs
// with no database, no network, and no real Tesla API — exercising every
// branch of Login, Callback, Refresh, Status, Disconnect, plus the
// generateState helper and the NewHandler constructor.
package auth

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	dbauth "github.com/ev-dev-labs/teslasync/internal/database/auth"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	authmodel "github.com/ev-dev-labs/teslasync/internal/models/auth"
	"github.com/ev-dev-labs/teslasync/internal/tesla"

	dto "github.com/prometheus/client_model/go"
)

// ── Test doubles ───────────────────────────────────────────────────────

// fakeTokenStore is an in-memory tokenStore. Zero value returns (nil, nil)
// from Get — i.e. "no account linked". Set the *Err fields to force error
// paths; the call counters let tests assert exactly which branches ran.
type fakeTokenStore struct {
	token *authmodel.Token

	getErr    error
	upsertErr error
	deleteErr error

	upserted    *authmodel.Token
	getCalls    int
	upsertCalls int
	deleteCalls int
}

func (f *fakeTokenStore) Get(context.Context) (*authmodel.Token, error) {
	f.getCalls++
	if f.getErr != nil {
		return nil, f.getErr
	}
	return f.token, nil
}

func (f *fakeTokenStore) Upsert(_ context.Context, t *authmodel.Token) error {
	f.upsertCalls++
	if f.upsertErr != nil {
		return f.upsertErr
	}
	f.upserted = t
	f.token = t
	return nil
}

func (f *fakeTokenStore) Delete(context.Context) error {
	f.deleteCalls++
	return f.deleteErr
}

// fakeTeslaClient is a teslaAuthClient that never touches the network. It
// records what it was asked to do so tests can assert the handler wired
// the code / context / tokens through correctly.
type fakeTeslaClient struct {
	authURL string

	exchangeResp *tesla.TokenResponse
	exchangeErr  error
	exchangeCode string
	exchangeCtx  context.Context
	exchangeCall int

	refreshResp *tesla.TokenResponse
	refreshErr  error
	refreshCtx  context.Context
	refreshCall int

	setCalls   int
	setAccess  string
	setRefresh string
	setExpiry  time.Time
}

func (f *fakeTeslaClient) GetAuthURL(state string) string {
	base := f.authURL
	if base == "" {
		base = "https://auth.tesla.com/oauth2/v3/authorize"
	}
	return base + "?state=" + state
}

func (f *fakeTeslaClient) ExchangeCode(ctx context.Context, code string) (*tesla.TokenResponse, error) {
	f.exchangeCall++
	f.exchangeCode = code
	f.exchangeCtx = ctx
	return f.exchangeResp, f.exchangeErr
}

func (f *fakeTeslaClient) RefreshTokens(ctx context.Context) (*tesla.TokenResponse, error) {
	f.refreshCall++
	f.refreshCtx = ctx
	return f.refreshResp, f.refreshErr
}

func (f *fakeTeslaClient) SetTokens(access, refresh string, expiresAt time.Time) {
	f.setCalls++
	f.setAccess = access
	f.setRefresh = refresh
	f.setExpiry = expiresAt
}

// ── Helpers ────────────────────────────────────────────────────────────

func newTestHandler(store tokenStore, client teslaAuthClient) *Handler {
	return &Handler{tokenRepo: store, teslaClient: client}
}

// counterValue reads the current scalar value of a prometheus Counter
// without pulling in the testutil package (which would add an indirect
// go-spew requirement to go.mod). Mirrors the repo's existing helper.
func counterValue(c interface {
	Write(*dto.Metric) error
}) float64 {
	pb := &dto.Metric{}
	if err := c.Write(pb); err != nil {
		return 0
	}
	return pb.GetCounter().GetValue()
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode body %q: %v", rec.Body.String(), err)
	}
	return m
}

// ── generateState ──────────────────────────────────────────────────────

func TestGenerateState(t *testing.T) {
	s1, err := generateState()
	if err != nil {
		t.Fatalf("generateState returned error: %v", err)
	}
	// 16 random bytes -> 32 hex characters.
	if len(s1) != 32 {
		t.Fatalf("state length = %d, want 32", len(s1))
	}
	if _, err := hex.DecodeString(s1); err != nil {
		t.Fatalf("state is not valid hex: %v", err)
	}
	s2, err := generateState()
	if err != nil {
		t.Fatalf("second generateState returned error: %v", err)
	}
	if s1 == s2 {
		t.Fatalf("expected distinct states across calls, both = %q", s1)
	}
}

// ── Login ──────────────────────────────────────────────────────────────

func TestLogin(t *testing.T) {
	client := &fakeTeslaClient{authURL: "https://auth.tesla.example/authorize"}
	h := newTestHandler(&fakeTokenStore{}, client)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
	h.Login(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("content-type = %q", ct)
	}
	body := decodeBody(t, rec)
	state, _ := body["state"].(string)
	if len(state) != 32 {
		t.Fatalf("state = %q, want 32 hex chars", state)
	}
	authURL, _ := body["auth_url"].(string)
	if !strings.HasPrefix(authURL, "https://auth.tesla.example/authorize?state=") {
		t.Fatalf("auth_url = %q, does not use client base URL", authURL)
	}
	if !strings.HasSuffix(authURL, state) {
		t.Fatalf("auth_url %q does not embed state %q", authURL, state)
	}
}

func TestLoginProducesUniqueStates(t *testing.T) {
	h := newTestHandler(&fakeTokenStore{}, &fakeTeslaClient{})

	states := make(map[string]struct{}, 5)
	for i := 0; i < 5; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/url", nil)
		h.Login(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("iteration %d status = %d", i, rec.Code)
		}
		s, _ := decodeBody(t, rec)["state"].(string)
		if _, dup := states[s]; dup {
			t.Fatalf("duplicate state %q on iteration %d", s, i)
		}
		states[s] = struct{}{}
	}
}

// ── Callback ───────────────────────────────────────────────────────────

func TestCallback(t *testing.T) {
	okResp := &tesla.TokenResponse{AccessToken: "acc", RefreshToken: "ref", ExpiresIn: 3600}

	tests := []struct {
		name         string
		query        string
		exchangeResp *tesla.TokenResponse
		exchangeErr  error
		upsertErr    error
		wantStatus   int
		wantCode     string // error `code` field, "" when N/A
		wantLocation string
		wantExchange int
		wantUpsert   int
	}{
		{
			name:         "missing code",
			query:        "",
			wantStatus:   http.StatusBadRequest,
			wantCode:     "BAD_REQUEST",
			wantExchange: 0,
			wantUpsert:   0,
		},
		{
			name:         "exchange error",
			query:        "code=abc",
			exchangeErr:  errors.New("upstream boom"),
			wantStatus:   http.StatusBadGateway,
			wantCode:     "ERROR", // HTTPStatusCode(502) has no dedicated code
			wantExchange: 1,
			wantUpsert:   0,
		},
		{
			name:         "nil response guard",
			query:        "code=abc",
			exchangeResp: nil, // and no error -> must not panic
			wantStatus:   http.StatusBadGateway,
			wantCode:     "ERROR",
			wantExchange: 1,
			wantUpsert:   0,
		},
		{
			name:         "upsert error",
			query:        "code=abc",
			exchangeResp: okResp,
			upsertErr:    errors.New("db down"),
			wantStatus:   http.StatusInternalServerError,
			wantCode:     "INTERNAL_ERROR",
			wantExchange: 1,
			wantUpsert:   1,
		},
		{
			name:         "success redirects",
			query:        "code=abc",
			exchangeResp: okResp,
			wantStatus:   http.StatusTemporaryRedirect,
			wantLocation: "/?auth=success",
			wantExchange: 1,
			wantUpsert:   1,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeTokenStore{upsertErr: tc.upsertErr}
			client := &fakeTeslaClient{exchangeResp: tc.exchangeResp, exchangeErr: tc.exchangeErr}
			h := newTestHandler(store, client)

			url := "/api/v1/auth/callback"
			if tc.query != "" {
				url += "?" + tc.query
			}
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, url, nil)
			h.Callback(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if tc.wantCode != "" {
				if got := decodeBody(t, rec)["code"]; got != tc.wantCode {
					t.Fatalf("error code = %v, want %s", got, tc.wantCode)
				}
			}
			if tc.wantLocation != "" {
				if loc := rec.Header().Get("Location"); loc != tc.wantLocation {
					t.Fatalf("Location = %q, want %q", loc, tc.wantLocation)
				}
			}
			if client.exchangeCall != tc.wantExchange {
				t.Fatalf("exchange calls = %d, want %d", client.exchangeCall, tc.wantExchange)
			}
			if store.upsertCalls != tc.wantUpsert {
				t.Fatalf("upsert calls = %d, want %d", store.upsertCalls, tc.wantUpsert)
			}
		})
	}
}

func TestCallbackPersistsTokenAndBoundsContext(t *testing.T) {
	store := &fakeTokenStore{}
	client := &fakeTeslaClient{
		exchangeResp: &tesla.TokenResponse{AccessToken: "acc-123", RefreshToken: "ref-456", ExpiresIn: 3600},
	}
	h := newTestHandler(store, client)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=the-code", nil)
	before := time.Now()
	h.Callback(rec, req)

	if client.exchangeCode != "the-code" {
		t.Fatalf("exchange got code %q, want the-code", client.exchangeCode)
	}
	if _, ok := client.exchangeCtx.Deadline(); !ok {
		t.Fatalf("expected ExchangeCode to receive a context with a deadline")
	}
	if store.upserted == nil {
		t.Fatalf("token was not persisted")
	}
	if store.upserted.AccessToken != "acc-123" || store.upserted.RefreshToken != "ref-456" {
		t.Fatalf("persisted token = %+v", store.upserted)
	}
	// ExpiresAt must be ~now+3600s (bounded by test wall-clock window).
	lo := before.Add(3600 * time.Second)
	hi := time.Now().Add(3601 * time.Second)
	if store.upserted.ExpiresAt.Before(lo) || store.upserted.ExpiresAt.After(hi) {
		t.Fatalf("ExpiresAt = %v, want within [%v, %v]", store.upserted.ExpiresAt, lo, hi)
	}
}

func TestCallbackMetrics(t *testing.T) {
	success := metrics.AuthAttempts.WithLabelValues("success")
	failure := metrics.AuthAttempts.WithLabelValues("failure")

	t.Run("success increments success counter", func(t *testing.T) {
		before := counterValue(success)
		h := newTestHandler(&fakeTokenStore{}, &fakeTeslaClient{
			exchangeResp: &tesla.TokenResponse{AccessToken: "a", ExpiresIn: 60},
		})
		rec := httptest.NewRecorder()
		h.Callback(rec, httptest.NewRequest(http.MethodGet, "/cb?code=x", nil))
		if got := counterValue(success) - before; got != 1 {
			t.Fatalf("success counter delta = %v, want 1", got)
		}
	})

	t.Run("error increments failure counter", func(t *testing.T) {
		before := counterValue(failure)
		h := newTestHandler(&fakeTokenStore{}, &fakeTeslaClient{exchangeErr: errors.New("boom")})
		rec := httptest.NewRecorder()
		h.Callback(rec, httptest.NewRequest(http.MethodGet, "/cb?code=x", nil))
		if got := counterValue(failure) - before; got != 1 {
			t.Fatalf("failure counter delta = %v, want 1", got)
		}
	})

	t.Run("nil response increments failure counter", func(t *testing.T) {
		before := counterValue(failure)
		h := newTestHandler(&fakeTokenStore{}, &fakeTeslaClient{}) // nil resp, nil err
		rec := httptest.NewRecorder()
		h.Callback(rec, httptest.NewRequest(http.MethodGet, "/cb?code=x", nil))
		if got := counterValue(failure) - before; got != 1 {
			t.Fatalf("failure counter delta = %v, want 1", got)
		}
	})
}

// ── Refresh ────────────────────────────────────────────────────────────

func TestRefresh(t *testing.T) {
	linked := &authmodel.Token{AccessToken: "old", RefreshToken: "oldref", ExpiresAt: time.Now()}
	okResp := &tesla.TokenResponse{AccessToken: "new", RefreshToken: "newref", ExpiresIn: 1800}

	tests := []struct {
		name        string
		existing    *authmodel.Token
		getErr      error
		refreshResp *tesla.TokenResponse
		refreshErr  error
		upsertErr   error
		wantStatus  int
		wantStatusB string // JSON "status" field, "" when N/A
		wantCode    string // error "code" field, "" when N/A
		wantRefresh int
		wantUpsert  int
	}{
		{
			name:       "get error",
			getErr:     errors.New("db down"),
			wantStatus: http.StatusInternalServerError,
			wantCode:   "INTERNAL_ERROR",
		},
		{
			name:        "no account linked returns noop",
			existing:    nil,
			wantStatus:  http.StatusOK,
			wantStatusB: "noop",
			wantRefresh: 0,
			wantUpsert:  0,
		},
		{
			name:        "refresh error",
			existing:    linked,
			refreshErr:  errors.New("upstream boom"),
			wantStatus:  http.StatusBadGateway,
			wantCode:    "ERROR", // HTTPStatusCode(502) has no dedicated code
			wantRefresh: 1,
			wantUpsert:  0,
		},
		{
			name:        "nil response guard",
			existing:    linked,
			refreshResp: nil,
			wantStatus:  http.StatusBadGateway,
			wantCode:    "ERROR",
			wantRefresh: 1,
			wantUpsert:  0,
		},
		{
			name:        "upsert error",
			existing:    linked,
			refreshResp: okResp,
			upsertErr:   errors.New("db down"),
			wantStatus:  http.StatusInternalServerError,
			wantCode:    "INTERNAL_ERROR",
			wantRefresh: 1,
			wantUpsert:  1,
		},
		{
			name:        "success",
			existing:    linked,
			refreshResp: okResp,
			wantStatus:  http.StatusOK,
			wantStatusB: "refreshed",
			wantRefresh: 1,
			wantUpsert:  1,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeTokenStore{token: tc.existing, getErr: tc.getErr, upsertErr: tc.upsertErr}
			client := &fakeTeslaClient{refreshResp: tc.refreshResp, refreshErr: tc.refreshErr}
			h := newTestHandler(store, client)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
			h.Refresh(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			body := decodeBody(t, rec)
			if tc.wantStatusB != "" {
				if got := body["status"]; got != tc.wantStatusB {
					t.Fatalf("status field = %v, want %s", got, tc.wantStatusB)
				}
			}
			if tc.wantCode != "" {
				if got := body["code"]; got != tc.wantCode {
					t.Fatalf("error code = %v, want %s", got, tc.wantCode)
				}
			}
			if client.refreshCall != tc.wantRefresh {
				t.Fatalf("refresh calls = %d, want %d", client.refreshCall, tc.wantRefresh)
			}
			if store.upsertCalls != tc.wantUpsert {
				t.Fatalf("upsert calls = %d, want %d", store.upsertCalls, tc.wantUpsert)
			}
		})
	}
}

func TestRefreshNoopReason(t *testing.T) {
	h := newTestHandler(&fakeTokenStore{token: nil}, &fakeTeslaClient{})
	rec := httptest.NewRecorder()
	h.Refresh(rec, httptest.NewRequest(http.MethodPost, "/refresh", nil))

	body := decodeBody(t, rec)
	if body["reason"] != "no tesla account linked" {
		t.Fatalf("reason = %v", body["reason"])
	}
}

func TestRefreshSuccessBoundsContextAndPersists(t *testing.T) {
	store := &fakeTokenStore{token: &authmodel.Token{AccessToken: "old"}}
	client := &fakeTeslaClient{
		refreshResp: &tesla.TokenResponse{AccessToken: "fresh", RefreshToken: "freshref", ExpiresIn: 900},
	}
	h := newTestHandler(store, client)

	rec := httptest.NewRecorder()
	h.Refresh(rec, httptest.NewRequest(http.MethodPost, "/refresh", nil))

	if _, ok := client.refreshCtx.Deadline(); !ok {
		t.Fatalf("expected RefreshTokens to receive a context with a deadline")
	}
	if store.upserted == nil || store.upserted.AccessToken != "fresh" {
		t.Fatalf("refreshed token not persisted: %+v", store.upserted)
	}
}

func TestRefreshMetrics(t *testing.T) {
	success := metrics.TokenRefreshes.WithLabelValues("success")
	failure := metrics.TokenRefreshes.WithLabelValues("failure")

	t.Run("success", func(t *testing.T) {
		before := counterValue(success)
		store := &fakeTokenStore{token: &authmodel.Token{AccessToken: "old"}}
		client := &fakeTeslaClient{refreshResp: &tesla.TokenResponse{AccessToken: "n", ExpiresIn: 60}}
		h := newTestHandler(store, client)
		h.Refresh(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/refresh", nil))
		if got := counterValue(success) - before; got != 1 {
			t.Fatalf("success delta = %v, want 1", got)
		}
	})

	t.Run("failure", func(t *testing.T) {
		before := counterValue(failure)
		store := &fakeTokenStore{token: &authmodel.Token{AccessToken: "old"}}
		client := &fakeTeslaClient{refreshErr: errors.New("boom")}
		h := newTestHandler(store, client)
		h.Refresh(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/refresh", nil))
		if got := counterValue(failure) - before; got != 1 {
			t.Fatalf("failure delta = %v, want 1", got)
		}
	})

	t.Run("noop does not move counters", func(t *testing.T) {
		s0, f0 := counterValue(success), counterValue(failure)
		h := newTestHandler(&fakeTokenStore{token: nil}, &fakeTeslaClient{})
		h.Refresh(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/refresh", nil))
		if counterValue(success) != s0 || counterValue(failure) != f0 {
			t.Fatalf("noop path must not touch refresh counters")
		}
	})
}

// ── Status ─────────────────────────────────────────────────────────────

func TestStatus(t *testing.T) {
	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)

	tests := []struct {
		name          string
		token         *authmodel.Token
		getErr        error
		wantStatus    int
		wantAuth      any  // expected "authenticated" field; nil = don't check
		wantExpired   bool // only checked when authenticated
		checkExpired  bool
		wantErrorCode string
	}{
		{
			name:          "get error",
			getErr:        errors.New("db down"),
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
		{
			name:       "no token -> unauthenticated",
			token:      nil,
			wantStatus: http.StatusOK,
			wantAuth:   false,
		},
		{
			name:         "valid token -> authenticated not expired",
			token:        &authmodel.Token{AccessToken: "a", ExpiresAt: future},
			wantStatus:   http.StatusOK,
			wantAuth:     true,
			wantExpired:  false,
			checkExpired: true,
		},
		{
			name:         "stale token -> authenticated expired",
			token:        &authmodel.Token{AccessToken: "a", ExpiresAt: past},
			wantStatus:   http.StatusOK,
			wantAuth:     true,
			wantExpired:  true,
			checkExpired: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeTokenStore{token: tc.token, getErr: tc.getErr}
			h := newTestHandler(store, &fakeTeslaClient{})

			rec := httptest.NewRecorder()
			h.Status(rec, httptest.NewRequest(http.MethodGet, "/api/v1/auth/status", nil))

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			body := decodeBody(t, rec)
			if tc.wantErrorCode != "" {
				if got := body["code"]; got != tc.wantErrorCode {
					t.Fatalf("error code = %v, want %s", got, tc.wantErrorCode)
				}
				return
			}
			if tc.wantAuth != nil {
				if body["authenticated"] != tc.wantAuth {
					t.Fatalf("authenticated = %v, want %v", body["authenticated"], tc.wantAuth)
				}
			}
			if tc.checkExpired {
				if body["expired"] != tc.wantExpired {
					t.Fatalf("expired = %v, want %v", body["expired"], tc.wantExpired)
				}
				if _, ok := body["expires_at"]; !ok {
					t.Fatalf("authenticated response must include expires_at")
				}
			}
		})
	}
}

// ── Disconnect ─────────────────────────────────────────────────────────

func TestDisconnect(t *testing.T) {
	tests := []struct {
		name        string
		deleteErr   error
		wantStatus  int
		wantStatusB string
		wantCode    string
		wantSet     int
	}{
		{
			name:       "delete error",
			deleteErr:  errors.New("db down"),
			wantStatus: http.StatusInternalServerError,
			wantCode:   "INTERNAL_ERROR",
			wantSet:    0,
		},
		{
			name:        "success clears tokens",
			wantStatus:  http.StatusOK,
			wantStatusB: "disconnected",
			wantSet:     1,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeTokenStore{deleteErr: tc.deleteErr}
			client := &fakeTeslaClient{}
			h := newTestHandler(store, client)

			rec := httptest.NewRecorder()
			h.Disconnect(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/disconnect", nil))

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			body := decodeBody(t, rec)
			if tc.wantStatusB != "" && body["status"] != tc.wantStatusB {
				t.Fatalf("status field = %v, want %s", body["status"], tc.wantStatusB)
			}
			if tc.wantCode != "" && body["code"] != tc.wantCode {
				t.Fatalf("error code = %v, want %s", body["code"], tc.wantCode)
			}
			if store.deleteCalls != 1 {
				t.Fatalf("Delete calls = %d, want 1", store.deleteCalls)
			}
			if client.setCalls != tc.wantSet {
				t.Fatalf("SetTokens calls = %d, want %d", client.setCalls, tc.wantSet)
			}
			if tc.wantSet == 1 {
				if client.setAccess != "" || client.setRefresh != "" || !client.setExpiry.IsZero() {
					t.Fatalf("SetTokens should clear credentials, got acc=%q ref=%q exp=%v",
						client.setAccess, client.setRefresh, client.setExpiry)
				}
			}
		})
	}
}

// ── NewHandler ─────────────────────────────────────────────────────────

func TestNewHandler(t *testing.T) {
	// Both the zero-encryptor and explicit-encryptor variadic branches
	// must wire a concrete *dbauth.TokenRepo as the token store. Passing
	// nil dependencies is safe: no I/O happens at construction time.
	cases := []struct {
		name string
		h    *Handler
	}{
		{"no encryptor", NewHandler(nil, nil)},
		{"nil encryptor arg", NewHandler(nil, nil, nil)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.h == nil {
				t.Fatal("NewHandler returned nil")
			}
			if tc.h.tokenRepo == nil {
				t.Fatal("tokenRepo not wired")
			}
			if _, ok := tc.h.tokenRepo.(*dbauth.TokenRepo); !ok {
				t.Fatalf("tokenRepo = %T, want *dbauth.TokenRepo", tc.h.tokenRepo)
			}
		})
	}
}
