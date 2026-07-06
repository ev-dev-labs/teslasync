package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// ---------------------------------------------------------------------------
// normalizeSQLType
// ---------------------------------------------------------------------------

func TestNormalizeSQLType(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"boolean", "BOOLEAN", "BOOLEAN"},
		{"boolean not null", "BOOLEAN NOT NULL", "BOOLEAN"},
		{"lowercase boolean", "boolean", "BOOLEAN"},
		{"text", "TEXT", "TEXT"},
		{"text trailing comma", "TEXT,", "TEXT"},
		{"text not null", "TEXT NOT NULL", "TEXT"},
		{"varchar", "VARCHAR(255)", "TEXT"},
		{"character varying", "CHARACTER VARYING", "TEXT"},
		{"integer", "INTEGER", "INTEGER"},
		{"int", "INT", "INTEGER"},
		{"smallint", "SMALLINT", "INTEGER"},
		{"bigint", "BIGINT NOT NULL", "INTEGER"},
		{"double precision", "DOUBLE PRECISION", "DOUBLE_PRECISION"},
		{"double precision not null", "DOUBLE PRECISION NOT NULL", "DOUBLE_PRECISION"},
		{"real", "REAL", "DOUBLE_PRECISION"},
		{"numeric", "NUMERIC(10,2)", "DOUBLE_PRECISION"},
		{"decimal", "DECIMAL", "DOUBLE_PRECISION"},
		{"timestamptz", "TIMESTAMPTZ", "TIMESTAMPTZ"},
		{"timestamp", "TIMESTAMP", "TIMESTAMPTZ"},
		{"jsonb", "JSONB", "JSONB"},
		{"json", "JSON", "JSONB"},
		{"lowercase and spaces normalized", "  double precision  ", "DOUBLE_PRECISION"},
		{"unknown type", "UUID", "OTHER:UUID"},
		{"empty", "", "OTHER:"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeSQLType(tt.in); got != tt.want {
				t.Errorf("normalizeSQLType(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// expectedGoType
// ---------------------------------------------------------------------------

func TestExpectedGoType(t *testing.T) {
	tests := []struct {
		name string
		vk   protomodel.ValueKind
		want string
	}{
		{"string", protomodel.ValueKindString, "string"},
		{"enum maps to string", protomodel.ValueKindEnum, "string"},
		{"bool", protomodel.ValueKindBool, "bool"},
		{"int32", protomodel.ValueKindInt32, "int32"},
		{"int64", protomodel.ValueKindInt64, "int64"},
		{"float", protomodel.ValueKindFloat, "float32"},
		{"double", protomodel.ValueKindDouble, "float64"},
		{"compound", protomodel.ValueKindCompound, "compound"},
		// Unclassified kinds intentionally fall through to "?" so the
		// compatibility check flags them for an auditor rather than
		// silently guessing a Go type.
		{"unknown falls through", protomodel.ValueKindUnknown, "?"},
		{"time falls through", protomodel.ValueKindTime, "?"},
		{"invalid falls through", protomodel.ValueKindInvalid, "?"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := expectedGoType(tt.vk); got != tt.want {
				t.Errorf("expectedGoType(%v) = %q, want %q", tt.vk, got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// compatible
// ---------------------------------------------------------------------------

func TestCompatible(t *testing.T) {
	tests := []struct {
		name   string
		goTyp  string
		sqlTyp string
		wantOK bool
	}{
		// BOOLEAN
		{"bool into boolean", "bool", "BOOLEAN", true},
		{"string into boolean fails", "string", "BOOLEAN", false},
		{"float32 into boolean fails", "float32", "BOOLEAN", false},
		// TEXT
		{"string into text", "string", "TEXT", true},
		{"compound into text", "compound", "TEXT", true},
		{"bool into text fails", "bool", "TEXT", false},
		{"float64 into text fails", "float64", "TEXT", false},
		// INTEGER
		{"int32 into integer", "int32", "INTEGER", true},
		{"int64 into integer", "int64", "INTEGER", true},
		{"float32 into integer", "float32", "INTEGER", true},
		{"float64 into integer", "float64", "INTEGER", true},
		{"string into integer fails", "string", "INTEGER", false},
		{"bool into integer fails", "bool", "INTEGER", false},
		// DOUBLE_PRECISION
		{"float32 into double", "float32", "DOUBLE_PRECISION", true},
		{"float64 into double", "float64", "DOUBLE_PRECISION", true},
		{"int32 into double", "int32", "DOUBLE_PRECISION", true},
		{"int64 into double", "int64", "DOUBLE_PRECISION", true},
		{"string into double fails", "string", "DOUBLE_PRECISION", false},
		{"bool into double fails", "bool", "DOUBLE_PRECISION", false},
		// TIMESTAMPTZ
		{"compound into timestamptz", "compound", "TIMESTAMPTZ", true},
		{"string into timestamptz", "string", "TIMESTAMPTZ", true},
		{"float32 into timestamptz fails", "float32", "TIMESTAMPTZ", false},
		{"bool into timestamptz fails", "bool", "TIMESTAMPTZ", false},
		{"question mark into timestamptz fails", "?", "TIMESTAMPTZ", false},
		// JSONB accepts everything
		{"string into jsonb", "string", "JSONB", true},
		{"bool into jsonb", "bool", "JSONB", true},
		{"question mark into jsonb", "?", "JSONB", true},
		// Unknown SQL types are skipped (permissive)
		{"anything into unknown sql", "bool", "OTHER:UUID", true},
		{"anything into missing", "string", "MISSING", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reason, ok := compatible(tt.goTyp, tt.sqlTyp)
			if ok != tt.wantOK {
				t.Fatalf("compatible(%q, %q) ok = %v, want %v (reason=%q)", tt.goTyp, tt.sqlTyp, ok, tt.wantOK, reason)
			}
			if ok && reason != "" {
				t.Errorf("compatible(%q, %q) returned ok=true but non-empty reason %q", tt.goTyp, tt.sqlTyp, reason)
			}
			if !ok && reason == "" {
				t.Errorf("compatible(%q, %q) returned ok=false but empty reason", tt.goTyp, tt.sqlTyp)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// count helpers
// ---------------------------------------------------------------------------

func TestCountHelpers(t *testing.T) {
	fs := []finding{
		{field: "new1"},
		{field: "new2"},
		{field: "fixed1", already: true},
		{field: "fixed2", already: true},
		{field: "fixed3", already: true},
		{field: "fp1", falsePositive: true},
		{field: "def1", deferred: true},
		{field: "def2", deferred: true},
	}
	if got := countFixed(fs); got != 3 {
		t.Errorf("countFixed = %d, want 3", got)
	}
	if got := countFalsePositive(fs); got != 1 {
		t.Errorf("countFalsePositive = %d, want 1", got)
	}
	if got := countDeferred(fs); got != 2 {
		t.Errorf("countDeferred = %d, want 2", got)
	}

	// Empty slice edge case.
	if got := countFixed(nil); got != 0 {
		t.Errorf("countFixed(nil) = %d, want 0", got)
	}
	if got := countFalsePositive(nil); got != 0 {
		t.Errorf("countFalsePositive(nil) = %d, want 0", got)
	}
	if got := countDeferred(nil); got != 0 {
		t.Errorf("countDeferred(nil) = %d, want 0", got)
	}
}

// ---------------------------------------------------------------------------
// parseSchema
// ---------------------------------------------------------------------------

// writeMigrationFixtures materialises a temporary repo root with a
// migrations/ directory containing every file parseSchema scans. Files
// present in content get that body; any other file required by
// migrationsToScan gets a harmless placeholder so ReadFile succeeds.
func writeMigrationFixtures(t *testing.T, content map[string]string) string {
	t.Helper()
	root := t.TempDir()
	migDir := filepath.Join(root, "migrations")
	if err := os.MkdirAll(migDir, 0o755); err != nil {
		t.Fatalf("mkdir migrations: %v", err)
	}
	for _, fname := range migrationsToScan {
		body, ok := content[fname]
		if !ok {
			body = "-- fixture placeholder: intentionally no schema\n"
		}
		if err := os.WriteFile(filepath.Join(migDir, fname), []byte(body), 0o644); err != nil {
			t.Fatalf("write %s: %v", fname, err)
		}
	}
	return root
}

func TestParseSchema_Success(t *testing.T) {
	content := map[string]string{
		"000182_positions_si.up.sql": `
DROP TABLE IF EXISTS positions CASCADE;

CREATE TABLE positions (
  vehicle_id    BIGINT NOT NULL,
  ts            TIMESTAMPTZ NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  speed_mps     DOUBLE PRECISION,
  gps_state     TEXT,
  PRIMARY KEY (vehicle_id, ts)
);

CREATE INDEX positions_ts ON positions (ts DESC);
`,
		"000183_snapshots_si.up.sql": `
CREATE TABLE climate_snapshots (
  vehicle_id BIGINT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  cabin_overheat_protection_temperature_limit_c DOUBLE PRECISION,
  driver_seat_belt BOOLEAN,
  PRIMARY KEY (vehicle_id, ts)
);
`,
		// Retypes the climate column from DOUBLE PRECISION to TEXT via
		// a multi-line DROP + ADD, applied after the CREATE TABLE above.
		"000210_climate_overheat_limit_text.up.sql": `
ALTER TABLE climate_snapshots
  DROP COLUMN IF EXISTS cabin_overheat_protection_temperature_limit_c;

ALTER TABLE climate_snapshots
  ADD COLUMN cabin_overheat_protection_temperature_limit TEXT;
`,
	}
	root := writeMigrationFixtures(t, content)

	schema, err := parseSchema(root)
	if err != nil {
		t.Fatalf("parseSchema returned error: %v", err)
	}

	pos, ok := schema["positions"]
	if !ok {
		t.Fatalf("positions table not parsed; schema=%v", schema)
	}
	wantPos := map[string]string{
		"vehicle_id": "INTEGER",
		"ts":         "TIMESTAMPTZ",
		"lat":        "DOUBLE_PRECISION",
		"speed_mps":  "DOUBLE_PRECISION",
		"gps_state":  "TEXT",
	}
	for col, want := range wantPos {
		if got := pos[col]; got != want {
			t.Errorf("positions.%s = %q, want %q", col, got, want)
		}
	}
	// The PRIMARY KEY constraint line must not be captured as a column.
	if _, ok := pos["primary"]; ok {
		t.Errorf("PRIMARY KEY line was captured as a column: %v", pos)
	}

	clim, ok := schema["climate_snapshots"]
	if !ok {
		t.Fatalf("climate_snapshots table not parsed; schema=%v", schema)
	}
	if clim["driver_seat_belt"] != "BOOLEAN" {
		t.Errorf("climate_snapshots.driver_seat_belt = %q, want BOOLEAN", clim["driver_seat_belt"])
	}
	// The ALTER DROP must remove the old _c column...
	if v, ok := clim["cabin_overheat_protection_temperature_limit_c"]; ok {
		t.Errorf("dropped column still present with type %q", v)
	}
	// ...and the ALTER ADD must introduce the replacement as TEXT.
	if got := clim["cabin_overheat_protection_temperature_limit"]; got != "TEXT" {
		t.Errorf("added column = %q, want TEXT", got)
	}
}

func TestParseSchema_MissingMigrationsDir(t *testing.T) {
	// A repo root with no migrations/ directory: the first scanned file
	// is unreadable, so parseSchema must return a wrapped error naming it.
	root := t.TempDir()
	_, err := parseSchema(root)
	if err == nil {
		t.Fatal("parseSchema on empty root returned nil error")
	}
	if !strings.Contains(err.Error(), migrationsToScan[0]) {
		t.Errorf("error %q does not mention the missing file %q", err, migrationsToScan[0])
	}
}

func TestParseSchema_MissingSingleFile(t *testing.T) {
	// Create every fixture, then delete one so a mid-scan read fails.
	root := writeMigrationFixtures(t, nil)
	victim := migrationsToScan[len(migrationsToScan)-1]
	if err := os.Remove(filepath.Join(root, "migrations", victim)); err != nil {
		t.Fatalf("remove fixture: %v", err)
	}
	_, err := parseSchema(root)
	if err == nil {
		t.Fatal("parseSchema with a missing file returned nil error")
	}
	if !strings.Contains(err.Error(), victim) {
		t.Errorf("error %q does not mention deleted file %q", err, victim)
	}
}

// ---------------------------------------------------------------------------
// buildFindings
// ---------------------------------------------------------------------------

func meta(vk protomodel.ValueKind) *protomodel.SignalMeta {
	return &protomodel.SignalMeta{ValueKind: vk}
}

func findingsByField(fs []finding) map[string]finding {
	m := make(map[string]finding, len(fs))
	for _, f := range fs {
		m[f.field] = f
	}
	return m
}

func TestBuildFindings(t *testing.T) {
	in := auditInputs{
		schema: map[string]map[string]string{
			"positions": {
				"speed_mps": "DOUBLE_PRECISION",
				"gps_state": "TEXT",
			},
			"climate_snapshots": {
				"driver_seat_belt": "BOOLEAN",
				"some_bad":         "BOOLEAN",
				"fp_ts":            "TIMESTAMPTZ",
				"def_ts":           "TIMESTAMPTZ",
			},
		},
		routes: map[string]router.Entry{
			"OKFloat":        {Field: "OKFloat", Destination: router.DestPositions, Column: "speed_mps"},
			"GpsState":       {Field: "GpsState", Destination: router.DestPositions, Column: "gps_state"},
			"ColdLog":        {Field: "ColdLog", Destination: router.DestSignalLog, Column: ""},
			"NoCol":          {Field: "NoCol", Destination: router.DestPositions, Column: ""},
			"MissingCol":     {Field: "MissingCol", Destination: router.DestPositions, Column: "nonexistent"},
			"NewBad":         {Field: "NewBad", Destination: router.DestClimateSnapshot, Column: "some_bad"},
			"DriverSeatBelt": {Field: "DriverSeatBelt", Destination: router.DestClimateSnapshot, Column: "driver_seat_belt"},
			"FalsePos":       {Field: "FalsePos", Destination: router.DestClimateSnapshot, Column: "fp_ts"},
			"Deferred":       {Field: "Deferred", Destination: router.DestClimateSnapshot, Column: "def_ts"},
		},
		signals: map[string]*protomodel.SignalMeta{
			"OKFloat":        meta(protomodel.ValueKindDouble),
			"GpsState":       meta(protomodel.ValueKindString),
			"Unrouted1":      meta(protomodel.ValueKindBool),
			"ColdLog":        meta(protomodel.ValueKindString),
			"NoCol":          meta(protomodel.ValueKindString),
			"MissingCol":     meta(protomodel.ValueKindString),
			"NewBad":         meta(protomodel.ValueKindString),
			"DriverSeatBelt": meta(protomodel.ValueKindEnum),
			"FalsePos":       meta(protomodel.ValueKindFloat),
			"Deferred":       meta(protomodel.ValueKindFloat),
		},
		destTables: map[router.Destination][]string{
			router.DestPositions:       {"positions"},
			router.DestClimateSnapshot: {"climate_snapshots"},
		},
		alreadyFixed:   map[string]bool{"DriverSeatBelt": true},
		falsePositives: map[string]string{"FalsePos": "writer handles it"},
		deferredKnown:  map[string]string{"Deferred": "pending migration 000999"},
	}

	findings, unrouted, noColumn := buildFindings(in)
	byField := findingsByField(findings)

	if len(findings) != 5 {
		t.Fatalf("got %d findings, want 5: %+v", len(findings), findings)
	}

	// Compatible signals produce no finding.
	if _, ok := byField["OKFloat"]; ok {
		t.Error("OKFloat (double->DOUBLE_PRECISION) should not be a finding")
	}
	if _, ok := byField["GpsState"]; ok {
		t.Error("GpsState (string->TEXT) should not be a finding")
	}
	// Destinations not in destTables are skipped entirely.
	if _, ok := byField["ColdLog"]; ok {
		t.Error("ColdLog routed to signal_log should be skipped, not a finding")
	}

	// Schema-drift: column not found in the destination table.
	if f := byField["MissingCol"]; f.sqlTyp != "MISSING" {
		t.Errorf("MissingCol sqlTyp = %q, want MISSING", f.sqlTyp)
	} else if !strings.Contains(f.reason, "not found") {
		t.Errorf("MissingCol reason = %q, want it to mention 'not found'", f.reason)
	}

	// Genuine new mismatch, unclassified.
	if f := byField["NewBad"]; f.already || f.deferred || f.falsePositive {
		t.Errorf("NewBad should be unclassified NEW, got %+v", f)
	} else if f.reason == "" {
		t.Error("NewBad finding has empty reason")
	}

	// Already-fixed classification.
	if f := byField["DriverSeatBelt"]; !f.already {
		t.Errorf("DriverSeatBelt should be already-fixed, got %+v", f)
	}

	// False-positive classification carries its note.
	if f := byField["FalsePos"]; !f.falsePositive || f.note != "writer handles it" {
		t.Errorf("FalsePos classification wrong: %+v", f)
	}

	// Deferred classification carries its note.
	if f := byField["Deferred"]; !f.deferred || f.note != "pending migration 000999" {
		t.Errorf("Deferred classification wrong: %+v", f)
	}

	if len(unrouted) != 1 || unrouted[0] != "Unrouted1" {
		t.Errorf("unrouted = %v, want [Unrouted1]", unrouted)
	}
	if len(noColumn) != 1 || noColumn[0] != "NoCol -> positions (no column)" {
		t.Errorf("noColumn = %v, want [NoCol -> positions (no column)]", noColumn)
	}
}

func TestBuildFindings_EmptyInputs(t *testing.T) {
	findings, unrouted, noColumn := buildFindings(auditInputs{
		signals: map[string]*protomodel.SignalMeta{},
	})
	if len(findings) != 0 || len(unrouted) != 0 || len(noColumn) != 0 {
		t.Errorf("empty inputs produced findings=%v unrouted=%v noColumn=%v", findings, unrouted, noColumn)
	}
}

// ---------------------------------------------------------------------------
// sortFindings
// ---------------------------------------------------------------------------

func TestSortFindings(t *testing.T) {
	findings := []finding{
		{field: "z", dest: "a"},                        // rank 0 (new)
		{field: "already", dest: "a", already: true},   // rank 3
		{field: "a", dest: "a"},                        // rank 0 (new), sorts before z
		{field: "fp", dest: "a", falsePositive: true},  // rank 2
		{field: "deferred", dest: "a", deferred: true}, // rank 1
		{field: "newB", dest: "b"},                     // rank 0, dest b sorts after dest a
	}
	sortFindings(findings)

	gotOrder := make([]string, len(findings))
	for i, f := range findings {
		gotOrder[i] = f.field
	}
	wantOrder := []string{"a", "z", "newB", "deferred", "fp", "already"}
	for i := range wantOrder {
		if gotOrder[i] != wantOrder[i] {
			t.Fatalf("sort order = %v, want %v", gotOrder, wantOrder)
		}
	}
}

// ---------------------------------------------------------------------------
// writeReport
// ---------------------------------------------------------------------------

func TestWriteReport_WithFindings(t *testing.T) {
	findings := []finding{
		{field: "NewField", dest: "positions", column: "col_a", vk: "ValueKindString", goTyp: "string", sqlTyp: "BOOLEAN", reason: "bad"},
		{field: "FixedField", dest: "climate_snapshot", column: "col_b", vk: "ValueKindEnum", goTyp: "string", sqlTyp: "BOOLEAN", already: true},
		{field: "FPField", dest: "tire_pressure_snapshot", column: "col_c", vk: "ValueKindFloat", goTyp: "float32", sqlTyp: "TIMESTAMPTZ", falsePositive: true, note: "writer converts"},
		{field: "DefField", dest: "motor_snapshot", column: "col_d", vk: "ValueKindFloat", goTyp: "float32", sqlTyp: "TEXT", deferred: true, note: "migration 001"},
	}
	unrouted := []string{"UZ", "UA"}
	noColumn := []string{"NC -> security_event (no column)"}

	var buf bytes.Buffer
	writeReport(&buf, 300, 290, findings, unrouted, noColumn)
	out := buf.String()

	wantContains := []string{
		"# Signal-type audit",
		"Total signals in metadata:           300",
		"Routed (in routing.yaml):            290",
		"Mismatch candidates found:           4",
		"  already-fixed by codec coercion:   1",
		"  false positives (writer-handled):  1",
		"  deferred to schema migration:      1",
		"  *** NEW (action required):         1",
		"## Type mismatch candidates",
		"NewField",
		"*** NEW ***",
		"FixedField",
		"fixed (codec coercion)",
		"false-positive: writer converts",
		"DEFERRED: migration 001",
		"## Fields in metadata but NOT in routing.yaml (2)",
		"## Fields routed to a snapshot destination with no column mapping (1)",
		"NC -> security_event (no column)",
	}
	for _, want := range wantContains {
		if !strings.Contains(out, want) {
			t.Errorf("report missing %q\n---\n%s", want, out)
		}
	}

	// unrouted must be sorted in place.
	if unrouted[0] != "UA" || unrouted[1] != "UZ" {
		t.Errorf("unrouted not sorted in place: %v", unrouted)
	}
	uaIdx := strings.Index(out, "  - UA")
	uzIdx := strings.Index(out, "  - UZ")
	if uaIdx < 0 || uzIdx < 0 || uaIdx > uzIdx {
		t.Errorf("unrouted entries not rendered in sorted order (UA=%d, UZ=%d)", uaIdx, uzIdx)
	}
}

func TestWriteReport_NoFindings(t *testing.T) {
	var buf bytes.Buffer
	writeReport(&buf, 100, 90, nil, nil, nil)
	out := buf.String()

	if !strings.Contains(out, "Mismatch candidates found:           0") {
		t.Errorf("expected zero-candidate summary line, got:\n%s", out)
	}
	if !strings.Contains(out, "  *** NEW (action required):         0") {
		t.Errorf("expected zero NEW line, got:\n%s", out)
	}
	// Detail sections must be omitted when their slices are empty.
	if strings.Contains(out, "## Type mismatch candidates") {
		t.Error("type-mismatch section rendered despite zero findings")
	}
	if strings.Contains(out, "## Fields in metadata but NOT in routing.yaml") {
		t.Error("unrouted section rendered despite empty slice")
	}
	if strings.Contains(out, "## Fields routed to a snapshot destination") {
		t.Error("noColumn section rendered despite empty slice")
	}
}

func TestWriteReport_TruncatesLongLists(t *testing.T) {
	// 25 unrouted entries: only the first 20 are listed, with a
	// "... and 5 more" summary line.
	unrouted := make([]string, 25)
	for i := range unrouted {
		// zero-padded so sort order is lexicographic and predictable
		unrouted[i] = "field" + string(rune('A'+i%26)) + string(rune('0'+i/26))
	}
	var buf bytes.Buffer
	writeReport(&buf, 1, 1, nil, unrouted, nil)
	out := buf.String()

	if !strings.Contains(out, "## Fields in metadata but NOT in routing.yaml (25)") {
		t.Errorf("expected count of 25 in header:\n%s", out)
	}
	if !strings.Contains(out, "... and 5 more") {
		t.Errorf("expected truncation summary '... and 5 more':\n%s", out)
	}
	listed := strings.Count(out, "  - field")
	if listed != 20 {
		t.Errorf("listed %d unrouted entries, want 20 (rest truncated)", listed)
	}
}

// ---------------------------------------------------------------------------
// run (end-to-end)
// ---------------------------------------------------------------------------

// findRepoRoot walks up from the test working directory to the module
// root (the directory containing go.mod). The audit reads real migrations
// relative to that root.
func findRepoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Skip("module root (go.mod) not found from test cwd; skipping integration test")
		}
		dir = parent
	}
}

func TestRun_Integration(t *testing.T) {
	root := findRepoRoot(t)

	var stdout, stderr bytes.Buffer
	code := run(&stdout, &stderr, root)
	if code != 0 {
		t.Fatalf("run() exit = %d, want 0; stderr=%q", code, stderr.String())
	}
	if stderr.Len() != 0 {
		t.Errorf("run() wrote to stderr on success: %q", stderr.String())
	}

	out := stdout.String()
	for _, want := range []string{
		"# Signal-type audit",
		"Total signals in metadata:",
		"Routed (in routing.yaml):",
		"Mismatch candidates found:",
		"*** NEW (action required):",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("integration report missing %q", want)
		}
	}
}

func TestRun_BadRepoRoot(t *testing.T) {
	// A directory with no migrations/ subtree makes parseSchema fail;
	// run must surface exit code 2 and log the failing stage to stderr.
	var stdout, stderr bytes.Buffer
	code := run(&stdout, &stderr, t.TempDir())
	if code != 2 {
		t.Fatalf("run() with bad root exit = %d, want 2", code)
	}
	if !strings.Contains(stderr.String(), "parseSchema") {
		t.Errorf("stderr = %q, want it to mention parseSchema", stderr.String())
	}
}
