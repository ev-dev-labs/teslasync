package ops

import (
	"strings"
	"testing"
	"testing/fstest"
)

// ── Re-review finding 1: fixture must match the live schema ──────────

// migrationFS builds a migrations tree from statement bodies.
func schemaFS(files map[string]string, extra map[string]string) fstest.MapFS {
	out := fstest.MapFS{}
	for name, body := range files {
		out[MigrationsDir+"/"+name] = &fstest.MapFile{Data: []byte(body)}
	}
	for path, body := range extra {
		out[path] = &fstest.MapFile{Data: []byte(body)}
	}
	return out
}

// currentVehiclesSchema mirrors the real post-000142/000154 shape.
const currentVehiclesSchema = `
CREATE TABLE vehicles (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  tesla_id        bigint      NOT NULL UNIQUE,
  vin             text        NOT NULL UNIQUE,
  display_name    text        NOT NULL,
  model           text,
  option_codes    text,
  color           text,
  trim_level      text,
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE drives (
  id bigserial PRIMARY KEY,
  vehicle_id bigint NOT NULL,
  started_at timestamptz NOT NULL,
  distance_m double precision
);
`

func TestBuildSchema_TracksIdentityAndAlterations(t *testing.T) {
	fsys := schemaFS(map[string]string{
		"000001_base.up.sql":   currentVehiclesSchema,
		"000001_base.down.sql": "DROP TABLE vehicles;",
		"000002_tz.up.sql":     "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';",
		"000002_tz.down.sql":   "ALTER TABLE vehicles DROP COLUMN timezone;",
		"000003_drop.up.sql":   "ALTER TABLE vehicles DROP COLUMN IF EXISTS option_codes;",
		"000003_drop.down.sql": "ALTER TABLE vehicles ADD COLUMN option_codes text;",
	}, nil)

	s, err := BuildSchema(fsys, MigrationsDir)
	if err != nil {
		t.Fatalf("BuildSchema: %v", err)
	}
	v, ok := s.Tables["vehicles"]
	if !ok {
		t.Fatal("vehicles table not reconstructed")
	}
	if !v.Columns["id"].Identity {
		t.Error("id must be flagged GENERATED ALWAYS AS IDENTITY")
	}
	if _, ok := v.Columns["timezone"]; !ok {
		t.Error("ADD COLUMN was not applied")
	}
	if _, ok := v.Columns["option_codes"]; ok {
		t.Error("DROP COLUMN was not applied")
	}
	if _, ok := v.Columns["tesla_id"]; !ok {
		t.Error("tesla_id missing")
	}
	// Table-level constraints must not be mistaken for columns.
	for _, bogus := range []string{"primary", "unique", "constraint"} {
		if _, ok := v.Columns[bogus]; ok {
			t.Errorf("constraint keyword %q parsed as a column", bogus)
		}
	}
}

func fixtureRegistry(path string) *FixtureRegistry {
	return &FixtureRegistry{
		Version: 1,
		Schema:  FixtureSchemaOpts{MigrationsDir: MigrationsDir},
		Fixtures: []FixtureEntry{{
			ID:          "f",
			Path:        path,
			Description: "d",
			SeedsTables: []string{"vehicles"},
			ExecutedBy:  "ci",
		}},
	}
}

// enoughTables pads the schema so ValidateFixtures' sanity floor (which
// exists so a broken parser cannot make the gate pass vacuously) is met.
func enoughTables() string {
	var b strings.Builder
	b.WriteString(currentVehiclesSchema)
	for i := 0; i < 25; i++ {
		b.WriteString("CREATE TABLE pad")
		b.WriteByte(byte('a' + i))
		b.WriteString(" (id bigint);\n")
	}
	return b.String()
}

// TestValidateFixtures_RejectsDroppedColumns is the negative control for
// the exact defect: the original fixture wrote vehicles columns that
// were removed by migration 000142.
func TestValidateFixtures_RejectsDroppedColumns(t *testing.T) {
	staleFixture := `
INSERT INTO vehicles (id, vehicle_id, vin, display_name, model, trim_badging, exterior_color, wheel_type, state, healthy, created_at, updated_at)
VALUES (1, 1000000001, 'TEST', 'Test', 'Model Y', 'LR', 'Silver', 'Gemini19', 'online', true, NOW(), NOW());
`
	fsys := schemaFS(
		map[string]string{"000142_base.up.sql": enoughTables(), "000142_base.down.sql": "DROP TABLE vehicles;"},
		map[string]string{"f.sql": staleFixture},
	)

	findings := ValidateFixtures(fsys, fixtureRegistry("f.sql"))
	for _, dropped := range []string{"vehicle_id", "trim_badging", "exterior_color", "wheel_type", "state", "healthy"} {
		if !hasMessage(findings, `writes column "`+dropped+`"`) {
			t.Errorf("dropped column %q was not rejected: %+v", dropped, findings)
		}
	}
}

// TestValidateFixtures_RejectsIdentityWrite is the other half of the
// same defect: an explicit `id` against GENERATED ALWAYS AS IDENTITY.
func TestValidateFixtures_RejectsIdentityWrite(t *testing.T) {
	fsys := schemaFS(
		map[string]string{"000142_base.up.sql": enoughTables(), "000142_base.down.sql": "DROP TABLE vehicles;"},
		map[string]string{"f.sql": "INSERT INTO vehicles (id, tesla_id, vin, display_name) VALUES (1, 2, 'V', 'D');"},
	)
	findings := ValidateFixtures(fsys, fixtureRegistry("f.sql"))
	if !hasMessage(findings, "GENERATED ALWAYS AS IDENTITY") {
		t.Fatalf("identity-column write was accepted: %+v", findings)
	}
}

func TestValidateFixtures_AcceptsACorrectFixture(t *testing.T) {
	fsys := schemaFS(
		map[string]string{"000142_base.up.sql": enoughTables(), "000142_base.down.sql": "DROP TABLE vehicles;"},
		map[string]string{"f.sql": "INSERT INTO vehicles (tesla_id, vin, display_name, model) VALUES (2, 'V', 'D', 'Model Y');"},
	)
	if f := ValidateFixtures(fsys, fixtureRegistry("f.sql")); len(f) != 0 {
		t.Fatalf("a schema-correct fixture was rejected: %+v", f)
	}
}

func TestValidateFixtures_RejectsUnknownTableAndMissingSeed(t *testing.T) {
	fsys := schemaFS(
		map[string]string{"000142_base.up.sql": enoughTables(), "000142_base.down.sql": "DROP TABLE vehicles;"},
		map[string]string{"f.sql": "INSERT INTO no_such_table (a) VALUES (1);"},
	)
	findings := ValidateFixtures(fsys, fixtureRegistry("f.sql"))
	if !hasMessage(findings, "no such table") {
		t.Errorf("unknown table accepted: %+v", findings)
	}
	if !hasMessage(findings, "contains no INSERT INTO vehicles") {
		t.Errorf("a fixture that does not seed its declared table was accepted: %+v", findings)
	}
}

func TestValidateFixtures_RequiresAnExecutor(t *testing.T) {
	r := fixtureRegistry("f.sql")
	r.Fixtures[0].ExecutedBy = ""
	fsys := schemaFS(
		map[string]string{"000142_base.up.sql": enoughTables(), "000142_base.down.sql": "DROP TABLE vehicles;"},
		map[string]string{"f.sql": "INSERT INTO vehicles (tesla_id, vin, display_name) VALUES (2, 'V', 'D');"},
	)
	if f := ValidateFixtures(fsys, r); !hasMessage(f, "executed_by is required") {
		t.Fatalf("a never-executed fixture was accepted: %+v", f)
	}
}

// TestRealFixturesMatchRealSchema runs the gate against the committed
// migrations and fixtures.
func TestRealFixturesMatchRealSchema(t *testing.T) {
	res := &Result{}
	res.Add(CheckFixtures(repoFSForTest(t))...)
	for _, f := range res.Errors() {
		t.Errorf("%s: %s", f.Subject, f.Message)
	}
}

// TestRealSchemaReconstructionIsPlausible guards against a parser
// regression silently emptying the schema.
func TestRealSchemaReconstructionIsPlausible(t *testing.T) {
	s, err := BuildSchema(repoFSForTest(t), MigrationsDir)
	if err != nil {
		t.Fatalf("BuildSchema: %v", err)
	}
	if len(s.Tables) < 100 {
		t.Fatalf("reconstructed only %d tables", len(s.Tables))
	}
	v, ok := s.Tables["vehicles"]
	if !ok {
		t.Fatal("vehicles missing")
	}
	if !v.Columns["id"].Identity {
		t.Error("vehicles.id should be GENERATED ALWAYS AS IDENTITY in the current schema")
	}
	for _, gone := range []string{"vehicle_id", "trim_badging", "exterior_color", "wheel_type", "state", "healthy"} {
		if _, present := v.Columns[gone]; present {
			t.Errorf("column %q should not exist in the current vehicles schema", gone)
		}
	}
	for _, want := range []string{"tesla_id", "vin", "display_name", "option_codes", "color", "trim_level", "timezone"} {
		if _, present := v.Columns[want]; !present {
			t.Errorf("column %q missing from the reconstructed vehicles schema", want)
		}
	}
}

func TestParseFixtureInserts(t *testing.T) {
	got := ParseFixtureInserts(`
INSERT INTO vehicles (tesla_id, vin) VALUES (1,'a');
insert into drives ( vehicle_id , started_at )
SELECT 1, now();
`)
	if len(got) != 2 {
		t.Fatalf("parsed %d inserts, want 2: %+v", len(got), got)
	}
	if got[0].Table != "vehicles" || len(got[0].Columns) != 2 {
		t.Errorf("first insert = %+v", got[0])
	}
	if got[1].Table != "drives" || got[1].Columns[0] != "vehicle_id" {
		t.Errorf("second insert = %+v", got[1])
	}
}

// ── Re-review finding 5: selector migration must converge ────────────

func migrationSteps(steps ...SelectorMigrationStep) SelectorMigration {
	return SelectorMigration{
		Runbook:  "runbook.md",
		Downtime: "none if ordered correctly",
		Rollback: "abort before the final step",
		Steps:    steps,
	}
}

var (
	stepOrphanDeployment = SelectorMigrationStep{
		ID: "orphan-deployment", Removes: RemovesDeploymentController,
		Command: "kubectl delete deployment $REL-api --cascade=orphan", Description: "d",
	}
	stepOrphanReplicaSet = SelectorMigrationStep{
		ID: "orphan-replicaset", Removes: RemovesReplicaSetController,
		Command: "kubectl delete rs -l … --cascade=orphan", Description: "d",
	}
	stepUpgrade = SelectorMigrationStep{
		ID: "upgrade", Removes: RemovesNothing,
		Command: "helm upgrade …", Description: "d",
	}
	stepDeletePods = SelectorMigrationStep{
		ID: "delete-pods", Removes: RemovesPods,
		Command: "kubectl delete pod -l '…,!teslasync.io/rollout'", Description: "d",
	}
)

// TestValidateSelectorMigration_RejectsOrphanThenPodDelete is the
// negative control for the documented-but-broken procedure: orphaning
// the Deployment leaves a live ReplicaSet that recreates every pod the
// final step deletes, so the migration never converges.
func TestValidateSelectorMigration_RejectsOrphanThenPodDelete(t *testing.T) {
	broken := migrationSteps(stepOrphanDeployment, stepUpgrade, stepDeletePods)

	findings := ValidateSelectorMigration("rollout", broken, nil)
	if !hasMessage(findings, "will recreate every pod deleted here") {
		t.Fatalf("the non-convergent orphan-then-delete-pods sequence was accepted: %+v", findings)
	}
	if !hasMessage(findings, "never removes the resulting ReplicaSet") {
		t.Fatalf("the missing ReplicaSet removal was not reported: %+v", findings)
	}
}

func TestValidateSelectorMigration_AcceptsCorrectOrdering(t *testing.T) {
	good := migrationSteps(stepOrphanDeployment, stepOrphanReplicaSet, stepUpgrade, stepDeletePods)
	if f := ValidateSelectorMigration("rollout", good, nil); len(f) != 0 {
		t.Fatalf("the convergent ordering was rejected: %+v", f)
	}
}

// TestValidateSelectorMigration_RejectsPodDeleteBeforeReplicaSetRemoval
// covers the subtler variant: the RS removal exists, but after the pod
// deletion.
func TestValidateSelectorMigration_RejectsPodDeleteBeforeReplicaSetRemoval(t *testing.T) {
	wrongOrder := migrationSteps(stepOrphanDeployment, stepUpgrade, stepDeletePods, stepOrphanReplicaSet)
	findings := ValidateSelectorMigration("rollout", wrongOrder, nil)
	if !hasMessage(findings, "will recreate every pod deleted here") {
		t.Fatalf("pod deletion before the ReplicaSet removal was accepted: %+v", findings)
	}
}

// TestValidateSelectorMigration_ForegroundPathIsAllowed: deleting with
// the default cascade removes the pods with the Deployment, so there is
// no orphaned controller and no ordering hazard.
func TestValidateSelectorMigration_ForegroundPathIsAllowed(t *testing.T) {
	foreground := migrationSteps(
		SelectorMigrationStep{
			ID: "foreground-delete", Removes: RemovesDeploymentController,
			Command: "kubectl delete deployment $REL-api", Description: "accepts downtime",
		},
		stepUpgrade,
	)
	if f := ValidateSelectorMigration("rollout", foreground, nil); len(f) != 0 {
		t.Fatalf("the foreground-deletion path was rejected: %+v", f)
	}
}

func TestValidateSelectorMigration_RequiresDowntimeAndRollbackStatements(t *testing.T) {
	m := migrationSteps(stepOrphanDeployment, stepOrphanReplicaSet, stepUpgrade, stepDeletePods)
	m.Downtime = ""
	m.Rollback = ""
	findings := ValidateSelectorMigration("rollout", m, nil)
	for _, want := range []string{"downtime implications", "rollback implications"} {
		if !hasMessage(findings, want) {
			t.Errorf("missing %q: %+v", want, findings)
		}
	}
}

// TestRealSelectorMigrationRunbookMatchesManifest is the doc/template
// contract test: every command in the manifest must appear in the
// runbook, so the two cannot drift into describing different procedures.
func TestRealSelectorMigrationRunbookMatchesManifest(t *testing.T) {
	fsys := repoFSForTest(t)
	m, err := LoadRolloutManifest(fsys, RolloutManifestPath)
	if err != nil {
		t.Fatalf("load manifest: %v", err)
	}
	mig := m.SelectorMigration
	if len(mig.Steps) == 0 {
		t.Fatal("the committed manifest declares no selector migration")
	}

	doc, err := readRepoFile(fsys, mig.Runbook)
	if err != nil {
		t.Fatalf("read runbook: %v", err)
	}

	// The runbook must warn about the trap, not just list steps.
	for _, want := range []string{"--cascade=orphan", "ReplicaSet", "recreates"} {
		if !strings.Contains(doc, want) {
			t.Errorf("runbook does not mention %q; the whole point is that the obvious procedure is wrong", want)
		}
	}

	// Scope the ordering check to the procedure section. The document
	// deliberately shows the BROKEN sequence first, under a "do not do
	// this" heading, and matching against that would be meaningless.
	start := strings.Index(doc, "## Procedure")
	if start < 0 {
		t.Fatal("runbook has no `## Procedure` section")
	}
	end := strings.Index(doc[start:], "## Downtime and rollback")
	if end < 0 {
		end = len(doc) - start
	}
	procedure := doc[start : start+end]

	// Every step must be represented, in order.
	lastIdx := -1
	for _, s := range mig.Steps {
		// Compare on the distinctive verb+object rather than the exact
		// string, so shell-formatting differences do not cause churn.
		key := stepKey(s.Command)
		idx := strings.Index(procedure, key)
		if idx < 0 {
			t.Errorf("runbook procedure is missing step %q (looked for %q)", s.ID, key)
			continue
		}
		if idx < lastIdx {
			t.Errorf("runbook presents step %q out of manifest order", s.ID)
		}
		lastIdx = idx
	}

	// The broken sequence must be present ONLY as an explicit warning.
	warnIdx := strings.Index(doc, "The obvious procedure is wrong")
	if warnIdx < 0 || warnIdx > start {
		t.Error("the runbook must call out the non-convergent orphan-then-delete-pods sequence BEFORE the procedure")
	}
}

// stepKey extracts a stable substring of a kubectl/helm command for
// doc-matching.
func stepKey(cmd string) string {
	switch {
	case strings.Contains(cmd, "delete deployment"):
		return "delete deployment"
	case strings.Contains(cmd, "delete rs"):
		return "delete rs"
	case strings.Contains(cmd, "helm upgrade"):
		return "helm upgrade"
	case strings.Contains(cmd, "rollout status"):
		return "rollout status"
	case strings.Contains(cmd, "delete pod"):
		return "delete pod"
	}
	return cmd
}
