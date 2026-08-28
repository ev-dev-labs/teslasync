package ops

import (
	"io/fs"
	"strings"
	"time"
)

// RunbookManifestPath is the canonical location of the OPS-11 register.
const RunbookManifestPath = "ops/runbooks/dependencies.yaml"

// RunbookManifest is the parsed ops/runbooks/dependencies.yaml.
type RunbookManifest struct {
	Version               int          `yaml:"version"`
	RequiredCriticalities []string     `yaml:"required_criticalities"`
	Dependencies          []Dependency `yaml:"dependencies"`
}

// Dependency is one external system the platform can lose.
type Dependency struct {
	ID                string             `yaml:"id"`
	Title             string             `yaml:"title"`
	Criticality       string             `yaml:"criticality"`
	UsedFor           string             `yaml:"used_for"`
	DegradedBehaviour string             `yaml:"degraded_behaviour"`
	Fallback          string             `yaml:"fallback"`
	Detection         []DependencySignal `yaml:"detection"`
	Runbook           string             `yaml:"runbook"`
}

// DependencySignal is one observable that reveals the degradation.
type DependencySignal struct {
	Signal string `yaml:"signal"`
	Note   string `yaml:"note"`
}

// requiredDependencies are the systems whose loss must have a runbook.
var requiredDependencies = []string{
	"database",
	"redis",
	"mqtt",
	"tesla-api",
	"ai-provider",
	"object-storage",
}

// runbookRequiredSections are the headings every degraded-mode runbook
// must contain so an on-call engineer can act without reading prose.
var runbookRequiredSections = []string{
	"## Symptoms",
	"## Confirm",
	"## Immediate mitigation",
	"## Recovery",
	"## Verify",
	"## Escalation",
}

// LoadRunbookManifest reads the OPS-11 register.
func LoadRunbookManifest(fsys fs.FS, path string) (*RunbookManifest, error) {
	var m RunbookManifest
	if err := loadYAML(fsys, path, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// ValidateRunbooks checks the register itself AND the referenced runbook
// files, so a dangling or skeleton runbook fails the gate.
func ValidateRunbooks(fsys fs.FS, m *RunbookManifest) []Finding {
	const check = "runbooks"
	var out []Finding

	if m.Version != 1 {
		out = append(out, errf(check, RunbookManifestPath, "unsupported manifest version %d (want 1)", m.Version))
	}
	allowed := setOf(m.RequiredCriticalities)
	if len(allowed) == 0 {
		out = append(out, errf(check, "required_criticalities", "must enumerate the allowed criticality values"))
	}

	seen := map[string]bool{}
	for _, d := range m.Dependencies {
		subject := "dependencies[" + d.ID + "]"
		if d.ID == "" {
			out = append(out, errf(check, "dependencies[]", "dependency needs an id"))
			continue
		}
		if seen[d.ID] {
			out = append(out, errf(check, subject, "duplicate dependency id"))
		}
		seen[d.ID] = true
		if d.Title == "" {
			out = append(out, errf(check, subject, "title is required"))
		}
		if len(allowed) > 0 && !allowed[d.Criticality] {
			out = append(out, errf(check, subject, "criticality %q is not one of %v", d.Criticality, m.RequiredCriticalities))
		}
		for field, value := range map[string]string{
			"used_for":           d.UsedFor,
			"degraded_behaviour": d.DegradedBehaviour,
			"fallback":           d.Fallback,
		} {
			if strings.TrimSpace(value) == "" {
				out = append(out, errf(check, subject, "%s is required", field))
			}
		}
		if len(d.Detection) == 0 {
			out = append(out, errf(check, subject, "at least one detection signal is required — an undetectable degradation has no runbook trigger"))
		}
		for _, s := range d.Detection {
			if strings.TrimSpace(s.Signal) == "" || strings.TrimSpace(s.Note) == "" {
				out = append(out, errf(check, subject, "every detection entry needs a signal and a note"))
			}
		}
		switch {
		case d.Runbook == "":
			out = append(out, errf(check, subject, "runbook path is required"))
		case !exists(fsys, d.Runbook):
			out = append(out, errf(check, subject, "runbook %s does not exist", d.Runbook))
		default:
			out = append(out, validateRunbookBody(fsys, check, subject, d.Runbook)...)
		}
	}

	for _, id := range requiredDependencies {
		if !seen[id] {
			out = append(out, errf(check, RunbookManifestPath, "missing mandatory dependency %q", id))
		}
	}
	return out
}

// validateRunbookBody rejects skeleton runbooks: every required section
// must be present and carry content, and no TODO markers may remain.
func validateRunbookBody(fsys fs.FS, check, subject, path string) []Finding {
	var out []Finding
	raw, err := fs.ReadFile(fsys, path)
	if err != nil {
		return []Finding{errf(check, subject, "read %s: %v", path, err)}
	}
	body := string(raw)
	for _, section := range runbookRequiredSections {
		idx := strings.Index(body, section+"\n")
		if idx < 0 {
			out = append(out, errf(check, subject, "%s is missing the %q section", path, section))
			continue
		}
		rest := body[idx+len(section):]
		if next := strings.Index(rest, "\n## "); next >= 0 {
			rest = rest[:next]
		}
		if len(strings.TrimSpace(rest)) < 40 {
			out = append(out, errf(check, subject, "%s section %q is a stub (fewer than 40 characters of content)", path, section))
		}
	}
	for _, marker := range []string{"TODO", "FIXME", "Coming soon"} {
		if strings.Contains(body, marker) {
			out = append(out, errf(check, subject, "%s contains a %q marker — an unfinished runbook is worse than none", path, marker))
		}
	}
	return out
}

// CheckRunbooks loads and validates the OPS-11 register.
func CheckRunbooks(fsys fs.FS) []Finding {
	m, err := LoadRunbookManifest(fsys, RunbookManifestPath)
	if err != nil {
		return []Finding{errf("runbooks", RunbookManifestPath, "%v", err)}
	}
	return ValidateRunbooks(fsys, m)
}

// ── OPS-03: restore drill ────────────────────────────────────────────

// RestoreDrillPath is the canonical location of the OPS-03 definition.
const RestoreDrillPath = "ops/restore/drill.yaml"

// RestoreDrill is the parsed ops/restore/drill.yaml.
type RestoreDrill struct {
	Version         int                `yaml:"version"`
	Schedule        RestoreSchedule    `yaml:"schedule"`
	Modes           []RestoreMode      `yaml:"modes"`
	CriticalTables  []string           `yaml:"critical_tables"`
	SuccessCriteria []RestoreCriterion `yaml:"success_criteria"`
	Fixture         string             `yaml:"fixture"`
	Objectives      RestoreObjectives  `yaml:"objectives"`
	Escalation      RestoreEscalation  `yaml:"escalation"`
	Workflow        string             `yaml:"workflow"`
}

// RestoreSchedule is the cron cadence and staleness budget.
type RestoreSchedule struct {
	Cron        string        `yaml:"cron"`
	Timezone    string        `yaml:"timezone"`
	MaxInterval time.Duration `yaml:"max_interval"`
}

// RestoreMode is one way of running the drill.
type RestoreMode struct {
	ID                  string   `yaml:"id"`
	Default             bool     `yaml:"default"`
	RequiresCredentials bool     `yaml:"requires_credentials"`
	CredentialEnv       []string `yaml:"credential_env"`
	Description         string   `yaml:"description"`
	Target              string   `yaml:"target"`
}

// RestoreCriterion is one pass condition plus what implements it.
type RestoreCriterion struct {
	ID            string `yaml:"id"`
	Statement     string `yaml:"statement"`
	ImplementedBy string `yaml:"implemented_by"`
}

// RestoreObjectives are the RTO/RPO targets.
type RestoreObjectives struct {
	RTOTarget         string `yaml:"rto_target"`
	RPOTarget         string `yaml:"rpo_target"`
	MeasurementStatus string `yaml:"measurement_status"`
}

// RestoreEscalation is what to do when a drill fails.
type RestoreEscalation struct {
	OnFailure string `yaml:"on_failure"`
	Runbook   string `yaml:"runbook"`
}

// LoadRestoreDrill reads the OPS-03 definition.
func LoadRestoreDrill(fsys fs.FS, path string) (*RestoreDrill, error) {
	var d RestoreDrill
	if err := loadYAML(fsys, path, &d); err != nil {
		return nil, err
	}
	return &d, nil
}

// ValidateRestore enforces that the drill is scheduled, self-contained by
// default, honest about what it has measured, and wired to real files.
func ValidateRestore(fsys fs.FS, d *RestoreDrill) []Finding {
	const check = "restore"
	var out []Finding

	if d.Version != 1 {
		out = append(out, errf(check, RestoreDrillPath, "unsupported version %d (want 1)", d.Version))
	}
	if strings.TrimSpace(d.Schedule.Cron) == "" {
		out = append(out, errf(check, "schedule.cron", "a drill that is not scheduled will not happen"))
	} else if fields := strings.Fields(d.Schedule.Cron); len(fields) != 5 {
		out = append(out, errf(check, "schedule.cron", "%q is not a 5-field cron expression", d.Schedule.Cron))
	}
	if d.Schedule.MaxInterval <= 0 {
		out = append(out, errf(check, "schedule.max_interval", "must be positive so a silently-disabled schedule is detectable"))
	}

	defaults := 0
	modeIDs := map[string]bool{}
	for _, m := range d.Modes {
		subject := "modes[" + m.ID + "]"
		if m.ID == "" {
			out = append(out, errf(check, "modes[]", "mode needs an id"))
			continue
		}
		if modeIDs[m.ID] {
			out = append(out, errf(check, subject, "duplicate mode id"))
		}
		modeIDs[m.ID] = true
		if strings.TrimSpace(m.Description) == "" || strings.TrimSpace(m.Target) == "" {
			out = append(out, errf(check, subject, "description and target are required"))
		}
		if m.Default {
			defaults++
			if m.RequiresCredentials {
				out = append(out, errf(check, subject, "the default mode must not require credentials, otherwise the schedule silently no-ops"))
			}
		}
		if m.RequiresCredentials && len(m.CredentialEnv) == 0 {
			out = append(out, errf(check, subject, "requires_credentials needs credential_env naming the variables (names only, never values)"))
		}
		for _, e := range m.CredentialEnv {
			if looksLikeSecret(e) {
				out = append(out, errf(check, subject, "credential_env must contain variable NAMES, not values"))
			}
		}
	}
	if defaults != 1 {
		out = append(out, errf(check, "modes", "exactly one mode must be marked default (found %d)", defaults))
	}
	for _, must := range []string{"roundtrip", "production-artifact"} {
		if !modeIDs[must] {
			out = append(out, errf(check, RestoreDrillPath, "missing mandatory mode %q", must))
		}
	}

	if len(d.CriticalTables) == 0 {
		out = append(out, errf(check, "critical_tables", "at least one table must be asserted non-empty after restore"))
	}
	// A drill whose critical tables are empty compares 0 against 0 and
	// reports success having proved nothing, so a fixture that populates
	// them is part of the contract rather than an implementation detail.
	switch {
	case strings.TrimSpace(d.Fixture) == "":
		out = append(out, errf(check, "fixture", "a fixture is required so critical_tables are non-empty; without it the roundtrip drill passes on 0-vs-0 parity"))
	case !exists(fsys, d.Fixture):
		out = append(out, errf(check, "fixture", "%s does not exist", d.Fixture))
	}
	if len(d.SuccessCriteria) == 0 {
		out = append(out, errf(check, "success_criteria", "a drill with no pass criteria cannot fail"))
	}
	for _, c := range d.SuccessCriteria {
		subject := "success_criteria[" + c.ID + "]"
		if c.ID == "" || strings.TrimSpace(c.Statement) == "" {
			out = append(out, errf(check, "success_criteria[]", "each criterion needs an id and a statement"))
			continue
		}
		if strings.TrimSpace(c.ImplementedBy) == "" {
			out = append(out, errf(check, subject, "implemented_by is required so the criterion is traceable to code"))
		}
	}

	if d.Objectives.RTOTarget == "" || d.Objectives.RPOTarget == "" {
		out = append(out, errf(check, "objectives", "both rto_target and rpo_target are required"))
	}
	switch d.Objectives.MeasurementStatus {
	case "pending-first-drill", "measured":
	default:
		out = append(out, errf(check, "objectives.measurement_status", "must be `pending-first-drill` or `measured` (got %q) — targets must never be presented as measurements", d.Objectives.MeasurementStatus))
	}

	if strings.TrimSpace(d.Escalation.OnFailure) == "" {
		out = append(out, errf(check, "escalation.on_failure", "required"))
	}
	for label, path := range map[string]string{
		"escalation.runbook": d.Escalation.Runbook,
		"workflow":           d.Workflow,
	} {
		if path == "" {
			out = append(out, errf(check, label, "required"))
			continue
		}
		if !exists(fsys, path) {
			out = append(out, errf(check, label, "%s does not exist", path))
		}
	}
	return out
}

// CheckRestore loads and validates the OPS-03 definition.
func CheckRestore(fsys fs.FS) []Finding {
	d, err := LoadRestoreDrill(fsys, RestoreDrillPath)
	if err != nil {
		return []Finding{errf("restore", RestoreDrillPath, "%v", err)}
	}
	return ValidateRestore(fsys, d)
}
