package main

import (
	"strings"
	"testing"
)

func TestDiffFrozenPackageIgnoresNewTestFiles(t *testing.T) {
	base := frozenPackageSnapshot("router.go")
	current := frozenPackageSnapshot("router.go", "router_data_repair_test.go")

	for _, regression := range diff(base, current) {
		if strings.Contains(regression, "frozen package") {
			t.Fatalf("new test file triggered frozen-package regression: %s", regression)
		}
	}
}

func TestDiffFrozenPackageRejectsNewProductionFiles(t *testing.T) {
	base := frozenPackageSnapshot("router.go")
	current := frozenPackageSnapshot("router.go", "router_data_repair.go")

	regressions := diff(base, current)
	if len(regressions) != 1 {
		t.Fatalf("regressions = %v, want one frozen-package regression", regressions)
	}
	if !strings.Contains(regressions[0], "new file in internal/api/router_data_repair.go (frozen package)") {
		t.Fatalf("regression = %q, want the new production file", regressions[0])
	}
}

func frozenPackageSnapshot(files ...string) Snapshot {
	return Snapshot{
		DocGoCoverage: 1,
		Packages: []PkgMetric{
			{
				Path:  "internal/api",
				Files: files,
			},
		},
	}
}
