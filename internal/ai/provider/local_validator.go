package provider

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
)

// LocalAllowedHostnames lists the hostname literals that are
// unconditionally accepted in local mode without a DNS lookup. Resolves
// the bootstrapping problem where the very first call to ValidateLocal
// would otherwise need a working resolver to confirm "localhost" is
// loopback.
//
// host.docker.internal is included for the docker-compose deployment
// where the API container reaches an Ollama process running on the
// host. The Docker daemon resolves it to a private bridge IP at
// runtime; treating the literal as pre-validated removes the resolver
// round-trip from the Settings save path.
var LocalAllowedHostnames = map[string]struct{}{
	"localhost":                {},
	"127.0.0.1":                {},
	"::1":                      {},
	"host.docker.internal":     {},
	"host.containers.internal": {}, // podman analogue
}

// resolver is the seam for net.LookupIP so tests can swap a deterministic
// fake in. Production code uses [DefaultResolver]; tests build a
// [StaticResolver] from a hostname → IPs map.
type resolver interface {
	LookupIP(ctx context.Context, host string) ([]net.IP, error)
}

// DefaultResolver delegates to the system DNS via net.DefaultResolver
// using a context-bound lookup so callers can apply timeouts.
type DefaultResolver struct{}

// LookupIP implements [resolver].
func (DefaultResolver) LookupIP(ctx context.Context, host string) ([]net.IP, error) {
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	out := make([]net.IP, len(addrs))
	for i, a := range addrs {
		out[i] = a.IP
	}
	return out, nil
}

// StaticResolver is a deterministic fake used by tests to model DNS
// rebinding (the same hostname returning a private IP at config-save
// time and a public IP at runtime).
type StaticResolver map[string][]net.IP

// LookupIP implements [resolver].
func (s StaticResolver) LookupIP(_ context.Context, host string) ([]net.IP, error) {
	if ips, ok := s[host]; ok {
		return ips, nil
	}
	return nil, fmt.Errorf("static resolver: no entry for %q", host)
}

// ValidateLocal asserts that cfg.BaseURL is reachable only on a
// private network (RFC1918 / loopback / IPv4 link-local 169.254/16 /
// IPv6 ULA fc00::/7 / IPv6 link-local fe80::/10). On success the
// resolved IP is returned so the caller can write it into
// cfg.PinnedIP — runtime calls re-resolve and compare against the pin
// to catch DNS rebinding.
//
// Hostnames in [LocalAllowedHostnames] short-circuit without a DNS
// lookup (and produce an empty pinnedIP since the literal is itself
// the trust anchor).
//
// Error returns wrap [ErrLocalModeViolation] so callers can branch on
// errors.Is even after the configuration layer adds context.
func ValidateLocal(cfg ProviderConfig) (pinnedIP string, err error) {
	return validateLocalWith(context.Background(), DefaultResolver{}, cfg)
}

// ValidateLocalCtx is the context-aware form, used by tests and by
// future call sites that want to apply a timeout (e.g. F2's settings
// save path).
func ValidateLocalCtx(ctx context.Context, cfg ProviderConfig) (pinnedIP string, err error) {
	return validateLocalWith(ctx, DefaultResolver{}, cfg)
}

func validateLocalWith(ctx context.Context, r resolver, cfg ProviderConfig) (string, error) {
	if cfg.BaseURL == "" {
		return "", fmt.Errorf("%w: empty base_url", ErrLocalModeViolation)
	}
	u, err := url.Parse(cfg.BaseURL)
	if err != nil {
		return "", fmt.Errorf("%w: parse base_url: %v", ErrLocalModeViolation, err)
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", fmt.Errorf("%w: unsupported scheme %q", ErrLocalModeViolation, scheme)
	}
	host := u.Hostname()
	if host == "" {
		return "", fmt.Errorf("%w: missing host", ErrLocalModeViolation)
	}
	// Strip IPv6 brackets that url.Parse leaves around literals.
	host = strings.Trim(host, "[]")

	// Literal allow-list short-circuit.
	if _, ok := LocalAllowedHostnames[host]; ok {
		return "", nil
	}

	// Direct IP literal — accept iff private.
	if ip := net.ParseIP(host); ip != nil {
		if !IsPrivateIP(ip) {
			return "", fmt.Errorf("%w: %q resolves to public IP %s", ErrLocalModeViolation, host, ip)
		}
		return ip.String(), nil
	}

	// Hostname — resolve and require ALL returned IPs to be private.
	// Allowing "first IP private, second public" would let an attacker
	// roll a DNS record where the legitimate path is private but a
	// retry hits a public IP.
	ips, err := r.LookupIP(ctx, host)
	if err != nil {
		return "", fmt.Errorf("%w: resolve %q: %v", ErrLocalModeViolation, host, err)
	}
	if len(ips) == 0 {
		return "", fmt.Errorf("%w: no IPs for %q", ErrLocalModeViolation, host)
	}
	for _, ip := range ips {
		if !IsPrivateIP(ip) {
			return "", fmt.Errorf("%w: %q resolves to public IP %s", ErrLocalModeViolation, host, ip)
		}
	}
	// Pin the first IP. Runtime callers re-resolve and assert at least
	// one returned IP equals the pin (DNS rebinding detector).
	return ips[0].String(), nil
}

// CheckPinnedIP re-resolves cfg.BaseURL's host and asserts at least one
// returned IP matches cfg.PinnedIP. Called by the runtime HTTP layer
// (slice F2 wires this into the settings save path; F1 exposes the
// primitive). Returns nil when pin matches, a wrapped
// [ErrLocalModeViolation] otherwise.
//
// cfg.PinnedIP="" is treated as "no pin required" — used for built-in
// loopback hostnames in [LocalAllowedHostnames] which need no runtime
// re-check.
func CheckPinnedIP(ctx context.Context, cfg ProviderConfig) error {
	return checkPinnedIPWith(ctx, DefaultResolver{}, cfg)
}

func checkPinnedIPWith(ctx context.Context, r resolver, cfg ProviderConfig) error {
	if cfg.PinnedIP == "" {
		return nil
	}
	u, err := url.Parse(cfg.BaseURL)
	if err != nil {
		return fmt.Errorf("%w: parse base_url: %v", ErrLocalModeViolation, err)
	}
	host := strings.Trim(u.Hostname(), "[]")
	if host == "" {
		return fmt.Errorf("%w: missing host", ErrLocalModeViolation)
	}
	if _, ok := LocalAllowedHostnames[host]; ok {
		return nil
	}
	if ip := net.ParseIP(host); ip != nil {
		if ip.String() == cfg.PinnedIP {
			return nil
		}
		return fmt.Errorf("%w: literal host %s does not match pin %s", ErrLocalModeViolation, ip, cfg.PinnedIP)
	}
	ips, err := r.LookupIP(ctx, host)
	if err != nil {
		return fmt.Errorf("%w: resolve %q: %v", ErrLocalModeViolation, host, err)
	}
	pin := net.ParseIP(cfg.PinnedIP)
	if pin == nil {
		return fmt.Errorf("%w: malformed pinned ip %q", ErrLocalModeViolation, cfg.PinnedIP)
	}
	for _, ip := range ips {
		if ip.Equal(pin) {
			// Also assert no current resolution is public — DNS rebinding
			// could keep the pin valid while injecting a new public IP.
			for _, other := range ips {
				if !IsPrivateIP(other) {
					return fmt.Errorf("%w: %q now resolves to public IP %s", ErrLocalModeViolation, host, other)
				}
			}
			return nil
		}
	}
	return fmt.Errorf("%w: pinned %s no longer in DNS for %q", ErrLocalModeViolation, cfg.PinnedIP, host)
}

// IsPrivateIP reports whether ip is on a network the local-mode
// validator treats as private. The Go stdlib does not expose a single
// helper for the union of (RFC1918, loopback, IPv4 link-local, IPv6
// ULA, IPv6 link-local) so this function spells out the membership
// test against the canonical CIDRs.
func IsPrivateIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip.IsLoopback() {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		// 10.0.0.0/8
		if v4[0] == 10 {
			return true
		}
		// 172.16.0.0/12
		if v4[0] == 172 && v4[1] >= 16 && v4[1] <= 31 {
			return true
		}
		// 192.168.0.0/16
		if v4[0] == 192 && v4[1] == 168 {
			return true
		}
		// 169.254.0.0/16 (IPv4 link-local)
		if v4[0] == 169 && v4[1] == 254 {
			return true
		}
		return false
	}
	// IPv6
	if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}
	// Unique Local Address fc00::/7
	if len(ip) == net.IPv6len && (ip[0]&0xfe) == 0xfc {
		return true
	}
	return false
}

// errMatchesViolation is a convenience for tests so they can spot-check
// the wrapping is intact.
var errMatchesViolation = errors.Is
var _ = errMatchesViolation // keep symbol live even if no test uses it directly
