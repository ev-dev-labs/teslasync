package main

import (
	"os"
	"strings"
	"testing"
)

const (
	testSHA      = "11bd71901bbe5b1630ceea73d27597364c9af683"
	testDigest   = "sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969"
	testGLDigest = "sha256:ebfeb6fd4f2c37fa371d3731ebfa662fdf80f93cd37d3b4771bb82263edff8d0"
)

func pinnedWorkflow() string {
	return `
env:
  TRIVY_IMAGE: aquasec/trivy@` + testDigest + ` # 0.74.0
  GITLEAKS_IMAGE: zricethezav/gitleaks@` + testGLDigest + ` # v8.27.2
jobs:
  security:
    steps:
      - uses: actions/checkout@` + testSHA + ` # v4.2.2
      - name: Name-first action
        uses: "actions/setup-go@` + testSHA + `" # v5.5.0
      - uses: >- # v4.33.0
          github/codeql-action/init@` + testSHA + `
      - { name: Flow action, uses: 'github/codeql-action/analyze@` + testSHA + `' } # v4.33.0
      - uses: ./actions/local-security-check
      - name: Shell text is not an action
        run: |
          echo "uses: actions/checkout@main"
  reusable:
    uses: example/security-workflows/.github/workflows/scan.yml@` + testSHA + ` # v1.2.3
  attest:
    steps:
      - name: Action in another job
        uses: actions/attest-build-provenance@` + testSHA + ` # v3.0.0
`
}

func TestWorkflowPinCheckerAcceptsYAMLSemantics(t *testing.T) {
	if failures := workflowPinFailures(pinnedWorkflow()); len(failures) > 0 {
		t.Fatalf("unexpected failures: %v", failures)
	}
}

func TestWorkflowPinCheckerRejectsMutableActionAndScanner(t *testing.T) {
	failures := workflowPinFailures(strings.Replace(pinnedWorkflow(), "@"+testSHA, "@main", 1))
	if !containsFailure(failures, "not SHA-pinned") {
		t.Fatalf("mutable action was not rejected: %v", failures)
	}

	failures = workflowPinFailures(strings.Replace(pinnedWorkflow(), "aquasec/trivy@"+testDigest, "aquasec/trivy:latest", 1))
	if !containsFailure(failures, "TRIVY_IMAGE must use a digest-pinned") {
		t.Fatalf("mutable scanner was not rejected: %v", failures)
	}
}

func TestWorkflowPinCheckerRejectsMutableActionsOutsideSecurityJob(t *testing.T) {
	for _, pinned := range []string{
		"example/security-workflows/.github/workflows/scan.yml@" + testSHA,
		"actions/attest-build-provenance@" + testSHA,
	} {
		failures := workflowPinFailures(strings.Replace(pinnedWorkflow(), pinned, strings.Split(pinned, "@")[0]+"@main", 1))
		if !containsFailure(failures, "not SHA-pinned") {
			t.Fatalf("mutable action outside security job was not rejected: %v", failures)
		}
	}
}

func TestWorkflowPinCheckerRejectsEveryMutableRealAction(t *testing.T) {
	workflow, err := os.ReadFile("../.github/workflows/security.yml")
	if err != nil {
		t.Fatalf("read real workflow: %v", err)
	}
	root, lines, err := parseWorkflow(string(workflow))
	if err != nil {
		t.Fatalf("parse real workflow: %v", err)
	}
	refs := securityActionRefs(root, lines)
	if len(refs) < 6 {
		t.Fatalf("discovered %d real actions, want at least 6", len(refs))
	}

	mutable := string(workflow)
	for _, ref := range refs {
		mutable = strings.Replace(mutable, ref.value, strings.Split(ref.value, "@")[0]+"@main", 1)
	}
	failures := workflowPinFailures(mutable)
	if got := countFailures(failures, "not SHA-pinned"); got != len(refs) {
		t.Fatalf("mutable action failures = %d, want %d; all=%v", got, len(refs), failures)
	}
}

func TestWorkflowPinCheckerIgnoresShellUsesText(t *testing.T) {
	workflow := pinnedWorkflow() + `
      - name: Another shell test
        run: >-
          printf '%s\n' "uses: github/codeql-action/init@main"
`
	if failures := workflowPinFailures(workflow); len(failures) > 0 {
		t.Fatalf("shell text must not be treated as an action: %v", failures)
	}
}

func containsFailure(failures []string, want string) bool {
	for _, failure := range failures {
		if strings.Contains(failure, want) {
			return true
		}
	}
	return false
}

func countFailures(failures []string, want string) int {
	count := 0
	for _, failure := range failures {
		if strings.Contains(failure, want) {
			count++
		}
	}
	return count
}
