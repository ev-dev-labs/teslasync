package ops

import (
	"strings"
	"testing"
	"testing/fstest"
)

// ── Issue A: Helm's hook <-> ordinary manifest boundary ──────────────
//
// Helm tracks hook resources and ordinary manifests separately and
// offers no supported in-place transition between them. Converting a
// secret source into a hook, rolling back across that boundary, or
// leaving hook mode each leave the release manifest and the live cluster
// disagreeing about who manages the credentials.
//
// That cannot be fixed in a template, so it is carried as an operator
// procedure — and the procedure is only a control if it cannot quietly
// rot. These tests prove the gate notices when it does.

// lifecycleFixture is a minimal registry + runbook + cross-linked doc
// that satisfies the contract, so each test can break exactly one thing.
func lifecycleFixture() (*RunbookManifest, fstest.MapFS) {
	const runbook = `# Lifecycle

## Procedure 2 — Rollback across a conversion boundary

Running a bare ` + "`helm rollback`" + ` across a conversion boundary can abort
partway through reconciliation and leave the release manifest and live Secret
source ownership out of sync. Delete the hook source first so Helm sees NotFound
and recreates the ordinary target, then verify the runtime Secret and the
workloads before declaring the rollback done.

` + "```bash" + `
kubectl -n "$NS" delete externalsecret "$RELEASE"
helm -n "$NS" rollback "$RELEASE" "$PRE_CONVERSION_REVISION"
` + "```" + `
`
	const readme = `# Chart

## Rollback

See docs/runbooks/lifecycle.md before rolling back across a conversion.
`
	const rebootRunbook = `# Node recovery

## Recovery

Wait for the original homelab node and its persistent volumes before checking
the stateful services in dependency order. This fixture intentionally contains
enough operational detail to prove the lifecycle gate rejects stub sections.

` + "```bash" + `
kubectl wait --for=condition=Ready node/"$NODE" --timeout=10m
` + "```" + `
`
	m := &RunbookManifest{
		Version:               1,
		RequiredCriticalities: []string{"critical"},
		LifecycleProcedures: []LifecycleProcedure{
			{
				ID:               "migration-gate-lifecycle",
				Title:            "Migration gate transitions",
				Why:              "Helm offers no in-place hook <-> ordinary transition.",
				Runbook:          "docs/runbooks/lifecycle.md",
				RequiredSections: []string{"## Procedure 2 — Rollback across a conversion boundary"},
				RequiredCommands: []string{
					`kubectl -n "$NS" delete externalsecret "$RELEASE"`,
					`helm -n "$NS" rollback "$RELEASE" "$PRE_CONVERSION_REVISION"`,
				},
				RequiredWarnings: []string{
					"bare `helm rollback` across a conversion boundary can abort",
				},
				CrossLinks: []LifecycleCrossLink{{
					Path:          "README.md",
					Section:       "## Rollback",
					MustReference: "docs/runbooks/lifecycle.md",
				}},
			},
			{
				ID:               "node-reboot-recovery",
				Title:            "Node reboot recovery",
				Why:              "Single-node state must recover from retained local volumes.",
				Runbook:          "docs/runbooks/node-reboot.md",
				RequiredSections: []string{"## Recovery"},
				RequiredCommands: []string{
					`kubectl wait --for=condition=Ready node/"$NODE" --timeout=10m`,
				},
			},
		},
	}
	fsys := fstest.MapFS{
		"docs/runbooks/lifecycle.md":   &fstest.MapFile{Data: []byte(runbook)},
		"docs/runbooks/node-reboot.md": &fstest.MapFile{Data: []byte(rebootRunbook)},
		"README.md":                    &fstest.MapFile{Data: []byte(readme)},
	}
	return m, fsys
}

func lifecycleMessages(f []Finding) string {
	parts := make([]string, 0, len(f))
	for _, x := range f {
		parts = append(parts, string(x.Severity)+": "+x.Message)
	}
	return strings.Join(parts, "\n")
}

func TestLifecycleProcedures_AcceptsCompleteRegistry(t *testing.T) {
	m, fsys := lifecycleFixture()
	if f := validateLifecycleProcedures(fsys, m); len(f) != 0 {
		t.Fatalf("a complete lifecycle registry was rejected:\n%s", lifecycleMessages(f))
	}
}

// TestLifecycleProcedures_RejectsDeregistration: the Helm limitation has
// not gone away, so the procedure may not simply be removed.
func TestLifecycleProcedures_RejectsDeregistration(t *testing.T) {
	m, fsys := lifecycleFixture()
	m.LifecycleProcedures = nil
	f := validateLifecycleProcedures(fsys, m)
	if !hasMessage(f, `missing mandatory lifecycle procedure "migration-gate-lifecycle"`) {
		t.Fatalf("deregistering the procedure was accepted:\n%s", lifecycleMessages(f))
	}
}

func TestLifecycleProcedures_RejectsMissingSection(t *testing.T) {
	m, fsys := lifecycleFixture()
	m.LifecycleProcedures[0].RequiredSections = append(
		m.LifecycleProcedures[0].RequiredSections, "## Procedure 3 — Leaving hook mode")
	if f := validateLifecycleProcedures(fsys, m); !hasMessage(f, "is missing the") {
		t.Fatalf("a runbook missing a pinned section was accepted:\n%s", lifecycleMessages(f))
	}
}

// TestLifecycleProcedures_RejectsStubSection: a heading with no steps is
// a warning pretending to be a runbook.
func TestLifecycleProcedures_RejectsStubSection(t *testing.T) {
	m, fsys := lifecycleFixture()
	fsys["docs/runbooks/lifecycle.md"] = &fstest.MapFile{
		Data: []byte("# Lifecycle\n\n## Procedure 2 — Rollback across a conversion boundary\n\nTBD.\n"),
	}
	if f := validateLifecycleProcedures(fsys, m); !hasMessage(f, "is a stub") {
		t.Fatalf("a stub procedure section was accepted:\n%s", lifecycleMessages(f))
	}
}

// TestLifecycleProcedures_RejectsMissingRemedy: describing the hazard
// without the commands is not actionable at 3am.
func TestLifecycleProcedures_RejectsMissingRemedy(t *testing.T) {
	m, fsys := lifecycleFixture()
	body := string(fsys["docs/runbooks/lifecycle.md"].Data)
	fsys["docs/runbooks/lifecycle.md"] = &fstest.MapFile{
		Data: []byte(strings.Replace(body, `kubectl -n "$NS" delete externalsecret "$RELEASE"`, "", 1)),
	}
	f := validateLifecycleProcedures(fsys, m)
	if !hasMessage(f, "no longer contains the required command") {
		t.Fatalf("a procedure that lost its remedy was accepted:\n%s", lifecycleMessages(f))
	}
	if !hasMessage(f, "drifted from the registry") {
		t.Errorf("the finding does not name drift as the cause:\n%s", lifecycleMessages(f))
	}
}

// TestLifecycleProcedures_RejectsSoftenedWarning is the point of the
// whole registry: the dangerous-command warning must not be edited away.
func TestLifecycleProcedures_RejectsSoftenedWarning(t *testing.T) {
	m, fsys := lifecycleFixture()
	body := string(fsys["docs/runbooks/lifecycle.md"].Data)
	softened := strings.Replace(body,
		"Running a bare `helm rollback` across a conversion boundary can abort",
		"Rolling back is usually fine, but be careful; it can abort", 1)
	fsys["docs/runbooks/lifecycle.md"] = &fstest.MapFile{Data: []byte(softened)}

	f := validateLifecycleProcedures(fsys, m)
	if !hasMessage(f, "no longer states") {
		t.Fatalf("a softened warning was accepted:\n%s", lifecycleMessages(f))
	}
	if !hasMessage(f, "load-bearing") {
		t.Errorf("the finding does not explain why the wording matters:\n%s", lifecycleMessages(f))
	}
}

// TestLifecycleProcedures_ToleratesReflow: the claim is pinned, its
// layout is not. Re-wrapping a paragraph must not fail the gate, or the
// gate becomes something people disable.
func TestLifecycleProcedures_ToleratesReflow(t *testing.T) {
	m, fsys := lifecycleFixture()
	body := string(fsys["docs/runbooks/lifecycle.md"].Data)
	reflowed := strings.Replace(body,
		"Running a bare `helm rollback` across a conversion boundary can abort\npartway through reconciliation",
		"Running a bare `helm rollback`\nacross a conversion boundary can abort partway\nthrough reconciliation", 1)
	if reflowed == body {
		t.Fatal("fixture changed; the reflow case no longer applies")
	}
	fsys["docs/runbooks/lifecycle.md"] = &fstest.MapFile{Data: []byte(reflowed)}
	if f := validateLifecycleProcedures(fsys, m); len(f) != 0 {
		t.Fatalf("re-wrapping the paragraph broke the gate:\n%s", lifecycleMessages(f))
	}

	// CRLF must not break it either — the repo is checked out on Windows.
	fsys["docs/runbooks/lifecycle.md"] = &fstest.MapFile{
		Data: []byte(strings.ReplaceAll(body, "\n", "\r\n")),
	}
	if f := validateLifecycleProcedures(fsys, m); len(f) != 0 {
		t.Fatalf("a CRLF checkout broke the gate:\n%s", lifecycleMessages(f))
	}
}

// TestLifecycleProcedures_RejectsUncrossLinkedGenericGuidance: generic
// rollback guidance that omits the link sends an operator straight into
// the boundary with a bare Helm command.
func TestLifecycleProcedures_RejectsUncrossLinkedGenericGuidance(t *testing.T) {
	m, fsys := lifecycleFixture()
	fsys["README.md"] = &fstest.MapFile{
		Data: []byte("# Chart\n\n## Rollback\n\nhelm rollback teslasync [REVISION]\n"),
	}
	f := validateLifecycleProcedures(fsys, m)
	if !hasMessage(f, "does not reference docs/runbooks/lifecycle.md") {
		t.Fatalf("un-cross-linked rollback guidance was accepted:\n%s", lifecycleMessages(f))
	}
	if !hasMessage(f, "bare Helm command") {
		t.Errorf("the finding does not explain the operator consequence:\n%s", lifecycleMessages(f))
	}
}

// TestLifecycleProcedures_CrossLinkIsSectionScoped: a link buried
// elsewhere in a long README does not make the rollback section safe.
func TestLifecycleProcedures_CrossLinkIsSectionScoped(t *testing.T) {
	m, fsys := lifecycleFixture()
	fsys["README.md"] = &fstest.MapFile{Data: []byte(
		"# Chart\n\n## Intro\n\nSee docs/runbooks/lifecycle.md sometime.\n\n" +
			"## Rollback\n\nhelm rollback teslasync [REVISION]\n\n## Testing\n\nx\n")}
	if f := validateLifecycleProcedures(fsys, m); !hasMessage(f, "## Rollback does not reference") {
		t.Fatalf("a link outside the dangerous section satisfied the contract:\n%s", lifecycleMessages(f))
	}
}

func TestLifecycleProcedures_RequiresRationaleAndRemedy(t *testing.T) {
	m, fsys := lifecycleFixture()
	m.LifecycleProcedures[0].Why = ""
	m.LifecycleProcedures[0].RequiredCommands = nil
	f := validateLifecycleProcedures(fsys, m)
	if !hasMessage(f, "why is required") {
		t.Errorf("a procedure with no rationale was accepted:\n%s", lifecycleMessages(f))
	}
	if !hasMessage(f, "required_commands must pin the remedy") {
		t.Errorf("a procedure with no remedy was accepted:\n%s", lifecycleMessages(f))
	}
}

// ── The real registry ────────────────────────────────────────────────

// TestRealLifecycleRegistryIsSatisfied runs the contract against the
// committed manifest and documents, not a fixture.
func TestRealLifecycleRegistryIsSatisfied(t *testing.T) {
	fsys := repoFSForTest(t)
	m, err := LoadRunbookManifest(fsys, RunbookManifestPath)
	if err != nil {
		t.Fatalf("load runbook manifest: %v", err)
	}
	if len(m.LifecycleProcedures) == 0 {
		t.Fatal("the lifecycle procedure registry is empty; Issue A's warning has nothing pinning it")
	}
	if f := validateLifecycleProcedures(fsys, m); len(f) != 0 {
		t.Fatalf("the committed lifecycle registry is not satisfied:\n%s", lifecycleMessages(f))
	}
}

// TestRealChartDocsDoNotSellNoneAsAnEscapeHatch pins the correction to
// the misleading wording: `none` does not make the race safe, it only
// stops the chart from managing it.
func TestRealChartDocsDoNotSellNoneAsAnEscapeHatch(t *testing.T) {
	fsys := repoFSForTest(t)
	for _, path := range []string{"helm/teslasync/values.yaml", "helm/teslasync/templates/_helpers.tpl"} {
		body, err := readRepoFile(fsys, path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		flat := collapseWhitespace(body)
		if !strings.Contains(flat, "NOT a general escape hatch") {
			t.Errorf("%s no longer qualifies `none`; it reads as a safe opt-out", path)
		}
		if !strings.Contains(flat, "docs/runbooks/migration-gate-lifecycle.md") {
			t.Errorf("%s does not point at the lifecycle procedures", path)
		}
	}
}

// TestRealChartDocsDoNotClaimRetroactiveOrphan guards the honesty
// boundary the reviewer asked for: rendering Orphan governs future
// reconciles and does not strip an ownerReference that already exists.
func TestRealChartDocsDoNotClaimRetroactiveOrphan(t *testing.T) {
	fsys := repoFSForTest(t)
	runbook, err := readRepoFile(fsys, "docs/runbooks/migration-gate-lifecycle.md")
	if err != nil {
		t.Fatalf("read runbook: %v", err)
	}

	flat := collapseWhitespace(runbook)
	for _, claim := range []string{
		"does **not** retroactively strip an ownerReference",
		"External Secrets Operator does not retract references it has already set",
	} {
		if !strings.Contains(flat, claim) {
			t.Errorf("the runbook no longer states %q", claim)
		}
	}

	helpers, err := readRepoFile(fsys, "helm/teslasync/templates/_helpers.tpl")
	if err != nil {
		t.Fatalf("read helpers: %v", err)
	}
	if !strings.Contains(collapseWhitespace(helpers), "It does not retroactively strip an ownerReference") {
		t.Error("_helpers.tpl no longer records that the rendered Orphan value is not retroactive")
	}
}

func TestRealMigrationGateRunbookDefinesTargetBeforeOptionalPreflight(t *testing.T) {
	fsys := repoFSForTest(t)
	runbook, err := readRepoFile(fsys, "docs/runbooks/migration-gate-lifecycle.md")
	if err != nil {
		t.Fatalf("read runbook: %v", err)
	}

	definition := strings.Index(runbook, "TARGET=${TARGET:-$RELEASE}")
	preflight := strings.Index(runbook, "## Preflight:")
	if definition < 0 {
		t.Fatal("runbook never derives TARGET from the ExternalSecret target name")
	}
	if preflight < 0 {
		t.Fatal("runbook lost its optional preflight section")
	}
	if definition > preflight {
		t.Fatal("TARGET is defined only inside the optional preflight; later destructive procedures can run with an empty target")
	}
	if !strings.Contains(runbook[:preflight], "TARGET=$RELEASE") {
		t.Fatal("runbook does not define TARGET for chart-managed Secret mode")
	}
}
