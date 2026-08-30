package middleware

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
)

// CSRFRejectedCode is the stable machine-readable error returned when a
// browser-originated unsafe request does not prove same-origin intent.
const CSRFRejectedCode = "CSRF_REJECTED"

// CSRFOptions describes the origins that can submit browser mutations. Under a
// TLS-terminating proxy, AllowedOrigins is authoritative; forwarded host and
// scheme headers are intentionally never used as client identity.
type CSRFOptions struct {
	AllowedOrigins       []string
	AllowLoopbackOrigins bool
}

// CSRFProtection rejects cross-site unsafe requests before they reach an
// authenticated handler. TeslaSync relies on upstream ForwardAuth cookies, so
// SameSite alone is not a sufficient CSRF boundary.
//
// Requests with no browser provenance headers remain supported for API clients
// and webhooks. Browser requests must either present an Origin matching the
// request host or declare same-origin navigation via Sec-Fetch-Site.
func CSRFProtection(next http.Handler) http.Handler {
	return CSRFProtectionWithOptions(CSRFOptions{})(next)
}

// CSRFProtectionWithOptions returns a middleware that validates browser
// provenance for unsafe methods. The protected route group mounts it after
// ForwardAuth; public telemetry, health, share, and webhook routes are not
// wrapped by it.
func CSRFProtectionWithOptions(opts CSRFOptions) func(http.Handler) http.Handler {
	allowedOrigins := normalizeAllowedOrigins(opts.AllowedOrigins)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !isUnsafeMethod(r.Method) || isSameOriginUnsafeRequest(r, allowedOrigins, opts.AllowLoopbackOrigins) {
				next.ServeHTTP(w, r)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error": "cross-site request rejected",
				"code":  CSRFRejectedCode,
			})
		})
	}
}

func isUnsafeMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func isSameOriginUnsafeRequest(r *http.Request, allowedOrigins map[string]struct{}, allowLoopbackOrigins bool) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" {
		parsed, err := url.Parse(origin)
		if err != nil || !validOriginURL(parsed) {
			return false
		}
		canonical := canonicalOrigin(parsed)
		if _, ok := allowedOrigins[canonical]; ok {
			return true
		}
		if allowLoopbackOrigins && isLoopbackHost(parsed.Hostname()) {
			return true
		}
		// Direct HTTP deployments retain same-origin support. Do not consult
		// X-Forwarded-* here: those values are attacker-controlled whenever a
		// backend is accidentally exposed outside its ingress boundary.
		return strings.EqualFold(parsed.Scheme, directRequestScheme(r)) &&
			strings.EqualFold(parsed.Host, requestHost(r))
	}

	// A same-site subdomain is not sufficient for state-changing requests:
	// it can be controlled by a different application. Modern browsers send
	// Origin for unsafe requests; headerless clients remain supported.
	switch strings.ToLower(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site"))) {
	case "", "same-origin", "none":
		return true
	default:
		return false
	}
}

// ParseAllowedOrigins normalizes a comma-separated deployment origin list.
// Wildcards are deliberately ignored because credentialed mutations require a
// concrete browser origin.
func ParseAllowedOrigins(values ...string) []string {
	origins := make([]string, 0, len(values))
	for _, value := range values {
		for _, raw := range strings.Split(value, ",") {
			raw = strings.TrimSpace(raw)
			if raw == "" || raw == "*" {
				continue
			}
			parsed, err := url.Parse(raw)
			if err != nil || !validOriginURL(parsed) {
				continue
			}
			origins = append(origins, canonicalOrigin(parsed))
		}
	}
	return origins
}

func normalizeAllowedOrigins(origins []string) map[string]struct{} {
	normalized := make(map[string]struct{}, len(origins))
	for _, origin := range ParseAllowedOrigins(origins...) {
		normalized[origin] = struct{}{}
	}
	return normalized
}

func canonicalOrigin(parsed *url.URL) string {
	return strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host)
}

func validOriginURL(parsed *url.URL) bool {
	return parsed.Scheme != "" &&
		parsed.Host != "" &&
		(parsed.Path == "" || parsed.Path == "/") &&
		parsed.RawQuery == "" &&
		parsed.Fragment == "" &&
		parsed.User == nil
}

func isLoopbackHost(host string) bool {
	host = strings.Trim(strings.ToLower(host), "[]")
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func directRequestScheme(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	return "http"
}

func requestHost(r *http.Request) string {
	if r.Host != "" {
		return r.Host
	}
	return r.URL.Host
}
