package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

type contextKey string

const userContextKey contextKey = "user"

// UserClaims represents the authenticated user extracted from a JWT.
type UserClaims struct {
	UserID string
	Email  string
}

// UserFromContext extracts user claims from the request context.
func UserFromContext(ctx context.Context) (*UserClaims, bool) {
	claims, ok := ctx.Value(userContextKey).(*UserClaims)
	return claims, ok
}

// Auth returns a middleware that validates JWT tokens.
// If validateFn is nil, only checks for the presence of the Authorization header.
func Auth(validateFn func(token string) (*UserClaims, error)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				httputil.RespondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authorization header")
				return
			}

			token := strings.TrimPrefix(authHeader, "Bearer ")
			if token == authHeader {
				httputil.RespondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid authorization format")
				return
			}

			if validateFn != nil {
				claims, err := validateFn(token)
				if err != nil {
					httputil.RespondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid token")
					return
				}
				ctx := context.WithValue(r.Context(), userContextKey, claims)
				r = r.WithContext(ctx)
			}

			next.ServeHTTP(w, r)
		})
	}
}
