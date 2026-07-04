package user

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fixedClock returns a deterministic time source for expiry testing.
func fixedClock(t time.Time) func() time.Time {
	return func() time.Time { return t }
}

// newTestHandler builds a Handler with a known secret and a frozen clock.
// db is nil because no handler method dereferences it.
func newTestHandler(secret string, now time.Time) *Handler {
	h := NewHandler(nil, secret)
	h.now = fixedClock(now)
	return h
}

// decodeBody unmarshals a JSON response body into the supplied target.
func decodeBody(t *testing.T, rec *httptest.ResponseRecorder, v interface{}) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), v); err != nil {
		t.Fatalf("decode body: %v; raw=%s", err, rec.Body.String())
	}
}

func TestNewHandler(t *testing.T) {
	t.Run("uses provided secret verbatim", func(t *testing.T) {
		h := NewHandler(nil, "my-secret")
		if string(h.jwtSecret) != "my-secret" {
			t.Fatalf("jwtSecret = %q, want my-secret", string(h.jwtSecret))
		}
		if h.now == nil {
			t.Fatal("now must be initialised to a non-nil clock")
		}
	})

	t.Run("generates random 32-byte secret when empty", func(t *testing.T) {
		h := NewHandler(nil, "")
		if len(h.jwtSecret) != 32 {
			t.Fatalf("generated secret len = %d, want 32", len(h.jwtSecret))
		}
		allZero := true
		for _, b := range h.jwtSecret {
			if b != 0 {
				allZero = false
				break
			}
		}
		if allZero {
			t.Fatal("generated secret is all zero bytes — rand.Read not applied")
		}
	})

	t.Run("random secrets differ between constructions", func(t *testing.T) {
		a := NewHandler(nil, "")
		b := NewHandler(nil, "")
		if string(a.jwtSecret) == string(b.jwtSecret) {
			t.Fatal("two empty-secret handlers produced identical secrets")
		}
	})
}

func TestClockFallback(t *testing.T) {
	// A zero-value Handler (constructed without NewHandler) must not panic
	// and must fall back to a live clock.
	h := &Handler{}
	got := h.clock()
	if time.Since(got) > time.Minute || time.Since(got) < -time.Minute {
		t.Fatalf("clock() fallback returned implausible time: %v", got)
	}
}

func TestSignVerifyRoundTrip(t *testing.T) {
	now := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	h := newTestHandler("round-trip-secret", now)

	tests := []struct {
		name   string
		claims userClaims
	}{
		{"admin", userClaims{UserID: 1, Username: "admin", Role: "admin", Exp: now.Add(time.Hour).Unix()}},
		{"viewer role", userClaims{UserID: 42, Username: "bob", Role: "viewer", Exp: now.Add(24 * time.Hour).Unix()}},
		{"zero user id", userClaims{UserID: 0, Username: "", Role: "", Exp: now.Add(time.Minute).Unix()}},
		{"unicode username", userClaims{UserID: 7, Username: "أحمد-李", Role: "admin", Exp: now.Add(time.Hour).Unix()}},
		{"negative user id", userClaims{UserID: -5, Username: "svc", Role: "system", Exp: now.Add(time.Hour).Unix()}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token, err := h.signToken(tt.claims)
			if err != nil {
				t.Fatalf("signToken: %v", err)
			}
			if strings.Count(token, ".") != 1 {
				t.Fatalf("token must contain exactly one '.', got %q", token)
			}
			got, err := h.verifyToken(token)
			if err != nil {
				t.Fatalf("verifyToken: %v", err)
			}
			if *got != tt.claims {
				t.Fatalf("round-trip mismatch:\n got  %+v\n want %+v", *got, tt.claims)
			}
		})
	}
}

func TestVerifyTokenErrors(t *testing.T) {
	now := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)
	h := newTestHandler("verify-secret", now)

	// Helper to sign an arbitrary payload string with the handler's key,
	// producing a token whose signature is valid but whose payload is
	// crafted to trip a later decode/unmarshal branch.
	tokenForPayload := func(payloadB64 string) string {
		return payloadB64 + "." + h.hmacSign(payloadB64)
	}

	validFuture := userClaims{UserID: 1, Username: "admin", Role: "admin", Exp: now.Add(time.Hour).Unix()}
	validToken, err := h.signToken(validFuture)
	if err != nil {
		t.Fatalf("setup signToken: %v", err)
	}

	tests := []struct {
		name    string
		token   string
		wantErr string
	}{
		{"empty string", "", "malformed token"},
		{"no separator", "abcdef", "malformed token"},
		{"tampered signature", strings.Split(validToken, ".")[0] + ".deadbeef", "invalid signature"},
		{
			"tampered payload keeps old sig",
			base64.RawURLEncoding.EncodeToString([]byte(`{"user_id":999}`)) + "." + strings.Split(validToken, ".")[1],
			"invalid signature",
		},
		{"valid sig but non-base64 payload", tokenForPayload("!!!not-base64!!!"), "decode payload"},
		{"valid sig but invalid json", tokenForPayload(base64.RawURLEncoding.EncodeToString([]byte("not-json"))), "unmarshal claims"},
		{
			"expired token",
			mustSign(t, h, userClaims{UserID: 1, Username: "admin", Role: "admin", Exp: now.Add(-time.Second).Unix()}),
			"token expired",
		},
		{
			"missing exp treated as expired",
			mustSign(t, h, userClaims{UserID: 1, Username: "admin", Role: "admin"}),
			"token expired",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			claims, err := h.verifyToken(tt.token)
			if err == nil {
				t.Fatalf("expected error containing %q, got nil (claims=%+v)", tt.wantErr, claims)
			}
			if claims != nil {
				t.Fatalf("claims must be nil on error, got %+v", claims)
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %q, want substring %q", err.Error(), tt.wantErr)
			}
		})
	}
}

func TestVerifyTokenWrongSecret(t *testing.T) {
	now := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)
	signer := newTestHandler("secret-A", now)
	verifier := newTestHandler("secret-B", now)

	token, err := signer.signToken(userClaims{UserID: 1, Username: "admin", Role: "admin", Exp: now.Add(time.Hour).Unix()})
	if err != nil {
		t.Fatalf("signToken: %v", err)
	}
	if _, err := verifier.verifyToken(token); err == nil {
		t.Fatal("token signed with secret-A must not verify under secret-B")
	}
}

func TestVerifyTokenExpiryBoundary(t *testing.T) {
	base := time.Date(2025, 3, 3, 8, 0, 0, 0, time.UTC)
	h := newTestHandler("boundary-secret", base)

	tests := []struct {
		name    string
		exp     int64
		wantErr bool
	}{
		{"exp equals now is still valid", base.Unix(), false},
		{"exp one second ahead valid", base.Add(time.Second).Unix(), false},
		{"exp one second behind expired", base.Add(-time.Second).Unix(), true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token := mustSign(t, h, userClaims{UserID: 1, Username: "admin", Role: "admin", Exp: tt.exp})
			_, err := h.verifyToken(token)
			if tt.wantErr && err == nil {
				t.Fatalf("exp=%d: expected expiry error, got nil", tt.exp)
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("exp=%d: unexpected error: %v", tt.exp, err)
			}
		})
	}
}

func TestHMACSign(t *testing.T) {
	h1 := NewHandler(nil, "secret-one")
	h2 := NewHandler(nil, "secret-two")

	t.Run("deterministic for same input+secret", func(t *testing.T) {
		if h1.hmacSign("payload") != h1.hmacSign("payload") {
			t.Fatal("hmacSign not deterministic for identical input")
		}
	})
	t.Run("differs by input", func(t *testing.T) {
		if h1.hmacSign("a") == h1.hmacSign("b") {
			t.Fatal("hmacSign collision for different inputs")
		}
	})
	t.Run("differs by secret", func(t *testing.T) {
		if h1.hmacSign("payload") == h2.hmacSign("payload") {
			t.Fatal("hmacSign identical across different secrets")
		}
	})
	t.Run("output is url-safe base64", func(t *testing.T) {
		sig := h1.hmacSign("payload")
		if _, err := base64.RawURLEncoding.DecodeString(sig); err != nil {
			t.Fatalf("signature not RawURLEncoding base64: %v", err)
		}
	})
}

type loginResponse struct {
	Token   string    `json:"token"`
	User    string    `json:"user"`
	Role    string    `json:"role"`
	Expires time.Time `json:"expires"`
}

func TestLogin(t *testing.T) {
	now := time.Date(2025, 2, 2, 10, 0, 0, 0, time.UTC)

	tests := []struct {
		name       string
		body       string
		wantStatus int
		wantErrMsg string // expected error message when non-2xx
	}{
		{"admin any password", `{"username":"admin","password":"anything"}`, http.StatusOK, ""},
		{"admin empty password", `{"username":"admin","password":""}`, http.StatusOK, ""},
		{"non-admin rejected", `{"username":"bob","password":"x"}`, http.StatusUnauthorized, "invalid credentials"},
		{"empty username rejected", `{"username":"","password":"x"}`, http.StatusUnauthorized, "invalid credentials"},
		{"malformed json", `{not-json`, http.StatusBadRequest, "invalid request body"},
		{"empty body", ``, http.StatusBadRequest, "invalid request body"},
		{"wrong types", `{"username":123}`, http.StatusBadRequest, "invalid request body"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHandler("login-secret", now)
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/user/login", strings.NewReader(tt.body))
			h.Login(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus != http.StatusOK {
				var errBody map[string]string
				decodeBody(t, rec, &errBody)
				if errBody["error"] != tt.wantErrMsg {
					t.Fatalf("error = %q, want %q", errBody["error"], tt.wantErrMsg)
				}
				return
			}

			var body loginResponse
			decodeBody(t, rec, &body)
			if body.User != "admin" || body.Role != "admin" {
				t.Fatalf("user/role = %q/%q, want admin/admin", body.User, body.Role)
			}
			if body.Token == "" {
				t.Fatal("token must be non-empty on success")
			}
			// Expiry must be exactly 24h from the frozen clock.
			wantExp := now.Add(24 * time.Hour)
			if !body.Expires.Equal(wantExp) {
				t.Fatalf("expires = %v, want %v", body.Expires, wantExp)
			}
			// The issued token must verify to admin claims.
			claims, err := h.verifyToken(body.Token)
			if err != nil {
				t.Fatalf("issued token failed verification: %v", err)
			}
			if claims.UserID != 1 || claims.Username != "admin" || claims.Role != "admin" {
				t.Fatalf("token claims = %+v, want admin", claims)
			}
			if claims.Exp != wantExp.Unix() {
				t.Fatalf("token exp = %d, want %d", claims.Exp, wantExp.Unix())
			}
		})
	}
}

func TestMe(t *testing.T) {
	h := NewHandler(nil, "me-secret")

	tests := []struct {
		name         string
		ctxValue     interface{}
		setValue     bool
		wantAuthed   bool
		wantUserID   float64 // JSON numbers decode to float64
		wantUsername string
		wantRole     string
	}{
		{
			name:         "authenticated claims present",
			ctxValue:     &userClaims{UserID: 1, Username: "admin", Role: "admin"},
			setValue:     true,
			wantAuthed:   true,
			wantUserID:   1,
			wantUsername: "admin",
			wantRole:     "admin",
		},
		{
			name:       "no claims in context",
			setValue:   false,
			wantAuthed: false,
		},
		{
			name:       "wrong type in context",
			ctxValue:   "not-claims",
			setValue:   true,
			wantAuthed: false,
		},
		{
			name:       "value not pointer in context",
			ctxValue:   userClaims{UserID: 9, Username: "x"},
			setValue:   true,
			wantAuthed: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/user/me", nil)
			if tt.setValue {
				ctx := context.WithValue(req.Context(), userContextKey, tt.ctxValue)
				req = req.WithContext(ctx)
			}
			h.Me(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			var body map[string]interface{}
			decodeBody(t, rec, &body)

			authed, _ := body["authenticated"].(bool)
			if authed != tt.wantAuthed {
				t.Fatalf("authenticated = %v, want %v", authed, tt.wantAuthed)
			}
			if !tt.wantAuthed {
				if _, ok := body["user_id"]; ok {
					t.Fatalf("unauthenticated response must omit user_id, got %+v", body)
				}
				return
			}
			if got, _ := body["user_id"].(float64); got != tt.wantUserID {
				t.Fatalf("user_id = %v, want %v", body["user_id"], tt.wantUserID)
			}
			if got, _ := body["username"].(string); got != tt.wantUsername {
				t.Fatalf("username = %v, want %v", body["username"], tt.wantUsername)
			}
			if got, _ := body["role"].(string); got != tt.wantRole {
				t.Fatalf("role = %v, want %v", body["role"], tt.wantRole)
			}
		})
	}
}

func TestAuthMiddleware(t *testing.T) {
	now := time.Date(2025, 4, 4, 9, 0, 0, 0, time.UTC)
	h := newTestHandler("mw-secret", now)

	validToken := mustSign(t, h, userClaims{UserID: 1, Username: "admin", Role: "admin", Exp: now.Add(time.Hour).Unix()})
	expiredToken := mustSign(t, h, userClaims{UserID: 1, Username: "admin", Role: "admin", Exp: now.Add(-time.Hour).Unix()})

	tests := []struct {
		name       string
		authHeader string
		setHeader  bool
		wantStatus int
		wantNext   bool
		wantErrMsg string
	}{
		{"valid token", "Bearer " + validToken, true, http.StatusOK, true, ""},
		{"missing header", "", false, http.StatusUnauthorized, false, "missing or invalid authorization header"},
		{"empty header value", "", true, http.StatusUnauthorized, false, "missing or invalid authorization header"},
		{"wrong scheme", "Basic abc123", true, http.StatusUnauthorized, false, "missing or invalid authorization header"},
		{"lowercase bearer", "bearer " + validToken, true, http.StatusUnauthorized, false, "missing or invalid authorization header"},
		{"bearer no token", "Bearer ", true, http.StatusUnauthorized, false, "invalid or expired token"},
		{"invalid token", "Bearer garbage.sig", true, http.StatusUnauthorized, false, "invalid or expired token"},
		{"expired token", "Bearer " + expiredToken, true, http.StatusUnauthorized, false, "invalid or expired token"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			nextCalled := false
			var gotClaims *userClaims
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				nextCalled = true
				if c, ok := r.Context().Value(userContextKey).(*userClaims); ok {
					gotClaims = c
				}
				w.WriteHeader(http.StatusOK)
			})

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/protected", nil)
			if tt.setHeader {
				req.Header.Set("Authorization", tt.authHeader)
			}
			h.AuthMiddleware(next).ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if nextCalled != tt.wantNext {
				t.Fatalf("nextCalled = %v, want %v", nextCalled, tt.wantNext)
			}
			if tt.wantNext {
				if gotClaims == nil || gotClaims.Username != "admin" {
					t.Fatalf("claims not propagated to next handler: %+v", gotClaims)
				}
				return
			}
			var errBody map[string]string
			decodeBody(t, rec, &errBody)
			if errBody["error"] != tt.wantErrMsg {
				t.Fatalf("error = %q, want %q", errBody["error"], tt.wantErrMsg)
			}
		})
	}
}

func TestOptionalAuthMiddleware(t *testing.T) {
	now := time.Date(2025, 5, 5, 11, 0, 0, 0, time.UTC)
	h := newTestHandler("opt-secret", now)

	validToken := mustSign(t, h, userClaims{UserID: 1, Username: "admin", Role: "admin", Exp: now.Add(time.Hour).Unix()})
	expiredToken := mustSign(t, h, userClaims{UserID: 1, Username: "admin", Role: "admin", Exp: now.Add(-time.Hour).Unix()})

	tests := []struct {
		name       string
		authHeader string
		setHeader  bool
		wantClaims bool
	}{
		{"valid token attaches claims", "Bearer " + validToken, true, true},
		{"no header passes through", "", false, false},
		{"wrong scheme passes through", "Basic xxx", true, false},
		{"invalid token passes through", "Bearer bad.token", true, false},
		{"expired token passes through", "Bearer " + expiredToken, true, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			nextCalled := false
			var gotClaims *userClaims
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				nextCalled = true
				if c, ok := r.Context().Value(userContextKey).(*userClaims); ok {
					gotClaims = c
				}
				w.WriteHeader(http.StatusOK)
			})

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/maybe-protected", nil)
			if tt.setHeader {
				req.Header.Set("Authorization", tt.authHeader)
			}
			h.OptionalAuthMiddleware(next).ServeHTTP(rec, req)

			// Optional middleware must NEVER reject the request.
			if !nextCalled {
				t.Fatal("optional middleware must always call next")
			}
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (optional never rejects)", rec.Code)
			}
			if tt.wantClaims && (gotClaims == nil || gotClaims.Username != "admin") {
				t.Fatalf("expected claims to be attached, got %+v", gotClaims)
			}
			if !tt.wantClaims && gotClaims != nil {
				t.Fatalf("expected no claims, got %+v", gotClaims)
			}
		})
	}
}

// TestLoginToMeEndToEnd exercises the full flow: obtain a token via Login,
// present it through AuthMiddleware, and confirm Me reports the admin.
func TestLoginToMeEndToEnd(t *testing.T) {
	now := time.Date(2025, 7, 7, 7, 0, 0, 0, time.UTC)
	h := newTestHandler("e2e-secret", now)

	// 1. Login.
	loginRec := httptest.NewRecorder()
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/user/login", strings.NewReader(`{"username":"admin","password":"pw"}`))
	h.Login(loginRec, loginReq)
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login status = %d, want 200", loginRec.Code)
	}
	var login loginResponse
	decodeBody(t, loginRec, &login)

	// 2. Call Me behind AuthMiddleware with the issued token.
	meRec := httptest.NewRecorder()
	meReq := httptest.NewRequest(http.MethodGet, "/api/v1/user/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+login.Token)
	h.AuthMiddleware(http.HandlerFunc(h.Me)).ServeHTTP(meRec, meReq)

	if meRec.Code != http.StatusOK {
		t.Fatalf("me status = %d, want 200; body=%s", meRec.Code, meRec.Body.String())
	}
	var me map[string]interface{}
	decodeBody(t, meRec, &me)
	if authed, _ := me["authenticated"].(bool); !authed {
		t.Fatalf("expected authenticated=true, got %+v", me)
	}
	if uname, _ := me["username"].(string); uname != "admin" {
		t.Fatalf("username = %v, want admin", me["username"])
	}
}

// mustSign signs claims or fails the test.
func mustSign(t *testing.T, h *Handler, c userClaims) string {
	t.Helper()
	token, err := h.signToken(c)
	if err != nil {
		t.Fatalf("signToken: %v", err)
	}
	return token
}
