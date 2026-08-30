package ops

import (
	"strings"
	"testing"
	"testing/fstest"
)

func TestAnalyzeMigration_StaticLockRiskRules(t *testing.T) {
	tests := []struct {
		name      string
		sql       string
		wantRisk  LockRisk
		wantRules []string
	}{
		{
			name:     "create table only",
			sql:      `CREATE TABLE IF NOT EXISTS widgets (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL);`,
			wantRisk: LockRiskNone,
		},
		{
			name:      "index on a pre-existing table",
			sql:       `CREATE INDEX IF NOT EXISTS drives_vehicle_idx ON drives (vehicle_id);`,
			wantRisk:  LockRiskHigh,
			wantRules: []string{"index-without-concurrently"},
		},
		{
			name:     "index on a table created in the same migration is fine",
			sql:      "CREATE TABLE widgets (id INT);\nCREATE INDEX widgets_id_idx ON widgets (id);",
			wantRisk: LockRiskNone,
		},
		{
			name:     "concurrent index is fine",
			sql:      `CREATE INDEX CONCURRENTLY drives_vehicle_idx ON drives (vehicle_id);`,
			wantRisk: LockRiskNone,
		},
		{
			name:      "not null without default",
			sql:       `ALTER TABLE drives ADD COLUMN region TEXT NOT NULL;`,
			wantRisk:  LockRiskHigh,
			wantRules: []string{"not-null-without-default"},
		},
		{
			name:     "not null with default is fine",
			sql:      `ALTER TABLE drives ADD COLUMN region TEXT NOT NULL DEFAULT 'na';`,
			wantRisk: LockRiskNone,
		},
		{
			name:      "column type change",
			sql:       `ALTER TABLE drives ALTER COLUMN distance_m TYPE DOUBLE PRECISION;`,
			wantRisk:  LockRiskHigh,
			wantRules: []string{"column-type-change"},
		},
		{
			name:      "drop column",
			sql:       `ALTER TABLE drives DROP COLUMN distance_mi;`,
			wantRisk:  LockRiskMedium,
			wantRules: []string{"drop-column-or-table"},
		},
		{
			name:      "validated check constraint",
			sql:       `ALTER TABLE drives ADD CONSTRAINT drives_distance_check CHECK (distance_m >= 0);`,
			wantRisk:  LockRiskMedium,
			wantRules: []string{"validated-constraint"},
		},
		{
			name:     "not-valid constraint is fine",
			sql:      `ALTER TABLE drives ADD CONSTRAINT drives_distance_check CHECK (distance_m >= 0) NOT VALID;`,
			wantRisk: LockRiskNone,
		},
		{
			name:      "unqualified update",
			sql:       `UPDATE drives SET region = 'na';`,
			wantRisk:  LockRiskMedium,
			wantRules: []string{"unqualified-dml"},
		},
		{
			name:     "qualified update is fine",
			sql:      `UPDATE drives SET region = 'na' WHERE region IS NULL;`,
			wantRisk: LockRiskNone,
		},
		{
			name:     "comments are stripped before analysis",
			sql:      "-- CREATE INDEX drives_x ON drives (id);\n/* ALTER TABLE drives DROP COLUMN y; */\nCREATE TABLE z (id INT);",
			wantRisk: LockRiskNone,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			risk, rules := AnalyzeMigration(tt.sql)
			if risk != tt.wantRisk {
				t.Fatalf("risk = %q, want %q (rules: %v)", risk, tt.wantRisk, rules)
			}
			for _, want := range tt.wantRules {
				found := false
				for _, got := range rules {
					if got == want {
						found = true
					}
				}
				if !found {
					t.Fatalf("rule %q did not fire; fired: %v", want, rules)
				}
			}
		})
	}
}

// TestStaticRulesAreDocumented pins the executable rules to the manifest
// documentation so the two cannot drift.
func TestStaticRulesAreDocumented(t *testing.T) {
	m, err := LoadMigrationManifest(repoFSForTest(t), MigrationManifestPath)
	if err != nil {
		t.Fatalf("load manifest: %v", err)
	}
	documented := map[string]LockRisk{}
	for _, r := range m.StaticRules {
		documented[r.ID] = r.Level
	}
	for id, level := range DocumentedRuleIDs() {
		got, ok := documented[id]
		if !ok {
			t.Errorf("rule %q is implemented but not documented in %s", id, MigrationManifestPath)
			continue
		}
		if got != level {
			t.Errorf("rule %q documented as %q, implemented as %q", id, got, level)
		}
	}
}

func migrationFS(files map[string]string) fstest.MapFS {
	out := fstest.MapFS{}
	for name, body := range files {
		out[MigrationsDir+"/"+name] = &fstest.MapFile{Data: []byte(body)}
	}
	return out
}

func TestDiscoverMigrations_PairsUpAndDown(t *testing.T) {
	fsys := migrationFS(map[string]string{
		"000001_first.up.sql":   "CREATE TABLE a (id INT);",
		"000001_first.down.sql": "DROP TABLE a;",
		"000002_second.up.sql":  "CREATE TABLE b (id INT);",
		"README.md":             "not a migration",
	})
	files, err := DiscoverMigrations(fsys, MigrationsDir)
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("found %d migrations, want 2", len(files))
	}
	if files[0].Version != 1 || !files[0].HasUp || !files[0].HasDown {
		t.Fatalf("first migration = %+v", files[0])
	}
	if files[1].HasDown {
		t.Fatal("second migration should be reported as missing its down file")
	}
}

func baseReview() MigrationReview {
	return MigrationReview{
		Version:                   300,
		Name:                      "new_thing",
		ForwardCompatible:         true,
		ForwardCompatibilityNotes: "purely additive",
		RollbackNotes:             "drop the table",
		ExpectedDuration:          "<1s",
		DurationBasis:             "measured",
		LockRisk:                  LockRiskNone,
		Reversible:                true,
		ReviewedBy:                "@atulmgupta",
		ReviewedOn:                "2026-08-26",
	}
}

func baseManifest(reviews ...MigrationReview) *MigrationManifest {
	rules := make([]MigrationRuleDoc, 0)
	for id, level := range DocumentedRuleIDs() {
		rules = append(rules, MigrationRuleDoc{ID: id, Level: level, Detects: "documented"})
	}
	return &MigrationManifest{
		Version:         1,
		BaselineVersion: 229,
		BackfillThrough: 231,
		StaticRules:     rules,
		Migrations:      reviews,
	}
}

func TestValidateMigrations_RequiresAReviewAboveBaseline(t *testing.T) {
	files := []MigrationFile{{Version: 300, Name: "new_thing", Up: "CREATE TABLE t (id INT);", Down: "DROP TABLE t;", HasUp: true, HasDown: true}}
	findings := ValidateMigrations(baseManifest(), files)
	if !hasMessage(findings, "no entry in "+MigrationManifestPath) {
		t.Fatalf("unreviewed migration was not rejected: %+v", findings)
	}
}

func TestValidateMigrations_AcceptsACompleteReview(t *testing.T) {
	files := []MigrationFile{{Version: 300, Name: "new_thing", Up: "CREATE TABLE t (id INT);", Down: "DROP TABLE t;", HasUp: true, HasDown: true}}
	if f := ValidateMigrations(baseManifest(baseReview()), files); len(f) != 0 {
		t.Fatalf("unexpected findings: %+v", f)
	}
}

func TestValidateMigrations_RejectsIncompleteReviews(t *testing.T) {
	up := "CREATE INDEX drives_x ON drives (id);"
	tests := []struct {
		name   string
		mutate func(*MigrationReview)
		want   string
	}{
		{"missing rollback notes", func(r *MigrationReview) { r.RollbackNotes = ""; r.LockRisk = LockRiskHigh; r.LockDetails = "d" }, "rollback_notes is required"},
		{"missing duration", func(r *MigrationReview) { r.ExpectedDuration = ""; r.LockRisk = LockRiskHigh; r.LockDetails = "d" }, "expected_duration is required"},
		{"bad duration basis", func(r *MigrationReview) { r.DurationBasis = "vibes"; r.LockRisk = LockRiskHigh; r.LockDetails = "d" }, "duration_basis must be"},
		{"understated lock risk", func(r *MigrationReview) { r.LockRisk = LockRiskLow }, "weaker than statically detected"},
		{"lock risk without details", func(r *MigrationReview) { r.LockRisk = LockRiskHigh }, "requires lock_details"},
		{"not forward compatible without a plan", func(r *MigrationReview) {
			r.ForwardCompatible = false
			r.LockRisk = LockRiskHigh
			r.LockDetails = "d"
		}, "two_phase_plan or requires_downtime"},
		{"forward compatible without notes", func(r *MigrationReview) {
			r.ForwardCompatibilityNotes = ""
			r.LockRisk = LockRiskHigh
			r.LockDetails = "d"
		}, "requires forward_compatibility_notes"},
		{"irreversible without justification", func(r *MigrationReview) {
			r.Reversible = false
			r.LockRisk = LockRiskHigh
			r.LockDetails = "d"
		}, "requires irreversible_justification"},
		{"backfill sentinel above threshold", func(r *MigrationReview) {
			r.ReviewedBy = backfillReviewer
			r.LockRisk = LockRiskHigh
			r.LockDetails = "d"
		}, "only allowed at or below backfill_through"},
		{"non-handle reviewer", func(r *MigrationReview) {
			r.ReviewedBy = "someone"
			r.LockRisk = LockRiskHigh
			r.LockDetails = "d"
		}, "must be a GitHub handle"},
		{"bad review date", func(r *MigrationReview) {
			r.ReviewedOn = "yesterday"
			r.LockRisk = LockRiskHigh
			r.LockDetails = "d"
		}, "must be an ISO date"},
		{"name mismatch", func(r *MigrationReview) {
			r.Name = "other"
			r.LockRisk = LockRiskHigh
			r.LockDetails = "d"
		}, "does not match file name"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := baseReview()
			tt.mutate(&r)
			files := []MigrationFile{{Version: 300, Name: "new_thing", Up: up, Down: "DROP INDEX drives_x;", HasUp: true, HasDown: true}}
			findings := ValidateMigrations(baseManifest(r), files)
			if !hasMessage(findings, tt.want) {
				t.Fatalf("want a finding containing %q, got %+v", tt.want, findings)
			}
		})
	}
}

func TestValidateMigrations_RequiresADownFile(t *testing.T) {
	files := []MigrationFile{{Version: 300, Name: "new_thing", Up: "CREATE TABLE t (id INT);", HasUp: true}}
	findings := ValidateMigrations(baseManifest(baseReview()), files)
	if !hasMessage(findings, "missing .down.sql") {
		t.Fatalf("missing down file was not rejected: %+v", findings)
	}
}

func TestValidateMigrations_BaselineMigrationsOnlyProduceAdvisories(t *testing.T) {
	files := []MigrationFile{{
		Version: 100, Name: "old", Up: "CREATE INDEX drives_x ON drives (id);", Down: "DROP INDEX drives_x;",
		HasUp: true, HasDown: true,
	}}
	res := &Result{}
	res.Add(ValidateMigrations(baseManifest(), files)...)
	if !res.OK() {
		t.Fatalf("pre-baseline migrations must not fail the gate: %+v", res.Errors())
	}
	if len(res.Advisories()) == 0 {
		t.Fatal("pre-baseline lock risk should still be reported as an advisory")
	}
}

func TestValidateMigrations_RejectsOrphanManifestEntry(t *testing.T) {
	r := baseReview()
	r.Version = 999
	findings := ValidateMigrations(baseManifest(r), nil)
	if !hasMessage(findings, "has no matching file") {
		t.Fatalf("orphan entry not rejected: %+v", findings)
	}
}

// TestRealMigrationsDirectoryIsDiscoverable makes sure the discovery
// regex still matches this repository's naming convention.
func TestRealMigrationsDirectoryIsDiscoverable(t *testing.T) {
	files, err := DiscoverMigrations(repoFSForTest(t), MigrationsDir)
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	if len(files) < 200 {
		t.Fatalf("discovered %d migrations; the naming convention or path changed", len(files))
	}
	for _, f := range files {
		if !f.HasUp {
			t.Errorf("migration %06d_%s has no .up.sql", f.Version, f.Name)
		}
		if !f.HasDown {
			t.Errorf("migration %06d_%s has no .down.sql", f.Version, f.Name)
		}
		if strings.TrimSpace(f.Up) == "" {
			t.Errorf("migration %06d_%s has an empty .up.sql", f.Version, f.Name)
		}
	}
}
