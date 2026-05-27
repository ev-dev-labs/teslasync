package features

import (
	"os"
	"path/filepath"
	"testing"
)

// TestSPAWiringSelfCheck is the canonical CI gate that asserts the
// static SPAWiringTable is in lock-step with the live Registry.
func TestSPAWiringSelfCheck(t *testing.T) {
	if err := SPAWiringSelfCheck(); err != nil {
		t.Fatalf("SPAWiringSelfCheck: %v", err)
	}
}

// TestSPAWiringComponentsExist asserts that every component path
// listed in SPAWiringTable resolves to an actual file on disk
// (relative to the repository root). The Go test binary normally
// runs from the package directory; we walk up to the repo root by
// looking for the go.mod file.
func TestSPAWiringComponentsExist(t *testing.T) {
	root := repoRoot(t)
	webSrc := filepath.Join(root, "web", "src")
	for _, w := range SPAWiringTable {
		full := filepath.Join(webSrc, filepath.FromSlash(w.Component))
		if _, err := os.Stat(full); err != nil {
			t.Errorf("SPAWiringTable[%s]: component %q does not exist at %s: %v",
				w.FeatureID, w.Component, full, err)
		}
	}
}

// TestSPAWiringIndicatorOnlyExists asserts each allowlist entry
// points at a real file. Stale allowlist entries dilute the W1-B
// enforcement signal.
func TestSPAWiringIndicatorOnlyExists(t *testing.T) {
	root := repoRoot(t)
	webSrc := filepath.Join(root, "web", "src")
	for _, p := range SPAWiringIndicatorOnly {
		full := filepath.Join(webSrc, filepath.FromSlash(p))
		if _, err := os.Stat(full); err != nil {
			t.Errorf("SPAWiringIndicatorOnly: %q does not exist at %s: %v",
				p, full, err)
		}
	}
}

// TestSPAWiringEndpointPathRoundTrip documents the helper trio
// SPAWiringEndpointMethod / SPAWiringEndpointPath /
// SPAWiringEndpointStaticPrefix against a handful of representative
// canonical endpoint strings.
func TestSPAWiringEndpointPathRoundTrip(t *testing.T) {
	cases := []struct {
		endpoint   string
		wantMethod string
		wantPath   string
		wantPrefix string
	}{
		{"POST /api/v1/ai/chatbot", "POST", "/ai/chatbot", "/ai/chatbot"},
		{"POST /api/v1/ai/drives/{driveID}/coach", "POST", "/ai/drives/{driveID}/coach", "/ai/drives/"},
		{"GET /api/v1/ai/_internal/health", "GET", "/ai/_internal/health", "/ai/_internal/health"},
		{"POST /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft", "POST", "/ai/vehicles/{vehicleID}/paint-preview/draft", "/ai/vehicles/"},
	}
	for _, tc := range cases {
		if got := SPAWiringEndpointMethod(tc.endpoint); got != tc.wantMethod {
			t.Errorf("SPAWiringEndpointMethod(%q) = %q, want %q", tc.endpoint, got, tc.wantMethod)
		}
		if got := SPAWiringEndpointPath(tc.endpoint); got != tc.wantPath {
			t.Errorf("SPAWiringEndpointPath(%q) = %q, want %q", tc.endpoint, got, tc.wantPath)
		}
		if got := SPAWiringEndpointStaticPrefix(tc.endpoint); got != tc.wantPrefix {
			t.Errorf("SPAWiringEndpointStaticPrefix(%q) = %q, want %q", tc.endpoint, got, tc.wantPrefix)
		}
	}
}

// TestSPAWiringIsIndicatorOnly verifies the allowlist lookup.
func TestSPAWiringIsIndicatorOnly(t *testing.T) {
	if !IsIndicatorOnly("components/ai/AIChatbotIndicator.tsx") {
		t.Fatal("AIChatbotIndicator.tsx should be allowlisted")
	}
	if IsIndicatorOnly("components/ai/AIDigestNarration.tsx") {
		t.Fatal("AIDigestNarration.tsx must NOT be allowlisted")
	}
}

// repoRoot locates the repository root by walking up from the
// current working directory until a go.mod file is found. The Go
// test binary runs from the package directory; the registry package
// lives several levels below the repo root.
func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("os.Getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("repoRoot: walked past filesystem root without finding go.mod")
		}
		dir = parent
	}
}
