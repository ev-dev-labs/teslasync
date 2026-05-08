package database

import (
	"strings"
	"testing"
)

// TestAlertRuleColumnsIncludesMaxFiresCap pins the slice 0003 contract:
// max_fires_per_resolution must appear in BOTH the SELECT column list
// and the canonical scan order, otherwise a Create/Update would silently
// drop the value or scan it into the wrong destination.
//
// SQL-shape tests are the codebase's accepted way of pinning critical
// schema contracts without a containerised DB (see guard_repo_test.go,
// vampire_drain_repo_test.go, mileage_repo_test.go for the same pattern).
// Phase-49 / Slice 0003 / Decision D5.
func TestAlertRuleColumnsIncludesMaxFiresCap(t *testing.T) {
	if !strings.Contains(alertRuleColumns, "max_fires_per_resolution") {
		t.Fatalf("alertRuleColumns must include max_fires_per_resolution; got: %q", alertRuleColumns)
	}
}
