package ops

import (
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

// ── OPS-11 runbooks ──────────────────────────────────────────────────

func completeRunbook() string {
	sections := []string{"Symptoms", "Confirm", "Immediate mitigation", "Recovery", "Verify", "Escalation"}
	var b strings.Builder
	b.WriteString("# Degraded mode: thing\n\n")
	for _, s := range sections {
		b.WriteString("## " + s + "\n\nThis section carries more than forty characters of real operator content.\n\n")
	}
	return b.String()
}

func runbookManifest(mutate func(*Dependency)) *RunbookManifest {
	m := &RunbookManifest{
		Version:               1,
		RequiredCriticalities: []string{"critical", "degraded-tolerable"},
	}
	for _, id := range requiredDependencies {
		d := Dependency{
			ID:                id,
			Title:             "Title for " + id,
			Criticality:       "critical",
			UsedFor:           "used for something",
			DegradedBehaviour: "degrades in a specific way",
			Fallback:          "falls back to something",
			Detection:         []DependencySignal{{Signal: "a_metric", Note: "a note"}},
			Runbook:           "docs/runbooks/degraded-mode-" + id + ".md",
		}
		if id == requiredDependencies[0] && mutate != nil {
			mutate(&d)
		}
		m.Dependencies = append(m.Dependencies, d)
	}
	return m
}

func runbookFS(overrides map[string]string) fstest.MapFS {
	out := fstest.MapFS{}
	for _, id := range requiredDependencies {
		out["docs/runbooks/degraded-mode-"+id+".md"] = &fstest.MapFile{Data: []byte(completeRunbook())}
	}
	for path, body := range overrides {
		out[path] = &fstest.MapFile{Data: []byte(body)}
	}
	return out
}

func TestValidateRunbooks_AcceptsACompleteRegister(t *testing.T) {
	if f := ValidateRunbooks(runbookFS(nil), runbookManifest(nil)); len(f) != 0 {
		t.Fatalf("unexpected findings: %+v", f)
	}
}

func TestValidateRunbooks_RequiresEveryDependency(t *testing.T) {
	m := runbookManifest(nil)
	m.Dependencies = m.Dependencies[:2]
	findings := ValidateRunbooks(runbookFS(nil), m)
	if !hasMessage(findings, "missing mandatory dependency") {
		t.Fatalf("incomplete register accepted: %+v", findings)
	}
}

func TestValidateRunbooks_RejectsIncompleteEntries(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Dependency)
		want   string
	}{
		{"no degraded behaviour", func(d *Dependency) { d.DegradedBehaviour = "" }, "degraded_behaviour is required"},
		{"no fallback", func(d *Dependency) { d.Fallback = "" }, "fallback is required"},
		{"no detection", func(d *Dependency) { d.Detection = nil }, "at least one detection signal"},
		{"detection without a note", func(d *Dependency) { d.Detection = []DependencySignal{{Signal: "x"}} }, "needs a signal and a note"},
		{"unknown criticality", func(d *Dependency) { d.Criticality = "meh" }, "is not one of"},
		{"missing runbook file", func(d *Dependency) { d.Runbook = "docs/runbooks/nope.md" }, "does not exist"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			findings := ValidateRunbooks(runbookFS(nil), runbookManifest(tt.mutate))
			if !hasMessage(findings, tt.want) {
				t.Fatalf("want a finding containing %q, got %+v", tt.want, findings)
			}
		})
	}
}

// TestValidateRunbooks_RejectsSkeletonRunbooks is the anti-stub rule: a
// runbook that exists but says nothing is worse than none, because it
// looks like coverage.
func TestValidateRunbooks_RejectsSkeletonRunbooks(t *testing.T) {
	first := requiredDependencies[0]
	path := "docs/runbooks/degraded-mode-" + first + ".md"

	t.Run("missing section", func(t *testing.T) {
		body := strings.Replace(completeRunbook(), "## Recovery\n", "## Something Else\n", 1)
		findings := ValidateRunbooks(runbookFS(map[string]string{path: body}), runbookManifest(nil))
		if !hasMessage(findings, `is missing the "## Recovery" section`) {
			t.Fatalf("missing section not detected: %+v", findings)
		}
	})

	t.Run("stub section", func(t *testing.T) {
		body := strings.Replace(completeRunbook(),
			"## Verify\n\nThis section carries more than forty characters of real operator content.\n",
			"## Verify\n\nTBD\n", 1)
		findings := ValidateRunbooks(runbookFS(map[string]string{path: body}), runbookManifest(nil))
		if !hasMessage(findings, "is a stub") {
			t.Fatalf("stub section not detected: %+v", findings)
		}
	})

	t.Run("TODO marker", func(t *testing.T) {
		body := completeRunbook() + "\nTODO: finish this\n"
		findings := ValidateRunbooks(runbookFS(map[string]string{path: body}), runbookManifest(nil))
		if !hasMessage(findings, `contains a "TODO" marker`) {
			t.Fatalf("TODO marker not detected: %+v", findings)
		}
	})
}

// ── OPS-03 restore drill ─────────────────────────────────────────────

func restoreDrill(mutate func(*RestoreDrill)) *RestoreDrill {
	d := &RestoreDrill{
		Version:  1,
		Schedule: RestoreSchedule{Cron: "0 5 * * 1", Timezone: "UTC", MaxInterval: 192 * time.Hour},
		Modes: []RestoreMode{
			{ID: "roundtrip", Default: true, Description: "self contained", Target: "ephemeral"},
			{ID: "production-artifact", RequiresCredentials: true, CredentialEnv: []string{"BACKUP_DRILL_DATABASE_URL"}, Description: "real artifact", Target: "scratch"},
		},
		CriticalTables: []string{"vehicles"},
		SuccessCriteria: []RestoreCriterion{
			{ID: "a", Statement: "s", ImplementedBy: "somewhere"},
		},
		Fixture:    "fixture.sql",
		Objectives: RestoreObjectives{RTOTarget: "1h", RPOTarget: "24h", MeasurementStatus: "pending-first-drill"},
		Escalation: RestoreEscalation{OnFailure: "open an issue", Runbook: "runbook.md"},
		Workflow:   "workflow.yml",
	}
	if mutate != nil {
		mutate(d)
	}
	return d
}

func restoreFS() fstest.MapFS {
	return fstest.MapFS{
		"runbook.md":   &fstest.MapFile{Data: []byte("x")},
		"workflow.yml": &fstest.MapFile{Data: []byte("x")},
		"fixture.sql":  &fstest.MapFile{Data: []byte("INSERT INTO vehicles …")},
	}
}

func TestValidateRestore_AcceptsAWellFormedDrill(t *testing.T) {
	if f := ValidateRestore(restoreFS(), restoreDrill(nil)); len(f) != 0 {
		t.Fatalf("unexpected findings: %+v", f)
	}
}

func TestValidateRestore_RejectsBrokenDrills(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*RestoreDrill)
		want   string
	}{
		{"no schedule", func(d *RestoreDrill) { d.Schedule.Cron = "" }, "not scheduled"},
		{"bad cron", func(d *RestoreDrill) { d.Schedule.Cron = "0 5 *" }, "not a 5-field cron"},
		{"no max interval", func(d *RestoreDrill) { d.Schedule.MaxInterval = 0 }, "silently-disabled schedule"},
		{"default mode needs credentials", func(d *RestoreDrill) { d.Modes[0].RequiresCredentials = true }, "must not require credentials"},
		{"two defaults", func(d *RestoreDrill) { d.Modes[1].Default = true }, "exactly one mode must be marked default"},
		{"credentials without env names", func(d *RestoreDrill) { d.Modes[1].CredentialEnv = nil }, "credential_env naming the variables"},
		{"no critical tables", func(d *RestoreDrill) { d.CriticalTables = nil }, "at least one table"},
		{"criterion without implementation", func(d *RestoreDrill) { d.SuccessCriteria[0].ImplementedBy = "" }, "implemented_by is required"},
		{"missing runbook", func(d *RestoreDrill) { d.Escalation.Runbook = "nope.md" }, "nope.md does not exist"},
		{"missing workflow", func(d *RestoreDrill) { d.Workflow = "nope.yml" }, "nope.yml does not exist"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			findings := ValidateRestore(restoreFS(), restoreDrill(tt.mutate))
			if !hasMessage(findings, tt.want) {
				t.Fatalf("want a finding containing %q, got %+v", tt.want, findings)
			}
		})
	}
}

// TestValidateRestore_RejectsFabricatedMeasurement: RTO/RPO targets must
// never be presented as measured capability.
func TestValidateRestore_RejectsFabricatedMeasurement(t *testing.T) {
	findings := ValidateRestore(restoreFS(), restoreDrill(func(d *RestoreDrill) {
		d.Objectives.MeasurementStatus = "verified"
	}))
	if !hasMessage(findings, "targets must never be presented as measurements") {
		t.Fatalf("fabricated measurement status accepted: %+v", findings)
	}
}

// ── OPS-10 capacity ──────────────────────────────────────────────────

func capacityManifest(mutate func(*CapacityProfile)) *CapacityManifest {
	m := &CapacityManifest{
		Version: 1,
		Safety: CapacitySafety{
			AllowedEnvironments: []string{"local", "ephemeral-ci"},
			RequireConfirmation: true,
			ConfirmationToken:   "RUN",
			MaxDuration:         30 * time.Minute,
		},
	}
	for _, id := range requiredCapacityProfiles {
		p := CapacityProfile{
			ID:           id,
			Title:        "Title",
			Description:  "description",
			Subsystem:    "sub",
			Driver:       "k6",
			Entrypoint:   "entry.js",
			Workload:     map[string]any{"duration": "5m"},
			Thresholds:   []CapacityThreshold{{Metric: "m", Comparison: "lt", Value: 1, Rationale: "because"}},
			LastExecuted: "never",
		}
		if id == requiredCapacityProfiles[0] && mutate != nil {
			mutate(&p)
		}
		m.Profiles = append(m.Profiles, p)
	}
	return m
}

func capacityFS() fstest.MapFS {
	return fstest.MapFS{"entry.js": &fstest.MapFile{Data: []byte("x")}}
}

func TestValidateCapacity_AcceptsAWellFormedManifest(t *testing.T) {
	if f := ValidateCapacity(capacityFS(), capacityManifest(nil)); len(f) != 0 {
		t.Fatalf("unexpected findings: %+v", f)
	}
}

// TestValidateCapacity_RejectsUnrunClaims is the honesty rule: a profile
// may not claim an execution without a reference someone can open.
func TestValidateCapacity_RejectsUnrunClaims(t *testing.T) {
	findings := ValidateCapacity(capacityFS(), capacityManifest(func(p *CapacityProfile) {
		p.LastExecuted = "2026-08-26"
	}))
	if !hasMessage(findings, "claiming an execution requires a run_reference") {
		t.Fatalf("unreferenced execution claim accepted: %+v", findings)
	}

	findings = ValidateCapacity(capacityFS(), capacityManifest(func(p *CapacityProfile) {
		p.RunReference = "https://example/run/1"
	}))
	if !hasMessage(findings, "last_executed is `never` but a run_reference is set") {
		t.Fatalf("contradictory execution record accepted: %+v", findings)
	}
}

func TestValidateCapacity_SafetyGuardrails(t *testing.T) {
	t.Run("production is never an allowed target", func(t *testing.T) {
		m := capacityManifest(nil)
		m.Safety.AllowedEnvironments = append(m.Safety.AllowedEnvironments, "production")
		findings := ValidateCapacity(capacityFS(), m)
		if !hasMessage(findings, "would permit generating load against production") {
			t.Fatalf("production target accepted: %+v", findings)
		}
	})

	t.Run("confirmation is mandatory", func(t *testing.T) {
		m := capacityManifest(nil)
		m.Safety.RequireConfirmation = false
		findings := ValidateCapacity(capacityFS(), m)
		if !hasMessage(findings, "must require an explicit confirmation token") {
			t.Fatalf("unconfirmed load accepted: %+v", findings)
		}
	})

	t.Run("duration is capped", func(t *testing.T) {
		findings := ValidateCapacity(capacityFS(), capacityManifest(func(p *CapacityProfile) {
			p.Workload = map[string]any{"duration": "2h"}
		}))
		if !hasMessage(findings, "exceeds safety.max_duration") {
			t.Fatalf("over-long profile accepted: %+v", findings)
		}
	})

	t.Run("entrypoint must exist", func(t *testing.T) {
		findings := ValidateCapacity(capacityFS(), capacityManifest(func(p *CapacityProfile) {
			p.Entrypoint = "missing.js"
		}))
		if !hasMessage(findings, "is not repeatable") {
			t.Fatalf("dangling entrypoint accepted: %+v", findings)
		}
	})

	t.Run("thresholds need a rationale", func(t *testing.T) {
		findings := ValidateCapacity(capacityFS(), capacityManifest(func(p *CapacityProfile) {
			p.Thresholds[0].Rationale = ""
		}))
		if !hasMessage(findings, "has no rationale") {
			t.Fatalf("unjustified threshold accepted: %+v", findings)
		}
	})
}

func TestValidateCapacity_RequiresEveryMandatoryProfile(t *testing.T) {
	m := capacityManifest(nil)
	m.Profiles = m.Profiles[:2]
	findings := ValidateCapacity(capacityFS(), m)
	if !hasMessage(findings, "missing mandatory capacity profile") {
		t.Fatalf("incomplete profile set accepted: %+v", findings)
	}
}

// ── OPS-05 rollout ───────────────────────────────────────────────────

func intPtr(v int) *int { return &v }

func rolloutManifest(mutate func(*RolloutManifest)) *RolloutManifest {
	m := &RolloutManifest{
		Version:      1,
		PauseControl: RolloutPause{HelmValue: "rollout.paused", KubernetesField: "spec.paused"},
		Shutdown: ShutdownBudget{
			HelmValue:                 "terminationGracePeriodSeconds",
			PreStopPropagationSeconds: 5,
			TelemetryFlushSeconds:     10,
			ServerDrainSeconds:        30,
			InboundLogDrainSeconds:    30,
			DrainListenerSeconds:      5,
			RequiredHeadroomSeconds:   10,
		},
		DrainPlane: DrainPlane{
			HelmValue:                       "drain.port",
			BindAddress:                     "127.0.0.1",
			HookType:                        "exec",
			HookCommand:                     "/usr/local/bin/teslasync drain",
			DrainPath:                       DrainPath,
			PublicStatusPath:                DrainStatusPath,
			ExposedByService:                false,
			StuckDrainLivenessBudgetSeconds: 180,
		},
		SelectorMigration: migrationSteps(stepOrphanDeployment, stepOrphanReplicaSet, stepUpgrade, stepDeletePods),
		Components: []RolloutComponent{
			{
				ID: "api", Workload: "Deployment/api", HelmPath: "rollout.api",
				CanarySupported: true, TrafficSplit: "replica-share",
				DefaultStrategy: RolloutStrategy{Type: "RollingUpdate", RenderedByDefault: true, MaxSurge: intPtr(1), MaxUnavailable: intPtr(0)},
			},
			{
				ID: "worker", Workload: "Deployment/worker", HelmPath: "rollout.worker",
				CanarySupported: false, TrafficSplit: "none",
				DefaultStrategy: RolloutStrategy{Type: StrategyKubernetesDefault, Note: "left unset on purpose"},
			},
		},
		HighRiskFlags: []HighRiskFlag{{ID: "f", Description: "d", EnableAtStage: "full", BlastRadius: "b"}},
		Stages: []RolloutStage{
			{ID: "canary", Description: "d", Components: []string{"api"}, BakeTime: "15m", Gates: []string{"smoke"}, PromoteWhen: "p", AbortWhen: "a"},
			{ID: "full", Description: "d", Components: []string{"api", "worker"}, BakeTime: "30m", Gates: []string{"smoke"}, PromoteWhen: "p", AbortWhen: "a"},
		},
		GateImplementations: map[string]string{"smoke": "cmd/smoke-gate"},
	}
	if mutate != nil {
		mutate(m)
	}
	return m
}

func rolloutValues() map[string]any {
	return map[string]any{
		"terminationGracePeriodSeconds": 90,
		"drain":                         map[string]any{"port": 8090},
		"service":                       map[string]any{"port": 8080},
		"rollout": map[string]any{
			"paused": false,
			"api":    map[string]any{"canary": map[string]any{"enabled": false}},
			"worker": map[string]any{"strategy": map[string]any{"type": ""}},
		},
	}
}

// TestValidateRollout_RejectsAGracePeriodThatCannotHoldTheBudget is the
// review-finding-5 regression: Kubernetes' 30s default could not hold
// the 80s shutdown budget, so pods were SIGKILLed mid-drain.
func TestValidateRollout_RejectsAGracePeriodThatCannotHoldTheBudget(t *testing.T) {
	values := rolloutValues()
	values["terminationGracePeriodSeconds"] = 30

	findings := ValidateRollout(rolloutManifest(nil), values, nil)
	if !hasMessage(findings, "SIGKILL the container mid-drain") {
		t.Fatalf("an undersized grace period was accepted: %+v", findings)
	}
}

func TestValidateRollout_RejectsAMissingGracePeriod(t *testing.T) {
	values := rolloutValues()
	delete(values, "terminationGracePeriodSeconds")

	findings := ValidateRollout(rolloutManifest(nil), values, nil)
	if !hasMessage(findings, "Kubernetes would default to 30s") {
		t.Fatalf("an absent grace period was accepted: %+v", findings)
	}
}

func TestShutdownBudgetArithmetic(t *testing.T) {
	s := rolloutManifest(nil).Shutdown
	if got := s.TotalSeconds(); got != 80 {
		t.Fatalf("total = %d, want 80", got)
	}
	if got := s.RequiredGracePeriodSeconds(); got != 90 {
		t.Fatalf("required = %d, want 90", got)
	}
}

// TestValidateRollout_RejectsAServicePublishedDrainPort is the
// review-finding-2 static half: the pod-fatal endpoint must not share
// the port the Service publishes.
func TestValidateRollout_RejectsAServicePublishedDrainPort(t *testing.T) {
	values := rolloutValues()
	values["drain"] = map[string]any{"port": 8080} // same as service.port

	findings := ValidateRollout(rolloutManifest(nil), values, nil)
	if !hasMessage(findings, "would be published by the Service") {
		t.Fatalf("a Service-published drain port was accepted: %+v", findings)
	}
}

func TestValidateRollout_RejectsDrainPlaneClaimingServiceExposure(t *testing.T) {
	findings := ValidateRollout(rolloutManifest(func(m *RolloutManifest) {
		m.DrainPlane.ExposedByService = true
	}), rolloutValues(), nil)
	if !hasMessage(findings, "one-way and pod-fatal") {
		t.Fatalf("declaring the drain plane Service-exposed was accepted: %+v", findings)
	}
}

func TestValidateRollout_AcceptsAWellFormedManifest(t *testing.T) {
	if f := ValidateRollout(rolloutManifest(nil), rolloutValues(), nil); len(f) != 0 {
		t.Fatalf("unexpected findings: %+v", f)
	}
}

func TestValidateRollout_RejectsDriftFromTheChart(t *testing.T) {
	values := rolloutValues()
	delete(values["rollout"].(map[string]any), "api")
	findings := ValidateRollout(rolloutManifest(nil), values, nil)
	if !hasMessage(findings, "helm_path rollout.api is not defined") {
		t.Fatalf("chart drift not detected: %+v", findings)
	}
}

func TestValidateRollout_RejectsBrokenManifests(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*RolloutManifest)
		want   string
	}{
		{"no pause control", func(m *RolloutManifest) { m.PauseControl = RolloutPause{} }, "cannot be halted mid-flight"},
		{"canary without traffic split", func(m *RolloutManifest) { m.Components[0].TrafficSplit = "none" }, "requires a traffic_split"},
		{"non-canary with traffic split", func(m *RolloutManifest) { m.Components[1].TrafficSplit = "replica-share" }, "traffic_split must be `none`"},
		{"rendered rolling update without bounds", func(m *RolloutManifest) { m.Components[0].DefaultStrategy.MaxSurge = nil }, "explicit max_surge and max_unavailable"},
		{"kubernetes-default without a note", func(m *RolloutManifest) { m.Components[1].DefaultStrategy.Note = "" }, "requires a note explaining"},
		{"kubernetes-default claiming to be rendered", func(m *RolloutManifest) { m.Components[1].DefaultStrategy.RenderedByDefault = true }, "rendered_by_default must be false"},
		{"stage without gates", func(m *RolloutManifest) { m.Stages[0].Gates = nil }, "a stage with no gate cannot fail"},
		{"stage with an unimplemented gate", func(m *RolloutManifest) { m.Stages[0].Gates = []string{"nope"} }, "no entry in gate_implementations"},
		{"stage with no bake", func(m *RolloutManifest) { m.Stages[0].BakeTime = "" }, "a stage with no soak proves nothing"},
		{"missing canary stage", func(m *RolloutManifest) { m.Stages = m.Stages[1:] }, `missing mandatory stage "canary"`},
		{"flag at an unknown stage", func(m *RolloutManifest) { m.HighRiskFlags[0].EnableAtStage = "nope" }, "is not a declared stage"},
		{"no high-risk flags", func(m *RolloutManifest) { m.HighRiskFlags = nil }, "no high-risk flags registered"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			findings := ValidateRollout(rolloutManifest(tt.mutate), rolloutValues(), nil)
			if !hasMessage(findings, tt.want) {
				t.Fatalf("want a finding containing %q, got %+v", tt.want, findings)
			}
		})
	}
}

func TestHelmValueExists(t *testing.T) {
	values := map[string]any{"a": map[string]any{"b": map[string]any{"c": 1}}}
	if !helmValueExists(values, "a.b.c") {
		t.Error("a.b.c should resolve")
	}
	if helmValueExists(values, "a.b.d") {
		t.Error("a.b.d should not resolve")
	}
	if helmValueExists(values, "a.b.c.d") {
		t.Error("descending through a scalar should not resolve")
	}
}
