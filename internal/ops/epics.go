package ops

import (
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// EpicsManifestPath is the canonical location of the OPS-12 register.
const EpicsManifestPath = "ops/epics.yaml"

// EpicsManifest is the parsed ops/epics.yaml.
type EpicsManifest struct {
	Version int    `yaml:"version"`
	Program string `yaml:"program"`
	Epics   []Epic `yaml:"epics"`
}

// Epic is one accepted release/operations work item.
type Epic struct {
	ID         string       `yaml:"id"`
	Title      string       `yaml:"title"`
	Status     string       `yaml:"status"`
	Owner      EpicOwner    `yaml:"owner"`
	Summary    string       `yaml:"summary"`
	Acceptance []Acceptance `yaml:"acceptance"`
	Artifacts  []string     `yaml:"artifacts"`
	DependsOn  []string     `yaml:"depends_on"`
}

// EpicOwner names the accountable role and person.
type EpicOwner struct {
	Role   string `yaml:"role"`
	GitHub string `yaml:"github"`
}

// Acceptance is one verifiable acceptance criterion.
type Acceptance struct {
	ID                             string   `yaml:"id"`
	Statement                      string   `yaml:"statement"`
	Evidence                       []string `yaml:"evidence"`
	Verification                   string   `yaml:"verification"`
	RequiresDeployedInfrastructure bool     `yaml:"requires_deployed_infrastructure"`
}

// Epic statuses. `implemented-pending-infrastructure` is the honest
// status for work whose code and configuration are complete but whose
// final acceptance needs a deployed environment or real credentials.
const (
	EpicStatusAccepted     = "accepted"
	EpicStatusImplemented  = "implemented"
	EpicStatusPendingInfra = "implemented-pending-infrastructure"
)

var validEpicStatuses = map[string]bool{
	EpicStatusAccepted:     true,
	EpicStatusImplemented:  true,
	EpicStatusPendingInfra: true,
}

var (
	epicIDRe       = regexp.MustCompile(`^OPS-(\d{2})$`)
	acceptanceIDRe = regexp.MustCompile(`^OPS-\d{2}-A\d+$`)
	githubHandleRe = regexp.MustCompile(`^@[A-Za-z0-9][A-Za-z0-9-]{0,38}$`)
)

// RequiredEpicCount is the number of epics the OPS programme accepted:
// OPS-01 through OPS-13.
const RequiredEpicCount = 13

// LoadEpics reads the OPS-12 register.
func LoadEpics(fsys fs.FS, path string) (*EpicsManifest, error) {
	var m EpicsManifest
	if err := loadYAML(fsys, path, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// ValidateEpics enforces that every accepted epic has an owner and at
// least one acceptance criterion whose evidence actually exists in the
// tree, and that a status never overstates what has been verified.
func ValidateEpics(fsys fs.FS, m *EpicsManifest) []Finding {
	const check = "epics"
	var out []Finding

	if m.Version != 1 {
		out = append(out, errf(check, EpicsManifestPath, "unsupported manifest version %d (want 1)", m.Version))
	}
	if strings.TrimSpace(m.Program) == "" {
		out = append(out, errf(check, "program", "the register must name the programme it belongs to"))
	}

	seen := map[string]bool{}
	numbers := map[int]bool{}
	for _, e := range m.Epics {
		subject := e.ID
		match := epicIDRe.FindStringSubmatch(e.ID)
		if match == nil {
			out = append(out, errf(check, "epics[]", "epic id %q must look like OPS-01", e.ID))
			continue
		}
		if seen[e.ID] {
			out = append(out, errf(check, subject, "duplicate epic id"))
		}
		seen[e.ID] = true
		n, _ := strconv.Atoi(match[1])
		numbers[n] = true

		if strings.TrimSpace(e.Title) == "" {
			out = append(out, errf(check, subject, "title is required"))
		}
		if strings.TrimSpace(e.Summary) == "" {
			out = append(out, errf(check, subject, "summary is required"))
		}
		if !validEpicStatuses[e.Status] {
			out = append(out, errf(check, subject, "status %q must be one of accepted, implemented, implemented-pending-infrastructure", e.Status))
		}
		if strings.TrimSpace(e.Owner.Role) == "" {
			out = append(out, errf(check, subject, "owner.role is required — an unowned epic has no accountable party"))
		}
		if !githubHandleRe.MatchString(e.Owner.GitHub) {
			out = append(out, errf(check, subject, "owner.github %q must be a GitHub handle like @octocat", e.Owner.GitHub))
		}
		if len(e.Acceptance) == 0 {
			out = append(out, errf(check, subject, "at least one acceptance criterion is required"))
		}

		needsInfra := false
		accSeen := map[string]bool{}
		for _, a := range e.Acceptance {
			accSubject := subject + "/" + a.ID
			if !acceptanceIDRe.MatchString(a.ID) || !strings.HasPrefix(a.ID, e.ID+"-A") {
				out = append(out, errf(check, subject, "acceptance id %q must look like %s-A1", a.ID, e.ID))
				continue
			}
			if accSeen[a.ID] {
				out = append(out, errf(check, accSubject, "duplicate acceptance id"))
			}
			accSeen[a.ID] = true
			if strings.TrimSpace(a.Statement) == "" {
				out = append(out, errf(check, accSubject, "statement is required"))
			}
			if strings.TrimSpace(a.Verification) == "" {
				out = append(out, errf(check, accSubject, "verification is required — an unverifiable criterion cannot be accepted"))
			}
			if len(a.Evidence) == 0 {
				out = append(out, errf(check, accSubject, "at least one evidence path is required"))
			}
			for _, ev := range a.Evidence {
				if !exists(fsys, ev) {
					out = append(out, errf(check, accSubject, "evidence path %s does not exist", ev))
				}
			}
			if a.RequiresDeployedInfrastructure {
				needsInfra = true
			}
		}

		if needsInfra && e.Status == EpicStatusImplemented {
			out = append(out, errf(check, subject,
				"status is `implemented` but an acceptance criterion requires deployed infrastructure; use `implemented-pending-infrastructure` so the register never overstates what has been verified"))
		}
		if !needsInfra && e.Status == EpicStatusPendingInfra {
			out = append(out, errf(check, subject, "status is `implemented-pending-infrastructure` but no acceptance criterion requires deployed infrastructure"))
		}

		for _, art := range e.Artifacts {
			if !exists(fsys, art) {
				out = append(out, errf(check, subject, "artifact %s does not exist", art))
			}
		}
	}

	for _, dep := range collectDeps(m) {
		if !seen[dep.target] {
			out = append(out, errf(check, dep.source, "depends_on references unknown epic %q", dep.target))
		}
	}

	missing := make([]string, 0)
	for i := 1; i <= RequiredEpicCount; i++ {
		if !numbers[i] {
			missing = append(missing, fmt.Sprintf("OPS-%02d", i))
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		out = append(out, errf(check, EpicsManifestPath, "missing accepted epics: %s", strings.Join(missing, ", ")))
	}
	return out
}

type epicDep struct{ source, target string }

func collectDeps(m *EpicsManifest) []epicDep {
	var out []epicDep
	for _, e := range m.Epics {
		for _, d := range e.DependsOn {
			out = append(out, epicDep{source: e.ID, target: d})
		}
	}
	return out
}

// CheckEpics loads and validates the OPS-12 register.
func CheckEpics(fsys fs.FS) []Finding {
	m, err := LoadEpics(fsys, EpicsManifestPath)
	if err != nil {
		return []Finding{errf("epics", EpicsManifestPath, "%v", err)}
	}
	return ValidateEpics(fsys, m)
}
