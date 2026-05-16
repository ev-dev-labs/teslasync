package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/features"
)

// TestGenerateFeaturesTSDeterministic asserts the features-mirror
// generator output is byte-stable across runs (Go map iteration
// order would otherwise leak in).
func TestGenerateFeaturesTSDeterministic(t *testing.T) {
	a := generate()
	b := generate()
	if !bytes.Equal(a, b) {
		t.Fatalf("generate() is not deterministic")
	}
}

// TestGenerateSPAWiringDeterministic asserts the SPA wiring mirror
// is byte-stable. The Go SPAWiringTable is a slice (already sorted)
// so this is effectively a sanity check on the writer.
func TestGenerateSPAWiringDeterministic(t *testing.T) {
	a := generateSPAWiring()
	b := generateSPAWiring()
	if !bytes.Equal(a, b) {
		t.Fatalf("generateSPAWiring() is not deterministic")
	}
}

// TestGenerateSPAWiringContent asserts the emitted file contains the
// header banner, the AiFeatureId import, the SPAWiringEntry shape,
// every feature ID, and an SPA_WIRING_BY_ID record keyed by every
// feature ID. The byte-for-byte tail of the file is also exercised
// by the --check round-trip against the live tree.
func TestGenerateSPAWiringContent(t *testing.T) {
	out := string(generateSPAWiring())
	for _, fragment := range []string{
		"DO NOT EDIT",
		"Phase-50 / 0065 W1",
		"import type { AiFeatureId } from './features';",
		"export type RenderContract = 'narrative' | 'proposal' | 'suggestion';",
		"export interface SPAWiringEntry {",
		"export const SPA_WIRING:",
		"export const SPA_WIRING_BY_ID:",
	} {
		if !strings.Contains(out, fragment) {
			t.Errorf("expected output to contain %q", fragment)
		}
	}
	for _, w := range features.SPAWiringTable {
		needle := "\"" + w.FeatureID + "\""
		if !strings.Contains(out, needle) {
			t.Errorf("expected output to contain feature ID literal %s", needle)
		}
	}
}

// TestGeneratedFilesInSync runs the equivalent of `--check` directly
// against the committed mirrors. If this test fails after a registry
// change, run `go run ./tools/aigen` and commit the result.
func TestGeneratedFilesInSync(t *testing.T) {
	root := repoRoot(t)
	cases := []struct {
		path string
		want []byte
	}{
		{filepath.Join(root, "web", "src", "ai", "features.ts"), generate()},
		{filepath.Join(root, "web", "src", "ai", "spaWiring.ts"), generateSPAWiring()},
	}
	for _, tc := range cases {
		existing, err := os.ReadFile(tc.path)
		if err != nil {
			t.Errorf("%s: read: %v", tc.path, err)
			continue
		}
		if !bytes.Equal(existing, tc.want) {
			t.Errorf("%s is stale; run `go run ./tools/aigen` and commit the result", tc.path)
		}
	}
}

func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
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
