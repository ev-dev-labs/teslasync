package provider

import (
	"context"
	"errors"
	"net"
	"testing"
)

// TestValidateLocal_LiteralAllowList covers the hostnames that
// short-circuit without a DNS lookup.
func TestValidateLocal_LiteralAllowList(t *testing.T) {
	t.Parallel()
	cases := []string{
		"http://localhost",
		"http://localhost:11434",
		"http://127.0.0.1:11434",
		"http://[::1]:11434",
		"http://host.docker.internal:11434",
		"http://host.containers.internal:11434",
	}
	for _, base := range cases {
		t.Run(base, func(t *testing.T) {
			pin, err := ValidateLocal(ProviderConfig{BaseURL: base})
			if err != nil {
				t.Fatalf("rejected literal allow-list host %q: %v", base, err)
			}
			if pin != "" {
				t.Fatalf("literal allow-list should not pin, got %q", pin)
			}
		})
	}
}

// TestValidateLocal_PrivateLiterals iterates every private CIDR and
// asserts ValidateLocal accepts a literal IP from it.
func TestValidateLocal_PrivateLiterals(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		ip   string
	}{
		{"rfc1918 10/8", "10.0.0.5"},
		{"rfc1918 172.16/12 lower", "172.16.0.1"},
		{"rfc1918 172.16/12 upper", "172.31.255.254"},
		{"rfc1918 192.168/16", "192.168.1.1"},
		{"link-local 169.254/16", "169.254.1.1"},
		{"loopback 127/8", "127.0.0.2"},
		{"ipv6 ULA fc00::/7", "[fd00::1]"},
		{"ipv6 link-local fe80::/10", "[fe80::1]"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pin, err := ValidateLocal(ProviderConfig{BaseURL: "http://" + c.ip + ":11434"})
			if err != nil {
				t.Fatalf("rejected private literal %q: %v", c.ip, err)
			}
			if pin == "" {
				t.Fatalf("expected non-empty pin for literal %q", c.ip)
			}
		})
	}
}

// TestValidateLocal_PublicLiteralRejected covers a public IP literal —
// even if the user typed an IP, we must reject 8.8.8.8.
func TestValidateLocal_PublicLiteralRejected(t *testing.T) {
	t.Parallel()
	_, err := ValidateLocal(ProviderConfig{BaseURL: "http://8.8.8.8:11434"})
	if !errors.Is(err, ErrLocalModeViolation) {
		t.Fatalf("public literal accepted, err=%v", err)
	}
}

// TestValidateLocal_HostnameResolvesPrivate covers the happy hostname
// path where the resolver returns an RFC1918 address.
func TestValidateLocal_HostnameResolvesPrivate(t *testing.T) {
	t.Parallel()
	r := StaticResolver{
		"my-ollama.lan": []net.IP{net.ParseIP("10.0.5.10")},
	}
	pin, err := validateLocalWith(context.Background(), r, ProviderConfig{BaseURL: "http://my-ollama.lan:11434"})
	if err != nil {
		t.Fatalf("private hostname rejected: %v", err)
	}
	if pin != "10.0.5.10" {
		t.Fatalf("expected pin 10.0.5.10, got %q", pin)
	}
}

// TestValidateLocal_HostnameResolvesPublicRejected mirrors the rebinding
// scenario where DNS returns a public IP at config-save time.
func TestValidateLocal_HostnameResolvesPublicRejected(t *testing.T) {
	t.Parallel()
	r := StaticResolver{
		"evil.attacker.com": []net.IP{net.ParseIP("203.0.113.5")},
	}
	_, err := validateLocalWith(context.Background(), r, ProviderConfig{BaseURL: "http://evil.attacker.com:11434"})
	if !errors.Is(err, ErrLocalModeViolation) {
		t.Fatalf("public hostname accepted, err=%v", err)
	}
}

// TestValidateLocal_MixedAllPrivate_ButOneIsPublic_Rejected covers the
// subtle rebinding case where an attacker rolls a record with one
// private and one public IP — the validator must reject conservatively.
func TestValidateLocal_MixedAllPrivate_ButOneIsPublic_Rejected(t *testing.T) {
	t.Parallel()
	r := StaticResolver{
		"mixed.lan": []net.IP{
			net.ParseIP("10.0.0.1"),
			net.ParseIP("203.0.113.5"),
		},
	}
	_, err := validateLocalWith(context.Background(), r, ProviderConfig{BaseURL: "http://mixed.lan"})
	if !errors.Is(err, ErrLocalModeViolation) {
		t.Fatalf("mixed-IPs accepted, err=%v", err)
	}
}

// TestValidateLocal_BadInputs covers empty/garbage inputs.
func TestValidateLocal_BadInputs(t *testing.T) {
	t.Parallel()
	bad := []ProviderConfig{
		{BaseURL: ""},
		{BaseURL: "not-a-url"},
		{BaseURL: "ftp://localhost"},
		{BaseURL: "http://"},
	}
	for _, cfg := range bad {
		_, err := ValidateLocal(cfg)
		if !errors.Is(err, ErrLocalModeViolation) {
			t.Fatalf("input %+v should be rejected, err=%v", cfg, err)
		}
	}
}

// TestCheckPinnedIP_AllowListSkipsCheck — literal allow-list hosts
// have no pin, so re-checking is a no-op.
func TestCheckPinnedIP_AllowListSkipsCheck(t *testing.T) {
	t.Parallel()
	if err := CheckPinnedIP(context.Background(), ProviderConfig{BaseURL: "http://localhost:11434"}); err != nil {
		t.Fatalf("loopback re-check failed: %v", err)
	}
}

// TestCheckPinnedIP_NoPinNoOp — empty pin means "no pin required".
func TestCheckPinnedIP_NoPinNoOp(t *testing.T) {
	t.Parallel()
	if err := CheckPinnedIP(context.Background(), ProviderConfig{BaseURL: "http://example.com"}); err != nil {
		t.Fatalf("no-pin should be no-op: %v", err)
	}
}

// TestCheckPinnedIP_DNSRebindingDetected — at config-save the host
// resolved to 10.0.0.5 (pinned). At runtime it now resolves to a
// public IP — the check must reject.
func TestCheckPinnedIP_DNSRebindingDetected(t *testing.T) {
	t.Parallel()
	r := StaticResolver{
		"my-ollama.lan": []net.IP{net.ParseIP("203.0.113.10")},
	}
	cfg := ProviderConfig{BaseURL: "http://my-ollama.lan", PinnedIP: "10.0.0.5"}
	err := checkPinnedIPWith(context.Background(), r, cfg)
	if !errors.Is(err, ErrLocalModeViolation) {
		t.Fatalf("rebinding to public IP should fail, err=%v", err)
	}
}

// TestCheckPinnedIP_HappyPath — the pin matches a private IP currently
// in DNS for the host.
func TestCheckPinnedIP_HappyPath(t *testing.T) {
	t.Parallel()
	r := StaticResolver{
		"my-ollama.lan": []net.IP{net.ParseIP("10.0.0.5")},
	}
	cfg := ProviderConfig{BaseURL: "http://my-ollama.lan", PinnedIP: "10.0.0.5"}
	if err := checkPinnedIPWith(context.Background(), r, cfg); err != nil {
		t.Fatalf("happy-path check failed: %v", err)
	}
}

// TestCheckPinnedIP_PinPresentButPublicAlsoPresent rejects even when
// the pin is still in DNS — the additional public IP signals rebinding.
func TestCheckPinnedIP_PinPresentButPublicAlsoPresent(t *testing.T) {
	t.Parallel()
	r := StaticResolver{
		"mixed.lan": []net.IP{net.ParseIP("10.0.0.5"), net.ParseIP("203.0.113.5")},
	}
	cfg := ProviderConfig{BaseURL: "http://mixed.lan", PinnedIP: "10.0.0.5"}
	err := checkPinnedIPWith(context.Background(), r, cfg)
	if !errors.Is(err, ErrLocalModeViolation) {
		t.Fatalf("mixed pin+public should fail, err=%v", err)
	}
}

// TestIsPrivateIP exercises the private-CIDR membership directly so a
// future regression in the helper surfaces with a clear failure.
func TestIsPrivateIP(t *testing.T) {
	t.Parallel()
	cases := []struct {
		ip   string
		want bool
	}{
		{"10.0.0.1", true},
		{"172.15.0.1", false},
		{"172.16.0.1", true},
		{"172.31.0.1", true},
		{"172.32.0.1", false},
		{"192.168.0.1", true},
		{"127.0.0.1", true},
		{"169.254.1.1", true},
		{"8.8.8.8", false},
		{"203.0.113.1", false},
		{"::1", true},
		{"fe80::1", true},
		{"fd00::1", true},
		{"2001:4860:4860::8888", false},
	}
	for _, c := range cases {
		ip := net.ParseIP(c.ip)
		if ip == nil {
			t.Fatalf("bad test ip %q", c.ip)
		}
		if got := IsPrivateIP(ip); got != c.want {
			t.Fatalf("IsPrivateIP(%s) = %v, want %v", c.ip, got, c.want)
		}
	}
}
