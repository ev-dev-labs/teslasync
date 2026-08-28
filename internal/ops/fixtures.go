package ops

import (
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strings"
)

// FixtureRegistryPath is the canonical location of the SQL fixture
// registry.
const FixtureRegistryPath = "ops/fixtures/registry.yaml"

// ── SQL fixture validation ───────────────────────────────────────────
//
// A fixture that references a column the schema dropped three migrations
// ago is not a fixture, it is a landmine: the restore drill "passes"
// right up until the day someone actually runs it, at which point the
// only evidence of recoverability the project has evaporates.
//
// The registry pairs each fixture with the tables it seeds. Two checks
// enforce it:
//
//   - THIS static gate reconstructs the effective schema by replaying
//     CREATE TABLE / ALTER TABLE ADD|DROP COLUMN across migrations/, then
//     verifies every INSERT column list against it. No database needed,
//     so it runs on every PR.
//   - The `fixture-execution` job in .github/workflows/ops-gate.yml runs
//     the fixtures for real against a freshly migrated database, because
//     column names are only part of what can be wrong.

// FixtureRegistry is the parsed ops/fixtures/registry.yaml.
type FixtureRegistry struct {
	Version  int               `yaml:"version"`
	Fixtures []FixtureEntry    `yaml:"fixtures"`
	Schema   FixtureSchemaOpts `yaml:"schema"`
}

// FixtureSchemaOpts controls schema reconstruction.
type FixtureSchemaOpts struct {
	MigrationsDir string `yaml:"migrations_dir"`
}

// FixtureEntry is one registered SQL fixture.
type FixtureEntry struct {
	ID          string   `yaml:"id"`
	Path        string   `yaml:"path"`
	Description string   `yaml:"description"`
	SeedsTables []string `yaml:"seeds_tables"`
	// ExecutedBy names the CI job that runs the fixture for real. A
	// fixture nobody executes is a fixture nobody validates.
	ExecutedBy string `yaml:"executed_by"`
}

// Column is one reconstructed column.
type Column struct {
	Name     string
	Identity bool // GENERATED ALWAYS AS IDENTITY — must never be written
}

// Table is a reconstructed table.
type Table struct {
	Name    string
	Columns map[string]Column
}

// Schema is the effective schema after replaying every migration.
type Schema struct {
	Tables map[string]Table
}

var (
	createTableCaptureRe = regexp.MustCompile(`(?is)\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_."]+)\s*\((.*)`)
	dropTableCaptureRe   = regexp.MustCompile(`(?i)\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z0-9_."]+)`)
	alterAddColumnRe     = regexp.MustCompile(`(?is)\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z0-9_."]+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_"]+)`)
	alterDropColumnRe    = regexp.MustCompile(`(?is)\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z0-9_."]+)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([a-z0-9_"]+)`)
	alterRenameColumnRe  = regexp.MustCompile(`(?is)\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z0-9_."]+)\s+RENAME\s+COLUMN\s+([a-z0-9_"]+)\s+TO\s+([a-z0-9_"]+)`)
	alterRenameTableRe   = regexp.MustCompile(`(?is)\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z0-9_."]+)\s+RENAME\s+TO\s+([a-z0-9_"]+)`)
	insertIntoRe         = regexp.MustCompile(`(?is)\bINSERT\s+INTO\s+([a-z0-9_."]+)\s*\(([^)]*)\)`)
	identityRe           = regexp.MustCompile(`(?i)GENERATED\s+ALWAYS\s+AS\s+IDENTITY`)
)

// reservedColumnWords are keywords that can begin a table-level
// constraint inside a CREATE TABLE body and must not be mistaken for a
// column name.
var reservedColumnWords = map[string]bool{
	"primary": true, "foreign": true, "unique": true, "check": true,
	"constraint": true, "exclude": true, "like": true,
}

// splitTopLevel splits a parenthesised list on commas at depth zero.
func splitTopLevel(body string) []string {
	var (
		out   []string
		depth int
		cur   strings.Builder
		inStr bool
	)
	for _, r := range body {
		switch {
		case r == '\'':
			inStr = !inStr
			cur.WriteRune(r)
		case inStr:
			cur.WriteRune(r)
		case r == '(':
			depth++
			cur.WriteRune(r)
		case r == ')':
			if depth == 0 {
				// Closing paren of the CREATE TABLE body.
				out = append(out, cur.String())
				return out
			}
			depth--
			cur.WriteRune(r)
		case r == ',' && depth == 0:
			out = append(out, cur.String())
			cur.Reset()
		default:
			cur.WriteRune(r)
		}
	}
	if strings.TrimSpace(cur.String()) != "" {
		out = append(out, cur.String())
	}
	return out
}

// BuildSchema replays the migrations in version order and returns the
// effective schema.
func BuildSchema(fsys fs.FS, dir string) (*Schema, error) {
	files, err := DiscoverMigrations(fsys, dir)
	if err != nil {
		return nil, err
	}
	s := &Schema{Tables: map[string]Table{}}
	for _, f := range files {
		for _, stmt := range splitStatements(f.Up) {
			s.applyStatement(stmt)
		}
	}
	return s, nil
}

func (s *Schema) applyStatement(stmt string) {
	if m := createTableCaptureRe.FindStringSubmatch(stmt); m != nil {
		name := normaliseIdent(m[1])
		tbl := Table{Name: name, Columns: map[string]Column{}}
		for _, def := range splitTopLevel(m[2]) {
			fields := strings.Fields(strings.TrimSpace(def))
			if len(fields) == 0 {
				continue
			}
			col := normaliseIdent(fields[0])
			if reservedColumnWords[strings.ToLower(col)] {
				continue
			}
			tbl.Columns[col] = Column{Name: col, Identity: identityRe.MatchString(def)}
		}
		// CREATE TABLE replaces any prior definition (the baseline
		// migration legitimately recreates tables).
		if len(tbl.Columns) > 0 {
			s.Tables[name] = tbl
		}
		return
	}
	if m := dropTableCaptureRe.FindStringSubmatch(stmt); m != nil {
		delete(s.Tables, normaliseIdent(m[1]))
		return
	}
	if m := alterRenameTableRe.FindStringSubmatch(stmt); m != nil {
		from, to := normaliseIdent(m[1]), normaliseIdent(m[2])
		if tbl, ok := s.Tables[from]; ok {
			tbl.Name = to
			s.Tables[to] = tbl
			delete(s.Tables, from)
		}
		return
	}
	if m := alterRenameColumnRe.FindStringSubmatch(stmt); m != nil {
		tbl, ok := s.Tables[normaliseIdent(m[1])]
		if !ok {
			return
		}
		from, to := normaliseIdent(m[2]), normaliseIdent(m[3])
		if col, ok := tbl.Columns[from]; ok {
			delete(tbl.Columns, from)
			col.Name = to
			tbl.Columns[to] = col
		}
		return
	}
	// A single ALTER TABLE can carry several ADD/DROP COLUMN clauses.
	for _, m := range alterAddColumnRe.FindAllStringSubmatch(stmt, -1) {
		if tbl, ok := s.Tables[normaliseIdent(m[1])]; ok {
			col := normaliseIdent(m[2])
			tbl.Columns[col] = Column{Name: col, Identity: identityRe.MatchString(stmt)}
		}
	}
	for _, m := range alterDropColumnRe.FindAllStringSubmatch(stmt, -1) {
		if tbl, ok := s.Tables[normaliseIdent(m[1])]; ok {
			delete(tbl.Columns, normaliseIdent(m[2]))
		}
	}
}

// InsertTarget is one INSERT statement discovered in a fixture.
type InsertTarget struct {
	Table   string
	Columns []string
}

// ParseFixtureInserts extracts every explicit INSERT column list.
func ParseFixtureInserts(sql string) []InsertTarget {
	var out []InsertTarget
	for _, m := range insertIntoRe.FindAllStringSubmatch(sql, -1) {
		cols := make([]string, 0, 8)
		for _, raw := range strings.Split(m[2], ",") {
			if c := normaliseIdent(raw); c != "" {
				cols = append(cols, c)
			}
		}
		out = append(out, InsertTarget{Table: normaliseIdent(m[1]), Columns: cols})
	}
	return out
}

// LoadFixtureRegistry reads the registry.
func LoadFixtureRegistry(fsys fs.FS, path string) (*FixtureRegistry, error) {
	var r FixtureRegistry
	if err := loadYAML(fsys, path, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

// ValidateFixtures checks every registered fixture against the schema
// reconstructed from the migrations.
func ValidateFixtures(fsys fs.FS, r *FixtureRegistry) []Finding {
	const check = "fixtures"
	var out []Finding

	if r.Version != 1 {
		out = append(out, errf(check, FixtureRegistryPath, "unsupported registry version %d (want 1)", r.Version))
	}
	if len(r.Fixtures) == 0 {
		out = append(out, errf(check, "fixtures", "no fixture registered; a fixture nobody validates goes stale silently"))
		return out
	}

	dir := r.Schema.MigrationsDir
	if dir == "" {
		dir = MigrationsDir
	}
	schema, err := BuildSchema(fsys, dir)
	if err != nil {
		return append(out, errf(check, dir, "reconstruct schema: %v", err))
	}
	if len(schema.Tables) < 20 {
		out = append(out, errf(check, dir, "reconstructed only %d tables; the schema parser regressed and the rest of this gate would pass vacuously", len(schema.Tables)))
		return out
	}

	seen := map[string]bool{}
	for _, f := range r.Fixtures {
		subject := "fixtures[" + f.ID + "]"
		if f.ID == "" || f.Path == "" {
			out = append(out, errf(check, "fixtures[]", "every fixture needs an id and a path"))
			continue
		}
		if seen[f.ID] {
			out = append(out, errf(check, subject, "duplicate fixture id"))
		}
		seen[f.ID] = true
		if strings.TrimSpace(f.Description) == "" {
			out = append(out, errf(check, subject, "description is required"))
		}
		if strings.TrimSpace(f.ExecutedBy) == "" {
			out = append(out, errf(check, subject, "executed_by is required — a fixture that is only checked statically is not proven to run"))
		}

		body, readErr := fs.ReadFile(fsys, f.Path)
		if readErr != nil {
			out = append(out, errf(check, subject, "%v", readErr))
			continue
		}
		out = append(out, validateFixtureSQL(check, subject, f, string(body), schema)...)
	}
	return out
}

func validateFixtureSQL(check, subject string, f FixtureEntry, body string, schema *Schema) []Finding {
	var out []Finding
	inserts := ParseFixtureInserts(body)
	if len(inserts) == 0 {
		out = append(out, errf(check, subject, "%s contains no INSERT with an explicit column list; the gate cannot verify it", f.Path))
		return out
	}

	touched := map[string]bool{}
	for _, ins := range inserts {
		touched[ins.Table] = true
		tbl, ok := schema.Tables[ins.Table]
		if !ok {
			out = append(out, errf(check, subject, "INSERT INTO %s: no such table in the schema reconstructed from migrations", ins.Table))
			continue
		}
		for _, col := range ins.Columns {
			c, ok := tbl.Columns[col]
			if !ok {
				out = append(out, errf(check, subject,
					"INSERT INTO %s writes column %q, which does not exist in the current schema (available: %s)",
					ins.Table, col, sampleColumns(tbl)))
				continue
			}
			if c.Identity {
				out = append(out, errf(check, subject,
					"INSERT INTO %s writes %q, which is GENERATED ALWAYS AS IDENTITY; Postgres rejects that without OVERRIDING SYSTEM VALUE. Resolve the surrogate key by natural key instead",
					ins.Table, col))
			}
		}
	}

	for _, want := range f.SeedsTables {
		if !touched[normaliseIdent(want)] {
			out = append(out, errf(check, subject,
				"registry says this fixture seeds %q but it contains no INSERT INTO %s; the drill would compare 0 against 0 for that table",
				want, want))
		}
	}
	return out
}

func sampleColumns(t Table) string {
	names := make([]string, 0, len(t.Columns))
	for n := range t.Columns {
		names = append(names, n)
	}
	sort.Strings(names)
	if len(names) > 12 {
		return strings.Join(names[:12], ", ") + ", …"
	}
	return strings.Join(names, ", ")
}

// CheckFixtures loads and validates the fixture registry.
func CheckFixtures(fsys fs.FS) []Finding {
	r, err := LoadFixtureRegistry(fsys, FixtureRegistryPath)
	if err != nil {
		return []Finding{errf("fixtures", FixtureRegistryPath, "%v", err)}
	}
	return ValidateFixtures(fsys, r)
}

// FixturePaths returns the registered fixture paths in order, for the CI
// job that executes them.
func FixturePaths(fsys fs.FS) ([]string, error) {
	r, err := LoadFixtureRegistry(fsys, FixtureRegistryPath)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(r.Fixtures))
	for _, f := range r.Fixtures {
		out = append(out, f.Path)
	}
	return out, nil
}

// String renders a fixture entry for log output.
func (f FixtureEntry) String() string { return fmt.Sprintf("%s (%s)", f.ID, f.Path) }
