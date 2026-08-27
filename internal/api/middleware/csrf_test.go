package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCSRFProtection(t *testing.T) {
	handler := CSRFProtectionWithOptions(CSRFOptions{
		AllowedOrigins:       []string{"https://app.example.test:8443"},
		AllowLoopbackOrigins: true,
	})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	tests := []struct {
		name        string
		method      string
		origin      string
		fetchSite   string
		host        string
		spoofedHost string
		wantStatus  int
	}{
		{
			name:       "same direct compose origin with port passes",
			method:     http.MethodPost,
			origin:     "http://localhost:3000",
			host:       "localhost:3000",
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "vite proxy changeOrigin localhost passes",
			method:     http.MethodPost,
			origin:     "http://localhost:5173",
			host:       "teslasync-api:8080",
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "configured helm non standard tls origin passes",
			method:     http.MethodPut,
			origin:     "https://app.example.test:8443",
			host:       "teslasync-api:8080",
			wantStatus: http.StatusNoContent,
		},
		{
			name:        "cross origin is rejected despite spoofed forwarded authority",
			method:      http.MethodDelete,
			origin:      "https://attacker.example.test",
			host:        "teslasync-api:8080",
			spoofedHost: "attacker.example.test",
			wantStatus:  http.StatusForbidden,
		},
		{
			name:       "cross site request without origin is rejected",
			method:     http.MethodPatch,
			fetchSite:  "cross-site",
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "non browser client without provenance passes",
			method:     http.MethodPut,
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "safe method bypasses origin check",
			method:     http.MethodGet,
			origin:     "https://attacker.example.test",
			host:       "teslasync-api:8080",
			wantStatus: http.StatusNoContent,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "http://app.example.test/api/v1/settings", nil)
			req.Host = tt.host
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			if tt.fetchSite != "" {
				req.Header.Set("Sec-Fetch-Site", tt.fetchSite)
			}
			if tt.spoofedHost != "" {
				req.Header.Set("X-Forwarded-Host", tt.spoofedHost)
				req.Header.Set("X-Forwarded-Proto", "https")
			}
			res := httptest.NewRecorder()

			handler.ServeHTTP(res, req)

			if res.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", res.Code, tt.wantStatus, res.Body.String())
			}
			if tt.wantStatus == http.StatusForbidden && res.Header().Get("Content-Type") != "application/json" {
				t.Fatalf("content type = %q, want application/json", res.Header().Get("Content-Type"))
			}
		})
	}
}

func TestCSRFProtection_PublicRoutesRemainOutsideProtectedGroup(t *testing.T) {
	router := http.NewServeMux()
	router.HandleFunc("/api/v1/web-vitals", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	router.Handle("/api/v1/settings", CSRFProtection(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))

	for _, path := range []string{"/api/v1/web-vitals", "/api/v1/settings"} {
		req := httptest.NewRequest(http.MethodPost, path, nil)
		req.Header.Set("Origin", "https://attacker.example.test")
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if path == "/api/v1/web-vitals" && res.Code != http.StatusNoContent {
			t.Errorf("public route status = %d, want %d", res.Code, http.StatusNoContent)
		}
		if path == "/api/v1/settings" && res.Code != http.StatusForbidden {
			t.Errorf("protected route status = %d, want %d", res.Code, http.StatusForbidden)
		}
	}
}

func TestParseAllowedOrigins(t *testing.T) {
	got := ParseAllowedOrigins("https://app.example.test:8443, *, invalid", "http://localhost:3000/")
	want := []string{"https://app.example.test:8443", "http://localhost:3000"}
	if len(got) != len(want) {
		t.Fatalf("origins = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("origin[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}
