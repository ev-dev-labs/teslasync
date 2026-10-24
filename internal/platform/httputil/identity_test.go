package httputil

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestActorIdentity(t *testing.T) {
	tests := []struct {
		name       string
		headerName string
		value      string
		want       string
	}{
		{name: "header not configured", headerName: "", value: "user@example.com", want: ""},
		{name: "header missing", headerName: "X-Forwarded-User", want: ""},
		{name: "value present", headerName: "X-Forwarded-User", value: "user@example.com", want: "user@example.com"},
		{name: "value trimmed", headerName: "X-Forwarded-User", value: " \t user@example.com \r\n", want: "user@example.com"},
		{name: "header name trimmed", headerName: "  X-Forwarded-User\t", value: "alice", want: "alice"},
		{name: "whitespace-only value", headerName: "X-Forwarded-User", value: " \t\r\n ", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.Header.Set("X-Forwarded-User", tt.value)
			if got := ActorIdentity(req, tt.headerName); got != tt.want {
				t.Fatalf("ActorIdentity() = %q, want %q", got, tt.want)
			}
		})
	}

	if got := ActorIdentity(nil, "X-Forwarded-User"); got != "" {
		t.Fatalf("nil ActorIdentity() = %q, want empty", got)
	}
}

func TestClientIPRemoteAddrFallback(t *testing.T) {
	tests := []struct {
		name   string
		remote string
		want   string
	}{
		{name: "empty", remote: "", want: ""},
		{name: "IPv4 with port", remote: "192.0.2.10:54321", want: "192.0.2.10"},
		{name: "IPv6 with port", remote: "[2001:db8::10]:54321", want: "2001:db8::10"},
		{name: "IPv6 zone with port", remote: "[fe80::1%eth0]:54321", want: "fe80::1%eth0"},
		{name: "plain IPv6", remote: "2001:db8::10", want: "2001:db8::10"},
		{name: "plain IPv6 zone", remote: "fe80::1%eth0", want: "fe80::1%eth0"},
		{name: "bracketed IPv6 without port preserved", remote: "[2001:db8::10]", want: "[2001:db8::10]"},
		{name: "malformed value preserved", remote: "not-an-address", want: "not-an-address"},
		{name: "whitespace trimmed", remote: " \t192.0.2.10:54321\r\n ", want: "192.0.2.10"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tt.remote
			if got := ClientIP(req); got != tt.want {
				t.Fatalf("ClientIP() = %q, want %q", got, tt.want)
			}
		})
	}

	if got := ClientIP(nil); got != "" {
		t.Fatalf("nil ClientIP() = %q, want empty", got)
	}
}

func TestClientIPForwardedHeadersAreOptIn(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.0.2.50:1234"
	req.Header.Set("X-Forwarded-For", "203.0.113.7, 192.0.2.51")
	req.Header.Set("X-Real-IP", "198.51.100.8")

	if got := ClientIP(req); got != "192.0.2.50" {
		t.Fatalf("default ClientIP() = %q, want RemoteAddr-only result", got)
	}
	if got := ClientIP(req, ClientIPOptions{TrustXForwardedFor: true}); got != "203.0.113.7" {
		t.Fatalf("trusted XFF ClientIP() = %q, want first forwarded hop", got)
	}
	if got := ClientIP(req, ClientIPOptions{TrustForwardedHeaders: true}); got != "203.0.113.7" {
		t.Fatalf("trusted forwarding ClientIP() = %q, want first forwarded hop", got)
	}
	if got := ClientIP(req, ClientIPOptions{TrustXRealIP: true}); got != "198.51.100.8" {
		t.Fatalf("trusted X-Real-IP ClientIP() = %q, want X-Real-IP", got)
	}
}

func TestClientIPForwardedEdgeCases(t *testing.T) {
	tests := []struct {
		name    string
		xff     string
		realIP  string
		remote  string
		options ClientIPOptions
		want    string
	}{
		{
			name:    "first XFF hop trimmed",
			xff:     " 203.0.113.7 , 192.0.2.51",
			remote:  "192.0.2.50:1234",
			options: ClientIPOptions{TrustXForwardedFor: true},
			want:    "203.0.113.7",
		},
		{
			name:    "IPv6 forwarded value and zone preserved",
			xff:     "[fe80::1%eth0]:8443, 192.0.2.51",
			remote:  "192.0.2.50:1234",
			options: ClientIPOptions{TrustXForwardedFor: true},
			want:    "[fe80::1%eth0]:8443",
		},
		{
			name:    "malformed forwarded value preserved",
			xff:     " not-an-address ",
			remote:  "192.0.2.50:1234",
			options: ClientIPOptions{TrustXForwardedFor: true},
			want:    "not-an-address",
		},
		{
			name:    "empty first XFF hop falls back to RemoteAddr by default",
			xff:     " , 203.0.113.7",
			remote:  "192.0.2.50:1234",
			options: ClientIPOptions{TrustXForwardedFor: true},
			want:    "192.0.2.50",
		},
		{
			name:    "empty first XFF hop may be skipped explicitly",
			xff:     " , 203.0.113.7",
			remote:  "192.0.2.50:1234",
			options: ClientIPOptions{TrustXForwardedFor: true, SkipEmptyXForwardedFor: true},
			want:    "203.0.113.7",
		},
		{
			name:    "whitespace XFF falls back to X-Real-IP",
			xff:     " \t\r\n ",
			realIP:  "198.51.100.8",
			remote:  "192.0.2.50:1234",
			options: ClientIPOptions{TrustForwardedHeaders: true},
			want:    "198.51.100.8",
		},
		{
			name:    "X-Real-IP whitespace fallback trimmed",
			realIP:  " 198.51.100.8\t ",
			remote:  "192.0.2.50:1234",
			options: ClientIPOptions{TrustXRealIP: true},
			want:    "198.51.100.8",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tt.remote
			if tt.xff != "" {
				req.Header.Set("X-Forwarded-For", tt.xff)
			}
			if tt.realIP != "" {
				req.Header.Set("X-Real-IP", tt.realIP)
			}
			if got := ClientIP(req, tt.options); got != tt.want {
				t.Fatalf("ClientIP() = %q, want %q", got, tt.want)
			}
		})
	}
}
