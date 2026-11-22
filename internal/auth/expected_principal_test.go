package auth

import (
	"net/http/httptest"
	"testing"
)

func TestExpectedPrincipalIsAnOptionalRaceGuard(t *testing.T) {
	tests := []struct {
		name, configuredHeader, subject, expected string
		want                                      bool
	}{
		{"ordinary client", "X-User", "subject-a", "", true},
		{"matching subject", "X-User", "subject-a", "subject:subject-a", true},
		{"unicode subject", "X-User", "élise", "subject:%C3%A9lise", true},
		{"changed subject", "X-User", "subject-b", "subject:subject-a", false},
		{"malformed encoding", "X-User", "subject-a", "subject:%ZZ", false},
		{"open mode", "", "open-mode", "open", true},
		{"real user named open-mode", "X-User", "open-mode", "subject:open-mode", true},
		{"mode changed", "", "open-mode", "subject:open-mode", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest("GET", "/", nil)
			request.Header.Set(ExpectedPrincipalHeader, tt.expected)
			if got := MatchesExpectedPrincipal(request, tt.configuredHeader, tt.subject); got != tt.want {
				t.Fatalf("MatchesExpectedPrincipal() = %v, want %v", got, tt.want)
			}
		})
	}
}
