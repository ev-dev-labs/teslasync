package drive

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func readPlaceLabelMigration(t *testing.T, direction string) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "migrations",
		"000226_drive_place_label_version."+direction+".sql")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s migration: %v", direction, err)
	}
	return string(body)
}

// TestPlaceLabelMigrationBackfillsExistingRowsAsStale pins the two-step default
// that makes the whole repair work.
//
// Adding the column with DEFAULT 0 lands every pre-existing row on 0, marking
// it for repair; raising the default to the current revision afterwards means
// rows written by the new code are never queued. Collapsing this into a single
// `DEFAULT <current>` would stamp every legacy row as already-correct and the
// repair would silently never run — the drives reported in production would
// keep their duplicated Start/Destination labels forever.
func TestPlaceLabelMigrationBackfillsExistingRowsAsStale(t *testing.T) {
	sql := readPlaceLabelMigration(t, "up")

	addCol := regexp.MustCompile(`(?i)ADD COLUMN IF NOT EXISTS place_label_version\s+SMALLINT\s+NOT NULL\s+DEFAULT\s+0`)
	if !addCol.MatchString(sql) {
		t.Error("column must be added with DEFAULT 0 so existing rows are queued for repair")
	}

	setDefault := regexp.MustCompile(`(?i)ALTER COLUMN place_label_version SET DEFAULT\s+(\d+)`)
	m := setDefault.FindStringSubmatch(sql)
	if m == nil {
		t.Fatal("migration must raise the default after backfilling, or every new drive would be queued for repair")
	}
	if m[1] != "2" {
		t.Errorf("default should match drive.PlaceLabelVersion (%d), got %s", PlaceLabelVersion, m[1])
	}
	if strings.Index(sql, "ADD COLUMN") > strings.Index(sql, "SET DEFAULT") {
		t.Error("SET DEFAULT must come after ADD COLUMN, otherwise existing rows are not marked stale")
	}
}

// TestPlaceLabelMigrationIndexesOnlyTheBacklog keeps the startup scan free once
// the repair drains. A full index on place_label_version would stay as large as
// the drives table forever for a column that is read once per boot.
func TestPlaceLabelMigrationIndexesOnlyTheBacklog(t *testing.T) {
	sql := readPlaceLabelMigration(t, "up")
	if !strings.Contains(sql, "CREATE INDEX IF NOT EXISTS idx_drives_place_label_stale") {
		t.Fatal("missing backlog index")
	}
	if !strings.Contains(sql, "WHERE place_label_version < 2") {
		t.Error("index must be partial on the repair backlog")
	}
}

// TestPlaceLabelDownMigrationIsComplete guards rollback: the index depends on
// the column, so dropping them out of order fails.
func TestPlaceLabelDownMigrationIsComplete(t *testing.T) {
	sql := readPlaceLabelMigration(t, "down")
	idx := strings.Index(sql, "DROP INDEX IF EXISTS idx_drives_place_label_stale")
	col := strings.Index(sql, "DROP COLUMN IF EXISTS place_label_version")
	if idx < 0 {
		t.Error("down migration does not drop idx_drives_place_label_stale")
	}
	if col < 0 {
		t.Error("down migration does not drop place_label_version")
	}
	if idx >= 0 && col >= 0 && idx > col {
		t.Error("index must be dropped before the column it depends on")
	}
}
