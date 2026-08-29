package codec

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
)

func TestIngestOriginVocabularyMatchesMigration(t *testing.T) {
	t.Parallel()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller could not locate test source")
	}

	migrationPath := filepath.Join(
		filepath.Dir(sourceFile),
		"..",
		"..",
		"..",
		"migrations",
		"000234_signal_log_ingest_provenance.up.sql",
	)
	body, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read provenance migration: %v", err)
	}

	checkPattern := regexp.MustCompile(`(?s)CHECK \(ingest_origin IS NULL OR ingest_origin IN \((.*?)\)\) NOT VALID`)
	match := checkPattern.FindSubmatch(body)
	if len(match) != 2 {
		t.Fatal("ingest_origin CHECK vocabulary not found in migration")
	}
	quotedPattern := regexp.MustCompile(`'([^']+)'`)
	sqlValues := quotedPattern.FindAllSubmatch(match[1], -1)
	got := make([]string, 0, len(sqlValues))
	for _, value := range sqlValues {
		got = append(got, string(value[1]))
	}
	sort.Strings(got)

	want := make([]string, 0, len(validIngestOrigins))
	for _, origin := range validIngestOrigins {
		want = append(want, string(origin))
	}
	sort.Strings(want)

	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("migration origin vocabulary = %v, Go vocabulary = %v", got, want)
	}
}

func TestProvenanceMigrationPreservesIndependentTransportEvidence(t *testing.T) {
	t.Parallel()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller could not locate test source")
	}
	migrationsDir := filepath.Join(filepath.Dir(sourceFile), "..", "..", "..", "migrations")
	up, err := os.ReadFile(filepath.Join(migrationsDir, "000234_signal_log_ingest_provenance.up.sql"))
	if err != nil {
		t.Fatalf("read provenance up migration: %v", err)
	}
	down, err := os.ReadFile(filepath.Join(migrationsDir, "000234_signal_log_ingest_provenance.down.sql"))
	if err != nil {
		t.Fatalf("read provenance down migration: %v", err)
	}

	for _, fragment := range []string{
		"CREATE TABLE signal_transport_evidence",
		"PRIMARY KEY (vehicle_id, source_emitted_at, field, ingest_origin)",
		"CREATE TRIGGER signal_log_transport_evidence_capture",
		"AFTER INSERT OR UPDATE ON signal_log",
		"source_emitted_at IS NOT NULL",
		"received_at IS NOT NULL",
	} {
		if !strings.Contains(string(up), fragment) {
			t.Errorf("up migration missing %q", fragment)
		}
	}

	for _, fragment := range []string{
		"DROP TRIGGER IF EXISTS signal_log_transport_evidence_capture",
		"DROP TABLE IF EXISTS signal_transport_evidence",
	} {
		if !strings.Contains(string(down), fragment) {
			t.Errorf("down migration missing %q", fragment)
		}
	}
}

func TestProvenanceMigrationOrdersCompleteEvidenceTuple(t *testing.T) {
	t.Parallel()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller could not locate test source")
	}
	body, err := os.ReadFile(filepath.Join(
		filepath.Dir(sourceFile),
		"..",
		"..",
		"..",
		"migrations",
		"000234_signal_log_ingest_provenance.up.sql",
	))
	if err != nil {
		t.Fatalf("read provenance migration: %v", err)
	}
	sql := string(body)

	for _, pattern := range []string{
		`received_at\s*=\s*EXCLUDED\.received_at`,
		`normalization_version\s*=\s*EXCLUDED\.normalization_version`,
		`EXCLUDED\.normalization_version\s*>\s*signal_transport_evidence\.normalization_version`,
		`EXCLUDED\.normalization_version\s*=\s*signal_transport_evidence\.normalization_version`,
		`EXCLUDED\.received_at\s*<\s*signal_transport_evidence\.received_at`,
	} {
		if !regexp.MustCompile(pattern).MatchString(sql) {
			t.Errorf("up migration missing evidence winner rule %q", pattern)
		}
	}
	for _, forbidden := range []string{
		"received_at = LEAST(",
		"normalization_version = GREATEST(",
	} {
		if strings.Contains(sql, forbidden) {
			t.Errorf("up migration retains split-tuple expression %q", forbidden)
		}
	}
}
