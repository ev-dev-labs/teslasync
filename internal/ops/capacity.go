package ops

import (
	"io/fs"
	"strings"
	"time"
)

// CapacityManifestPath is the canonical location of the OPS-10 manifest.
const CapacityManifestPath = "ops/capacity/profiles.yaml"

// CapacityManifest is the parsed ops/capacity/profiles.yaml.
type CapacityManifest struct {
	Version  int               `yaml:"version"`
	Safety   CapacitySafety    `yaml:"safety"`
	Profiles []CapacityProfile `yaml:"profiles"`
}

// CapacitySafety are the guardrails every execution path must honour.
type CapacitySafety struct {
	AllowedEnvironments                      []string      `yaml:"allowed_environments"`
	RequireConfirmation                      bool          `yaml:"require_confirmation"`
	ConfirmationToken                        string        `yaml:"confirmation_token"`
	MaxDuration                              time.Duration `yaml:"max_duration"`
	DestructiveProfilesRequireEphemeralStack bool          `yaml:"destructive_profiles_require_ephemeral_stack"`
}

// CapacityProfile is one repeatable load shape.
type CapacityProfile struct {
	ID            string                `yaml:"id"`
	Title         string                `yaml:"title"`
	Description   string                `yaml:"description"`
	Subsystem     string                `yaml:"subsystem"`
	Driver        string                `yaml:"driver"`
	Entrypoint    string                `yaml:"entrypoint"`
	Destructive   bool                  `yaml:"destructive"`
	Workload      map[string]any        `yaml:"workload"`
	Thresholds    []CapacityThreshold   `yaml:"thresholds"`
	Observability CapacityObservability `yaml:"observability"`
	LastExecuted  string                `yaml:"last_executed"`
	RunReference  string                `yaml:"run_reference"`
}

// CapacityThreshold is a pass/fail criterion for a profile.
type CapacityThreshold struct {
	Metric     string  `yaml:"metric"`
	Comparison string  `yaml:"comparison"`
	Value      float64 `yaml:"value"`
	Rationale  string  `yaml:"rationale"`
}

// CapacityObservability lists the dashboards to watch during a run.
type CapacityObservability struct {
	Dashboards []string `yaml:"dashboards"`
}

var validCapacityDrivers = map[string]bool{"k6": true, "mqtt": true, "chaos": true}

// requiredCapacityProfiles are the load shapes this platform must be
// able to reproduce on demand.
var requiredCapacityProfiles = []string{
	"telemetry-burst",
	"sse-fanout",
	"analytics-query",
	"fleet-state-batch-100",
	"fleet-state-batch-500",
	"fleet-state-batch-5000",
	"fleet-state-mixed",
	"export-generation",
	"reconnect-storm",
}

// LoadCapacityManifest reads the OPS-10 manifest.
func LoadCapacityManifest(fsys fs.FS, path string) (*CapacityManifest, error) {
	var m CapacityManifest
	if err := loadYAML(fsys, path, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// ValidateCapacity enforces the safety guardrails and, critically, the
// honesty rule: a profile may only claim an execution if it also carries
// a verifiable run reference.
func ValidateCapacity(fsys fs.FS, m *CapacityManifest) []Finding {
	const check = "capacity"
	var out []Finding

	if m.Version != 1 {
		out = append(out, errf(check, CapacityManifestPath, "unsupported manifest version %d (want 1)", m.Version))
	}
	if len(m.Safety.AllowedEnvironments) == 0 {
		out = append(out, errf(check, "safety.allowed_environments", "must be a non-empty allow list"))
	}
	for _, env := range m.Safety.AllowedEnvironments {
		if strings.Contains(strings.ToLower(env), "prod") {
			out = append(out, errf(check, "safety.allowed_environments", "%q would permit generating load against production", env))
		}
	}
	if !m.Safety.RequireConfirmation {
		out = append(out, errf(check, "safety.require_confirmation", "capacity tests must require an explicit confirmation token"))
	}
	if m.Safety.ConfirmationToken == "" {
		out = append(out, errf(check, "safety.confirmation_token", "confirmation token must be set"))
	}
	if m.Safety.MaxDuration <= 0 {
		out = append(out, errf(check, "safety.max_duration", "an unbounded load test is a cost and availability hazard"))
	}

	seen := map[string]bool{}
	for _, p := range m.Profiles {
		subject := "profiles[" + p.ID + "]"
		if p.ID == "" {
			out = append(out, errf(check, "profiles[]", "profile needs an id"))
			continue
		}
		if seen[p.ID] {
			out = append(out, errf(check, subject, "duplicate profile id"))
		}
		seen[p.ID] = true
		if strings.TrimSpace(p.Description) == "" || p.Title == "" {
			out = append(out, errf(check, subject, "title and description are required"))
		}
		if !validCapacityDrivers[p.Driver] {
			out = append(out, errf(check, subject, "driver %q must be one of k6, mqtt, chaos", p.Driver))
		}
		if p.Entrypoint == "" {
			out = append(out, errf(check, subject, "entrypoint is required"))
		} else if !exists(fsys, p.Entrypoint) {
			out = append(out, errf(check, subject, "entrypoint %s does not exist — the profile is not repeatable", p.Entrypoint))
		}
		if len(p.Workload) == 0 {
			out = append(out, errf(check, subject, "workload parameters are required for the run to be reproducible"))
		}
		if dur, ok := p.Workload["duration"].(string); ok && m.Safety.MaxDuration > 0 {
			if parsed, err := time.ParseDuration(dur); err == nil && parsed > m.Safety.MaxDuration {
				out = append(out, errf(check, subject, "workload.duration %s exceeds safety.max_duration %s", dur, m.Safety.MaxDuration))
			}
		}
		if len(p.Thresholds) == 0 {
			out = append(out, errf(check, subject, "a profile with no thresholds cannot pass or fail"))
		}
		for _, t := range p.Thresholds {
			if t.Metric == "" || !validComparisons[t.Comparison] {
				out = append(out, errf(check, subject, "threshold needs a metric and a comparison of gt/gte/lt/lte (got %q/%q)", t.Metric, t.Comparison))
			}
			if strings.TrimSpace(t.Rationale) == "" {
				out = append(out, errf(check, subject, "threshold %q has no rationale", t.Metric))
			}
		}
		// Honesty rule: `last_executed` is either the literal `never`
		// or a date accompanied by a run reference someone can open.
		switch {
		case p.LastExecuted == "":
			out = append(out, errf(check, subject, "last_executed is required (use `never` until the profile has actually been run)"))
		case p.LastExecuted == "never":
			if p.RunReference != "" {
				out = append(out, errf(check, subject, "last_executed is `never` but a run_reference is set"))
			}
		default:
			if !reviewedOnRe.MatchString(p.LastExecuted) {
				out = append(out, errf(check, subject, "last_executed %q must be `never` or an ISO date", p.LastExecuted))
			}
			if strings.TrimSpace(p.RunReference) == "" {
				out = append(out, errf(check, subject, "claiming an execution requires a run_reference (workflow run URL or artifact path)"))
			}
		}
		if p.Destructive && m.Safety.DestructiveProfilesRequireEphemeralStack {
			out = append(out, advisef(check, subject, "destructive profile: the runner must point it at a disposable stack"))
		}
	}

	for _, id := range requiredCapacityProfiles {
		if !seen[id] {
			out = append(out, errf(check, CapacityManifestPath, "missing mandatory capacity profile %q", id))
		}
	}
	return out
}

// CheckCapacity loads and validates the OPS-10 manifest.
func CheckCapacity(fsys fs.FS) []Finding {
	m, err := LoadCapacityManifest(fsys, CapacityManifestPath)
	if err != nil {
		return []Finding{errf("capacity", CapacityManifestPath, "%v", err)}
	}
	return ValidateCapacity(fsys, m)
}
