package middleware

import "net/http"

const apiContentSecurityPolicy = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"

// SecurityHeaders adds baseline browser hardening headers to every API
// response. HSTS deliberately belongs at the TLS-terminating ingress, not at
// the API process, which can also be reached over trusted cluster HTTP.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		// Modern browsers rely on CSP instead of the retired XSS filter.
		w.Header().Set("X-XSS-Protection", "0")
		w.Header().Set("Content-Security-Policy", apiContentSecurityPolicy)
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy",
			"accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()")

		next.ServeHTTP(w, r)
	})
}
