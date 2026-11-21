package personal

import (
	"net/http"
	"net/http/httptest"
	"testing"

	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
)

func TestSubjectSeparatesSharedAndAuthenticatedScopes(t *testing.T) {
	tests := []struct {
		name        string
		header      string
		identity    string
		expected    string
		impersonate bool
		want        string
		status      int
	}{
		{"shared open scope ignores spoofed identity", "", "open-mode", "open", false, personaldomain.OpenSubject, http.StatusOK},
		{"forwarded open-mode is a real user", "X-Test-Subject", "open-mode", "subject:open-mode", false, "open-mode", http.StatusOK},
		{"reserved scope cannot be forwarded", "X-Test-Subject", personaldomain.OpenSubject, "", false, "", http.StatusUnauthorized},
		{"missing forwarded identity", "X-Test-Subject", "", "", false, "", http.StatusUnauthorized},
		{"stale authenticated request in open mode", "", "", "subject:open-mode", false, "", http.StatusConflict},
		{"stale open request after enabling auth", "X-Test-Subject", "open-mode", "open", false, "", http.StatusConflict},
		{"impersonation denied in open mode", "", "", "open", true, "", http.StatusForbidden},
		{"impersonation denied with auth", "X-Test-Subject", "open-mode", "", true, "", http.StatusForbidden},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.Header.Set("X-Test-Subject", test.identity)
			request.Header.Set(tsauth.ExpectedPrincipalHeader, test.expected)
			if test.impersonate {
				request = request.WithContext(tsauth.WithImpersonationForTests(
					request.Context(), tsauth.ImpersonationClaim{OriginalAdmin: "admin", Target: "other"},
				))
			}
			response := httptest.NewRecorder()
			subject, ok := Subject(response, request, test.header, "routines")
			if response.Code != test.status || ok != (test.status == http.StatusOK) || subject != test.want {
				t.Fatalf("status=%d ok=%v subject=%q, want %d %v %q",
					response.Code, ok, subject, test.status, test.status == http.StatusOK, test.want)
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("cache-control = %q", response.Header().Get("Cache-Control"))
			}
		})
	}
}
