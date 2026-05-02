package signal_test

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestNoSignalLogStateReadMethods asserts the deleted broken-state-read methods stay deleted.
func TestNoSignalLogStateReadMethods(t *testing.T) {
	forbidden := []*regexp.Regexp{
		regexp.MustCompile(`func \(\w+ \*SignalLogReader\) SnapshotAt\(`),
		regexp.MustCompile(`func \(\w+ \*SignalLogReader\) SignalAt\(`),
		regexp.MustCompile(`func \(\w+ \*SignalLogReader\) SnapshotBetween\(`),
		regexp.MustCompile(`func \(\w+ \*SignalLogReader\) SignalTracePivot\(`),
		regexp.MustCompile(`func \(\w+ \*SignalLogReader\) SignalTracePivotFlat\(`),
		regexp.MustCompile(`func \(\w+ \*SignalHistoryWriter\) GetLatestPerSignal\(`),
		regexp.MustCompile(`func \(\w+ \*SignalHistoryWriter\) SnapshotAt\(`),
		regexp.MustCompile(`func \(\w+ \*SignalHistoryWriter\) SignalAt\(`),
		regexp.MustCompile(`func \(\w+ \*SignalHistoryWriter\) SnapshotBetween\(`),
	}
	root := mustRepoRoot(t)
	dbDir := filepath.Join(root, "internal", "database")
	err := filepath.Walk(dbDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") {
			return err
		}
		body, _ := os.ReadFile(path)
		for _, re := range forbidden {
			if re.Match(body) {
				t.Errorf("forbidden state-read method re-introduced in %s: %s — see ARCHITECTURE.md ADR-002", path, re.String())
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// TestHandlersDoNotCallDeletedSymbols ensures no internal/api OR cmd/ file references the legacy state-read names.
// Walks both internal/api/ AND cmd/ (workers + main) so future workers can't re-introduce the bug class.
func TestHandlersDoNotCallDeletedSymbols(t *testing.T) {
	forbidden := []string{
		".SnapshotAt(",
		"signalLogReader.SignalAt(",
		"signalHistoryWriter.SignalAt(",
		"SignalTracePivot(",
		"SignalTracePivotFlat(",
		"GetLatestPerSignal(",
		"SnapshotBetween(",
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
			text := string(body)
			for _, sym := range forbidden {
				if strings.Contains(text, sym) {
					t.Errorf("file %s references deleted state-read symbol %q — must use signal.StateReader instead (see ARCHITECTURE.md ADR-002)", path, sym)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}

func mustRepoRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	dir := wd
	for i := 0; i < 8; i++ {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		dir = filepath.Dir(dir)
	}
	t.Fatal("repo root not found")
	return ""
}
