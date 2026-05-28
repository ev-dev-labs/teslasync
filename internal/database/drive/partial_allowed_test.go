package drive_test

import (
	"regexp"
	"testing"

	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
)

// TestDrivePartialAllowed_Valid verifies the partial-update allow-list
// has only well-formed SQL column identifiers. Carved from
// internal/database/helpers_test.go in Phase R4.12 alongside the
// drive_repo.go → drive/repo.go carve so the test follows the
// (now-exported) drivePartialAllowed map.
func TestDrivePartialAllowed_Valid(t *testing.T) {
	if len(drivedb.DrivePartialAllowed) == 0 {
		t.Fatal("drivePartialAllowed is empty")
	}
	colRe := regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	for key, col := range drivedb.DrivePartialAllowed {
		if key == "" {
			t.Error("empty key in drivePartialAllowed")
		}
		if col == "" {
			t.Errorf("empty column for key %q", key)
		}
		if !colRe.MatchString(col) {
			t.Errorf("column %q doesn't look like a valid SQL identifier", col)
		}
	}
}
