package api

import "net/http"

// SecurityHeadersMiddleware adds standard security headers to all HTTP responses.
// These headers protect against common web vulnerabilities including clickjacking,
// MIME-type sniffing, XSS, and protocol downgrade attacks.
func SecurityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Prevent MIME-type sniffing
		w.Header().Set("X-Content-Type-Options", "nosniff")

		// Prevent clickjacking — deny all framing
		w.Header().Set("X-Frame-Options", "DENY")

		// XSS filter for older browsers (modern browsers ignore this in favor of CSP)
		w.Header().Set("X-XSS-Protection", "1; mode=block")

		// HSTS: enforce HTTPS for 1 year (only effective when served over TLS)
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

		// Basic CSP: restrict to same-origin with allowances for inline styles
		// (needed by many React/CSS-in-JS setups). Tighten further in production
		// by adding specific font/image CDN domains and removing 'unsafe-inline'.
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'")

		// Control how much referrer info is sent with outgoing requests
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")

		// Prevent the browser from using features we don't need
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")

		next.ServeHTTP(w, r)
	})
}
