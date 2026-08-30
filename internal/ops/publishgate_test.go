package ops

import (
	"strings"
	"testing"
)

// ── Re-review finding 3: the gate must precede the publish ───────────
//
// The release workflow pushed :version AND :latest, signed, attested,
// and published the Helm chart — and only then ran vulnerability-report,
// whose failure could block nothing but the release notes. A fixable
// CRITICAL still reached every consumer pulling :latest while the run
// showed red. These tests pin the ordering that fixed it.

func publishGate() PublishGatePolicy {
	return PublishGatePolicy{
		Workflow:    "release.yml",
		GateJob:     "vulnerability-report",
		PublishJobs: []string{"docker", "helm", "release-notes"},
		Rationale:   "images are scanned before push",
	}
}

// brokenReleaseOrder reproduces the original shape: publish first, gate
// afterwards.
const brokenReleaseOrder = `
jobs:
  version-tag:
    steps: []
  docker:
    needs: version-tag
    steps: []
  vulnerability-report:
    needs: [version-tag, docker]
    steps: []
  helm:
    needs: [version-tag, docker]
    steps: []
  release-notes:
    needs: [version-tag, docker, helm, vulnerability-report]
    steps: []
`

// fixedReleaseOrder is the corrected shape: build+scan, gate, then
// publish.
const fixedReleaseOrder = `
jobs:
  version:
    steps: []
  build-scan:
    needs: version
    steps: []
  vulnerability-report:
    needs: [version, build-scan]
    steps: []
  docker:
    needs: [version, vulnerability-report]
    steps: []
  helm:
    needs: [version, docker]
    steps: []
  release-notes:
    needs: [version, docker, helm, vulnerability-report]
    steps: []
`

func TestValidatePublishGate_RejectsPublishBeforeGate(t *testing.T) {
	findings := ValidatePublishGate(publishGate(), brokenReleaseOrder)

	// `docker` and `helm` both run without the gate. `release-notes`
	// does depend on it, so it must NOT be flagged — otherwise the check
	// would be indiscriminate rather than precise.
	if !hasMessage(findings, `publish job "docker" can run WITHOUT "vulnerability-report"`) {
		t.Errorf("the un-gated image push was not detected: %+v", findings)
	}
	if !hasMessage(findings, `publish job "helm" can run WITHOUT "vulnerability-report"`) {
		t.Errorf("the un-gated chart push was not detected: %+v", findings)
	}
	for _, f := range findings {
		if strings.Contains(f.Message, `publish job "release-notes" can run WITHOUT`) {
			t.Errorf("release-notes DOES depend on the gate and must not be flagged: %s", f.Message)
		}
	}
	if !hasMessage(findings, "blocks nothing") {
		t.Errorf("the finding does not explain why ordering matters: %+v", findings)
	}
}

func TestValidatePublishGate_AcceptsGatedOrder(t *testing.T) {
	if f := ValidatePublishGate(publishGate(), fixedReleaseOrder); len(f) != 0 {
		t.Fatalf("the correctly ordered workflow was rejected: %+v", f)
	}
}

// TestValidatePublishGate_TransitiveDependencyCounts: helm depends on
// docker, which depends on the gate. That is sufficient.
func TestValidatePublishGate_TransitiveDependencyCounts(t *testing.T) {
	policy := publishGate()
	policy.PublishJobs = []string{"helm"}
	if f := ValidatePublishGate(policy, fixedReleaseOrder); len(f) != 0 {
		t.Fatalf("a transitively-gated job was rejected: %+v", f)
	}
}

func TestValidatePublishGate_RejectsUnknownJobs(t *testing.T) {
	policy := publishGate()
	policy.GateJob = "no-such-gate"
	if f := ValidatePublishGate(policy, fixedReleaseOrder); !hasMessage(f, "gate job \"no-such-gate\" does not exist") {
		t.Errorf("unknown gate job accepted: %+v", f)
	}

	policy = publishGate()
	policy.PublishJobs = []string{"no-such-publish"}
	if f := ValidatePublishGate(policy, fixedReleaseOrder); !hasMessage(f, "publish job \"no-such-publish\" does not exist") {
		t.Errorf("unknown publish job accepted: %+v", f)
	}
}

func TestValidatePublishGate_RejectsSelfGating(t *testing.T) {
	policy := publishGate()
	policy.PublishJobs = []string{"vulnerability-report"}
	if f := ValidatePublishGate(policy, fixedReleaseOrder); !hasMessage(f, "both the gate and a publish job") {
		t.Errorf("self-gating accepted: %+v", f)
	}
}

func TestTransitiveNeeds(t *testing.T) {
	parsed, err := ParseWorkflowJobs(fixedReleaseOrder)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	jobs := map[string]workflowJob{}
	for _, j := range parsed {
		jobs[j.Name] = j
	}
	closure := transitiveNeeds(jobs, "helm")
	for _, want := range []string{"docker", "vulnerability-report", "build-scan", "version"} {
		if !closure[want] {
			t.Errorf("closure of helm missing %q: %v", want, closure)
		}
	}
	if len(transitiveNeeds(jobs, "version")) != 0 {
		t.Error("a root job should have an empty closure")
	}
}

// TestRealReleaseWorkflowGatesEveryPublish asserts the property against
// the committed workflow, including that nothing pushes a git tag before
// the gate.
func TestRealReleaseWorkflowGatesEveryPublish(t *testing.T) {
	fsys := repoFSForTest(t)
	body, err := readRepoFile(fsys, ".github/workflows/release.yml")
	if err != nil {
		t.Fatalf("read release workflow: %v", err)
	}

	parsed, parseErr := ParseWorkflowJobs(body)
	if parseErr != nil {
		t.Fatalf("parse: %v", parseErr)
	}
	jobs := map[string]workflowJob{}
	for _, j := range parsed {
		jobs[j.Name] = j
	}

	for _, publish := range []string{"docker", "helm", "release-notes"} {
		job, ok := jobs[publish]
		if !ok {
			t.Fatalf("publish job %q not found", publish)
		}
		if !transitiveNeeds(jobs, publish)["vulnerability-report"] {
			t.Errorf("publish job %q does not transitively require the vulnerability gate", publish)
		}
		_ = job
	}

	// The git tag is a persistent public artifact; it must be pushed by
	// a gated job, not by the version-computation job.
	for name, job := range jobs {
		script := ""
		for _, b := range job.RunBlocks {
			script += b.Script + "\n"
		}
		if !strings.Contains(script, "git push origin") {
			continue
		}
		if !transitiveNeeds(jobs, name)["vulnerability-report"] {
			t.Errorf("job %q pushes a git tag without depending on the vulnerability gate; a blocked release would still leave a permanent tag behind", name)
		}
	}

	// And the build stage must not push images.
	if scan, ok := jobs["build-scan"]; ok {
		for _, b := range scan.RunBlocks {
			if strings.Contains(b.Script, "docker push") {
				t.Error("build-scan pushes an image; the scan stage must have no publish side effects")
			}
		}
	} else {
		t.Error("no build-scan job; images would be pushed before they are scanned")
	}
}
