package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestActorFromRequest(t *testing.T) {
	tests := []struct {
		name       string
		headerName string
		setHeader  string
		want       string
	}{
		{name: "no header configured", headerName: "", setHeader: "user@example.com", want: ""},
		{name: "header configured but missing", headerName: "X-Forwarded-User", setHeader: "", want: ""},
		{name: "header present", headerName: "X-Forwarded-User", setHeader: "user@example.com", want: "user@example.com"},
		{name: "header value trimmed", headerName: "X-Forwarded-User", setHeader: "  user@example.com  ", want: "user@example.com"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.setHeader != "" {
				req.Header.Set("X-Forwarded-User", tt.setHeader)
			}
			got := actorFromRequest(req, tt.headerName)
			if got != tt.want {
				t.Fatalf("actorFromRequest = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestClientIP(t *testing.T) {
	tests := []struct {
		name     string
		xff      string
		remote   string
		wantHost string
	}{
		{name: "remote addr only", remote: "10.0.0.1:54321", wantHost: "10.0.0.1"},
		{name: "ipv6 remote addr", remote: "[::1]:54321", wantHost: "::1"},
		{name: "xff single", xff: "203.0.113.5", remote: "10.0.0.1:54321", wantHost: "203.0.113.5"},
		{name: "xff chain prefers leftmost", xff: "203.0.113.5, 10.0.0.2", remote: "10.0.0.1:54321", wantHost: "203.0.113.5"},
		{name: "xff with whitespace", xff: "  203.0.113.5  ", remote: "10.0.0.1:54321", wantHost: "203.0.113.5"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tt.remote
			if tt.xff != "" {
				req.Header.Set("X-Forwarded-For", tt.xff)
			}
			if got := clientIP(req); got != tt.wantHost {
				t.Fatalf("clientIP = %q, want %q", got, tt.wantHost)
			}
		})
	}
}
