package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/cors"
)

func TestNativeAppCORSPreflightAllowsSudoReplayWithoutOpeningOrigins(t *testing.T) {
	handler := cors.Handler(cors.Options{
		AllowedOrigins: []string{"teslasync-app://app"},
		AllowedMethods: []string{http.MethodDelete, http.MethodOptions},
		AllowedHeaders: nativeAppCORSHeaders,
	})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	for _, origin := range []string{"teslasync-app://app", "https://untrusted.example.com"} {
		req := httptest.NewRequest(http.MethodOptions, "/api/v1/api-keys/42", nil)
		req.Header.Set("Origin", origin)
		req.Header.Set("Access-Control-Request-Method", http.MethodDelete)
		req.Header.Set("Access-Control-Request-Headers", "authorization,x-sudo-token,x-teslasync-app")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		allowed := rec.Header().Get("Access-Control-Allow-Origin")
		if origin != "teslasync-app://app" {
			if allowed != "" {
				t.Errorf("untrusted origin was allowed: %q", allowed)
			}
			continue
		}
		if allowed != origin {
			t.Errorf("native origin=%q, want %q", allowed, origin)
		}
		headers := strings.ToLower(rec.Header().Get("Access-Control-Allow-Headers"))
		for _, name := range []string{"authorization", "x-sudo-token", "x-teslasync-app"} {
			if !strings.Contains(headers, name) {
				t.Errorf("native preflight omitted %q: %q", name, headers)
			}
		}
	}
}
