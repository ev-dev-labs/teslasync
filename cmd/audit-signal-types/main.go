// One-off audit: cross-reference protomodel.SignalsByName (declared
// ValueKind) against routing.yaml (hot-column destination) against
// the actual DB schema (column SQL type) to find type-shape mismatches
// like DriverSeatBelt/GpsState/RearSeatHeaters before they bite in
// production.
//
// Run from repo root:
//
//	go run ./cmd/audit-signal-types
//
// Output: a tabular report grouped by mismatch class. The audit
// findings never influence the exit code — this is a discovery tool,
// not a CI gate. The process exits 0 on a completed audit and 2 only on
// a fatal setup error (working directory unavailable, unreadable
// migrations, or malformed routing.yaml).
package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// Maps router.Destination → list of (table_name) candidates the writer
// might insert into. For destinations that map cleanly to a single
// table, this is one-element. For DestSignalLog / DestDrop the column
// check is skipped because there is no field-specific column.
var destinationTables = map[router.Destination][]string{
	router.DestPositions:         {"positions"},
	router.DestClimateSnapshot:   {"climate_snapshots"},
	router.DestMotorSnapshot:     {"motor_snapshots"},
	router.DestTirePressure:      {"tire_pressure_snapshots"},
	router.DestMediaSnapshot:     {"media_snapshots"},
	router.DestSafetySnapshot:    {"safety_snapshots"},
	router.DestLocationSnapshot:  {"location_snapshots"},
	router.DestSecurityEvent:     {"security_events"},
	router.DestChargingTelemetry: {"charging_telemetry"},
	router.DestDriveTelemetry:    {"drive_telemetry"},
	// signal_log, drop, unit_history have no per-field column to check
}

var migrationsToScan = []string{
	"000182_positions_si.up.sql",
	"000183_snapshots_si.up.sql",
	"000184_charging_si.up.sql",
	"000185_drives_si.up.sql",
	"000190_drive_telemetry_si.up.sql",
	// This migration renames a climate_snapshots column from DOUBLE PRECISION
	// to TEXT; parseSchema handles it through ALTER TABLE parsing.
	"000210_climate_overheat_limit_text.up.sql",
}

// createTableRE captures "CREATE TABLE <name> (" — case-insensitive.
var createTableRE = regexp.MustCompile(`(?i)CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(`)

// columnLineRE captures a column definition line. Lenient: matches
//
//	col_name  SQL_TYPE  (constraints...) ,
var columnLineRE = regexp.MustCompile(`^\s*([a-z_][a-z0-9_]*)\s+([A-Z][A-Z0-9 _]*)`)

// alterDropRE captures "ALTER TABLE <name> DROP COLUMN [IF EXISTS] <col>".
// Single-line form only — sufficient for current migrations.
var alterDropRE = regexp.MustCompile(`(?i)ALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)`)

// alterAddRE captures "ALTER TABLE <name> ADD COLUMN [IF NOT EXISTS] <col> <SQL_TYPE>".
var alterAddRE = regexp.MustCompile(`(?i)ALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+([A-Z][A-Z0-9 _]*)`)

func normalizeSQLType(raw string) string {
	s := strings.ToUpper(strings.TrimSpace(raw))
	s = strings.TrimSuffix(s, ",")
	switch {
	case strings.HasPrefix(s, "BOOLEAN"):
		return "BOOLEAN"
	case strings.HasPrefix(s, "TEXT"):
		return "TEXT"
	case strings.HasPrefix(s, "VARCHAR"), strings.HasPrefix(s, "CHARACTER VARYING"):
		return "TEXT"
	case strings.HasPrefix(s, "INTEGER"), strings.HasPrefix(s, "INT"), strings.HasPrefix(s, "SMALLINT"), strings.HasPrefix(s, "BIGINT"):
		return "INTEGER"
	case strings.HasPrefix(s, "DOUBLE PRECISION"), strings.HasPrefix(s, "REAL"), strings.HasPrefix(s, "NUMERIC"), strings.HasPrefix(s, "DECIMAL"):
		return "DOUBLE_PRECISION"
	case strings.HasPrefix(s, "TIMESTAMPTZ"), strings.HasPrefix(s, "TIMESTAMP"):
		return "TIMESTAMPTZ"
	case strings.HasPrefix(s, "JSONB"), strings.HasPrefix(s, "JSON"):
		return "JSONB"
	}
	return "OTHER:" + s
}

// parseSchema walks the listed migration files and builds (table, col) -> sqlTyp.
// Processes CREATE TABLE blocks then applies semicolon-terminated
// "ALTER TABLE ... DROP/ADD COLUMN" statements in file order so a later
// migration that renames or retypes a column is reflected in the
// final map (e.g. 000210 drops `cabin_overheat_protection_temperature_limit_c`
// DOUBLE PRECISION and adds `cabin_overheat_protection_temperature_limit` TEXT).
//
// ALTER statements may span multiple lines; the parser splits on
// semicolons (string-literal-free SQL is fine for our migration
// authoring conventions) and then matches the whole statement.
func parseSchema(repoRoot string) (map[string]map[string]string, error) {
	out := map[string]map[string]string{}
	for _, fname := range migrationsToScan {
		path := filepath.Join(repoRoot, "migrations", fname)
		body, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", fname, err)
		}
		// Strip block comments (handled by the line iterator's `--`
		// skip below for line comments) so the per-statement regex
		// matches don't get confused. We only have line comments in
		// the audited files, so this is a safety pre-pass for future
		// migrations.
		raw := string(body)
		// First pass — CREATE TABLE block extraction (line-based state
		// machine, unchanged).
		lines := strings.Split(raw, "\n")
		var inTable string
		for _, line := range lines {
			line = strings.TrimRight(line, "\r")
			if inTable == "" {
				if m := createTableRE.FindStringSubmatch(line); m != nil {
					inTable = m[1]
					if _, ok := out[inTable]; !ok {
						out[inTable] = map[string]string{}
					}
				}
				continue
			}
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, ");") || trimmed == ")" {
				inTable = ""
				continue
			}
			upper := strings.ToUpper(trimmed)
			if strings.HasPrefix(upper, "PRIMARY KEY") || strings.HasPrefix(upper, "CONSTRAINT") ||
				strings.HasPrefix(upper, "FOREIGN KEY") || strings.HasPrefix(upper, "UNIQUE") ||
				strings.HasPrefix(upper, "CHECK") || strings.HasPrefix(upper, "--") {
				continue
			}
			if m := columnLineRE.FindStringSubmatch(line); m != nil {
				col := m[1]
				sqlTyp := normalizeSQLType(m[2])
				out[inTable][col] = sqlTyp
			}
		}
		// Second pass — apply ALTER deltas at statement granularity.
		// Strip line comments first so a `-- foo` mid-statement does
		// not confuse the regex when statements are joined.
		var clean strings.Builder
		for _, line := range strings.Split(raw, "\n") {
			line = strings.TrimRight(line, "\r")
			if i := strings.Index(line, "--"); i >= 0 {
				line = line[:i]
			}
			clean.WriteString(line)
			clean.WriteString(" ")
		}
		flat := clean.String()
		// Whitespace-collapse so multi-line statements match the
		// single-line regex without further changes.
		flat = strings.Join(strings.Fields(flat), " ")
		for _, stmt := range strings.Split(flat, ";") {
			stmt = strings.TrimSpace(stmt)
			if stmt == "" {
				continue
			}
			if m := alterAddRE.FindStringSubmatch(stmt); m != nil {
				table := m[1]
				col := m[2]
				sqlTyp := normalizeSQLType(m[3])
				if _, ok := out[table]; !ok {
					out[table] = map[string]string{}
				}
				out[table][col] = sqlTyp
				continue
			}
			if m := alterDropRE.FindStringSubmatch(stmt); m != nil {
				table := m[1]
				col := m[2]
				if cols, ok := out[table]; ok {
					delete(cols, col)
				}
			}
		}
	}
	return out, nil
}

// expectedGoType returns the Go runtime type that codec.Atomic.Value
// carries for a given ValueKind, post-canonicalisation. This is what
// the writer hands to pgx (via bindSnapshotValue or per-writer
// type assertion).
func expectedGoType(vk protomodel.ValueKind) string {
	switch vk {
	case protomodel.ValueKindString, protomodel.ValueKindEnum:
		return "string"
	case protomodel.ValueKindBool:
		return "bool"
	case protomodel.ValueKindInt32:
		return "int32"
	case protomodel.ValueKindInt64:
		return "int64"
	case protomodel.ValueKindFloat:
		return "float32"
	case protomodel.ValueKindDouble:
		return "float64"
	case protomodel.ValueKindCompound:
		return "compound"
	}
	return "?"
}

// compatible returns ("", true) if a Go-typed value can be bound to the
// given SQL column type. Returns (reason, false) on mismatch. The
// snapshot_base.bindSnapshotValue routes numerics through signal.Float64
// → float64, so for snapshot tables the bound type is always bool /
// string / float64 — the table here reflects that.
func compatible(goTyp, sqlTyp string) (string, bool) {
	switch sqlTyp {
	case "BOOLEAN":
		if goTyp == "bool" {
			return "", true
		}
		return fmt.Sprintf("declared kind => Go %s but DB column is BOOLEAN — pgx will refuse the bind", goTyp), false
	case "TEXT":
		if goTyp == "string" || goTyp == "compound" {
			return "", true
		}
		return fmt.Sprintf("declared kind => Go %s but DB column is TEXT — pgx will refuse the bind", goTyp), false
	case "INTEGER":
		if goTyp == "int32" || goTyp == "int64" || goTyp == "float32" || goTyp == "float64" {
			return "", true
		}
		return fmt.Sprintf("declared kind => Go %s but DB column is INTEGER", goTyp), false
	case "DOUBLE_PRECISION":
		if goTyp == "float32" || goTyp == "float64" || goTyp == "int32" || goTyp == "int64" {
			return "", true
		}
		return fmt.Sprintf("declared kind => Go %s but DB column is DOUBLE PRECISION — bind would fail", goTyp), false
	case "TIMESTAMPTZ":
		if goTyp == "compound" || goTyp == "string" {
			return "", true
		}
		return fmt.Sprintf("declared kind => Go %s but DB column is TIMESTAMPTZ", goTyp), false
	case "JSONB":
		return "", true // jsonb accepts most things via pgx
	}
	return "", true // unknown sql types: skip
}

type finding struct {
	field         string
	dest          string
	table         string
	column        string
	vk            string
	goTyp         string
	sqlTyp        string
	reason        string
	already       bool // codec coercion already handles this field
	falsePositive bool // writer-side conversion handles it, not a real bug
	deferred      bool // genuine mismatch but deferred to schema migration
	note          string
}

var alreadyFixed = map[string]bool{
	// Seatbelt fields are already handled by codec coercion.
	"DriverSeatBelt":    true,
	"PassengerSeatBelt": true,
	"GpsState":          true,
	"RearSeatHeaters":   true,
	// Codec coercion handles these HVAC enum fields.
	"HvacAutoMode":  true,
	"HvacPower":     true,
	"HvacFanStatus": true,
	// Migration 000210 changed this column from DOUBLE PRECISION to TEXT;
	// the codec canonicalises the proto enum label.
	"CabinOverheatProtectionTemperatureLimit": true,
}

// falsePositives are fields the audit flags as type-mismatch candidates
// but which are actually handled correctly by a special writer-side
// path. Keep this list short and explicitly justified — each entry is
// a contract that a writer code-path exists outside the snapshot_base
// generic binder.
var falsePositives = map[string]string{
	"TpmsLastSeenPressureTimeFl": "tire_pressure_writer.writeTimestamp converts float64 epoch -> time.Time -> TIMESTAMPTZ",
	"TpmsLastSeenPressureTimeFr": "tire_pressure_writer.writeTimestamp converts float64 epoch -> time.Time -> TIMESTAMPTZ",
	"TpmsLastSeenPressureTimeRl": "tire_pressure_writer.writeTimestamp converts float64 epoch -> time.Time -> TIMESTAMPTZ",
	"TpmsLastSeenPressureTimeRr": "tire_pressure_writer.writeTimestamp converts float64 epoch -> time.Time -> TIMESTAMPTZ",
}

// deferredKnown lists fields that ARE genuine type mismatches but are
// deliberately not fixed by codec coercion because the right answer is
// a schema migration (NOT a value-fabricating coercion). Each entry is
// a known-issue tracker line — when the migration ships, remove the
// entry here.
//
// Empty because migration 000210 converted the last known
// DOUBLE PRECISION-vs-Enum column to TEXT and the codec now canonicalises
// the label.
var deferredKnown = map[string]string{}

// auditInputs bundles the three sources of truth (parsed DB schema,
// routing map, proto signal metadata) plus the classification look-up
// tables that buildFindings cross-references. Passing them in as data
// instead of reaching for package globals keeps the core audit a pure
// function of its inputs, so the report logic can be exercised in tests
// with hand-built fixtures rather than the live migrations, routing.yaml,
// and generated proto metadata.
type auditInputs struct {
	schema         map[string]map[string]string
	routes         map[string]router.Entry
	signals        map[string]*protomodel.SignalMeta
	destTables     map[router.Destination][]string
	alreadyFixed   map[string]bool
	falsePositives map[string]string
	deferredKnown  map[string]string
}

func main() {
	repoRoot, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, "getwd:", err)
		os.Exit(2)
	}
	os.Exit(run(os.Stdout, os.Stderr, repoRoot))
}

// run performs the full audit against the migrations under repoRoot and
// writes the tabular report to stdout. It returns the process exit code:
// 0 when the audit completes (regardless of how many mismatches it
// found — this is a discovery tool, not a gate) and 2 on a fatal setup
// error (unreadable migrations or malformed routing.yaml). Keeping run
// separate from main isolates the os.Exit / os.Getwd boundary in main so
// the audit is testable end-to-end against a fixture repo root.
func run(stdout, stderr io.Writer, repoRoot string) int {
	schema, err := parseSchema(repoRoot)
	if err != nil {
		fmt.Fprintln(stderr, "parseSchema:", err)
		return 2
	}

	routes, err := router.LoadMap()
	if err != nil {
		fmt.Fprintln(stderr, "router.LoadMap:", err)
		return 2
	}

	in := auditInputs{
		schema:         schema,
		routes:         routes,
		signals:        protomodel.SignalsByName,
		destTables:     destinationTables,
		alreadyFixed:   alreadyFixed,
		falsePositives: falsePositives,
		deferredKnown:  deferredKnown,
	}

	findings, unrouted, noColumn := buildFindings(in)
	sortFindings(findings)
	writeReport(stdout, len(in.signals), len(routes), findings, unrouted, noColumn)
	return 0
}

// buildFindings is the pure core of the audit. For every signal it
// cross-references the declared ValueKind (via expectedGoType) against
// the SQL type of its routing destination's hot column and returns:
//
//   - findings: type-shape mismatches, plus "column not found" schema-drift
//     entries, each tagged with its classification (already-fixed by codec
//     coercion, writer-handled false positive, or deferred to a migration);
//   - unrouted: signals present in metadata but absent from routing.yaml;
//   - noColumn: signals routed to a snapshot destination whose routing
//     entry has an empty Column mapping (the writer would silently no-op).
//
// It performs no I/O and reads no globals, so every branch is table-testable.
func buildFindings(in auditInputs) (findings []finding, unrouted, noColumn []string) {
	for field, meta := range in.signals {
		entry, ok := in.routes[field]
		if !ok {
			unrouted = append(unrouted, field)
			continue
		}
		tables, ok := in.destTables[entry.Destination]
		if !ok {
			// destinations like signal_log/drop/unit_history have no
			// per-field hot column; skip the column-level audit.
			continue
		}
		if entry.Column == "" {
			noColumn = append(noColumn, fmt.Sprintf("%s -> %s (no column)", field, entry.Destination))
			continue
		}
		goTyp := expectedGoType(meta.ValueKind)
		// look up the column in each candidate table; first hit wins
		var sqlTyp, table string
		for _, t := range tables {
			if cols, ok := in.schema[t]; ok {
				if st, ok := cols[entry.Column]; ok {
					sqlTyp = st
					table = t
					break
				}
			}
		}
		if sqlTyp == "" {
			// column not declared in any candidate table — schema drift
			findings = append(findings, finding{
				field:  field,
				dest:   string(entry.Destination),
				table:  strings.Join(tables, "|"),
				column: entry.Column,
				vk:     meta.ValueKind.String(),
				goTyp:  goTyp,
				sqlTyp: "MISSING",
				reason: "column not found in any candidate destination table",
			})
			continue
		}
		reason, ok := compatible(goTyp, sqlTyp)
		if !ok {
			f := finding{
				field:   field,
				dest:    string(entry.Destination),
				table:   table,
				column:  entry.Column,
				vk:      meta.ValueKind.String(),
				goTyp:   goTyp,
				sqlTyp:  sqlTyp,
				reason:  reason,
				already: in.alreadyFixed[field],
			}
			if note, ok := in.falsePositives[field]; ok {
				f.falsePositive = true
				f.note = note
			}
			if note, ok := in.deferredKnown[field]; ok {
				f.deferred = true
				f.note = note
			}
			findings = append(findings, f)
		}
	}
	return findings, unrouted, noColumn
}

// sortFindings orders findings in place for the report: action-required
// ("new") first, then deferred, then writer-handled false positives, then
// already-fixed. Ties break by destination then field so the render is
// stable and diff-friendly across runs (map iteration in buildFindings is
// otherwise non-deterministic).
func sortFindings(findings []finding) {
	sort.Slice(findings, func(i, j int) bool {
		rank := func(f finding) int {
			if !f.already && !f.deferred && !f.falsePositive {
				return 0
			}
			if f.deferred {
				return 1
			}
			if f.falsePositive {
				return 2
			}
			return 3
		}
		ri, rj := rank(findings[i]), rank(findings[j])
		if ri != rj {
			return ri < rj
		}
		if findings[i].dest != findings[j].dest {
			return findings[i].dest < findings[j].dest
		}
		return findings[i].field < findings[j].field
	})
}

// writeReport renders the audit summary and the three detail sections to
// w. It is the single output boundary; buildFindings and sortFindings do
// no I/O. unrouted and noColumn are sorted in place for a stable render.
func writeReport(w io.Writer, totalSignals, totalRoutes int, findings []finding, unrouted, noColumn []string) {
	newCount := 0
	for _, f := range findings {
		if !f.already && !f.deferred && !f.falsePositive {
			newCount++
		}
	}

	fmt.Fprintf(w, "# Signal-type audit\n\n")
	fmt.Fprintf(w, "Total signals in metadata:           %d\n", totalSignals)
	fmt.Fprintf(w, "Routed (in routing.yaml):            %d\n", totalRoutes)
	fmt.Fprintf(w, "Mismatch candidates found:           %d\n", len(findings))
	fmt.Fprintf(w, "  already-fixed by codec coercion:   %d\n", countFixed(findings))
	fmt.Fprintf(w, "  false positives (writer-handled):  %d\n", countFalsePositive(findings))
	fmt.Fprintf(w, "  deferred to schema migration:      %d\n", countDeferred(findings))
	fmt.Fprintf(w, "  *** NEW (action required):         %d\n", newCount)
	fmt.Fprintln(w)

	if len(findings) > 0 {
		fmt.Fprintln(w, "## Type mismatch candidates")
		fmt.Fprintln(w)
		fmt.Fprintf(w, "%-44s %-25s %-32s %-12s %-10s %-18s %s\n",
			"FIELD", "DESTINATION", "COLUMN", "VALUEKIND", "GO_TYPE", "SQL_TYPE", "STATUS")
		fmt.Fprintln(w, strings.Repeat("-", 180))
		for _, f := range findings {
			status := "*** NEW ***"
			switch {
			case f.already:
				status = "fixed (codec coercion)"
			case f.deferred:
				status = "DEFERRED: " + f.note
			case f.falsePositive:
				status = "false-positive: " + f.note
			}
			fmt.Fprintf(w, "%-44s %-25s %-32s %-12s %-10s %-18s %s\n",
				f.field, f.dest, f.column, f.vk, f.goTyp, f.sqlTyp, status)
		}
		fmt.Fprintln(w)
	}

	if len(unrouted) > 0 {
		sort.Strings(unrouted)
		fmt.Fprintf(w, "## Fields in metadata but NOT in routing.yaml (%d)\n", len(unrouted))
		fmt.Fprintln(w, "These signals decode successfully but have no router entry — they'd hit the router's 'unknown field' error path.")
		fmt.Fprintln(w)
		// don't dump 200+ entries; show first 20
		limit := 20
		if len(unrouted) < limit {
			limit = len(unrouted)
		}
		for i := 0; i < limit; i++ {
			fmt.Fprintf(w, "  - %s\n", unrouted[i])
		}
		if len(unrouted) > limit {
			fmt.Fprintf(w, "  ... and %d more\n", len(unrouted)-limit)
		}
		fmt.Fprintln(w)
	}

	if len(noColumn) > 0 {
		sort.Strings(noColumn)
		fmt.Fprintf(w, "## Fields routed to a snapshot destination with no column mapping (%d)\n", len(noColumn))
		fmt.Fprintln(w, "These signals route to a destination table but the routing entry has Column=\"\" — the snapshot writer would no-op.")
		fmt.Fprintln(w)
		limit := 20
		if len(noColumn) < limit {
			limit = len(noColumn)
		}
		for i := 0; i < limit; i++ {
			fmt.Fprintf(w, "  - %s\n", noColumn[i])
		}
		if len(noColumn) > limit {
			fmt.Fprintf(w, "  ... and %d more\n", len(noColumn)-limit)
		}
		fmt.Fprintln(w)
	}
}

func countFixed(fs []finding) int {
	n := 0
	for _, f := range fs {
		if f.already {
			n++
		}
	}
	return n
}

func countFalsePositive(fs []finding) int {
	n := 0
	for _, f := range fs {
		if f.falsePositive {
			n++
		}
	}
	return n
}

func countDeferred(fs []finding) int {
	n := 0
	for _, f := range fs {
		if f.deferred {
			n++
		}
	}
	return n
}
