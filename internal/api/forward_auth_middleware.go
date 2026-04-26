package api

import "net/http"

// ForwardAuthMiddleware checks for the presence of a header set by the
// reverse proxy's ForwardAuth provider (Authentik, Authelia, oauth2-proxy,
// Keycloak, etc.). If headerName is empty, returns a no-op passthrough
// (dev mode / no auth configured).
func ForwardAuthMiddleware(headerName string) func(http.Handler) http.Handler {
	if headerName == "" {
		return func(next http.Handler) http.Handler { return next }
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get(headerName) == "" {
				writeError(w, http.StatusUnauthorized, "unauthorized: missing auth header")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
