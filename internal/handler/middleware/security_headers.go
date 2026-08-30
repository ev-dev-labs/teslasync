package middleware

import "net/http"

const apiContentSecurityPolicy = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"

// SecurityHeaders returns middleware that sets security-related HTTP headers
// for API responses. HSTS is set by the TLS-terminating ingress rather than
// by a backend that also serves trusted cluster HTTP.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "0")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Content-Security-Policy", apiContentSecurityPolicy)
		w.Header().Set("Permissions-Policy",
			"accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()")

		next.ServeHTTP(w, r)
	})
}
