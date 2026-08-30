package webvitals

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Backend/frontend route-template contract.
//
// `generatedRoutePaths` is produced by `go run ./cmd/routetemplategen` from
// web/src/lib/routeRegistry.ts. The Go binary must not read the web tree at
// runtime, so the artifact is committed — and pinned here by re-parsing the
// TypeScript source at TEST time. If someone adds a parameterised SPA route and
// forgets to regenerate, this fails and the drift is caught before an opaque
// slug can reach a Prometheus label.

var webRoutePathRE = regexp.MustCompile(`\bpath:\s*'([^']+)'`)

func webRegistryPath(t *testing.T) string {
	t.Helper()
	return filepath.Join("..", "..", "..", "web", "src", "lib", "routeRegistry.ts")
}

func parseWebRoutePaths(t *testing.T) []string {
	t.Helper()
	raw, err := os.ReadFile(webRegistryPath(t))
	if err != nil {
		t.Skipf("web route registry not readable from this working directory: %v", err)
	}
	matches := webRoutePathRE.FindAllStringSubmatch(string(raw), -1)
	if len(matches) == 0 {
		t.Fatal("no `path:` entries parsed from routeRegistry.ts — has its shape changed?")
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		if _, dup := seen[m[1]]; dup {
			continue
		}
		seen[m[1]] = struct{}{}
		out = append(out, m[1])
	}
	sort.Strings(out)
	return out
}

// TestGeneratedRoutePathsMatchWebRegistry is the drift gate.
func TestGeneratedRoutePathsMatchWebRegistry(t *testing.T) {
	want := parseWebRoutePaths(t)
	got := generatedRoutePaths[:]

	if len(got) != len(want) {
		t.Fatalf("generated route table has %d entries, web registry has %d — run `go run ./cmd/routetemplategen`",
			len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("route table drift at index %d: generated %q, web registry %q — run `go run ./cmd/routetemplategen`",
				i, got[i], want[i])
		}
	}
}

// TestGeneratedRouteTableIsSortedAndUnique keeps the artifact deterministic so
// a regeneration produces a zero-line diff when nothing changed.
func TestGeneratedRouteTableIsSortedAndUnique(t *testing.T) {
	seen := map[string]struct{}{}
	for i, p := range generatedRoutePaths {
		if !strings.HasPrefix(p, "/") {
			t.Errorf("route %q does not start with '/'", p)
		}
		if _, dup := seen[p]; dup {
			t.Errorf("duplicate route %q", p)
		}
		seen[p] = struct{}{}
		if i > 0 && generatedRoutePaths[i-1] > p {
			t.Fatalf("route table is not sorted: %q before %q", generatedRoutePaths[i-1], p)
		}
	}
}

// TestEveryParameterisedRouteIsTemplated is the substantive privacy assertion:
// for EVERY `:param` position the SPA declares, an opaque, digit-free,
// hyphenated slug — the shape heuristics cannot distinguish it from a page
// name — must be redacted.
func TestEveryParameterisedRouteIsTemplated(t *testing.T) {
	const slug = "customer-private-slug"

	paramRoutes := 0
	for _, canonical := range generatedRoutePaths {
		if !strings.Contains(canonical, "/:") {
			continue
		}
		paramRoutes++

		parts := splitPathSegments(canonical)
		probe := make([]string, len(parts))
		want := make([]string, len(parts))
		for i, seg := range parts {
			if strings.HasPrefix(seg, ":") {
				probe[i] = slug
				want[i] = idPlaceholder
				continue
			}
			probe[i] = seg
			want[i] = strings.ToLower(seg)
		}

		in := "/" + strings.Join(probe, "/")
		expected := "/" + strings.Join(want, "/")
		got := NormalizeRoute(in)

		if strings.Contains(got, slug) {
			t.Errorf("NormalizeRoute(%q) = %q leaked the opaque parameter", in, got)
			continue
		}
		// Depth/length caps may truncate a very deep route; compare against
		// the same caps rather than assuming no truncation.
		if len(expected) <= maxRouteLabelLength && got != expected {
			t.Errorf("NormalizeRoute(%q) = %q, want %q", in, got, expected)
		}
	}

	if paramRoutes == 0 {
		t.Fatal("no parameterised routes found — the generated table is wrong")
	}
	t.Logf("verified %d parameterised routes", paramRoutes)
}

// TestNamedParameterRoutesFromAcceptanceReview pins the exact cases raised in
// the observability acceptance review.
func TestNamedParameterRoutesFromAcceptanceReview(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"/s/share-token-abc", "/s/:id"},
		{"/year-review/private-share-slug", "/year-review/:id"},
		{"/trips/customer-private-slug", "/trips/:id"},
		{"/automations/private-name/edit", "/automations/:id/edit"},
		{"/charging/private-slug", "/charging/:id"},
		{"/system-status/incidents/private-slug", "/system-status/incidents/:id"},
		{"/drives/private-slug", "/drives/:id"},
		{"/drives/private-slug/replay", "/drives/:id/replay"},
		{"/vehicles/private-slug", "/vehicles/:id"},
		{"/vehicles/private-slug/access", "/vehicles/:id/access"},
	}
	for _, tt := range tests {
		if got := NormalizeRoute(tt.in); got != tt.want {
			t.Errorf("NormalizeRoute(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

// TestLiteralRoutePrecedence proves a literal route is never resolved through a
// parameterised one of the same length.
func TestLiteralRoutePrecedence(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"/automations/list", "/automations/list"},
		{"/automations/new", "/automations/new"},
		{"/vehicles/list/state", "/vehicles/list/state"},
		{"/analytics/tco", "/analytics/tco"},
		{"/account/2fa", "/account/2fa"},
	}
	for _, tt := range tests {
		if got := NormalizeRoute(tt.in); got != tt.want {
			t.Errorf("NormalizeRoute(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

// TestNormalizeRoute_PercentEncoding covers safe decoding and the malformed
// case, which must redact rather than guess.
func TestNormalizeRoute_PercentEncoding(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"encoded literal still resolves", "/year%2Dreview/2024", "/year-review/:id"},
		{"encoded slug in a param position", "/s/%73hare-token", "/s/:id"},
		{"encoded slash is opaque", "/search/%2Fsecret", "/search/:id"},
		{"malformed encoding is opaque", "/search/%zz", "/search/:id"},
		{"truncated encoding is opaque", "/search/%2", "/search/:id"},
		{"encoded space is redacted", "/search/hello%20world", "/search/:id"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NormalizeRoute(tt.in)
			if got != tt.want {
				t.Errorf("NormalizeRoute(%q) = %q, want %q", tt.in, got, tt.want)
			}
			if strings.Contains(got, "%") {
				t.Errorf("NormalizeRoute(%q) = %q retained a percent-encoding", tt.in, got)
			}
		})
	}
}

// TestNormalizeRoute_ProtocolRelative makes sure a `//host/path` value cannot
// smuggle the authority into a label.
func TestNormalizeRoute_ProtocolRelative(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"//tenant.example.com/s/share-token-abc", "/s/:id"},
		{"//tenant.example.com/dashboard", "/dashboard"},
		{"//tenant.example.com", "/"},
		{"https://tenant.example.com/s/share-token-abc?x=1#y", "/s/:id"},
	}
	for _, tt := range tests {
		if got := NormalizeRoute(tt.in); got != tt.want {
			t.Errorf("NormalizeRoute(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
