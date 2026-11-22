package auth

import (
	"strings"
	"testing"
)

func TestIncidentRecipientRequiresExactExplicitForwardAuthSubject(t *testing.T) {
	const subject = "operator"
	for _, tt := range []struct {
		name, header, configured, expected string
	}{
		{"allowlisted", "X-Test-Subject", subject, subject},
		{"other", "X-Test-Subject", "other", ""},
		{"case mismatch", "X-Test-Subject", "Operator", ""},
		{"unset", "X-Test-Subject", "", ""},
		{"open mode", "", subject, ""},
		{"oversized", "X-Test-Subject", strings.Repeat("x", 513), ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			allowlist := subject + "," + strings.Repeat("x", 513)
			if got := NewOperatorAccess(tt.header, allowlist).IncidentRecipient(tt.configured); got != tt.expected {
				t.Fatalf("incident recipient = %q, want %q", got, tt.expected)
			}
		})
	}
}
