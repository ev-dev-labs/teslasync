package ops

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"regexp"
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
	// LifecycleProcedures are operator-controlled transitions that need an
	// explicit, tested sequence. They are registered here so critical recovery
	// steps and scope warnings cannot drift away from the deployed topology.
	LifecycleProcedures []LifecycleProcedure `yaml:"lifecycle_procedures"`
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
	out = append(out, validateLifecycleProcedures(fsys, m)...)
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
	Ownership       RestoreOwnership   `yaml:"ownership"`
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
	Scope               string `yaml:"scope"`
	RTOTarget           string `yaml:"rto_target"`
	RPOTarget           string `yaml:"rpo_target"`
	RecoveryPointSource string `yaml:"recovery_point_source"`
	MeasurementStatus   string `yaml:"measurement_status"`
	LastMeasuredAt      string `yaml:"last_measured_at"`
	LastMeasuredRTO     string `yaml:"last_measured_rto"`
	LastMeasuredRPO     string `yaml:"last_measured_rpo"`
	LastDrillReference  string `yaml:"last_drill_reference"`
}

// RestoreDrillEvidence is the immutable, non-sensitive result committed after
// a successful production-artifact workflow run.
type RestoreDrillEvidence struct {
	Version                 int              `json:"version"`
	Mode                    string           `json:"mode"`
	Outcome                 string           `json:"outcome"`
	Repository              string           `json:"repository"`
	WorkflowRunID           int64            `json:"workflow_run_id"`
	WorkflowRunAttempt      int              `json:"workflow_run_attempt"`
	WorkflowRunURL          string           `json:"workflow_run_url"`
	WorkflowArtifactName    string           `json:"workflow_artifact_name"`
	CommitSHA               string           `json:"commit_sha"`
	ArtifactRunID           int64            `json:"artifact_run_id"`
	ArtifactSHA256          string           `json:"artifact_sha256"`
	BackupCreatedAt         string           `json:"backup_created_at"`
	DrillStartedAt          string           `json:"drill_started_at"`
	DrillCompletedAt        string           `json:"drill_completed_at"`
	RestoreDurationSeconds  int64            `json:"restore_duration_seconds"`
	RecoveryPointAgeSeconds int64            `json:"recovery_point_age_seconds"`
	TargetDatabase          string           `json:"target_database"`
	DatabaseImported        bool             `json:"database_imported"`
	SchemaMigrated          bool             `json:"schema_migrated"`
	CriticalTableRows       map[string]int64 `json:"critical_table_rows"`
	APIHealthPath           string           `json:"api_health_path"`
	APIHealthStatus         int              `json:"api_health_status"`
}

// RestoreOwnership assigns every decision and execution responsibility.
type RestoreOwnership struct {
	AccountableRole       string        `yaml:"accountable_role"`
	IncidentCommanderRole string        `yaml:"incident_commander_role"`
	RecoveryLeadRole      string        `yaml:"recovery_lead_role"`
	CommunicationsRole    string        `yaml:"communications_role"`
	FallbackRole          string        `yaml:"fallback_role"`
	HandoffInterval       time.Duration `yaml:"handoff_interval"`
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

	if strings.TrimSpace(d.Objectives.Scope) == "" {
		out = append(out, errf(check, "objectives.scope", "required"))
	}
	if strings.TrimSpace(d.Objectives.RecoveryPointSource) == "" {
		out = append(out, errf(check, "objectives.recovery_point_source", "required so the RPO has an evidence source"))
	}
	rtoTarget, rtoErr := time.ParseDuration(d.Objectives.RTOTarget)
	if rtoErr != nil || rtoTarget <= 0 {
		out = append(out, errf(check, "objectives.rto_target", "%q must be a positive duration", d.Objectives.RTOTarget))
	}
	rpoTarget, rpoErr := time.ParseDuration(d.Objectives.RPOTarget)
	if rpoErr != nil || rpoTarget <= 0 {
		out = append(out, errf(check, "objectives.rpo_target", "%q must be a positive duration", d.Objectives.RPOTarget))
	}
	switch d.Objectives.MeasurementStatus {
	case "pending-first-drill":
		if d.Objectives.LastMeasuredAt != "" || d.Objectives.LastMeasuredRTO != "" ||
			d.Objectives.LastMeasuredRPO != "" || d.Objectives.LastDrillReference != "" {
			out = append(out, errf(check, "objectives", "pending-first-drill cannot carry measurement evidence"))
		}
	case "measured":
		if _, err := time.Parse("2006-01-02", d.Objectives.LastMeasuredAt); err != nil {
			out = append(out, errf(check, "objectives.last_measured_at", "last_measured_at %q must be an ISO date when measurement_status is measured", d.Objectives.LastMeasuredAt))
		}
		measuredRTO, err := time.ParseDuration(d.Objectives.LastMeasuredRTO)
		if err != nil || measuredRTO <= 0 {
			out = append(out, errf(check, "objectives.last_measured_rto", "last_measured_rto %q must be a positive duration when measurement_status is measured", d.Objectives.LastMeasuredRTO))
		} else if rtoErr == nil && rtoTarget > 0 && measuredRTO > rtoTarget {
			out = append(out, errf(check, "objectives.last_measured_rto", "last_measured_rto %s exceeds the RTO target %s", measuredRTO, rtoTarget))
		}
		measuredRPO, err := time.ParseDuration(d.Objectives.LastMeasuredRPO)
		if err != nil || measuredRPO < 0 {
			out = append(out, errf(check, "objectives.last_measured_rpo", "last_measured_rpo %q must be a non-negative duration when measurement_status is measured", d.Objectives.LastMeasuredRPO))
		} else if rpoErr == nil && rpoTarget > 0 && measuredRPO > rpoTarget {
			out = append(out, errf(check, "objectives.last_measured_rpo", "last_measured_rpo %s exceeds the RPO target %s", measuredRPO, rpoTarget))
		}
		out = append(out, validateRestoreEvidence(fsys, d, measuredRTO, measuredRPO)...)
	default:
		out = append(out, errf(check, "objectives.measurement_status", "must be `pending-first-drill` or `measured` (got %q) — targets must never be presented as measurements", d.Objectives.MeasurementStatus))
	}

	for field, value := range map[string]string{
		"accountable_role":        d.Ownership.AccountableRole,
		"incident_commander_role": d.Ownership.IncidentCommanderRole,
		"recovery_lead_role":      d.Ownership.RecoveryLeadRole,
		"communications_role":     d.Ownership.CommunicationsRole,
		"fallback_role":           d.Ownership.FallbackRole,
	} {
		if strings.TrimSpace(value) == "" {
			out = append(out, errf(check, "ownership."+field, "%s is required", field))
		}
	}
	if d.Ownership.HandoffInterval <= 0 || d.Ownership.HandoffInterval > 4*time.Hour {
		out = append(out, errf(check, "ownership.handoff_interval", "must be positive and no more than 4h"))
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

var (
	restoreCommitSHA = regexp.MustCompile(`^[0-9a-f]{40}$`)
	restoreChecksum  = regexp.MustCompile(`^[0-9a-f]{64}$`)
	restoreRepo      = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
)

func validateRestoreEvidence(fsys fs.FS, drill *RestoreDrill, measuredRTO, measuredRPO time.Duration) []Finding {
	const check = "restore"
	var out []Finding
	reference := drill.Objectives.LastDrillReference
	reference = strings.TrimSpace(reference)
	if !strings.HasPrefix(reference, "ops/restore/evidence/") || !strings.HasSuffix(reference, ".json") {
		return []Finding{errf(check, "objectives.last_drill_reference",
			"last_drill_reference must reference a committed JSON result under ops/restore/evidence")}
	}
	raw, err := fs.ReadFile(fsys, reference)
	if err != nil {
		return []Finding{errf(check, "objectives.last_drill_reference",
			"read immutable drill evidence %s: %v", reference, err)}
	}
	var evidence RestoreDrillEvidence
	if err := json.Unmarshal(raw, &evidence); err != nil {
		return []Finding{errf(check, "objectives.last_drill_reference",
			"parse immutable drill evidence %s: %v", reference, err)}
	}

	if evidence.Version != 1 {
		out = append(out, errf(check, reference, "evidence version is %d, want 1", evidence.Version))
	}
	if evidence.Mode != "production-artifact" || evidence.Outcome != "succeeded" {
		out = append(out, errf(check, reference,
			"evidence must record a succeeded production-artifact drill"))
	}
	if !restoreRepo.MatchString(evidence.Repository) {
		out = append(out, errf(check, reference, "repository %q is not owner/name", evidence.Repository))
	}
	if evidence.WorkflowRunID <= 0 || evidence.WorkflowRunAttempt <= 0 {
		out = append(out, errf(check, reference, "workflow run ID and attempt must be positive"))
	}
	expectedReference := fmt.Sprintf(
		"ops/restore/evidence/%d-%d.json",
		evidence.WorkflowRunID,
		evidence.WorkflowRunAttempt,
	)
	if reference != expectedReference {
		out = append(out, errf(check, reference,
			"evidence path must be %s for this workflow run", expectedReference))
	}
	expectedRunURL := fmt.Sprintf(
		"https://github.com/%s/actions/runs/%d",
		evidence.Repository,
		evidence.WorkflowRunID,
	)
	if evidence.WorkflowRunURL != expectedRunURL {
		out = append(out, errf(check, reference,
			"workflow_run_url must be the immutable run URL %s", expectedRunURL))
	}
	expectedArtifactName := fmt.Sprintf(
		"restore-drill-%d-%d",
		evidence.WorkflowRunID,
		evidence.WorkflowRunAttempt,
	)
	if evidence.WorkflowArtifactName != expectedArtifactName {
		out = append(out, errf(check, reference,
			"workflow_artifact_name must be %s", expectedArtifactName))
	}
	if !restoreCommitSHA.MatchString(evidence.CommitSHA) {
		out = append(out, errf(check, reference, "commit_sha must be a 40-character lowercase Git SHA"))
	}
	if evidence.ArtifactRunID <= 0 || !restoreChecksum.MatchString(evidence.ArtifactSHA256) {
		out = append(out, errf(check, reference,
			"artifact run ID and SHA-256 must identify the restored production backup"))
	}

	backupAt, backupErr := time.Parse(time.RFC3339, evidence.BackupCreatedAt)
	startedAt, startedErr := time.Parse(time.RFC3339, evidence.DrillStartedAt)
	completedAt, completedErr := time.Parse(time.RFC3339, evidence.DrillCompletedAt)
	if backupErr != nil || startedErr != nil || completedErr != nil {
		out = append(out, errf(check, reference,
			"backup_created_at, drill_started_at, and drill_completed_at must be RFC3339 timestamps"))
	} else {
		actualRTO := completedAt.Sub(startedAt)
		actualRPO := startedAt.Sub(backupAt)
		if actualRTO <= 0 || actualRPO < 0 {
			out = append(out, errf(check, reference, "measured recovery durations are not chronologically valid"))
		}
		if evidence.RestoreDurationSeconds != int64(actualRTO/time.Second) ||
			measuredRTO != time.Duration(evidence.RestoreDurationSeconds)*time.Second {
			out = append(out, errf(check, reference,
				"restore duration does not match timestamps and objectives.last_measured_rto"))
		}
		if evidence.RecoveryPointAgeSeconds != int64(actualRPO/time.Second) ||
			measuredRPO != time.Duration(evidence.RecoveryPointAgeSeconds)*time.Second {
			out = append(out, errf(check, reference,
				"recovery-point age does not match timestamps and objectives.last_measured_rpo"))
		}
		if drill.Objectives.LastMeasuredAt != completedAt.UTC().Format(time.DateOnly) {
			out = append(out, errf(check, reference,
				"objectives.last_measured_at must match the evidence completion date"))
		}
	}

	if !evidence.DatabaseImported || !evidence.SchemaMigrated {
		out = append(out, errf(check, reference,
			"evidence must prove scratch database import and schema migration"))
	}
	for _, table := range drill.CriticalTables {
		if evidence.CriticalTableRows[table] <= 0 {
			out = append(out, errf(check, reference,
				"critical table %s lacks a positive restored row count", table))
		}
	}
	if evidence.APIHealthPath != "/healthz" || evidence.APIHealthStatus != 200 {
		out = append(out, errf(check, reference,
			"evidence must prove the restored API returned HTTP 200 from /healthz"))
	}
	if !strings.HasPrefix(evidence.TargetDatabase, "teslasync_drill_") &&
		!strings.HasSuffix(evidence.TargetDatabase, "_restore_drill") {
		out = append(out, errf(check, reference,
			"target_database must identify an isolated restore-drill database"))
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
