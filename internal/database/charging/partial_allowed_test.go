package charging_test

import (
	"regexp"
	"testing"

	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
)

// TestChargingPartialAllowed_Valid verifies the partial-update allow-list
// has only well-formed SQL column identifiers. Carved from
// internal/database/helpers_test.go in Phase R4.11 alongside the
// charging_repo.go → charging/repo.go carve so the test follows the
// (now-exported) chargingPartialAllowed map.
func TestChargingPartialAllowed_Valid(t *testing.T) {
	if len(chargingdb.ChargingPartialAllowed) == 0 {
		t.Fatal("chargingPartialAllowed is empty")
	}
	colRe := regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	for key, col := range chargingdb.ChargingPartialAllowed {
		if key == "" {
			t.Error("empty key in chargingPartialAllowed")
		}
		if col == "" {
			t.Errorf("empty column for key %q", key)
		}
		if !colRe.MatchString(col) {
			t.Errorf("column %q doesn't look like a valid SQL identifier", col)
		}
	}
}
