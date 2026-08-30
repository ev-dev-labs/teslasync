package ops

import (
	"os/exec"
	"strings"
	"testing"
)

// ── OPS-03 migration hook secret gate ────────────────────────────────
//
// The defect: with `externalSecrets.enabled=true` the chart rendered the
// ExternalSecret as an ordinary manifest while the database migration Job
// was a `pre-install,pre-upgrade` hook reading DATABASE_PASS from the
// target Secret via `envFrom`. Helm applies hooks BEFORE ordinary
// manifests, so on a fresh install External Secrets Operator had not even
// been asked to fetch anything: the Job's pod sat in
// CreateContainerConfigError until the hook timed out, and nothing in the
// output named the cause.
//
// Hook weights alone do not fix it. Weights only order resources that are
// themselves hooks, and an ExternalSecret existing says nothing about
// whether ESO has reconciled it.

// brokenGateRender reproduces the original shape exactly.
const brokenGateRender = `
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: test-teslasync
spec:
  target:
    name: test-teslasync
---
apiVersion: batch/v1
kind: Job
metadata:
  name: test-teslasync-migrate-1
  annotations:
    helm.sh/hook: pre-upgrade,pre-install
    helm.sh/hook-weight: "0"
spec:
  template:
    spec:
      initContainers:
        - name: wait-for-db
          command: ['sh', '-c', 'until nc -z db 5432; do sleep 2; done']
      containers:
        - name: migrate
          envFrom:
            - secretRef:
                name: test-teslasync
`

// fixedGateRender is the corrected shape: the source is a lower-weight
// hook that survives ordinary->hook conversion (`resource-policy: keep`)
// and cannot garbage-collect its target (`creationPolicy: Orphan`), AND
// the Job waits for the data to materialise.
const fixedGateRender = `
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: test-teslasync
  annotations:
    helm.sh/resource-policy: keep
    helm.sh/hook: pre-install,pre-upgrade
    helm.sh/hook-weight: "-10"
    helm.sh/hook-delete-policy: before-hook-creation
spec:
  target:
    name: test-teslasync
    creationPolicy: Orphan
    deletionPolicy: Retain
---
apiVersion: batch/v1
kind: Job
metadata:
  name: test-teslasync-migrate-1
  annotations:
    helm.sh/hook: pre-upgrade,pre-install
    helm.sh/hook-weight: "0"
    teslasync.io/migration-gate: "hook"
spec:
  template:
    spec:
      initContainers:
        - name: wait-for-runtime-secret
          command:
            - sh
            - -c
            - |
              DEADLINE=$(( $(date +%s) + TIMEOUT_SECONDS ))
              echo "kubectl get externalsecret"
          volumeMounts:
            - name: runtime-secret
        - name: wait-for-db
          command: ['sh', '-c', 'until nc -z db 5432; do sleep 2; done']
      volumes:
        - name: runtime-secret
          secret:
            secretName: test-teslasync
            optional: true
      containers:
        - name: migrate
          envFrom:
            - secretRef:
                name: test-teslasync
`

func gateMessages(findings []Finding) string {
	parts := make([]string, 0, len(findings))
	for _, f := range findings {
		parts = append(parts, string(f.Severity)+": "+f.Message)
	}
	return strings.Join(parts, "\n")
}

func TestVerifyMigrationGate_RejectsOrdinarySecretSource(t *testing.T) {
	findings := VerifyMigrationGate(brokenGateRender)
	if !hasMessage(findings, "rendered as an ORDINARY manifest") {
		t.Fatalf("the original ordering defect was accepted:\n%s", gateMessages(findings))
	}
	if !hasMessage(findings, "CreateContainerConfigError") {
		t.Errorf("the finding does not name the observed symptom:\n%s", gateMessages(findings))
	}
	// It must also notice the Job never waits.
	if !hasMessage(findings, "wait-for-runtime-secret") {
		t.Errorf("the missing readiness wait was not detected:\n%s", gateMessages(findings))
	}
}

func TestVerifyMigrationGate_AcceptsHookOrderedAndWaitingJob(t *testing.T) {
	if f := VerifyMigrationGate(fixedGateRender); len(f) != 0 {
		t.Fatalf("the corrected render was rejected:\n%s", gateMessages(f))
	}
}

// TestVerifyMigrationGate_RejectsHookWeightTie: Helm gives no ordering
// guarantee between hooks of equal weight, so "it is a hook" is not
// enough.
func TestVerifyMigrationGate_RejectsHookWeightTie(t *testing.T) {
	render := strings.Replace(fixedGateRender, `helm.sh/hook-weight: "-10"`, `helm.sh/hook-weight: "0"`, 1)
	findings := VerifyMigrationGate(render)
	if !hasMessage(findings, "does not sort before the migration Job") {
		t.Fatalf("an equal hook weight was accepted:\n%s", gateMessages(findings))
	}
}

// TestVerifyMigrationGate_RequireModeAllowsOrdinarySource: in `require`
// mode the source is deliberately applied outside the release and the
// Secret is guaranteed pre-provisioned — validated against the live
// cluster at install time, which a static render cannot do.
// TestVerifyMigrationGate_RequireModeStillDemandsTheWait: even with a
// genuinely pre-provisioned Secret, the readiness wait is mandatory —
// pre-provisioned does not mean currently reconciled.
func TestVerifyMigrationGate_RequireModeStillDemandsTheWait(t *testing.T) {
	// Drop the chart-rendered ExternalSecret so `require` is coherent,
	// and keep the Job's original wait-less shape.
	job := brokenGateRender[strings.Index(brokenGateRender, "apiVersion: batch/v1"):]
	render := strings.Replace(job,
		`    helm.sh/hook-weight: "0"`,
		"    helm.sh/hook-weight: \"0\"\n    teslasync.io/migration-gate: \"require\"", 1)
	findings := VerifyMigrationGate(render)
	if hasMessage(findings, "rendered as an ORDINARY manifest") {
		t.Errorf("a release with no rendered source was treated as the ordering defect:\n%s", gateMessages(findings))
	}
	if !hasMessage(findings, "wait-for-runtime-secret") {
		t.Fatalf("require mode was allowed to skip the readiness wait:\n%s", gateMessages(findings))
	}
}

// TestVerifyMigrationGate_NoneModeIsAdvisoryNotSilent: `none` is the
// documented escape hatch, so it must not block a render — but it must
// never be silent either.
func TestVerifyMigrationGate_NoneModeIsAdvisoryNotSilent(t *testing.T) {
	render := strings.Replace(brokenGateRender,
		`    helm.sh/hook-weight: "0"`,
		"    helm.sh/hook-weight: \"0\"\n    teslasync.io/migration-gate: \"none\"", 1)
	findings := VerifyMigrationGate(render)

	var ordering *Finding
	for i := range findings {
		if strings.Contains(findings[i].Message, "rendered as an ORDINARY manifest") {
			ordering = &findings[i]
		}
		if findings[i].Severity == SeverityError {
			t.Errorf("mode=none produced a blocking finding, so the escape hatch is unusable: %s", findings[i].Message)
		}
	}
	if ordering == nil {
		t.Fatalf("mode=none silently accepted the ordering defect:\n%s", gateMessages(findings))
	}
	if ordering.Severity != SeverityAdvisory {
		t.Errorf("the mode=none ordering finding is %q, want advisory", ordering.Severity)
	}
	if !strings.Contains(ordering.Message, "chosen explicitly") {
		t.Errorf("the advisory does not record that the risk was opted into: %s", ordering.Message)
	}
}

// TestVerifyMigrationGate_RequireModeRejectsChartRenderedSource pins the
// third defect. `require` means the Secret is provisioned OUTSIDE the
// release. Combining it with a chart-rendered source is not merely
// redundant — Helm cannot apply an ordinary manifest until the
// pre-install hooks have finished, so the migration Job waits the full
// timeout on every fresh install, by construction.
func TestVerifyMigrationGate_RequireModeRejectsChartRenderedSource(t *testing.T) {
	render := strings.Replace(fixedGateRender, `    teslasync.io/migration-gate: "hook"`,
		`    teslasync.io/migration-gate: "require"`, 1)
	findings := VerifyMigrationGate(render)
	if !hasMessage(findings, "provisioned OUTSIDE this release") {
		t.Fatalf("require mode accepted a chart-rendered source:\n%s", gateMessages(findings))
	}
	if !hasMessage(findings, "wait the full timeout on every fresh install") {
		t.Errorf("the finding does not explain that this is a guaranteed failure:\n%s", gateMessages(findings))
	}
	blocking := false
	for _, f := range findings {
		if f.Severity == SeverityError {
			blocking = true
		}
	}
	if !blocking {
		t.Error("the require+rendered-source combination must block, not advise")
	}
}

// TestVerifyMigrationGate_RequireModeAllowsPreProvisionedSecret is the
// positive half: with no rendered source, `require` is exactly right.
func TestVerifyMigrationGate_RequireModeAllowsPreProvisionedSecret(t *testing.T) {
	// Everything before the Job document is the ExternalSecret; drop it.
	job := fixedGateRender[strings.Index(fixedGateRender, "apiVersion: batch/v1"):]
	render := strings.Replace(job, `    teslasync.io/migration-gate: "hook"`,
		`    teslasync.io/migration-gate: "require"`, 1)
	if f := VerifyMigrationGate(render); len(f) != 0 {
		t.Fatalf("require mode with a genuinely pre-provisioned Secret was rejected:\n%s", gateMessages(f))
	}
}

// TestVerifyMigrationGate_HookModeRequiresRenderedSource is the mirror:
// hook can only order what the chart renders.
func TestVerifyMigrationGate_HookModeRequiresRenderedSource(t *testing.T) {
	job := fixedGateRender[strings.Index(fixedGateRender, "apiVersion: batch/v1"):]
	if f := VerifyMigrationGate(job); !hasMessage(f, "no rendered object produces Secret") {
		t.Fatalf("hook mode accepted a release with nothing to order:\n%s", gateMessages(f))
	}
}

// ── Defect 1: ordinary -> hook conversion must not self-destruct ─────
//
// Without `helm.sh/resource-policy: keep`, upgrading a release where the
// source was an ORDINARY manifest destroys it: `before-hook-creation`
// recreates it during pre-upgrade, then Helm's regular reconciliation
// finds it in the old release manifest but not the new one, puts it in
// `original.Difference(target)`, and deletes the object it just created.
func TestVerifyMigrationGate_RequiresResourcePolicyKeepOnHookSource(t *testing.T) {
	render := strings.Replace(fixedGateRender, "    helm.sh/resource-policy: keep\n", "", 1)
	findings := VerifyMigrationGate(render)
	if !hasMessage(findings, "carries no `helm.sh/resource-policy: keep`") {
		t.Fatalf("a hook source with no keep policy was accepted:\n%s", gateMessages(findings))
	}
	if !hasMessage(findings, "deletes\nthe object it just created") &&
		!hasMessage(findings, "deletes the object it just created") {
		t.Errorf("the finding does not explain the conversion failure:\n%s", gateMessages(findings))
	}
	// And it must not suggest dropping before-hook-creation, which Helm
	// requires because it CREATES hook resources rather than patching.
	if !hasMessage(findings, "before-hook-creation` still works") {
		t.Errorf("the finding does not record that keep and before-hook-creation coexist:\n%s", gateMessages(findings))
	}
}

// TestVerifyMigrationGate_ChartManagedSecretConversion covers the same
// invariant for the chart-managed Secret, which is the shape the
// CRITICAL review finding was raised against.
func TestVerifyMigrationGate_ChartManagedSecretConversion(t *testing.T) {
	const managed = `
apiVersion: v1
kind: Secret
metadata:
  name: test-teslasync
  annotations:
    helm.sh/hook: pre-install,pre-upgrade
    helm.sh/hook-weight: "-10"
    helm.sh/hook-delete-policy: before-hook-creation
---
`
	render := managed + fixedGateRender[strings.Index(fixedGateRender, "apiVersion: batch/v1"):]
	if f := VerifyMigrationGate(render); !hasMessage(f, `Secret "test-teslasync" is a hook but carries no`) {
		t.Fatalf("a chart-managed hook Secret with no keep policy was accepted:\n%s", gateMessages(f))
	}

	withKeep := strings.Replace(managed, "  annotations:\n", "  annotations:\n    helm.sh/resource-policy: keep\n", 1)
	fixed := withKeep + fixedGateRender[strings.Index(fixedGateRender, "apiVersion: batch/v1"):]
	if f := VerifyMigrationGate(fixed); len(f) != 0 {
		t.Fatalf("the corrected chart-managed Secret was rejected:\n%s", gateMessages(f))
	}
}

// ── Defect 2: the hook must not garbage-collect its own target ───────
//
// ESO sets `.metadata.ownerReferences` on the target Secret for every
// creationPolicy except Orphan, so deleting the ExternalSecret — which
// `before-hook-creation` does on every upgrade — makes Kubernetes
// collect the credentials with it. `deletionPolicy: Retain` does not
// help: it only governs provider-side data deletion.
func TestVerifyMigrationGate_RequiresOrphanCreationPolicy(t *testing.T) {
	for _, policy := range []string{"Owner", "Merge", "None"} {
		t.Run(policy, func(t *testing.T) {
			render := strings.Replace(fixedGateRender, "    creationPolicy: Orphan", "    creationPolicy: "+policy, 1)
			findings := VerifyMigrationGate(render)
			if !hasMessage(findings, "creationPolicy: "+policy) {
				t.Fatalf("creationPolicy %s was accepted on a hook ExternalSecret:\n%s", policy, gateMessages(findings))
			}
			if !hasMessage(findings, "does NOT prevent this") {
				t.Errorf("the finding does not correct the deletionPolicy misconception:\n%s", gateMessages(findings))
			}
		})
	}

	t.Run("unset", func(t *testing.T) {
		render := strings.Replace(fixedGateRender, "    creationPolicy: Orphan\n", "", 1)
		if f := VerifyMigrationGate(render); !hasMessage(f, "creationPolicy: <unset>") {
			t.Fatalf("an unset creationPolicy was accepted:\n%s", gateMessages(f))
		}
	})

	t.Run("retain is not protection", func(t *testing.T) {
		// deletionPolicy Retain with a non-Orphan creationPolicy is the
		// exact false-confidence shape the review flagged.
		render := strings.Replace(fixedGateRender, "    creationPolicy: Orphan", "    creationPolicy: Owner", 1)
		if !strings.Contains(render, "deletionPolicy: Retain") {
			t.Fatal("fixture lost its deletionPolicy; the test no longer covers the misconception")
		}
		if f := VerifyMigrationGate(render); !hasMessage(f, "deletionPolicy: Retain` does NOT prevent this") {
			t.Fatalf("Retain was allowed to stand in for Orphan:\n%s", gateMessages(f))
		}
	})
}

func TestVerifyMigrationGate_RequiresDeclaredContract(t *testing.T) {
	render := strings.Replace(fixedGateRender, "    teslasync.io/migration-gate: \"hook\"\n", "", 1)
	if f := VerifyMigrationGate(render); !hasMessage(f, "does not record `teslasync.io/migration-gate`") {
		t.Fatalf("an unlabelled contract was accepted:\n%s", gateMessages(f))
	}
}

// TestVerifyMigrationGate_RequiresOptionalSecretMount: a non-optional
// mount makes the pod unschedulable until the Secret exists, which is
// exactly the opaque failure the wait replaces.
func TestVerifyMigrationGate_RequiresOptionalSecretMount(t *testing.T) {
	render := strings.Replace(fixedGateRender, "            optional: true", "            optional: false", 1)
	if f := VerifyMigrationGate(render); !hasMessage(f, "without `optional: true`") {
		t.Fatalf("a blocking secret mount was accepted:\n%s", gateMessages(f))
	}
}

func TestVerifyMigrationGate_RequiresBoundedWait(t *testing.T) {
	render := strings.Replace(fixedGateRender,
		"              DEADLINE=$(( $(date +%s) + TIMEOUT_SECONDS ))\n", "", 1)
	if f := VerifyMigrationGate(render); !hasMessage(f, "has no timeout") {
		t.Fatalf("an unbounded wait was accepted:\n%s", gateMessages(f))
	}
}

func TestVerifyMigrationGate_RequiresActionableDiagnostic(t *testing.T) {
	render := strings.Replace(fixedGateRender, `echo "kubectl get externalsecret"`, `echo "failed"`, 1)
	if f := VerifyMigrationGate(render); !hasMessage(f, "inspect the ExternalSecret status") {
		t.Fatalf("a wait with no operator diagnostic was accepted:\n%s", gateMessages(f))
	}
}

func TestVerifyMigrationGate_RequiresMigrationJob(t *testing.T) {
	if f := VerifyMigrationGate("kind: ConfigMap\nmetadata:\n  name: x\n"); !hasMessage(f, "no migration Job") {
		t.Fatalf("a render with no migration hook was accepted:\n%s", gateMessages(f))
	}
}

// ── Against the real chart ───────────────────────────────────────────
//
// Fixtures can drift from the chart they describe, so every supported
// secret mode is rendered with the actual `helm template` and checked.

func helmRender(t *testing.T, args ...string) string {
	t.Helper()
	helm, err := exec.LookPath("helm")
	if err != nil {
		t.Skip("helm is not installed; the fixture tests still cover the gate semantics")
	}
	full := append([]string{"template", "test", "../../helm/teslasync"}, args...)
	out, err := exec.Command(helm, full...).CombinedOutput()
	if err != nil {
		t.Fatalf("helm template %v failed: %v\n%s", args, err, out)
	}
	return string(out)
}

func TestRealChartMigrationGateAcrossSecretModes(t *testing.T) {
	cases := []struct {
		name string
		args []string
		// wantMode is the contract the chart must record for this mode.
		wantMode string
		// wantWait is whether the Job must carry the readiness wait.
		wantWait bool
		// wantKeep is whether a hook-rendered source must be protected
		// from Helm's regular removal phase.
		wantKeep bool
		// wantCreationPolicy is asserted on the ExternalSecret target.
		wantCreationPolicy string
	}{
		{
			name:     "default pre-provisioned secret",
			args:     nil,
			wantMode: "none",
			wantWait: false,
		},
		{
			name: "external secrets",
			args: []string{
				"--set", "externalSecrets.enabled=true",
				"--set-string", "externalSecrets.secretStoreRef.name=production-secrets",
				"--set-string", "externalSecrets.target.name=teslasync-runtime",
				"--set-string", "externalSecrets.dataFrom[0].extract.key=teslasync/production",
			},
			wantMode:           "hook",
			wantWait:           true,
			wantKeep:           true,
			wantCreationPolicy: "Orphan",
		},
		{
			name: "external secrets with an explicit Orphan policy",
			args: []string{
				"--set", "externalSecrets.enabled=true",
				"--set-string", "externalSecrets.secretStoreRef.name=production-secrets",
				"--set-string", "externalSecrets.dataFrom[0].extract.key=teslasync/production",
				"--set-string", "externalSecrets.target.creationPolicy=Orphan",
			},
			wantMode:           "hook",
			wantWait:           true,
			wantKeep:           true,
			wantCreationPolicy: "Orphan",
		},
		{
			name: "external secrets outside hook mode is still Orphan",
			args: []string{
				"--set", "externalSecrets.enabled=true",
				"--set-string", "externalSecrets.secretStoreRef.name=production-secrets",
				"--set-string", "externalSecrets.dataFrom[0].extract.key=teslasync/production",
				"--set", "migrationGate.mode=none",
			},
			wantMode: "none",
			wantWait: false,
			wantKeep: false,
			// Issue B: an ownerReference written under `none` today is
			// what garbage-collects the target the day this release
			// enters hook mode. Orphan must not be conditional on the
			// mode that happens to be active right now.
			wantCreationPolicy: "Orphan",
		},
		{
			name: "chart-managed secret",
			args: []string{
				"--set", "secrets.create=true",
				"--set-string", "postgresql.auth.password=CIOnlyDatabasePassword-2026",
				"--set-string", "grafana.adminPassword=CIOnlyGrafanaPassword-2026",
			},
			wantMode: "hook",
			wantWait: true,
			wantKeep: true,
		},
		{
			name:     "existing secret",
			args:     []string{"--set-string", "secrets.existingSecret=teslasync-runtime"},
			wantMode: "none",
			wantWait: false,
		},
		{
			name: "existing secret with the require contract",
			args: []string{
				"--set-string", "secrets.existingSecret=teslasync-runtime",
				"--set", "migrationGate.mode=require",
			},
			wantMode: "require",
			wantWait: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			render := helmRender(t, tc.args...)
			for _, f := range VerifyMigrationGate(render) {
				if f.Severity == SeverityError {
					t.Errorf("%s: %s", f.Subject, f.Message)
				}
			}
			if !strings.Contains(render, `"teslasync.io/migration-gate": "`+tc.wantMode+`"`) {
				t.Errorf("chart did not record migration gate mode %q", tc.wantMode)
			}
			if got := strings.Contains(render, "wait-for-runtime-secret"); got != tc.wantWait {
				t.Errorf("readiness wait present = %v, want %v", got, tc.wantWait)
			}
			if tc.wantCreationPolicy != "" {
				want := `creationPolicy: "` + tc.wantCreationPolicy + `"`
				if !strings.Contains(render, want) {
					t.Errorf("ExternalSecret target does not declare %s", want)
				}
			}
			if tc.wantKeep {
				// Every hook-rendered secret source must survive the
				// ordinary -> hook conversion upgrade.
				assertHookSourcesKeepResource(t, render)
			}
		})
	}
}

// assertHookSourcesKeepResource walks the render and requires every
// Secret/ExternalSecret that is a Helm hook to also carry
// `helm.sh/resource-policy: keep`.
func assertHookSourcesKeepResource(t *testing.T, render string) {
	t.Helper()
	objs, err := decodeMigrationGate(render)
	if err != nil {
		t.Fatalf("decode render: %v", err)
	}
	found := 0
	for _, o := range objs {
		if o.Kind != "Secret" && o.Kind != "ExternalSecret" {
			continue
		}
		if _, isHook := o.hookWeight(); !isHook {
			continue
		}
		found++
		if !o.keepsResource() {
			t.Errorf("%s %q is a hook without resource-policy: keep; an ordinary -> hook upgrade would delete it",
				o.Kind, o.Metadata.Name)
		}
	}
	if found == 0 {
		t.Error("no hook-rendered secret source found, so the conversion invariant was not exercised")
	}
}

// TestRealChartRejectsIncoherentGateConfiguration proves the chart fails
// fast rather than rendering a contract it cannot honour.
func TestRealChartRejectsIncoherentGateConfiguration(t *testing.T) {
	helm, err := exec.LookPath("helm")
	if err != nil {
		t.Skip("helm is not installed")
	}
	cases := []struct {
		name string
		args []string
		want string
	}{
		{
			name: "unknown mode",
			args: []string{"--set", "migrationGate.mode=bogus"},
			want: "migrationGate.mode must be auto, hook, require, or none",
		},
		{
			name: "hook mode cannot own an out-of-band Secret",
			args: []string{"--set-string", "secrets.existingSecret=runtime", "--set", "migrationGate.mode=hook"},
			want: "cannot manage secrets.existingSecret",
		},
		{
			name: "hook mode needs something to order",
			args: []string{"--set", "migrationGate.mode=hook"},
			want: "requires a chart-rendered secret source",
		},
		{
			name: "require cannot be combined with externalSecrets",
			args: []string{
				"--set", "externalSecrets.enabled=true",
				"--set-string", "externalSecrets.secretStoreRef.name=s",
				"--set-string", "externalSecrets.dataFrom[0].extract.key=k",
				"--set", "migrationGate.mode=require",
			},
			want: "would time out on every fresh install by construction",
		},
		{
			name: "require cannot be combined with a chart-managed Secret",
			args: []string{
				"--set", "secrets.create=true",
				"--set-string", "postgresql.auth.password=CIOnlyDatabasePassword-2026",
				"--set-string", "grafana.adminPassword=CIOnlyGrafanaPassword-2026",
				"--set", "migrationGate.mode=require",
			},
			want: "is incompatible with a chart-rendered secret source",
		},
		{
			name: "hook mode refuses an owning creationPolicy",
			args: []string{
				"--set", "externalSecrets.enabled=true",
				"--set-string", "externalSecrets.secretStoreRef.name=s",
				"--set-string", "externalSecrets.dataFrom[0].extract.key=k",
				"--set-string", "externalSecrets.target.creationPolicy=Owner",
			},
			want: "is not supported; this chart renders Orphan in every migrationGate mode",
		},
		{
			// Issue B: rejection must not be conditional on the mode that
			// happens to be active. An Owner reference written under
			// `none` is what kills the target on the later conversion.
			name: "none mode also refuses an owning creationPolicy",
			args: []string{
				"--set", "externalSecrets.enabled=true",
				"--set-string", "externalSecrets.secretStoreRef.name=s",
				"--set-string", "externalSecrets.dataFrom[0].extract.key=k",
				"--set-string", "externalSecrets.target.creationPolicy=Owner",
				"--set", "migrationGate.mode=none",
			},
			want: "the day this release enters hook mode",
		},
		{
			name: "Merge is refused too",
			args: []string{
				"--set", "externalSecrets.enabled=true",
				"--set-string", "externalSecrets.secretStoreRef.name=s",
				"--set-string", "externalSecrets.dataFrom[0].extract.key=k",
				"--set-string", "externalSecrets.target.creationPolicy=Merge",
			},
			want: "is not supported",
		},
		{
			name: "poll interval must fit inside the timeout",
			args: []string{"--set", "migrationGate.timeoutSeconds=10", "--set", "migrationGate.pollIntervalSeconds=30"},
			want: "must be smaller than timeoutSeconds",
		},
		{
			name: "required keys cannot be empty",
			args: []string{"--set", "migrationGate.requiredKeys=null"},
			want: "must name at least one key",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			full := append([]string{"template", "test", "../../helm/teslasync"}, tc.args...)
			out, err := exec.Command(helm, full...).CombinedOutput()
			if err == nil {
				t.Fatalf("helm template accepted an incoherent configuration:\n%s", out)
			}
			if !strings.Contains(string(out), tc.want) {
				t.Errorf("error did not explain the problem (want %q):\n%s", tc.want, out)
			}
		})
	}
}

// TestRealChartRendersDeterministically: the `require` contract consults
// the live cluster, and a render with no cluster must still be stable.
func TestRealChartRendersDeterministically(t *testing.T) {
	for _, args := range [][]string{
		nil,
		{"--set-string", "secrets.existingSecret=teslasync-runtime", "--set", "migrationGate.mode=require"},
		{"--set-string", "secrets.existingSecret=teslasync-runtime"},
	} {
		first := helmRender(t, args...)
		second := helmRender(t, args...)
		if first != second {
			t.Errorf("render is not deterministic for %v", args)
		}
	}
}
