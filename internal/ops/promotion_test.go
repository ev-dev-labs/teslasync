package ops

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// ── Final-review finding 1: job outputs must not be spliced into shell
//    script text ────────────────────────────────────────────────────
//
// `release-notes` interpolated
// `${{ needs.vulnerability-report.outputs.summary }}` into an expanding
// heredoc. That summary is a Markdown table whose image names are
// wrapped in BACKTICKS, so bash treated them as command substitution:
// it ran `api` as a command, printed `api: command not found`,
// substituted the empty string, and exited 0. The release published a
// security table with blank image cells and nothing failed.

func outputPolicy() *WorkflowPolicy {
	return &WorkflowPolicy{
		Version:              1,
		UntrustedContexts:    []string{"inputs."},
		JobOutputContexts:    []string{"needs.", "steps."},
		RequireStatusFunctio: true,
	}
}

const heredocSplicedOutput = `
jobs:
  release-notes:
    steps:
      - name: Generate release notes
        run: |
          cat > notes.md << NOTES_EOF
          ${{ needs.vulnerability-report.outputs.summary }}
          NOTES_EOF
`

const heredocEnvIndirection = `
jobs:
  release-notes:
    steps:
      - name: Generate release notes
        env:
          VULN_SUMMARY: ${{ needs.vulnerability-report.outputs.summary }}
        run: |
          cat > notes.md << NOTES_EOF
          ${VULN_SUMMARY}
          NOTES_EOF
`

func TestWorkflowSemantics_RejectsJobOutputInRunScript(t *testing.T) {
	f := ValidateWorkflowSemantics(outputPolicy(), "release.yml", heredocSplicedOutput)
	if !hasMessage(f, "splices needs. output") {
		t.Fatalf("a job output spliced into script text was accepted: %+v", f)
	}
	// The message must explain the mechanism, otherwise the next author
	// "fixes" it by adding `set -euo pipefail`, which does nothing here.
	if !hasMessage(f, "does not neutralise it") {
		t.Errorf("the finding does not warn that set -euo pipefail is not a fix: %+v", f)
	}
}

func TestWorkflowSemantics_AcceptsJobOutputViaEnv(t *testing.T) {
	// The expression still appears in the file — under `env:`, which is
	// the safe channel. Only `run:` bodies are scanned.
	if f := ValidateWorkflowSemantics(outputPolicy(), "release.yml", heredocEnvIndirection); len(f) != 0 {
		t.Fatalf("env indirection was rejected: %+v", f)
	}
}

// TestWorkflowSemantics_StepOutputsAlsoGoverned: `steps.*.outputs.*` is
// the same hazard one scope down.
func TestWorkflowSemantics_StepOutputsAlsoGoverned(t *testing.T) {
	const src = `
jobs:
  publish:
    steps:
      - run: echo "${{ steps.scan.outputs.summary }}"
`
	if f := ValidateWorkflowSemantics(outputPolicy(), "release.yml", src); !hasMessage(f, "splices steps. output") {
		t.Fatalf("a step output spliced into script text was accepted: %+v", f)
	}
}

// TestRealReleaseNotesUsesEnvIndirection pins the fix in the committed
// workflow: the vulnerability summary reaches the heredoc through the
// environment, and the heredoc expands a shell variable.
func TestRealReleaseNotesUsesEnvIndirection(t *testing.T) {
	fsys := repoFSForTest(t)
	body, err := readRepoFile(fsys, ".github/workflows/release.yml")
	if err != nil {
		t.Fatalf("read release workflow: %v", err)
	}
	if !strings.Contains(body, "VULN_SUMMARY: ${{ needs.vulnerability-report.outputs.summary }}") {
		t.Error("the vulnerability summary is not passed through env:")
	}
	if !strings.Contains(body, "${VULN_SUMMARY}") {
		t.Error("the heredoc does not expand the environment variable")
	}
	parsed, parseErr := ParseWorkflowJobs(body)
	if parseErr != nil {
		t.Fatalf("parse: %v", parseErr)
	}
	for _, job := range parsed {
		for _, b := range job.RunBlocks {
			if strings.Contains(b.Script, "needs.vulnerability-report.outputs.summary") {
				t.Errorf("job %q step %q still splices the summary into script text", job.Name, b.Step)
			}
		}
	}
}

// TestBashDoesNotReparseParameterExpansion is the behavioural proof.
//
// It runs the two heredoc shapes through a real bash with a summary
// containing backticks, $(…), and `;` — exactly what the Markdown
// vulnerability table looks like. The spliced form executes the
// backticked text as a command and loses the content; the variable form
// preserves every character literally.
//
// The value is delivered through a file rather than the process
// environment so the test does not depend on Windows→WSL env
// marshalling; the property under test is identical, because bash never
// re-scans the RESULT of a parameter expansion regardless of where the
// variable got its value.
func TestBashDoesNotReparseParameterExpansion(t *testing.T) {
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("bash not available on this host; the semantic gate covers the property statically")
	}

	// What GitHub Actions substitutes for the job output: a Markdown
	// table with backticked image names, plus metacharacters.
	const summary = "| `api` | 0 CRITICAL | $(touch pwned) | a;b |"

	// ── The broken shape: the value is part of the script TEXT ───────
	dir := t.TempDir()
	spliced := "cat > out.md << NOTES_EOF\n" + summary + "\nNOTES_EOF\ncat out.md\n"
	out, runErr := runBash(t, bash, dir, spliced)
	if runErr != nil && !strings.Contains(out, "command not found") {
		t.Skipf("bash on this host could not run the fixture (%v): %s", runErr, out)
	}
	if strings.Contains(out, "`api`") {
		t.Errorf("expected the spliced form to LOSE the backticked content, got %q", out)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "pwned")); statErr != nil {
		t.Errorf("expected the spliced form to EXECUTE $(touch pwned) — that is the defect being demonstrated (output %q)", out)
	}

	// ── The fixed shape: the value arrives through a variable ────────
	dir2 := t.TempDir()
	if writeErr := os.WriteFile(filepath.Join(dir2, "summary.txt"), []byte(summary+"\n"), 0o600); writeErr != nil {
		t.Fatalf("write fixture: %v", writeErr)
	}
	fixed := "VULN_SUMMARY=\"$(cat summary.txt)\"\n" +
		"cat > out.md << NOTES_EOF\n${VULN_SUMMARY}\nNOTES_EOF\ncat out.md\n"
	out2, runErr2 := runBash(t, bash, dir2, fixed)
	if runErr2 != nil {
		t.Fatalf("the variable form failed: %v (%s)", runErr2, out2)
	}
	if !strings.Contains(out2, "`api`") {
		t.Errorf("the literal Markdown did not survive parameter expansion: %q", out2)
	}
	if !strings.Contains(out2, "$(touch pwned)") || !strings.Contains(out2, "a;b") {
		t.Errorf("shell metacharacters were not preserved literally: %q", out2)
	}
	if _, statErr := os.Stat(filepath.Join(dir2, "pwned")); statErr == nil {
		t.Error("parameter expansion still executed the command substitution")
	}
	if strings.Contains(out2, "command not found") {
		t.Errorf("the variable form still ran a command: %q", out2)
	}
}

func runBash(t *testing.T, bash, dir, script string) (string, error) {
	t.Helper()
	// GitHub Actions writes a `run:` block to a temp script file and
	// executes it, so a script file is the faithful reproduction (and it
	// avoids any argv-quoting artefacts from `bash -c`).
	path := filepath.Join(dir, "step.sh")
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatalf("write script: %v", err)
	}
	cmd := exec.Command(bash, "step.sh")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// ── Final-review finding 2: exact artifact promotion ─────────────────
//
// Job ordering was already correct and the gate passed, yet the publish
// job RE-BUILT the image with `push: true` instead of promoting the
// artifact that was scanned. Two builds are not one artifact.

func promotionPolicy() ArtifactPromotionPolicy {
	return ArtifactPromotionPolicy{
		Workflow:         "release.yml",
		ScanJob:          "build-scan",
		PublishJobs:      []string{"docker"},
		BuildActions:     []string{"docker/build-push-action"},
		UploadAction:     "actions/upload-artifact",
		DownloadAction:   "actions/download-artifact",
		ArtifactPrefix:   "image-",
		IsolationTokens:  []string{"matrix.image", "outputs.version"},
		ContinuityMarker: "DIGEST CONTINUITY",
		PushCommands:     []string{"crane push", "docker push"},
	}
}

// promotingWorkflow is the corrected shape: build once to an archive,
// scan it, upload it, download it, push it, prove the digest matches.
const promotingWorkflow = `
jobs:
  build-scan:
    steps:
      - name: Build to archive
        uses: docker/build-push-action@sha
        with:
          push: false
          outputs: type=docker,dest=/tmp/promote/${{ matrix.image }}.tar
      - name: Upload archive
        uses: actions/upload-artifact@sha
        with:
          name: image-${{ matrix.image }}-${{ needs.version.outputs.version }}
          if-no-files-found: error
  docker:
    needs: [build-scan]
    steps:
      - name: Download archive
        uses: actions/download-artifact@sha
        with:
          name: image-${{ matrix.image }}-${{ needs.version.outputs.version }}
      - name: Promote
        run: crane push /tmp/promote/img.tar "$PRIMARY"
      - name: Assert continuity
        run: |
          echo "DIGEST CONTINUITY verified"
`

func TestValidateArtifactPromotion_AcceptsPromotingShape(t *testing.T) {
	if f := ValidateArtifactPromotion(promotionPolicy(), promotingWorkflow); len(f) != 0 {
		t.Fatalf("the promoting workflow was rejected: %+v", f)
	}
}

// TestValidateArtifactPromotion_RejectsScanJobPush: a scan job that can
// push has a public side effect before the vulnerability verdict.
func TestValidateArtifactPromotion_RejectsScanJobPush(t *testing.T) {
	src := strings.Replace(promotingWorkflow, "          push: false", "          push: true", 1)
	f := ValidateArtifactPromotion(promotionPolicy(), src)
	if !hasMessage(f, "with.push: true") {
		t.Fatalf("a pushing scan job was accepted: %+v", f)
	}
	if !hasMessage(f, "BEFORE the vulnerability verdict") {
		t.Errorf("the finding does not explain the consequence: %+v", f)
	}
}

// TestValidateArtifactPromotion_RejectsPublishRebuild is the exact
// defect: correct ordering, wrong bytes.
func TestValidateArtifactPromotion_RejectsPublishRebuild(t *testing.T) {
	src := strings.Replace(promotingWorkflow, `      - name: Promote
        run: crane push /tmp/promote/img.tar "$PRIMARY"`,
		`      - name: Build and push
        uses: docker/build-push-action@sha
        with:
          push: true
      - name: Promote
        run: crane push /tmp/promote/img.tar "$PRIMARY"`, 1)

	f := ValidateArtifactPromotion(promotionPolicy(), src)
	if !hasMessage(f, "REBUILDS instead of promoting") {
		t.Fatalf("a rebuilding publish job was accepted: %+v", f)
	}
	if !hasMessage(f, "attests bytes nobody assessed") {
		t.Errorf("the finding does not explain why a rebuild breaks the attestation: %+v", f)
	}
}

func TestValidateArtifactPromotion_RejectsMissingContinuityProof(t *testing.T) {
	src := strings.Replace(promotingWorkflow, `          echo "DIGEST CONTINUITY verified"`, `          echo "pushed"`, 1)
	if f := ValidateArtifactPromotion(promotionPolicy(), src); !hasMessage(f, "never emits the continuity marker") {
		t.Fatalf("a publish job with no digest comparison was accepted: %+v", f)
	}
}

func TestValidateArtifactPromotion_RejectsArtifactNameMismatch(t *testing.T) {
	src := strings.Replace(promotingWorkflow,
		`          name: image-${{ matrix.image }}-${{ needs.version.outputs.version }}
      - name: Promote`,
		`          name: image-other-${{ matrix.image }}-${{ needs.version.outputs.version }}
      - name: Promote`, 1)
	if f := ValidateArtifactPromotion(promotionPolicy(), src); !hasMessage(f, "the names must match exactly") {
		t.Fatalf("a mismatched artifact name was accepted: %+v", f)
	}
}

// TestValidateArtifactPromotion_RejectsCollidingArtifactName: without
// the image name in the artifact, parallel matrix legs overwrite each
// other and a publish job can promote another image's bytes.
func TestValidateArtifactPromotion_RejectsCollidingArtifactName(t *testing.T) {
	src := strings.ReplaceAll(promotingWorkflow,
		"image-${{ matrix.image }}-${{ needs.version.outputs.version }}",
		"image-${{ needs.version.outputs.version }}")
	if f := ValidateArtifactPromotion(promotionPolicy(), src); !hasMessage(f, "isolation token") {
		t.Fatalf("a colliding artifact name was accepted: %+v", f)
	}
}

func TestValidateArtifactPromotion_RejectsUnretainedBuild(t *testing.T) {
	src := strings.Replace(promotingWorkflow,
		"          outputs: type=docker,dest=/tmp/promote/${{ matrix.image }}.tar",
		"          tags: scan/local:candidate", 1)
	if f := ValidateArtifactPromotion(promotionPolicy(), src); !hasMessage(f, "neither exports an artifact") {
		t.Fatalf("an unretained build was accepted: %+v", f)
	}
}

func TestValidateArtifactPromotion_RejectsMissingUpload(t *testing.T) {
	src := strings.Replace(promotingWorkflow, "actions/upload-artifact@sha", "actions/cache@sha", 1)
	if f := ValidateArtifactPromotion(promotionPolicy(), src); !hasMessage(f, "uploads no artifact") {
		t.Fatalf("a scan job that retains nothing was accepted: %+v", f)
	}
}

// TestRealReleaseWorkflowPromotesExactArtifact asserts the property
// against the committed workflow rather than a fixture.
func TestRealReleaseWorkflowPromotesExactArtifact(t *testing.T) {
	fsys := repoFSForTest(t)
	body, err := readRepoFile(fsys, ".github/workflows/release.yml")
	if err != nil {
		t.Fatalf("read release workflow: %v", err)
	}
	policyBody, err := LoadWorkflowPolicy(fsys, WorkflowPolicyPath)
	if err != nil {
		t.Fatalf("load workflow policy: %v", err)
	}
	if len(policyBody.ArtifactPromotions) == 0 {
		t.Fatal("the policy declares no artifact_promotion entry, so nothing would be enforced")
	}
	for _, ap := range policyBody.ArtifactPromotions {
		if f := ValidateArtifactPromotion(ap, body); len(f) != 0 {
			t.Fatalf("the committed release workflow violates artifact promotion: %+v", f)
		}
	}

	parsed, parseErr := ParseWorkflowJobs(body)
	if parseErr != nil {
		t.Fatalf("parse: %v", parseErr)
	}
	jobs := map[string]workflowJob{}
	for _, j := range parsed {
		jobs[j.Name] = j
	}

	// The signed/attested digest must be the PROMOTED digest, not a
	// build action's output — otherwise the signature describes bytes
	// the scan never saw.
	pub, ok := jobs["docker"]
	if !ok {
		t.Fatal("no docker publish job")
	}
	joined := ""
	for _, b := range pub.RunBlocks {
		joined += b.Script + "\n"
	}
	if strings.Contains(body, "steps.docker-build.outputs.digest") {
		t.Error("something still signs/attests a build-action digest instead of the promoted digest")
	}
	if !strings.Contains(joined, "cosign sign") {
		t.Error("the publish job does not sign the promoted image")
	}
	// The provenance subject is set via `with:`, so check the step.
	foundProvenance := false
	for _, s := range pub.Steps {
		if s.usesAction("actions/attest-build-provenance") {
			foundProvenance = true
			if !strings.Contains(s.With["subject-digest"], "steps.promote.outputs.digest") {
				t.Errorf("provenance subject-digest is %q, not the promoted digest", s.With["subject-digest"])
			}
		}
	}
	if !foundProvenance {
		t.Error("the publish job emits no build provenance")
	}
}

// TestRealReleaseWorkflowMutationsAreRejected mutates the COMMITTED
// workflow in memory and asserts the gate catches each regression. A
// gate proven only against hand-written fixtures can drift away from the
// file it is supposed to govern.
func TestRealReleaseWorkflowMutationsAreRejected(t *testing.T) {
	fsys := repoFSForTest(t)
	body, err := readRepoFile(fsys, ".github/workflows/release.yml")
	if err != nil {
		t.Fatalf("read release workflow: %v", err)
	}
	policy, err := LoadWorkflowPolicy(fsys, WorkflowPolicyPath)
	if err != nil {
		t.Fatalf("load policy: %v", err)
	}
	if len(policy.ArtifactPromotions) == 0 {
		t.Fatal("no artifact_promotion entry to exercise")
	}
	ap := policy.ArtifactPromotions[0]

	cases := []struct {
		name    string
		mutate  func(string) string
		wantMsg string
	}{
		{
			name:    "scan job pushes",
			mutate:  func(s string) string { return strings.Replace(s, "          push: false", "          push: true", 1) },
			wantMsg: "BEFORE the vulnerability verdict",
		},
		{
			name: "publish job rebuilds",
			mutate: func(s string) string {
				return strings.Replace(s,
					"      - name: Install cosign",
					"      - name: Rebuild and push\n        uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8 # v6.19.2\n        with:\n          push: true\n\n      - name: Install cosign", 1)
			},
			wantMsg: "REBUILDS instead of promoting",
		},
		{
			name: "continuity proof removed",
			mutate: func(s string) string {
				return strings.ReplaceAll(s, "DIGEST CONTINUITY", "digest checked")
			},
			wantMsg: "never emits the continuity marker",
		},
		{
			name: "archive no longer retained",
			mutate: func(s string) string {
				return strings.Replace(s,
					"          outputs: type=docker,dest=/tmp/promote/${{ matrix.image }}.tar",
					"          load: false", 1)
			},
			wantMsg: "neither exports an artifact",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mutated := tc.mutate(body)
			if mutated == body {
				t.Fatal("the mutation did not apply; the workflow shape changed and this test is no longer meaningful")
			}
			if f := ValidateArtifactPromotion(ap, mutated); !hasMessage(f, tc.wantMsg) {
				t.Fatalf("mutation was accepted; expected a finding containing %q, got %+v", tc.wantMsg, f)
			}
		})
	}

	// And the injection regression: put the summary back into the
	// heredoc and the semantics gate must reject it.
	reverted := strings.Replace(body, "          ${VULN_SUMMARY}",
		"          ${{ needs.vulnerability-report.outputs.summary }}", 1)
	if reverted == body {
		t.Fatal("the release notes no longer expand ${VULN_SUMMARY}; the injection fix may have been undone")
	}
	if f := ValidateWorkflowSemantics(policy, ".github/workflows/release.yml", reverted); !hasMessage(f, "splices needs. output") {
		t.Fatalf("the reverted heredoc injection was accepted: %+v", f)
	}
}

// TestParseWorkflowJobs_CapturesStepInputs guards the parser gap that// let the previous gate miss `with.push` entirely.
func TestParseWorkflowJobs_CapturesStepInputs(t *testing.T) {
	const src = `
jobs:
  build:
    steps:
      - name: Build
        uses: docker/build-push-action@10e90e36
        with:
          push: true
          file: Dockerfile
      - run: echo hi
`
	parsed, err := ParseWorkflowJobs(src)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(parsed) != 1 || len(parsed[0].Steps) != 2 {
		t.Fatalf("expected 1 job with 2 steps, got %+v", parsed)
	}
	step := parsed[0].Steps[0]
	if !step.usesAction("docker/build-push-action") {
		t.Errorf("the build action was not recognised through its @sha pin: %q", step.Uses)
	}
	if !truthy(step.With["push"]) {
		t.Errorf("with.push was not captured: %+v", step.With)
	}
	if parsed[0].Steps[1].Run == "" {
		t.Error("a run-only step was not captured as a step")
	}
	if len(parsed[0].RunBlocks) != 1 {
		t.Errorf("run blocks changed shape: %+v", parsed[0].RunBlocks)
	}
}
