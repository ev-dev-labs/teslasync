package api

import (
	"net/http"
	"strings"
)

// ForwardAuthMiddleware checks for the presence of a header set by the
// reverse proxy's ForwardAuth provider (Authentik, Authelia, oauth2-proxy,
// Keycloak, etc.). If headerName is empty, returns a no-op passthrough
// (dev mode / no auth configured).
func ForwardAuthMiddleware(headerName string) func(http.Handler) http.Handler {
	headerName = strings.TrimSpace(headerName)
	if headerName == "" {
		return func(next http.Handler) http.Handler { return next }
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.TrimSpace(r.Header.Get(headerName)) == "" {
				writeError(w, http.StatusUnauthorized, "unauthorized: missing auth header")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
