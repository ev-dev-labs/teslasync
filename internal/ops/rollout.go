package ops

import (
	"fmt"
	"io/fs"
	"strings"

	"gopkg.in/yaml.v3"
)

// RolloutManifestPath is the canonical location of the OPS-05 manifest.
const RolloutManifestPath = "ops/rollout/stages.yaml"

// HelmValuesPath is the chart's values file, cross-checked by the gate.
const HelmValuesPath = "helm/teslasync/values.yaml"

// RolloutManifest is the parsed ops/rollout/stages.yaml.
type RolloutManifest struct {
	Version             int                `yaml:"version"`
	PauseControl        RolloutPause       `yaml:"pause_control"`
	Shutdown            ShutdownBudget     `yaml:"shutdown"`
	DrainPlane          DrainPlane         `yaml:"drain_plane"`
	SelectorMigration   SelectorMigration  `yaml:"selector_migration"`
	Components          []RolloutComponent `yaml:"components"`
	HighRiskFlags       []HighRiskFlag     `yaml:"high_risk_flags"`
	Stages              []RolloutStage     `yaml:"stages"`
	GateImplementations map[string]string  `yaml:"gate_implementations"`
}

// SelectorMigration is the documented legacy → disjoint procedure.
type SelectorMigration struct {
	Runbook  string                  `yaml:"runbook"`
	Downtime string                  `yaml:"downtime"`
	Rollback string                  `yaml:"rollback"`
	Steps    []SelectorMigrationStep `yaml:"steps"`
}

// SelectorMigrationStep is one ordered step. `Removes` classifies what
// the step tears down, which is what makes the ordering checkable.
type SelectorMigrationStep struct {
	ID          string `yaml:"id"`
	Removes     string `yaml:"removes"`
	Command     string `yaml:"command"`
	Description string `yaml:"description"`
}

// Values for SelectorMigrationStep.Removes.
const (
	RemovesDeploymentController = "deployment-controller"
	RemovesReplicaSetController = "replicaset-controller"
	RemovesPods                 = "pods"
	RemovesNothing              = "none"
)

var validRemoves = map[string]bool{
	RemovesDeploymentController: true,
	RemovesReplicaSetController: true,
	RemovesPods:                 true,
	RemovesNothing:              true,
}

// ShutdownBudget records every wall-clock term of a graceful shutdown.
// Its sum plus RequiredHeadroomSeconds must fit inside the chart's
// terminationGracePeriodSeconds; see ValidateRollout.
type ShutdownBudget struct {
	HelmValue                 string `yaml:"helm_value"`
	PreStopPropagationSeconds int    `yaml:"prestop_propagation_seconds"`
	TelemetryFlushSeconds     int    `yaml:"telemetry_flush_seconds"`
	ServerDrainSeconds        int    `yaml:"server_drain_seconds"`
	InboundLogDrainSeconds    int    `yaml:"inbound_log_drain_seconds"`
	DrainListenerSeconds      int    `yaml:"drain_listener_seconds"`
	RequiredHeadroomSeconds   int    `yaml:"required_headroom_seconds"`
}

// TotalSeconds is the worst-case wall clock of a graceful shutdown.
func (s ShutdownBudget) TotalSeconds() int {
	return s.PreStopPropagationSeconds +
		s.TelemetryFlushSeconds +
		s.ServerDrainSeconds +
		s.InboundLogDrainSeconds +
		s.DrainListenerSeconds
}

// RequiredGracePeriodSeconds is the minimum terminationGracePeriodSeconds
// that can hold the budget.
func (s ShutdownBudget) RequiredGracePeriodSeconds() int {
	return s.TotalSeconds() + s.RequiredHeadroomSeconds
}

// DrainPlane records the isolated preStop listener contract.
type DrainPlane struct {
	HelmValue                       string `yaml:"helm_value"`
	BindAddress                     string `yaml:"bind_address"`
	HookType                        string `yaml:"hook_type"`
	HookCommand                     string `yaml:"hook_command"`
	DrainPath                       string `yaml:"drain_path"`
	PublicStatusPath                string `yaml:"public_status_path"`
	ExposedByService                bool   `yaml:"exposed_by_service"`
	StuckDrainLivenessBudgetSeconds int    `yaml:"stuck_drain_liveness_budget_seconds"`
}

// RolloutPause maps the pause switch to its Helm value and k8s field.
type RolloutPause struct {
	HelmValue       string `yaml:"helm_value"`
	KubernetesField string `yaml:"kubernetes_field"`
}

// RolloutComponent is one deployable workload.
type RolloutComponent struct {
	ID              string          `yaml:"id"`
	Workload        string          `yaml:"workload"`
	HelmPath        string          `yaml:"helm_path"`
	CanarySupported bool            `yaml:"canary_supported"`
	TrafficSplit    string          `yaml:"traffic_split"`
	DefaultStrategy RolloutStrategy `yaml:"default_strategy"`
}

// RolloutStrategy mirrors the Kubernetes Deployment strategy.
//
// RenderedByDefault distinguishes "the chart writes this strategy into
// the manifest" from "the chart writes nothing, so the Kubernetes
// default applies". Conflating the two is how a rollout-controls change
// silently alters existing deployment behaviour.
type RolloutStrategy struct {
	Type              string `yaml:"type"`
	RenderedByDefault bool   `yaml:"rendered_by_default"`
	MaxSurge          *int   `yaml:"max_surge"`
	MaxUnavailable    *int   `yaml:"max_unavailable"`
	Note              string `yaml:"note"`
}

// StrategyKubernetesDefault marks a component whose strategy the chart
// deliberately does not render.
const StrategyKubernetesDefault = "kubernetes-default"

// HighRiskFlag is a behaviour change that ships dark.
type HighRiskFlag struct {
	ID            string `yaml:"id"`
	Description   string `yaml:"description"`
	EnableAtStage string `yaml:"enable_at_stage"`
	BlastRadius   string `yaml:"blast_radius"`
}

// RolloutStage is one promotion step.
type RolloutStage struct {
	ID             string   `yaml:"id"`
	Description    string   `yaml:"description"`
	Components     []string `yaml:"components"`
	CanaryReplicas int      `yaml:"canary_replicas"`
	CanaryPercent  int      `yaml:"canary_percent"`
	BakeTime       string   `yaml:"bake_time"`
	Gates          []string `yaml:"gates"`
	PromoteWhen    string   `yaml:"promote_when"`
	AbortWhen      string   `yaml:"abort_when"`
}

// LoadRolloutManifest reads the OPS-05 manifest.
func LoadRolloutManifest(fsys fs.FS, path string) (*RolloutManifest, error) {
	var m RolloutManifest
	if err := loadYAML(fsys, path, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// helmValueExists resolves a dotted path inside a parsed values tree.
func helmValueExists(values map[string]any, dotted string) bool {
	cur := any(values)
	for _, seg := range strings.Split(dotted, ".") {
		m, ok := cur.(map[string]any)
		if !ok {
			return false
		}
		cur, ok = m[seg]
		if !ok {
			return false
		}
	}
	return true
}

func lookupHelmValue(values map[string]any, dotted string) (any, bool) {
	cur := any(values)
	for _, seg := range strings.Split(dotted, ".") {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		cur, ok = m[seg]
		if !ok {
			return nil, false
		}
	}
	return cur, true
}

// validateShutdownBudget enforces the third leg of the shutdown lock:
// the recorded budget plus its headroom must fit inside the chart's
// terminationGracePeriodSeconds. Kubernetes' default is 30s, so a chart
// that simply omits the field cannot hold a 75s drain.
func validateShutdownBudget(check string, s ShutdownBudget, values map[string]any) []Finding {
	var out []Finding
	if s.HelmValue == "" {
		out = append(out, errf(check, "shutdown.helm_value", "the shutdown budget must name the Helm value that carries the grace period"))
		return out
	}
	for field, v := range map[string]int{
		"prestop_propagation_seconds": s.PreStopPropagationSeconds,
		"telemetry_flush_seconds":     s.TelemetryFlushSeconds,
		"server_drain_seconds":        s.ServerDrainSeconds,
		"inbound_log_drain_seconds":   s.InboundLogDrainSeconds,
		"drain_listener_seconds":      s.DrainListenerSeconds,
	} {
		if v <= 0 {
			out = append(out, errf(check, "shutdown."+field, "must be a positive number of seconds"))
		}
	}
	if s.RequiredHeadroomSeconds <= 0 {
		out = append(out, errf(check, "shutdown.required_headroom_seconds", "a budget with zero headroom is a budget that will be exceeded"))
	}
	if values == nil {
		return out
	}

	raw, ok := lookupHelmValue(values, s.HelmValue)
	if !ok {
		out = append(out, errf(check, "shutdown.helm_value",
			"%s is not defined in %s; Kubernetes would default to 30s, which cannot hold the %ds shutdown budget",
			s.HelmValue, HelmValuesPath, s.TotalSeconds()))
		return out
	}
	grace, ok := asInt(raw)
	if !ok {
		out = append(out, errf(check, "shutdown.helm_value", "%s = %v is not an integer number of seconds", s.HelmValue, raw))
		return out
	}
	if want := s.RequiredGracePeriodSeconds(); grace < want {
		out = append(out, errf(check, "shutdown.helm_value",
			"%s = %ds is below the required %ds (budget %ds + headroom %ds); the kubelet would SIGKILL the container mid-drain",
			s.HelmValue, grace, want, s.TotalSeconds(), s.RequiredHeadroomSeconds))
	}
	return out
}

// validateDrainPlane enforces that the pod-fatal preStop endpoint stays
// off the public listener.
func validateDrainPlane(check string, d DrainPlane, values map[string]any) []Finding {
	var out []Finding
	if d.HelmValue == "" {
		out = append(out, errf(check, "drain_plane", "the drain listener must declare its Helm value"))
		return out
	}
	// Loopback binding is the whole security property: a wildcard bind
	// makes a one-way, pod-fatal endpoint reachable by every pod on the
	// network.
	if d.BindAddress != "127.0.0.1" {
		out = append(out, errf(check, "drain_plane.bind_address",
			"must be 127.0.0.1 (got %q); a wildcard bind exposes the pod-fatal drain endpoint to the whole pod network", d.BindAddress))
	}
	// …and loopback binding forces an exec hook, because kubelet dials
	// httpGet probes from outside the container against the pod IP.
	if d.HookType != "exec" {
		out = append(out, errf(check, "drain_plane.hook_type",
			"must be `exec` (got %q); an httpGet preStop hook is dialled from outside the container and cannot reach a loopback listener", d.HookType))
	}
	if strings.TrimSpace(d.HookCommand) == "" {
		out = append(out, errf(check, "drain_plane.hook_command", "an exec hook must declare the command it runs"))
	}
	if d.DrainPath == "" || d.PublicStatusPath == "" {
		out = append(out, errf(check, "drain_plane", "both drain_path and public_status_path are required"))
	}
	if d.DrainPath == d.PublicStatusPath {
		out = append(out, errf(check, "drain_plane", "the mutating drain path and the public status path must differ"))
	}
	if d.ExposedByService {
		out = append(out, errf(check, "drain_plane.exposed_by_service",
			"must be false — the drain endpoint is one-way and pod-fatal, so publishing it through a Service lets any caller that reaches the ingress remove a healthy pod"))
	}
	// A one-way latch with no escape hatch turns an accidental drain
	// into permanent invisible dead capacity.
	if d.StuckDrainLivenessBudgetSeconds <= 0 {
		out = append(out, errf(check, "drain_plane.stuck_drain_liveness_budget_seconds",
			"must be positive; without a watchdog an accidentally drained pod stays unready-but-alive forever and nothing restarts it"))
	}
	if values == nil {
		return out
	}
	raw, ok := lookupHelmValue(values, d.HelmValue)
	if !ok {
		out = append(out, errf(check, "drain_plane.helm_value", "%s is not defined in %s", d.HelmValue, HelmValuesPath))
		return out
	}
	drainPort, ok := asInt(raw)
	if !ok {
		out = append(out, errf(check, "drain_plane.helm_value", "%s = %v is not a port number", d.HelmValue, raw))
		return out
	}
	if svcPort, ok := lookupHelmValue(values, "service.port"); ok {
		if p, ok := asInt(svcPort); ok && p == drainPort {
			out = append(out, errf(check, "drain_plane.helm_value",
				"the drain port (%d) equals service.port; the drain endpoint would be published by the Service", drainPort))
		}
	}
	return out
}

func asInt(v any) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	}
	return 0, false
}

// ValidateSelectorMigration enforces the ordering that makes the
// legacy → disjoint procedure converge.
//
// The defect this exists to reject: `kubectl delete deployment
// --cascade=orphan` orphans the pods AND the ReplicaSet. The ReplicaSet
// is still a live controller, so deleting the old pods afterwards makes
// it recreate every one of them. The documented procedure then never
// terminates, and the Service fronts both revisions forever.
func ValidateSelectorMigration(check string, m SelectorMigration, fsys fs.FS) []Finding {
	var out []Finding

	if len(m.Steps) == 0 {
		out = append(out, errf(check, "selector_migration",
			"switching selectorMode on an installed release needs a documented procedure — spec.selector is immutable, so `helm upgrade` alone fails"))
		return out
	}
	for _, field := range []struct{ name, value string }{
		{"downtime", m.Downtime},
		{"rollback", m.Rollback},
	} {
		if strings.TrimSpace(field.value) == "" {
			out = append(out, errf(check, "selector_migration."+field.name,
				"required — a procedure that does not state its %s implications is not reviewable", field.name))
		}
	}
	switch {
	case m.Runbook == "":
		out = append(out, errf(check, "selector_migration.runbook", "required"))
	case fsys != nil && !exists(fsys, m.Runbook):
		out = append(out, errf(check, "selector_migration.runbook", "%s does not exist", m.Runbook))
	}

	var (
		orphanedDeployment  bool
		replicaSetRemovedAt = -1
		seen                = map[string]bool{}
	)
	for i, s := range m.Steps {
		subject := "selector_migration.steps[" + s.ID + "]"
		if s.ID == "" || strings.TrimSpace(s.Command) == "" || strings.TrimSpace(s.Description) == "" {
			out = append(out, errf(check, "selector_migration.steps[]", "every step needs an id, a command, and a description"))
			continue
		}
		if seen[s.ID] {
			out = append(out, errf(check, subject, "duplicate step id"))
		}
		seen[s.ID] = true
		if !validRemoves[s.Removes] {
			out = append(out, errf(check, subject,
				"removes %q must be one of deployment-controller, replicaset-controller, pods, none", s.Removes))
			continue
		}

		if s.Removes == RemovesDeploymentController && strings.Contains(s.Command, "--cascade=orphan") {
			orphanedDeployment = true
		}
		if s.Removes == RemovesReplicaSetController {
			replicaSetRemovedAt = i
		}
		if s.Removes == RemovesPods {
			// THE ordering rule.
			if orphanedDeployment && replicaSetRemovedAt < 0 {
				out = append(out, errf(check, subject,
					"deletes pods while an orphaned ReplicaSet is still a live controller; it will recreate every pod deleted here and the migration will never converge. Remove the ReplicaSet first (removes: replicaset-controller) or use a foreground deletion with documented downtime"))
			}
			if replicaSetRemovedAt >= 0 && replicaSetRemovedAt > i {
				out = append(out, errf(check, subject,
					"pod deletion at step %d precedes the ReplicaSet removal at step %d", i+1, replicaSetRemovedAt+1))
			}
		}
	}

	if orphanedDeployment && replicaSetRemovedAt < 0 {
		out = append(out, errf(check, "selector_migration",
			"the procedure orphans a Deployment with --cascade=orphan but never removes the resulting ReplicaSet; it remains a live controller that keeps the old revision alive"))
	}
	return out
}

// ValidateRollout enforces the manifest invariants and cross-checks the
// Helm chart so the documented control surface and the implemented one
// cannot drift.
//
// fsys may be nil, in which case file-existence checks are skipped
// (used by unit tests that drive the validator from literals).
func ValidateRollout(m *RolloutManifest, values map[string]any, fsys fs.FS) []Finding {
	const check = "rollout"
	var out []Finding

	if m.Version != 1 {
		out = append(out, errf(check, RolloutManifestPath, "unsupported manifest version %d (want 1)", m.Version))
	}
	if m.PauseControl.HelmValue == "" || m.PauseControl.KubernetesField == "" {
		out = append(out, errf(check, "pause_control", "a rollout with no pause switch cannot be halted mid-flight"))
	} else if values != nil && !helmValueExists(values, m.PauseControl.HelmValue) {
		out = append(out, errf(check, "pause_control.helm_value", "%s is not defined in %s", m.PauseControl.HelmValue, HelmValuesPath))
	}
	out = append(out, validateShutdownBudget(check, m.Shutdown, values)...)
	out = append(out, validateDrainPlane(check, m.DrainPlane, values)...)
	out = append(out, ValidateSelectorMigration(check, m.SelectorMigration, fsys)...)

	componentIDs := map[string]bool{}
	canaryCapable := 0
	for _, c := range m.Components {
		subject := "components[" + c.ID + "]"
		if c.ID == "" {
			out = append(out, errf(check, "components[]", "component needs an id"))
			continue
		}
		if componentIDs[c.ID] {
			out = append(out, errf(check, subject, "duplicate component id"))
		}
		componentIDs[c.ID] = true
		if c.Workload == "" {
			out = append(out, errf(check, subject, "workload is required"))
		}
		if c.HelmPath == "" {
			out = append(out, errf(check, subject, "helm_path is required"))
		} else if values != nil && !helmValueExists(values, c.HelmPath) {
			out = append(out, errf(check, subject, "helm_path %s is not defined in %s", c.HelmPath, HelmValuesPath))
		}
		switch c.DefaultStrategy.Type {
		case "RollingUpdate":
			if !c.DefaultStrategy.RenderedByDefault {
				out = append(out, errf(check, subject, "an explicit RollingUpdate strategy must be rendered_by_default: true"))
			}
			if c.DefaultStrategy.MaxSurge == nil || c.DefaultStrategy.MaxUnavailable == nil {
				out = append(out, errf(check, subject, "RollingUpdate requires explicit max_surge and max_unavailable"))
			}
		case "Recreate":
			if c.DefaultStrategy.MaxSurge != nil || c.DefaultStrategy.MaxUnavailable != nil {
				out = append(out, errf(check, subject, "Recreate must not declare max_surge/max_unavailable"))
			}
		case StrategyKubernetesDefault:
			if c.DefaultStrategy.RenderedByDefault {
				out = append(out, errf(check, subject, "kubernetes-default means the chart renders nothing; rendered_by_default must be false"))
			}
			if c.DefaultStrategy.MaxSurge != nil || c.DefaultStrategy.MaxUnavailable != nil {
				out = append(out, errf(check, subject, "kubernetes-default must not declare max_surge/max_unavailable"))
			}
			if strings.TrimSpace(c.DefaultStrategy.Note) == "" {
				out = append(out, errf(check, subject, "kubernetes-default requires a note explaining why the chart leaves the strategy unset"))
			}
		default:
			out = append(out, errf(check, subject, "default_strategy.type %q must be RollingUpdate, Recreate, or kubernetes-default", c.DefaultStrategy.Type))
		}
		if c.CanarySupported {
			canaryCapable++
			if c.TrafficSplit == "none" || c.TrafficSplit == "" {
				out = append(out, errf(check, subject, "canary_supported requires a traffic_split mechanism"))
			}
			if values != nil && !helmValueExists(values, c.HelmPath+".canary.enabled") {
				out = append(out, errf(check, subject, "%s.canary.enabled is not defined in %s", c.HelmPath, HelmValuesPath))
			}
		} else if c.TrafficSplit != "none" {
			out = append(out, errf(check, subject, "traffic_split must be `none` when canary_supported is false (got %q)", c.TrafficSplit))
		}
	}
	if canaryCapable == 0 {
		out = append(out, errf(check, RolloutManifestPath, "no component supports canary — the manifest describes no staged rollout"))
	}

	stageIDs := map[string]bool{}
	for _, s := range m.Stages {
		subject := "stages[" + s.ID + "]"
		if s.ID == "" {
			out = append(out, errf(check, "stages[]", "stage needs an id"))
			continue
		}
		if stageIDs[s.ID] {
			out = append(out, errf(check, subject, "duplicate stage id"))
		}
		stageIDs[s.ID] = true
		if strings.TrimSpace(s.Description) == "" {
			out = append(out, errf(check, subject, "description is required"))
		}
		if s.BakeTime == "" {
			out = append(out, errf(check, subject, "bake_time is required — a stage with no soak proves nothing"))
		}
		if strings.TrimSpace(s.PromoteWhen) == "" || strings.TrimSpace(s.AbortWhen) == "" {
			out = append(out, errf(check, subject, "both promote_when and abort_when must be stated"))
		}
		if len(s.Components) == 0 {
			out = append(out, errf(check, subject, "stage targets no component"))
		}
		for _, c := range s.Components {
			if !componentIDs[c] {
				out = append(out, errf(check, subject, "references undeclared component %q", c))
			}
		}
		if len(s.Gates) == 0 {
			out = append(out, errf(check, subject, "a stage with no gate cannot fail"))
		}
		for _, g := range s.Gates {
			if _, ok := m.GateImplementations[g]; !ok {
				out = append(out, errf(check, subject, "gate %q has no entry in gate_implementations", g))
			}
		}
	}
	for _, must := range []string{"canary", "full"} {
		if !stageIDs[must] {
			out = append(out, errf(check, RolloutManifestPath, "missing mandatory stage %q", must))
		}
	}

	flagIDs := map[string]bool{}
	for _, f := range m.HighRiskFlags {
		subject := "high_risk_flags[" + f.ID + "]"
		if f.ID == "" {
			out = append(out, errf(check, "high_risk_flags[]", "flag needs an id"))
			continue
		}
		if flagIDs[f.ID] {
			out = append(out, errf(check, subject, "duplicate flag id"))
		}
		flagIDs[f.ID] = true
		if strings.TrimSpace(f.Description) == "" || strings.TrimSpace(f.BlastRadius) == "" {
			out = append(out, errf(check, subject, "description and blast_radius are both required"))
		}
		if !stageIDs[f.EnableAtStage] {
			out = append(out, errf(check, subject, "enable_at_stage %q is not a declared stage", f.EnableAtStage))
		}
	}
	if len(m.HighRiskFlags) == 0 {
		out = append(out, errf(check, RolloutManifestPath, "no high-risk flags registered — staged rollout must classify at least the destructive behaviours"))
	}
	return out
}

// CheckRollout loads the manifest plus the chart values and validates.
func CheckRollout(fsys fs.FS) []Finding {
	m, err := LoadRolloutManifest(fsys, RolloutManifestPath)
	if err != nil {
		return []Finding{errf("rollout", RolloutManifestPath, "%v", err)}
	}
	var values map[string]any
	raw, readErr := fs.ReadFile(fsys, HelmValuesPath)
	if readErr != nil {
		return []Finding{errf("rollout", HelmValuesPath, "%v", readErr)}
	}
	if err := yaml.Unmarshal(raw, &values); err != nil {
		return []Finding{errf("rollout", HelmValuesPath, "parse: %v", err)}
	}
	findings := ValidateRollout(m, values, fsys)
	for _, gate := range m.GateImplementations {
		if !exists(fsys, gate) {
			findings = append(findings, errf("rollout", "gate_implementations", "%s does not exist", gate))
		}
	}
	return findings
}

// String renders a component for log output.
func (c RolloutComponent) String() string {
	return fmt.Sprintf("%s (%s)", c.ID, c.Workload)
}
