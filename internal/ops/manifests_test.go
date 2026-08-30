package ops

import (
	"io/fs"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

// repoRoot is the repository root relative to this package, so the gates
// can be exercised against the real tree.
const repoRoot = "../.."

// repoFSForTest returns an fs.FS rooted at the repository root.
func repoFSForTest(t *testing.T) fs.FS {
	t.Helper()
	return os.DirFS(repoRoot)
}

// TestRepositoryManifestsAllValidate is the single most important test
// in this package: it runs every gate against the real tree, so a
// malformed manifest, a dangling evidence path, or an unreviewed
// migration fails `go test ./internal/ops/...` before it ever reaches a
// workflow.
func TestRepositoryManifestsAllValidate(t *testing.T) {
	fsys := os.DirFS(repoRoot)
	for _, c := range Checks() {
		t.Run(c.Name, func(t *testing.T) {
			res := &Result{}
			res.Add(c.Run(fsys)...)
			res.Sort()
			for _, f := range res.Errors() {
				t.Errorf("%s: %s: %s", f.Check, f.Subject, f.Message)
			}
		})
	}
}

// TestRunChecksRejectsUnknownName guards the CLI contract.
func TestRunChecksRejectsUnknownName(t *testing.T) {
	res := RunChecks(fstest.MapFS{}, []string{"not-a-check"})
	if res.OK() {
		t.Fatal("unknown check name must produce an error finding")
	}
}

func TestCheckNamesAreUniqueAndSorted(t *testing.T) {
	names := CheckNames()
	if len(names) != len(Checks()) {
		t.Fatalf("CheckNames returned %d names for %d checks", len(names), len(Checks()))
	}
	seen := map[string]bool{}
	for i, n := range names {
		if seen[n] {
			t.Fatalf("duplicate check name %q", n)
		}
		seen[n] = true
		if i > 0 && names[i-1] > n {
			t.Fatalf("CheckNames is not sorted: %q before %q", names[i-1], n)
		}
	}
}

func TestResultSortIsDeterministic(t *testing.T) {
	r := &Result{}
	r.Add(
		errf("z", "b", "second"),
		advisef("a", "a", "advisory"),
		errf("a", "a", "error"),
	)
	r.Sort()
	if r.Findings[0].Check != "a" || r.Findings[0].Severity != SeverityAdvisory {
		t.Fatalf("unexpected order: %+v", r.Findings)
	}
	if len(r.Errors()) != 2 || len(r.Advisories()) != 1 {
		t.Fatalf("errors=%d advisories=%d", len(r.Errors()), len(r.Advisories()))
	}
}

func TestLoadYAMLRejectsUnknownFields(t *testing.T) {
	fsys := fstest.MapFS{
		"x.yaml": &fstest.MapFile{Data: []byte("version: 1\nnot_a_field: true\n")},
	}
	var into struct {
		Version int `yaml:"version"`
	}
	if err := loadYAML(fsys, "x.yaml", &into); err == nil {
		t.Fatal("a typo'd manifest key must be a hard error, not silently ignored")
	}
}

// ── OPS-01 smoke manifest ────────────────────────────────────────────

func validSmokeYAML() string {
	return `
version: 1
defaults:
  timeout: 10s
  max_latency: 5s
  expect_status: [200]
auth:
  mode: forward_auth_header
  header: X-Forwarded-User
  value_env: SMOKE_USER
checks:
  - id: liveness
    description: alive
    path: /healthz
    critical: true
    tags: [availability, recovery]
  - id: metrics
    description: scrapeable
    path: /metrics
    critical: true
    tags: [observability]
  - id: api
    description: authenticated read
    path: /api/v1/vehicles
    authenticated: true
    critical: true
    tags: [availability]
  - id: spa
    description: shell
    path: /
    target: web
    critical: true
    tags: [frontend]
`
}

func loadSmokeFromString(t *testing.T, body string) *SmokeManifest {
	t.Helper()
	fsys := fstest.MapFS{SmokeManifestPath: &fstest.MapFile{Data: []byte(body)}}
	m, err := LoadSmokeManifest(fsys, SmokeManifestPath)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	return m
}

func TestValidateSmoke_AcceptsAWellFormedManifest(t *testing.T) {
	if f := ValidateSmoke(loadSmokeFromString(t, validSmokeYAML())); len(f) != 0 {
		t.Fatalf("unexpected findings: %+v", f)
	}
}

func TestValidateSmoke_RejectsBrokenManifests(t *testing.T) {
	tests := []struct {
		name    string
		replace [2]string
		want    string
	}{
		{"unknown auth mode", [2]string{"mode: forward_auth_header", "mode: magic"}, "unknown auth mode"},
		{"missing credential env", [2]string{"value_env: SMOKE_USER", "value_env: \"\""}, "referenced by env var name"},
		{"unrooted path", [2]string{"path: /healthz", "path: healthz"}, "must be rooted"},
		{"duplicate id", [2]string{"id: metrics", "id: liveness"}, "duplicate check id"},
		{"no authenticated check", [2]string{"authenticated: true", "authenticated: false"}, "no authenticated check"},
		{"no critical check", [2]string{"critical: true", "critical: false"}, "no critical check"},
		{"missing tag coverage", [2]string{"tags: [frontend]", "tags: [data]"}, `no check tagged "frontend"`},
		{"latency beyond timeout", [2]string{"max_latency: 5s", "max_latency: 60s"}, "exceeds defaults.timeout"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body := strings.Replace(validSmokeYAML(), tt.replace[0], tt.replace[1], -1)
			findings := ValidateSmoke(loadSmokeFromString(t, body))
			if !hasMessage(findings, tt.want) {
				t.Fatalf("want a finding containing %q, got %+v", tt.want, findings)
			}
		})
	}
}

func TestLooksLikeSecret(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"SMOKE_FORWARD_AUTH_USER", false},
		{"short", false},
		{`<div id="root">`, false},
		{"ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", true},
		{"teslasync_", false},
	}
	for _, tt := range tests {
		if got := looksLikeSecret(tt.in); got != tt.want {
			t.Errorf("looksLikeSecret(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

// ── OPS-08 supply chain ──────────────────────────────────────────────

func TestParseWorkflowSurface_IgnoresShellTextAndFindsRealRefs(t *testing.T) {
	const sha = "11bd71901bbe5b1630ceea73d27597364c9af683"
	workflow := `
env:
  TRIVY_IMAGE: aquasec/trivy@sha256:` + strings.Repeat("a", 64) + ` # 0.74.0
jobs:
  docker:
    steps:
      - uses: actions/checkout@` + sha + ` # v4.2.2
      - name: shell text is not an action
        run: |
          echo "uses: actions/checkout@main"
          cosign sign --yes image
  other:
    steps:
      - uses: actions/setup-go@main
`
	s, err := ParseWorkflowSurface(".github/workflows/release.yml", workflow, []string{"docker"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(s.Refs) != 1 {
		t.Fatalf("refs = %d, want 1 (only the docker job): %+v", len(s.Refs), s.Refs)
	}
	if len(s.Images) != 1 || !strings.HasPrefix(s.Images[0].Value, "aquasec/trivy@sha256:") {
		t.Fatalf("images = %+v", s.Images)
	}
	if !strings.Contains(strings.Join(s.RunBlocks, "\n"), "cosign sign") {
		t.Fatalf("run blocks not captured: %+v", s.RunBlocks)
	}
	if !s.KnownJobs["other"] {
		t.Fatal("all job names should be recorded even when not inspected")
	}
}

func TestValidateSupplyChainWorkflow_RejectsMutableRefs(t *testing.T) {
	policy := &SupplyChainPolicy{
		FirstPartyPrefixes:    []string{"./"},
		RequireVersionComment: true,
		DigestPinnedImages:    true,
	}
	const sha = "11bd71901bbe5b1630ceea73d27597364c9af683"
	workflow := `
env:
  SCANNER: aquasec/trivy:latest
jobs:
  docker:
    steps:
      - uses: actions/checkout@main
      - uses: actions/setup-go@` + sha + `
      - uses: ./local-action
`
	s, err := ParseWorkflowSurface("w.yml", workflow, []string{"docker"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	findings := policy.ValidateSupplyChainWorkflow(s, []string{"docker"})
	for _, want := range []string{"not pinned to a full 40-character commit SHA", "no trailing version comment", "not digest-pinned"} {
		if !hasMessage(findings, want) {
			t.Errorf("want a finding containing %q, got %+v", want, findings)
		}
	}
	// The first-party ./local-action must not be flagged.
	for _, f := range findings {
		if strings.Contains(f.Message, "./local-action") {
			t.Errorf("first-party action was flagged: %s", f.Message)
		}
	}
}

func TestValidateSupplyChain_RejectsExpiredVulnerabilityException(t *testing.T) {
	p := &SupplyChainPolicy{
		Version:               1,
		RequireVersionComment: true,
		DigestPinnedImages:    true,
		PinnedWorkflows:       []PinnedWorkflow{{Path: ".github/workflows/release.yml"}},
		VulnerabilityPolicy: VulnerabilityPolicy{
			FailOn: []string{"CRITICAL"},
			Report: []string{"CRITICAL"},
			Exceptions: []VulnException{
				{ID: "CVE-2020-0001", Reason: "no fix upstream", Expires: "2020-01-01"},
			},
		},
		RequiredAttestations: []RequiredAttestation{
			{Type: "signature", Verify: "cosign verify"},
			{Type: "cyclonedx", Verify: "cosign verify-attestation"},
			{Type: "slsaprovenance", Verify: "gh attestation verify"},
		},
	}
	fsys := fstest.MapFS{".github/workflows/release.yml": &fstest.MapFile{Data: []byte("jobs: {}\n")}}
	findings := ValidateSupplyChain(fsys, p, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if !hasMessage(findings, "exception expired") {
		t.Fatalf("expired exception was not rejected: %+v", findings)
	}
}

func TestValidateSupplyChain_RequiresAllAttestationTypes(t *testing.T) {
	p := &SupplyChainPolicy{
		Version:               1,
		RequireVersionComment: true,
		DigestPinnedImages:    true,
		PinnedWorkflows:       []PinnedWorkflow{{Path: ".github/workflows/release.yml"}},
		VulnerabilityPolicy:   VulnerabilityPolicy{FailOn: []string{"CRITICAL"}, Report: []string{"CRITICAL"}},
		RequiredAttestations:  []RequiredAttestation{{Type: "signature", Verify: "cosign verify"}},
	}
	fsys := fstest.MapFS{".github/workflows/release.yml": &fstest.MapFile{Data: []byte("jobs: {}\n")}}
	findings := ValidateSupplyChain(fsys, p, time.Now())
	for _, want := range []string{`missing mandatory attestation type "cyclonedx"`, `missing mandatory attestation type "slsaprovenance"`} {
		if !hasMessage(findings, want) {
			t.Errorf("want %q, got %+v", want, findings)
		}
	}
}

// ── OPS-13 scorecard ─────────────────────────────────────────────────

func TestGenerateScorecard_DerivesStatusFromEvidenceAndGates(t *testing.T) {
	def := &ScorecardDefinition{
		Version:      1,
		StatusValues: []string{StatusMet, StatusGap, StatusUnverifiable},
		Dimensions: []ScorecardDimension{{
			ID:       "availability",
			Title:    "Availability",
			Question: "?",
			Criteria: []ScorecardCriterion{
				{ID: "a-met", Statement: "evidence exists", Evidence: []string{"present.txt"}, Verification: "x"},
				{ID: "a-gap", Statement: "evidence missing", Evidence: []string{"absent.txt"}, Verification: "x"},
				{ID: "a-infra", Statement: "needs a cluster", Evidence: []string{"present.txt"}, Verification: "x", RequiresDeployedInfrastructure: true},
			},
		}},
	}
	fsys := fstest.MapFS{"present.txt": &fstest.MapFile{Data: []byte("x")}}
	card := GenerateScorecard(fsys, def, "deadbeef", time.Unix(0, 0).UTC())

	if card.Met != 1 || card.Gap != 1 || card.Unverifiable != 1 {
		t.Fatalf("met=%d gap=%d unverifiable=%d", card.Met, card.Gap, card.Unverifiable)
	}
	// Unverifiable must be excluded from the score, not counted as met.
	if got := card.Score(); got != 50 {
		t.Fatalf("score = %.0f, want 50 (1 met of 2 verifiable)", got)
	}

	rendered := RenderScorecard(card)
	for _, want := range []string{"GENERATED FILE", "`unverifiable`", "Not machine-verifiable", "a-infra"} {
		if !strings.Contains(rendered, want) {
			t.Errorf("rendered scorecard missing %q", want)
		}
	}
}

func TestValidateScorecard_RejectsUnknownGateAndInfraGateCombination(t *testing.T) {
	def := &ScorecardDefinition{
		Version:      1,
		StatusValues: []string{StatusMet, StatusGap, StatusUnverifiable},
		Dimensions: []ScorecardDimension{{
			ID: "availability", Title: "A", Question: "?",
			Criteria: []ScorecardCriterion{
				{ID: "c1", Statement: "s", Evidence: []string{"x"}, Verification: "v", Gate: "not-a-gate"},
				{ID: "c2", Statement: "s", Evidence: []string{"x"}, Verification: "v", Gate: "smoke", RequiresDeployedInfrastructure: true},
			},
		}},
	}
	findings := ValidateScorecard(fstest.MapFS{}, def)
	if !hasMessage(findings, "is not implemented by cmd/ops-gate") {
		t.Errorf("unknown gate not rejected: %+v", findings)
	}
	if !hasMessage(findings, "cannot also be proven by a static gate") {
		t.Errorf("infra+gate combination not rejected: %+v", findings)
	}
	for _, want := range []string{"latency", "security", "accessibility", "recovery", "cost"} {
		if !hasMessage(findings, `missing mandatory dimension "`+want+`"`) {
			t.Errorf("missing dimension %q not reported", want)
		}
	}
}

// TestValidateScorecard_ManualReviewMustBeDeclaredBothWays stops a
// human judgement from silently scoring as an automated pass.
func TestValidateScorecard_ManualReviewMustBeDeclaredBothWays(t *testing.T) {
	base := func(c ScorecardCriterion) *ScorecardDefinition {
		d := &ScorecardDefinition{
			Version:      1,
			StatusValues: []string{StatusMet, StatusGap, StatusUnverifiable},
		}
		for _, id := range requiredScorecardDimensions {
			dim := ScorecardDimension{ID: id, Title: id, Question: "?", Criteria: []ScorecardCriterion{{
				ID: id + "-ok", Statement: "s", Evidence: []string{"x"}, Verification: "go test ./...",
			}}}
			if id == "accessibility" {
				dim.Criteria = append(dim.Criteria, c)
			}
			d.Dimensions = append(d.Dimensions, dim)
		}
		return d
	}

	t.Run("flag without the manual verification string", func(t *testing.T) {
		findings := ValidateScorecard(fstest.MapFS{}, base(ScorecardCriterion{
			ID: "a11y-x", Statement: "s", Evidence: []string{"x"}, Verification: "go test ./...", RequiresHumanReview: true,
		}))
		if !hasMessage(findings, "a manual criterion must use verification") {
			t.Fatalf("mismatch not rejected: %+v", findings)
		}
	})

	t.Run("manual verification string without the flag", func(t *testing.T) {
		findings := ValidateScorecard(fstest.MapFS{}, base(ScorecardCriterion{
			ID: "a11y-y", Statement: "s", Evidence: []string{"x"}, Verification: ManualVerification,
		}))
		if !hasMessage(findings, "a manual criterion must use verification") {
			t.Fatalf("mismatch not rejected: %+v", findings)
		}
	})

	t.Run("both declared is accepted", func(t *testing.T) {
		findings := ValidateScorecard(fstest.MapFS{}, base(ScorecardCriterion{
			ID: "a11y-z", Statement: "s", Evidence: []string{"x"}, Verification: ManualVerification, RequiresHumanReview: true,
		}))
		if len(findings) != 0 {
			t.Fatalf("unexpected findings: %+v", findings)
		}
	})
}

// TestGenerateScorecard_HumanReviewIsNeverMet: a criterion whose
// assessment is a human judgement must not inflate the score just
// because a document exists.
func TestGenerateScorecard_HumanReviewIsNeverMet(t *testing.T) {
	def := &ScorecardDefinition{
		Version:      1,
		StatusValues: []string{StatusMet, StatusGap, StatusUnverifiable},
		Dimensions: []ScorecardDimension{{
			ID: "accessibility", Title: "Accessibility", Question: "?",
			Criteria: []ScorecardCriterion{
				{ID: "manual", Statement: "the guidelines are good", Evidence: []string{"present.txt"}, Verification: ManualVerification, RequiresHumanReview: true},
			},
		}},
	}
	fsys := fstest.MapFS{"present.txt": &fstest.MapFile{Data: []byte("x")}}
	card := GenerateScorecard(fsys, def, "", time.Unix(0, 0).UTC())

	if card.Met != 0 || card.Unverifiable != 1 {
		t.Fatalf("met=%d unverifiable=%d; a human-review criterion must never be counted as met", card.Met, card.Unverifiable)
	}
}

func hasMessage(findings []Finding, want string) bool {
	for _, f := range findings {
		if strings.Contains(f.Message, want) {
			return true
		}
	}
	return false
}

// readRepoFile reads a file from an fs.FS rooted at the repository root.
func readRepoFile(fsys fs.FS, path string) (string, error) {
	b, err := fs.ReadFile(fsys, path)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
