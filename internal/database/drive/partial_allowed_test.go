package drive_test

import (
	"regexp"
	"testing"

	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
)

// TestDrivePartialAllowed_Valid verifies the partial-update allow-list has
// only well-formed SQL column identifiers. The test lives with the exported
// DrivePartialAllowed map so future allow-list changes are checked locally.
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
