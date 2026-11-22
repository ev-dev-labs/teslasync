package auth

import (
	"net/http"
	"net/url"
	"strings"
)

// ExpectedPrincipalHeader is an optional browser-side race guard, never a credential.
const ExpectedPrincipalHeader = "X-TeslaSync-Expected-Principal"

// MatchesExpectedPrincipal prevents a request prepared for one browser identity
// from being applied after the upstream session has changed.
func MatchesExpectedPrincipal(r *http.Request, headerName, subject string) bool {
	expected := r.Header.Get(ExpectedPrincipalHeader)
	if expected == "" {
		return true
	}
	if IsOpenMode(headerName) {
		return expected == "open"
	}
	const prefix = "subject:"
	if !strings.HasPrefix(expected, prefix) {
		return false
	}
	decoded, err := url.PathUnescape(strings.TrimPrefix(expected, prefix))
	return err == nil && decoded == subject
}
