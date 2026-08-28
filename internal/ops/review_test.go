package ops

import (
	"strings"
	"testing"
	"testing/fstest"
)

// ── Review finding 10: script injection ──────────────────────────────

func injectionPolicy() *WorkflowPolicy {
	return &WorkflowPolicy{
		Version:              1,
		Workflows:            []string{"w.yml"},
		UntrustedContexts:    []string{"inputs.", "github.event.inputs.", "github.actor", "github.head_ref"},
		TrustedExpressions:   []string{"github.run_id", "github.repository", "github.server_url"},
		RequireStatusFunctio: true,
	}
}

// TestValidateWorkflowSemantics_RejectsUntrustedInterpolation is the
// negative fixture: an operator-supplied input spliced into a script
// that also holds a secret.
func TestValidateWorkflowSemantics_RejectsUntrustedInterpolation(t *testing.T) {
	workflow := `
jobs:
  deploy:
    steps:
      - name: Deploy
        env:
          TOKEN: ${{ secrets.DEPLOY_TOKEN }}
        run: |
          ./deploy --url "${{ inputs.base_url }}"
`
	findings := ValidateWorkflowSemantics(injectionPolicy(), "w.yml", workflow)
	if !hasMessage(findings, "interpolates untrusted inputs.") {
		t.Fatalf("injection was not detected: %+v", findings)
	}
	if !hasMessage(findings, "Pass it through `env:`") {
		t.Fatalf("the finding does not state the remedy: %+v", findings)
	}
}

// TestValidateWorkflowSemantics_AcceptsEnvIndirection is the positive
// control: the same value routed through `env:` is safe, because the
// runner sets it as a variable instead of splicing it into the script.
func TestValidateWorkflowSemantics_AcceptsEnvIndirection(t *testing.T) {
	workflow := `
jobs:
  deploy:
    steps:
      - name: Deploy
        env:
          TOKEN: ${{ secrets.DEPLOY_TOKEN }}
          BASE_URL: ${{ inputs.base_url }}
        run: |
          ./deploy --url "$BASE_URL"
`
	if f := ValidateWorkflowSemantics(injectionPolicy(), "w.yml", workflow); len(f) != 0 {
		t.Fatalf("env indirection was flagged: %+v", f)
	}
}

func TestValidateWorkflowSemantics_UntrustedContextCoverage(t *testing.T) {
	for _, expr := range []string{
		"inputs.version",
		"github.event.inputs.profile",
		"github.actor",
		"github.head_ref",
	} {
		t.Run(expr, func(t *testing.T) {
			workflow := "jobs:\n  j:\n    steps:\n      - name: s\n        run: echo \"${{ " + expr + " }}\"\n"
			if f := ValidateWorkflowSemantics(injectionPolicy(), "w.yml", workflow); len(f) == 0 {
				t.Fatalf("%s was not treated as untrusted", expr)
			}
		})
	}
}

func TestValidateWorkflowSemantics_AllowsTrustedExpressions(t *testing.T) {
	workflow := `
jobs:
  j:
    steps:
      - name: s
        run: echo "${{ github.run_id }} ${{ github.repository }} ${{ github.server_url }}"
`
	if f := ValidateWorkflowSemantics(injectionPolicy(), "w.yml", workflow); len(f) != 0 {
		t.Fatalf("GitHub-generated values were flagged: %+v", f)
	}
}

// ── Review finding 3: implicit success() ─────────────────────────────

// TestValidateWorkflowSemantics_RejectsImplicitSuccess reproduces the
// exact defect: a manually-confirmed rollback job that needs an
// evaluator which exits non-zero on a rollback verdict.
func TestValidateWorkflowSemantics_RejectsImplicitSuccess(t *testing.T) {
	workflow := `
jobs:
  evaluate:
    steps:
      - run: exit 1
  rollback:
    needs: evaluate
    if: inputs.confirm == 'ROLLBACK'
    steps:
      - run: echo rolling back
`
	findings := ValidateWorkflowSemantics(injectionPolicy(), "w.yml", workflow)
	if !hasMessage(findings, "IMPLICIT success()") {
		t.Fatalf("the implicit-success trap was not detected: %+v", findings)
	}
}

func TestValidateWorkflowSemantics_AcceptsExplicitStatusFunctions(t *testing.T) {
	for _, guard := range []string{"!cancelled()", "always()", "failure()", "success()"} {
		t.Run(guard, func(t *testing.T) {
			workflow := "jobs:\n  a:\n    steps:\n      - run: true\n  b:\n    needs: a\n    if: " + guard + " && inputs.confirm == 'YES'\n    steps:\n      - run: true\n"
			findings := ValidateWorkflowSemantics(injectionPolicy(), "w.yml", workflow)
			for _, f := range findings {
				if strings.Contains(f.Message, "IMPLICIT success()") {
					t.Fatalf("%s was rejected: %s", guard, f.Message)
				}
			}
		})
	}
}

func TestValidateWorkflowSemantics_IgnoresJobsWithoutNeeds(t *testing.T) {
	workflow := `
jobs:
  solo:
    if: inputs.confirm == 'YES'
    steps:
      - run: true
`
	findings := ValidateWorkflowSemantics(injectionPolicy(), "w.yml", workflow)
	for _, f := range findings {
		if strings.Contains(f.Message, "IMPLICIT success()") {
			t.Fatalf("a job with no needs was flagged: %s", f.Message)
		}
	}
}

func TestParseWorkflowJobs_HandlesScalarAndListNeeds(t *testing.T) {
	jobs, err := ParseWorkflowJobs("jobs:\n  a:\n    steps: []\n  b:\n    needs: a\n    steps: []\n  c:\n    needs: [a, b]\n    steps: []\n")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	byName := map[string]workflowJob{}
	for _, j := range jobs {
		byName[j.Name] = j
	}
	if len(byName["b"].Needs) != 1 || byName["b"].Needs[0] != "a" {
		t.Fatalf("scalar needs = %v", byName["b"].Needs)
	}
	if len(byName["c"].Needs) != 2 {
		t.Fatalf("list needs = %v", byName["c"].Needs)
	}
}

// TestRealDeployRollbackRunsOnRollbackVerdict asserts the actual fix in
// the committed workflow, not just the rule.
func TestRealDeployRollbackRunsOnRollbackVerdict(t *testing.T) {
	raw, err := fstest.MapFS{}.Open("nope")
	_ = raw
	_ = err

	fsys := repoFSForTest(t)
	body, readErr := readRepoFile(fsys, ".github/workflows/deploy-rollback.yml")
	if readErr != nil {
		t.Fatalf("read workflow: %v", readErr)
	}
	jobs, parseErr := ParseWorkflowJobs(body)
	if parseErr != nil {
		t.Fatalf("parse: %v", parseErr)
	}
	var rollback *workflowJob
	for i := range jobs {
		if jobs[i].Name == "rollback" {
			rollback = &jobs[i]
		}
	}
	if rollback == nil {
		t.Fatal("no rollback job")
	}
	if len(rollback.Needs) == 0 {
		t.Fatal("the rollback job no longer depends on evaluate")
	}
	if !strings.Contains(rollback.If, "!cancelled()") {
		t.Fatalf("rollback `if` lacks !cancelled(); a confirmed rollback would be skipped when evaluation reports a rollback verdict: %q", rollback.If)
	}
	if strings.Contains(rollback.If, "always()") {
		t.Fatalf("rollback uses always(); a cancelled run must not proceed to roll production back: %q", rollback.If)
	}
}

// ── Review finding 7: governed image locations ───────────────────────

func digestPolicy() *SupplyChainPolicy {
	return &SupplyChainPolicy{
		FirstPartyPrefixes:    []string{"./"},
		RequireVersionComment: true,
		DigestPinnedImages:    true,
	}
}

const testDigest = "sha256:a693dd7fbb75b51c3d717507a9956501686edb123b48dd90b094fd5612d53abe"

// TestParseWorkflowSurface_FindsEveryGovernedImageLocation is the
// regression for the parser that only looked at root `env:` and
// therefore let a mutable service-container tag through.
func TestParseWorkflowSurface_FindsEveryGovernedImageLocation(t *testing.T) {
	workflow := `
env:
  SCANNER_IMAGE: aquasec/trivy:latest
jobs:
  drill:
    container:
      image: golang:1.25
    services:
      postgres:
        image: timescale/timescaledb-ha:pg17
      redis:
        image: redis:7-alpine
    env:
      HELPER_IMAGE: busybox:1.36
    steps:
      - name: scan
        uses: aquasecurity/trivy-action@` + strings.Repeat("a", 40) + ` # v0.33.1
        with:
          image-ref: ghcr.io/example/app:latest
      - name: build destination (not pulled)
        run: echo build
`
	s, err := ParseWorkflowSurface("w.yml", workflow, []string{"drill"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	got := map[string]bool{}
	for _, img := range s.Images {
		got[img.Value] = true
	}
	for _, want := range []string{
		"aquasec/trivy:latest",
		"golang:1.25",
		"timescale/timescaledb-ha:pg17",
		"redis:7-alpine",
		"busybox:1.36",
		"ghcr.io/example/app:latest",
	} {
		if !got[want] {
			t.Errorf("image %q was not discovered; locations found: %v", want, got)
		}
	}

	findings := digestPolicy().ValidateSupplyChainWorkflow(s, []string{"drill"})
	if n := countMessages(findings, "not digest-pinned"); n != 6 {
		t.Fatalf("digest findings = %d, want 6: %+v", n, findings)
	}
}

// TestParseWorkflowSurface_ScalarContainerShorthand covers
// `container: image:tag`.
func TestParseWorkflowSurface_ScalarContainerShorthand(t *testing.T) {
	workflow := "jobs:\n  j:\n    container: golang:1.25\n    steps: []\n"
	s, err := ParseWorkflowSurface("w.yml", workflow, []string{"j"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(s.Images) != 1 || s.Images[0].Value != "golang:1.25" {
		t.Fatalf("scalar container shorthand not captured: %+v", s.Images)
	}
}

func TestParseWorkflowSurface_IgnoresBuiltDestinations(t *testing.T) {
	workflow := `
env:
  BACKEND_IMAGE: ghcr.io/${{ github.repository }}-api
jobs:
  docker:
    steps:
      - with:
          image-ref: ghcr.io/${{ github.repository }}-api@${{ steps.build.outputs.digest }}
        uses: ./local
`
	s, err := ParseWorkflowSurface("w.yml", workflow, []string{"docker"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(s.Images) != 0 {
		t.Fatalf("templated build destinations must not be treated as pulled images: %+v", s.Images)
	}
}

func TestParseWorkflowSurface_AcceptsDigestPinnedImages(t *testing.T) {
	workflow := `
jobs:
  drill:
    services:
      postgres:
        image: timescale/timescaledb-ha@` + testDigest + ` # pg17
    steps: []
`
	s, err := ParseWorkflowSurface("w.yml", workflow, []string{"drill"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if f := digestPolicy().ValidateSupplyChainWorkflow(s, []string{"drill"}); len(f) != 0 {
		t.Fatalf("a digest-pinned service image was flagged: %+v", f)
	}
}

// TestRealBackupDrillServiceImageIsDigestPinned asserts the actual fix.
func TestRealBackupDrillServiceImageIsDigestPinned(t *testing.T) {
	body, err := readRepoFile(repoFSForTest(t), ".github/workflows/backup-restore-drill.yml")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	s, parseErr := ParseWorkflowSurface(".github/workflows/backup-restore-drill.yml", body, []string{"drill"})
	if parseErr != nil {
		t.Fatalf("parse: %v", parseErr)
	}
	if len(s.Images) == 0 {
		t.Fatal("no images discovered in the drill workflow; the parser regressed")
	}
	for _, img := range s.Images {
		if !digestRe.MatchString(img.Value) {
			t.Errorf("%s = %q is not digest-pinned", img.Job, img.Value)
		}
	}
}

// ── Review finding 6: enforceable migration ratchet ──────────────────

// TestValidateMigrations_BaselineCannotBeRaisedInYAMLAlone is the
// negative control. Bumping the manifest to exempt a new migration must
// fail, because the boundary is pinned in code.
func TestValidateMigrations_BaselineCannotBeRaisedInYAMLAlone(t *testing.T) {
	m := baseManifest()
	m.BaselineVersion = PinnedMigrationBaseline + 50 // "exempt everything"
	files := []MigrationFile{{
		Version: PinnedMigrationBaseline + 10, Name: "sneaky", Up: "DROP TABLE drives;", Down: "",
		HasUp: true, HasDown: true,
	}}

	findings := ValidateMigrations(m, files)
	if !hasMessage(findings, "PinnedMigrationBaseline") {
		t.Fatalf("raising baseline_version in YAML alone was accepted: %+v", findings)
	}
}

func TestValidateMigrations_BackfillWindowCannotBeWidenedInYAMLAlone(t *testing.T) {
	m := baseManifest()
	m.BackfillThrough = PinnedBackfillThrough + 100
	findings := ValidateMigrations(m, nil)
	if !hasMessage(findings, "PinnedBackfillThrough") {
		t.Fatalf("widening backfill_through in YAML alone was accepted: %+v", findings)
	}
}

// TestRealMigrationManifestMatchesPins asserts the committed manifest
// agrees with the code pins.
func TestRealMigrationManifestMatchesPins(t *testing.T) {
	m, err := LoadMigrationManifest(repoFSForTest(t), MigrationManifestPath)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if m.BaselineVersion != PinnedMigrationBaseline {
		t.Errorf("baseline_version = %d, pinned = %d", m.BaselineVersion, PinnedMigrationBaseline)
	}
	if m.BackfillThrough != PinnedBackfillThrough {
		t.Errorf("backfill_through = %d, pinned = %d", m.BackfillThrough, PinnedBackfillThrough)
	}
}

func countMessages(findings []Finding, want string) int {
	n := 0
	for _, f := range findings {
		if strings.Contains(f.Message, want) {
			n++
		}
	}
	return n
}
