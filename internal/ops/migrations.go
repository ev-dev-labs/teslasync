package ops

import (
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// MigrationManifestPath is the canonical location of the OPS-04 manifest.
const MigrationManifestPath = "ops/migrations/manifest.yaml"

// MigrationsDir is the golang-migrate source directory.
const MigrationsDir = "migrations"

// LockRisk is the declared/detected contention level of a migration.
type LockRisk string

// Lock risk levels, ordered.
const (
	LockRiskNone   LockRisk = "none"
	LockRiskLow    LockRisk = "low"
	LockRiskMedium LockRisk = "medium"
	LockRiskHigh   LockRisk = "high"
)

var lockRiskRank = map[LockRisk]int{
	LockRiskNone:   0,
	LockRiskLow:    1,
	LockRiskMedium: 2,
	LockRiskHigh:   3,
}

// MigrationManifest is the parsed ops/migrations/manifest.yaml.
type MigrationManifest struct {
	Version            int                `yaml:"version"`
	BaselineVersion    int                `yaml:"baseline_version"`
	BackfillThrough    int                `yaml:"backfill_through"`
	ReviewRequirements []string           `yaml:"review_requirements"`
	LockRiskLevels     []LockRisk         `yaml:"lock_risk_levels"`
	StaticRules        []MigrationRuleDoc `yaml:"static_rules"`
	Migrations         []MigrationReview  `yaml:"migrations"`
}

// MigrationRuleDoc documents a static analysis rule. The executable
// definition lives in staticRules below; DocumentedRuleIDs keeps the two
// in sync via a unit test.
type MigrationRuleDoc struct {
	ID      string   `yaml:"id"`
	Level   LockRisk `yaml:"level"`
	Detects string   `yaml:"detects"`
}

// MigrationReview is one reviewed migration.
type MigrationReview struct {
	Version                   int      `yaml:"version"`
	Name                      string   `yaml:"name"`
	ForwardCompatible         bool     `yaml:"forward_compatible"`
	ForwardCompatibilityNotes string   `yaml:"forward_compatibility_notes"`
	TwoPhasePlan              string   `yaml:"two_phase_plan"`
	RequiresDowntime          bool     `yaml:"requires_downtime"`
	RollbackNotes             string   `yaml:"rollback_notes"`
	ExpectedDuration          string   `yaml:"expected_duration"`
	DurationBasis             string   `yaml:"duration_basis"`
	LockRisk                  LockRisk `yaml:"lock_risk"`
	LockDetails               string   `yaml:"lock_details"`
	Reversible                bool     `yaml:"reversible"`
	IrreversibleJustification string   `yaml:"irreversible_justification"`
	ReviewedBy                string   `yaml:"reviewed_by"`
	ReviewedOn                string   `yaml:"reviewed_on"`
}

// MigrationFile is a discovered up/down pair on disk.
type MigrationFile struct {
	Version int
	Name    string
	Up      string
	Down    string
	HasUp   bool
	HasDown bool
}

// staticRule is an executable lock-risk heuristic.
type staticRule struct {
	id    string
	level LockRisk
	// detect inspects one normalised SQL statement in the context of the
	// set of tables the same migration creates.
	detect func(stmt string, createdTables map[string]bool) bool
}

var (
	migrationFileRe = regexp.MustCompile(`^(\d+)_(.+)\.(up|down)\.sql$`)
	lineCommentRe   = regexp.MustCompile(`--[^\n]*`)
	blockCommentRe  = regexp.MustCompile(`(?s)/\*.*?\*/`)
	whitespaceRe    = regexp.MustCompile(`\s+`)
	createTableRe   = regexp.MustCompile(`(?i)\bCREATE\s+(?:UNLOGGED\s+|TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_."]+)`)
	createIndexRe   = regexp.MustCompile(`(?i)\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[a-z0-9_."]+\s+ON\s+(?:ONLY\s+)?([a-z0-9_."]+)`)
	addColumnRe     = regexp.MustCompile(`(?i)\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z0-9_."]+)\b.*\bADD\s+COLUMN\b`)
	alterTypeRe     = regexp.MustCompile(`(?i)\bALTER\s+TABLE\b.*\bALTER\s+(?:COLUMN\s+)?[a-z0-9_."]+\s+(?:SET\s+DATA\s+)?TYPE\b`)
	dropColumnRe    = regexp.MustCompile(`(?i)\bALTER\s+TABLE\b.*\bDROP\s+COLUMN\b`)
	dropTableRe     = regexp.MustCompile(`(?i)\bDROP\s+TABLE\b`)
	addConstraintRe = regexp.MustCompile(`(?i)\bADD\s+CONSTRAINT\b.*\b(CHECK|FOREIGN\s+KEY|REFERENCES)\b`)
	unqualifiedDML  = regexp.MustCompile(`(?i)^\s*(UPDATE|DELETE\s+FROM)\s+[a-z0-9_."]+\b`)
	whereClauseRe   = regexp.MustCompile(`(?i)\bWHERE\b`)
)

// staticRules is the executable counterpart of manifest.static_rules.
var staticRules = []staticRule{
	{
		id:    "index-without-concurrently",
		level: LockRiskHigh,
		detect: func(stmt string, created map[string]bool) bool {
			m := createIndexRe.FindStringSubmatch(stmt)
			if m == nil {
				return false
			}
			concurrently := strings.TrimSpace(m[1]) != ""
			table := normaliseIdent(m[2])
			return !concurrently && !created[table]
		},
	},
	{
		id:    "not-null-without-default",
		level: LockRiskHigh,
		detect: func(stmt string, created map[string]bool) bool {
			m := addColumnRe.FindStringSubmatch(stmt)
			if m == nil {
				return false
			}
			if created[normaliseIdent(m[1])] {
				return false
			}
			upper := strings.ToUpper(stmt)
			return strings.Contains(upper, "NOT NULL") && !strings.Contains(upper, "DEFAULT")
		},
	},
	{
		id:     "column-type-change",
		level:  LockRiskHigh,
		detect: func(stmt string, _ map[string]bool) bool { return alterTypeRe.MatchString(stmt) },
	},
	{
		id:    "drop-column-or-table",
		level: LockRiskMedium,
		detect: func(stmt string, _ map[string]bool) bool {
			return dropColumnRe.MatchString(stmt) || dropTableRe.MatchString(stmt)
		},
	},
	{
		id:    "validated-constraint",
		level: LockRiskMedium,
		detect: func(stmt string, created map[string]bool) bool {
			if !addConstraintRe.MatchString(stmt) {
				return false
			}
			return !strings.Contains(strings.ToUpper(stmt), "NOT VALID")
		},
	},
	{
		id:    "unqualified-dml",
		level: LockRiskMedium,
		detect: func(stmt string, _ map[string]bool) bool {
			return unqualifiedDML.MatchString(stmt) && !whereClauseRe.MatchString(stmt)
		},
	},
}

// DocumentedRuleIDs returns the executable rule IDs, for the drift test
// that keeps manifest.static_rules honest.
func DocumentedRuleIDs() map[string]LockRisk {
	out := make(map[string]LockRisk, len(staticRules))
	for _, r := range staticRules {
		out[r.id] = r.level
	}
	return out
}

func normaliseIdent(s string) string {
	s = strings.ReplaceAll(s, `"`, "")
	s = strings.ToLower(strings.TrimSpace(s))
	if i := strings.LastIndex(s, "."); i >= 0 {
		s = s[i+1:]
	}
	return s
}

// splitStatements strips comments and splits on semicolons. It is
// deliberately simple: migrations in this repo are plain DDL, and the
// analysis is advisory-by-construction for anything it cannot parse.
func splitStatements(sql string) []string {
	sql = blockCommentRe.ReplaceAllString(sql, " ")
	sql = lineCommentRe.ReplaceAllString(sql, " ")
	parts := strings.Split(sql, ";")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(whitespaceRe.ReplaceAllString(p, " "))
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// AnalyzeMigration returns the highest detected lock risk plus the IDs of
// every rule that fired.
func AnalyzeMigration(upSQL string) (LockRisk, []string) {
	stmts := splitStatements(upSQL)
	created := map[string]bool{}
	for _, s := range stmts {
		for _, m := range createTableRe.FindAllStringSubmatch(s, -1) {
			created[normaliseIdent(m[1])] = true
		}
	}
	worst := LockRiskNone
	fired := map[string]bool{}
	for _, s := range stmts {
		for _, rule := range staticRules {
			if rule.detect(s, created) {
				fired[rule.id] = true
				if lockRiskRank[rule.level] > lockRiskRank[worst] {
					worst = rule.level
				}
			}
		}
	}
	ids := make([]string, 0, len(fired))
	for id := range fired {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return worst, ids
}

// DiscoverMigrations reads the migrations directory and pairs up/down files.
func DiscoverMigrations(fsys fs.FS, dir string) ([]MigrationFile, error) {
	entries, err := fs.ReadDir(fsys, dir)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", dir, err)
	}
	byVersion := map[int]*MigrationFile{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		m := migrationFileRe.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		version, convErr := strconv.Atoi(m[1])
		if convErr != nil {
			continue
		}
		body, readErr := fs.ReadFile(fsys, dir+"/"+e.Name())
		if readErr != nil {
			return nil, fmt.Errorf("read %s: %w", e.Name(), readErr)
		}
		mf, ok := byVersion[version]
		if !ok {
			mf = &MigrationFile{Version: version, Name: m[2]}
			byVersion[version] = mf
		}
		if m[3] == "up" {
			mf.Up, mf.HasUp = string(body), true
		} else {
			mf.Down, mf.HasDown = string(body), true
		}
	}
	out := make([]MigrationFile, 0, len(byVersion))
	for _, mf := range byVersion {
		out = append(out, *mf)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Version < out[j].Version })
	return out, nil
}

// LoadMigrationManifest reads the OPS-04 manifest.
func LoadMigrationManifest(fsys fs.FS, path string) (*MigrationManifest, error) {
	var m MigrationManifest
	if err := loadYAML(fsys, path, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

var reviewerHandleRe = regexp.MustCompile(`^@[A-Za-z0-9][A-Za-z0-9-]{0,38}$`)
var reviewedOnRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

const backfillReviewer = "ops-gate-backfill"

// ── Enforceable baseline ratchet ─────────────────────────────────────
//
// A static gate cannot read git history, so it cannot tell a legitimate
// baseline from one someone raised this morning to skip a review. The
// original manifest claimed "raising this number is not allowed" and
// then enforced nothing — bumping `baseline_version: 231` would have
// silently exempted the next migration.
//
// What a static gate CAN do is pin the values in code, so the YAML alone
// cannot move them. Raising the baseline now requires editing this file
// too, which surfaces in review as a deliberate act rather than a
// one-character diff buried in a manifest.
//
// These are the only two numbers with that property; everything else in
// the manifest is per-migration data that the gate validates directly.
const (
	// PinnedMigrationBaseline is the highest migration version exempt
	// from the review-record requirement.
	PinnedMigrationBaseline = 229
	// PinnedBackfillThrough is the highest version allowed to use the
	// `ops-gate-backfill` reviewer sentinel.
	PinnedBackfillThrough = 231
)

// ValidateMigrations cross-checks the manifest against the migrations on
// disk. Every migration above baseline_version must carry a complete
// review record, must declare a lock_risk at least as severe as static
// analysis detects, and must be reversible or explicitly justified.
func ValidateMigrations(m *MigrationManifest, files []MigrationFile) []Finding {
	const check = "migrations"
	var out []Finding

	if m.Version != 1 {
		out = append(out, errf(check, MigrationManifestPath, "unsupported manifest version %d (want 1)", m.Version))
	}
	// The ratchet: the manifest may not move its own exemption
	// boundaries. Both values are pinned in internal/ops/migrations.go,
	// so raising them requires a reviewed code change rather than a
	// one-line YAML edit that silently exempts the next migration.
	if m.BaselineVersion != PinnedMigrationBaseline {
		out = append(out, errf(check, "baseline_version",
			"is %d but internal/ops.PinnedMigrationBaseline is %d; raising the baseline exempts migrations from review, so it must be changed in code and in the manifest together",
			m.BaselineVersion, PinnedMigrationBaseline))
	}
	if m.BackfillThrough != PinnedBackfillThrough {
		out = append(out, errf(check, "backfill_through",
			"is %d but internal/ops.PinnedBackfillThrough is %d; widening the backfill window lets unreviewed migrations use the %q sentinel",
			m.BackfillThrough, PinnedBackfillThrough, backfillReviewer))
	}
	if m.BackfillThrough < m.BaselineVersion {
		out = append(out, errf(check, MigrationManifestPath, "backfill_through (%d) must be >= baseline_version (%d)", m.BackfillThrough, m.BaselineVersion))
	}
	documented := map[string]LockRisk{}
	for _, r := range m.StaticRules {
		documented[r.ID] = r.Level
	}
	for id, level := range DocumentedRuleIDs() {
		got, ok := documented[id]
		switch {
		case !ok:
			out = append(out, errf(check, MigrationManifestPath, "static rule %q is implemented but not documented in static_rules", id))
		case got != level:
			out = append(out, errf(check, MigrationManifestPath, "static rule %q documented as %q but implemented as %q", id, got, level))
		}
	}

	reviews := map[int]MigrationReview{}
	for _, r := range m.Migrations {
		if _, dup := reviews[r.Version]; dup {
			out = append(out, errf(check, fmt.Sprintf("migrations[%d]", r.Version), "duplicate manifest entry"))
		}
		reviews[r.Version] = r
	}

	onDisk := map[int]MigrationFile{}
	for _, f := range files {
		onDisk[f.Version] = f
	}
	for version := range reviews {
		if _, ok := onDisk[version]; !ok {
			out = append(out, errf(check, fmt.Sprintf("migrations[%d]", version), "manifest entry has no matching file in %s/", MigrationsDir))
		}
	}

	for _, f := range files {
		subject := fmt.Sprintf("%06d_%s", f.Version, f.Name)
		detected, rules := AnalyzeMigration(f.Up)

		if !f.HasUp {
			out = append(out, errf(check, subject, "missing .up.sql"))
		}
		if !f.HasDown {
			out = append(out, errf(check, subject, "missing .down.sql — golang-migrate cannot roll back"))
		}

		if f.Version <= m.BaselineVersion {
			if detected != LockRiskNone {
				out = append(out, advisef(check, subject, "pre-manifest migration has %s lock risk (%s)", detected, strings.Join(rules, ", ")))
			}
			continue
		}

		r, ok := reviews[f.Version]
		if !ok {
			out = append(out, errf(check, subject,
				"no entry in %s — every migration above baseline_version %d needs forward_compatible, rollback_notes, expected_duration, and lock_risk review (static analysis detected %s risk: %s)",
				MigrationManifestPath, m.BaselineVersion, detected, ruleList(rules)))
			continue
		}
		if r.Name != f.Name {
			out = append(out, errf(check, subject, "manifest name %q does not match file name %q", r.Name, f.Name))
		}
		if strings.TrimSpace(r.RollbackNotes) == "" {
			out = append(out, errf(check, subject, "rollback_notes is required"))
		}
		if strings.TrimSpace(r.ExpectedDuration) == "" {
			out = append(out, errf(check, subject, "expected_duration is required"))
		}
		if r.DurationBasis != "measured" && r.DurationBasis != "estimate" {
			out = append(out, errf(check, subject, "duration_basis must be `measured` or `estimate` (got %q)", r.DurationBasis))
		}
		if _, known := lockRiskRank[r.LockRisk]; !known {
			out = append(out, errf(check, subject, "lock_risk %q is not one of none/low/medium/high", r.LockRisk))
		} else if lockRiskRank[r.LockRisk] < lockRiskRank[detected] {
			out = append(out, errf(check, subject, "declared lock_risk %q is weaker than statically detected %q (%s)", r.LockRisk, detected, ruleList(rules)))
		}
		if lockRiskRank[r.LockRisk] >= lockRiskRank[LockRiskMedium] && strings.TrimSpace(r.LockDetails) == "" {
			out = append(out, errf(check, subject, "lock_risk %q requires lock_details naming the locks taken and the mitigation", r.LockRisk))
		}
		if !r.ForwardCompatible {
			if strings.TrimSpace(r.TwoPhasePlan) == "" && !r.RequiresDowntime {
				out = append(out, errf(check, subject, "forward_compatible: false requires either a two_phase_plan or requires_downtime: true — a rolling deploy runs both revisions at once"))
			}
		} else if strings.TrimSpace(r.ForwardCompatibilityNotes) == "" {
			out = append(out, errf(check, subject, "forward_compatible: true requires forward_compatibility_notes explaining why the previous revision still works"))
		}
		if !r.Reversible && strings.TrimSpace(r.IrreversibleJustification) == "" {
			out = append(out, errf(check, subject, "reversible: false requires irreversible_justification"))
		}
		switch {
		case strings.TrimSpace(r.ReviewedBy) == "":
			out = append(out, errf(check, subject, "reviewed_by is required"))
		case r.ReviewedBy == backfillReviewer && f.Version > m.BackfillThrough:
			out = append(out, errf(check, subject, "reviewed_by %q is only allowed at or below backfill_through (%d); name a real reviewer", backfillReviewer, m.BackfillThrough))
		case r.ReviewedBy != backfillReviewer && !reviewerHandleRe.MatchString(r.ReviewedBy):
			out = append(out, errf(check, subject, "reviewed_by %q must be a GitHub handle like @octocat", r.ReviewedBy))
		}
		if !reviewedOnRe.MatchString(r.ReviewedOn) {
			out = append(out, errf(check, subject, "reviewed_on %q must be an ISO date (YYYY-MM-DD)", r.ReviewedOn))
		}
	}
	return out
}

func ruleList(rules []string) string {
	if len(rules) == 0 {
		return "no rules fired"
	}
	return strings.Join(rules, ", ")
}

// CheckMigrations loads the manifest + migrations dir and validates them.
func CheckMigrations(fsys fs.FS) []Finding {
	m, err := LoadMigrationManifest(fsys, MigrationManifestPath)
	if err != nil {
		return []Finding{errf("migrations", MigrationManifestPath, "%v", err)}
	}
	files, err := DiscoverMigrations(fsys, MigrationsDir)
	if err != nil {
		return []Finding{errf("migrations", MigrationsDir, "%v", err)}
	}
	return ValidateMigrations(m, files)
}
