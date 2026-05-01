package signal_test

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestNoSnapshotTableCurrentStateReads forbids "ORDER BY ts DESC LIMIT 1" patterns
// against snapshot tables in handler AND worker code. These reads exhibit the same
// staleness bug class as the deleted SignalLogReader.SnapshotAt — current state must
// come from signal.StateReader, not from the snapshot history.
func TestNoSnapshotTableCurrentStateReads(t *testing.T) {
	tables := []string{
		"positions", "security_events", "media_snapshots", "motor_snapshots",
		"tire_pressure_snapshots", "safety_snapshots", "climate_snapshots",
		"charging_telemetry",
	}
	patterns := make([]*regexp.Regexp, 0, len(tables))
	for _, tbl := range tables {
		patterns = append(patterns, regexp.MustCompile(`(?is)FROM\s+`+regexp.QuoteMeta(tbl)+`\b.*ORDER\s+BY\s+\w+\s+DESC\s+LIMIT\s+1`))
	}
	root := mustRepoRoot(t)
	scanDirs := []string{
		filepath.Join(root, "internal", "api"),
		filepath.Join(root, "cmd"),
	}
	for _, dir := range scanDirs {
		err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return err
			}
			body, _ := os.ReadFile(path)
			for i, re := range patterns {
				if re.Match(body) {
					t.Errorf("file %s reads current state from snapshot table %q via ORDER BY ... LIMIT 1 — must use signal.StateReader instead (see ARCHITECTURE.md ADR-002)", path, tables[i])
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}
