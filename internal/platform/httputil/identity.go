package httputil

import (
	"net"
	"net/http"
	"strings"
)

// ClientIPOptions explicitly enables forwarded client-address sources.
//
// Forwarded headers are intentionally disabled by default. A caller must only
// enable them when its deployment has proved that the reverse proxy owns and
// sanitizes those headers. Different call sites have historically accepted
// slightly different X-Forwarded-For behavior, so SkipEmptyXForwardedFor
// preserves that behavior when it matters.
type ClientIPOptions struct {
	TrustForwardedHeaders  bool
	TrustXForwardedFor     bool
	TrustXRealIP           bool
	SkipEmptyXForwardedFor bool
}

// ActorIdentity returns the trimmed actor identity from the configured
// ForwardAuth header. It returns an empty string for nil requests, an empty
// header name, or a missing/whitespace-only header.
func ActorIdentity(r *http.Request, headerName string) string {
	if r == nil {
		return ""
	}
	headerName = strings.TrimSpace(headerName)
	if headerName == "" {
		return ""
	}
	return strings.TrimSpace(r.Header.Get(headerName))
}

// ActorIdentityFromRequest is a descriptive alias for ActorIdentity.
func ActorIdentityFromRequest(r *http.Request, headerName string) string {
	return ActorIdentity(r, headerName)
}

// ClientIP resolves a best-effort client address.
//
// With no options it uses only RemoteAddr. When trusted forwarding is enabled,
// it prefers the first X-Forwarded-For candidate (optionally skipping empty
// candidates), then X-Real-IP, and finally RemoteAddr. Forwarded candidates
// are trimmed but not parsed or rewritten, preserving malformed values, ports,
// and IPv6 zones exactly as presented. RemoteAddr ports are removed with
// net.SplitHostPort; malformed or unported values are trimmed and returned
// unchanged.
func ClientIP(r *http.Request, options ...ClientIPOptions) string {
	if r == nil {
		return ""
	}

	var opts ClientIPOptions
	for _, option := range options {
		if option.TrustForwardedHeaders {
			opts.TrustForwardedHeaders = true
		}
		if option.TrustXForwardedFor {
			opts.TrustXForwardedFor = true
		}
		if option.TrustXRealIP {
			opts.TrustXRealIP = true
		}
		if option.SkipEmptyXForwardedFor {
			opts.SkipEmptyXForwardedFor = true
		}
	}

	if opts.TrustForwardedHeaders || opts.TrustXForwardedFor {
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			if candidate, ok := firstForwardedFor(forwarded, opts.SkipEmptyXForwardedFor); ok {
				return candidate
			}
		}
	}
	if opts.TrustForwardedHeaders || opts.TrustXRealIP {
		if realIP := strings.TrimSpace(r.Header.Get("X-Real-IP")); realIP != "" {
			return realIP
		}
	}

	remote := strings.TrimSpace(r.RemoteAddr)
	if remote == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(remote); err == nil {
		return strings.TrimSpace(host)
	}
	return remote
}

// ClientIPFromRequest is a descriptive alias for ClientIP.
func ClientIPFromRequest(r *http.Request, options ...ClientIPOptions) string {
	return ClientIP(r, options...)
}

func firstForwardedFor(header string, skipEmpty bool) (string, bool) {
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			if skipEmpty {
				continue
			}
			return "", false
		}
		return candidate, true
	}
	return "", false
}
