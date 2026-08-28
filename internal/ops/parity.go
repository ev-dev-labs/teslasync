package ops

import (
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strings"
)

// ParityManifestPath is the canonical location of the OPS-06 manifest.
const ParityManifestPath = "ops/config/parity.yaml"

// ParityManifest is the parsed ops/config/parity.yaml.
type ParityManifest struct {
	Version            int            `yaml:"version"`
	Sources            ParitySources  `yaml:"sources"`
	ComposeServices    []string       `yaml:"compose_services"`
	SecretPatterns     []string       `yaml:"secret_patterns"`
	NonSecretOverrides []string       `yaml:"non_secret_overrides"`
	Exemptions         []ParityExempt `yaml:"exemptions"`
	Baseline           ParityBaseline `yaml:"baseline"`
}

// ParitySources names the files that must agree.
type ParitySources struct {
	GoConfig      string `yaml:"go_config"`
	Compose       string `yaml:"compose"`
	HelmConfigMap string `yaml:"helm_configmap"`
	HelmSecret    string `yaml:"helm_secret"`
	HelmValues    string `yaml:"helm_values"`
	// GoScanDirs are additionally scanned for direct os.Getenv("NAME")
	// reads. Not every variable is bound in config.go — ENCRYPTION_KEY,
	// API_ENDPOINT and HELM_CHART_VERSION are read at their point of
	// use — and without this scan the gate would report them as dead
	// Helm config.
	GoScanDirs []string `yaml:"go_scan_dirs"`
}

// ParityExempt records a deliberate, reviewed absence.
type ParityExempt struct {
	Name    string   `yaml:"name"`
	Targets []string `yaml:"targets"` // compose | helm
	Reason  string   `yaml:"reason"`
}

// ParityBaseline is the ratchet. It records the drift that existed when
// the gate was introduced. New drift is a hard failure; drift that has
// been fixed must be removed from the baseline (a stale entry also
// fails), so the list can only shrink.
type ParityBaseline struct {
	MissingInCompose []string `yaml:"missing_in_compose"`
	MissingInHelm    []string `yaml:"missing_in_helm"`
	UnknownInCompose []string `yaml:"unknown_in_compose"`
	UnknownInHelm    []string `yaml:"unknown_in_helm"`
}

// ParitySnapshot is the extracted state of the config surfaces.
type ParitySnapshot struct {
	GoVars        []string
	GoGetenvVars  []string
	ComposeVars   []string
	HelmConfigMap []string
	HelmSecret    []string
}

var (
	goEnvRe       = regexp.MustCompile(`env(?:Str|Bool|Int|Int64|Float|Duration|StringSlice|CSV)\(\s*"([A-Z][A-Z0-9_]*)"`)
	goGetenvRe    = regexp.MustCompile(`(?:os\.Getenv|getenv|LookupEnv)\(\s*"([A-Z][A-Z0-9_]*)"`)
	helmDataKeyRe = regexp.MustCompile(`(?m)^\s{2}([A-Z][A-Z0-9_]*):`)
	composeKVRe   = regexp.MustCompile(`^([A-Z][A-Z0-9_]*)\s*[:=]`)
)

// ExtractGoEnvVars returns every environment variable bound in the Go
// config loader, sorted and de-duplicated.
func ExtractGoEnvVars(src string) []string {
	return uniqueSorted(captureAll(goEnvRe, src, 1))
}

// ScanGetenvVars walks the given directories for non-test .go files and
// collects every literal os.Getenv / os.LookupEnv key. This captures the
// variables that are read at their point of use rather than bound in
// internal/config.
func ScanGetenvVars(fsys fs.FS, dirs []string) ([]string, error) {
	var found []string
	for _, dir := range dirs {
		err := fs.WalkDir(fsys, dir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			body, readErr := fs.ReadFile(fsys, path)
			if readErr != nil {
				return readErr
			}
			found = append(found, captureAll(goGetenvRe, string(body), 1)...)
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("scan %s for os.Getenv: %w", dir, err)
		}
	}
	return uniqueSorted(found), nil
}

// ExtractHelmEnvVars returns the data/stringData keys of a Helm template.
// It is deliberately regex-based: the file is a Go template, not valid
// YAML, so a YAML parser cannot read it.
func ExtractHelmEnvVars(src string) []string {
	return uniqueSorted(captureAll(helmDataKeyRe, src, 1))
}

// ExtractComposeEnvVars returns the environment keys declared by the
// named services in a docker-compose file. Scoping to our own services
// keeps third-party image configuration (POSTGRES_*, GF_*) out of the
// comparison.
//
// It handles both the mapping form (`KEY: value`) and the list form
// (`- KEY=value`), and it walks the file line-wise rather than through a
// YAML parser so `${VAR:-default}` interpolation cannot confuse it.
func ExtractComposeEnvVars(src string, services []string) []string {
	want := make(map[string]bool, len(services))
	for _, s := range services {
		want[s] = true
	}

	var out []string
	var currentService string
	inEnvironment := false
	envIndent := 0

	for _, raw := range strings.Split(src, "\n") {
		line := strings.TrimRight(raw, "\r")
		if strings.TrimSpace(line) == "" || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		indent := len(line) - len(strings.TrimLeft(line, " "))
		trimmed := strings.TrimSpace(line)

		// Service headers sit at exactly two spaces of indentation.
		if indent == 2 && strings.HasSuffix(trimmed, ":") {
			currentService = strings.TrimSuffix(trimmed, ":")
			inEnvironment = false
			continue
		}
		if indent == 0 {
			currentService = ""
			inEnvironment = false
			continue
		}
		if !want[currentService] {
			continue
		}
		if indent == 4 && strings.HasPrefix(trimmed, "environment:") {
			inEnvironment = true
			envIndent = indent
			continue
		}
		if indent <= envIndent && inEnvironment {
			inEnvironment = false
		}
		if !inEnvironment {
			continue
		}
		key := strings.TrimPrefix(trimmed, "- ")
		key = strings.TrimSpace(key)
		if m := composeKVRe.FindStringSubmatch(key); m != nil {
			out = append(out, m[1])
		}
	}
	return uniqueSorted(out)
}

func captureAll(re *regexp.Regexp, src string, group int) []string {
	matches := re.FindAllStringSubmatch(src, -1)
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		out = append(out, m[group])
	}
	return out
}

func uniqueSorted(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}

// LoadParityManifest reads the OPS-06 manifest.
func LoadParityManifest(fsys fs.FS, path string) (*ParityManifest, error) {
	var m ParityManifest
	if err := loadYAML(fsys, path, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// Snapshot extracts the three config surfaces named by the manifest.
func (m *ParityManifest) Snapshot(fsys fs.FS) (*ParitySnapshot, error) {
	read := func(p string) (string, error) {
		b, err := fs.ReadFile(fsys, p)
		if err != nil {
			return "", fmt.Errorf("read %s: %w", p, err)
		}
		return string(b), nil
	}
	goSrc, err := read(m.Sources.GoConfig)
	if err != nil {
		return nil, err
	}
	composeSrc, err := read(m.Sources.Compose)
	if err != nil {
		return nil, err
	}
	cmSrc, err := read(m.Sources.HelmConfigMap)
	if err != nil {
		return nil, err
	}
	secretSrc, err := read(m.Sources.HelmSecret)
	if err != nil {
		return nil, err
	}
	getenvVars, err := ScanGetenvVars(fsys, m.Sources.GoScanDirs)
	if err != nil {
		return nil, err
	}
	return &ParitySnapshot{
		GoVars:        ExtractGoEnvVars(goSrc),
		GoGetenvVars:  getenvVars,
		ComposeVars:   ExtractComposeEnvVars(composeSrc, m.ComposeServices),
		HelmConfigMap: ExtractHelmEnvVars(cmSrc),
		HelmSecret:    ExtractHelmEnvVars(secretSrc),
	}, nil
}

// IsSecret classifies a variable name using the manifest's patterns and
// explicit non-secret overrides.
func (m *ParityManifest) IsSecret(name string) bool {
	for _, o := range m.NonSecretOverrides {
		if o == name {
			return false
		}
	}
	for _, p := range m.SecretPatterns {
		if re, err := regexp.Compile(p); err == nil && re.MatchString(name) {
			return true
		}
	}
	return false
}

func (m *ParityManifest) exempt(name, target string) bool {
	for _, e := range m.Exemptions {
		if e.Name != name {
			continue
		}
		for _, t := range e.Targets {
			if t == target {
				return true
			}
		}
	}
	return false
}

// ComputeParityDrift returns the four drift sets for a snapshot.
//
// `missing_*` is computed from the config.go bindings alone: those are
// the variables a deployment target is expected to supply. `unknown_*`
// is computed against config.go bindings PLUS point-of-use os.Getenv
// reads, so a legitimately-consumed variable is never reported as dead.
func (m *ParityManifest) ComputeParityDrift(s *ParitySnapshot) ParityBaseline {
	knownSet := setOf(s.GoVars)
	for _, v := range s.GoGetenvVars {
		knownSet[v] = true
	}
	composeSet := setOf(s.ComposeVars)
	helmSet := setOf(s.HelmConfigMap)
	for _, k := range s.HelmSecret {
		helmSet[k] = true
	}

	var drift ParityBaseline
	for _, v := range s.GoVars {
		if !composeSet[v] && !m.exempt(v, "compose") {
			drift.MissingInCompose = append(drift.MissingInCompose, v)
		}
		if !helmSet[v] && !m.exempt(v, "helm") {
			drift.MissingInHelm = append(drift.MissingInHelm, v)
		}
	}
	for _, v := range s.ComposeVars {
		if !knownSet[v] {
			drift.UnknownInCompose = append(drift.UnknownInCompose, v)
		}
	}
	for _, v := range append(append([]string{}, s.HelmConfigMap...), s.HelmSecret...) {
		if !knownSet[v] {
			drift.UnknownInHelm = append(drift.UnknownInHelm, v)
		}
	}
	drift.MissingInCompose = uniqueSorted(drift.MissingInCompose)
	drift.MissingInHelm = uniqueSorted(drift.MissingInHelm)
	drift.UnknownInCompose = uniqueSorted(drift.UnknownInCompose)
	drift.UnknownInHelm = uniqueSorted(drift.UnknownInHelm)
	return drift
}

func setOf(in []string) map[string]bool {
	out := make(map[string]bool, len(in))
	for _, s := range in {
		out[s] = true
	}
	return out
}

// ValidateParity compares live drift against the recorded baseline.
//
//   - New drift (present now, absent from the baseline) is an error:
//     it means someone added a config variable to fewer than all three
//     deployment targets.
//   - Stale baseline entries (recorded but no longer drifting) are an
//     error too, so the ratchet can only tighten.
//   - A secret-classified variable rendered into the non-secret
//     ConfigMap is always an error, regardless of baseline.
func ValidateParity(m *ParityManifest, s *ParitySnapshot) []Finding {
	const check = "config-parity"
	var out []Finding

	if m.Version != 1 {
		out = append(out, errf(check, ParityManifestPath, "unsupported manifest version %d (want 1)", m.Version))
	}
	if len(m.ComposeServices) == 0 {
		out = append(out, errf(check, "compose_services", "at least one first-party compose service must be listed"))
	}
	if len(m.SecretPatterns) == 0 {
		out = append(out, errf(check, "secret_patterns", "no secret classification patterns configured"))
	}
	for _, p := range m.SecretPatterns {
		if _, err := regexp.Compile(p); err != nil {
			out = append(out, errf(check, "secret_patterns", "invalid regexp %q: %v", p, err))
		}
	}
	for _, e := range m.Exemptions {
		if strings.TrimSpace(e.Reason) == "" {
			out = append(out, errf(check, "exemptions["+e.Name+"]", "an exemption without a reason is not reviewable"))
		}
		for _, t := range e.Targets {
			if t != "compose" && t != "helm" {
				out = append(out, errf(check, "exemptions["+e.Name+"]", "unknown target %q (want compose or helm)", t))
			}
		}
	}
	if len(s.GoVars) == 0 {
		out = append(out, errf(check, m.Sources.GoConfig, "no environment variables extracted — the extractor is broken or the file moved"))
		return out
	}

	for _, v := range s.HelmConfigMap {
		if m.IsSecret(v) {
			out = append(out, errf(check, v, "secret-classified variable is rendered into the non-secret ConfigMap %s; move it to %s", m.Sources.HelmConfigMap, m.Sources.HelmSecret))
		}
	}

	drift := m.ComputeParityDrift(s)
	compare := func(label string, now, baseline []string, hint string) {
		baseSet := setOf(baseline)
		nowSet := setOf(now)
		for _, v := range now {
			if !baseSet[v] {
				out = append(out, errf(check, v, "%s — %s", label, hint))
				continue
			}
			// Grandfathered debt stays visible on every run so it is
			// never quietly forgotten.
			out = append(out, advisef(check, v, "known pre-existing drift: %s", label))
		}
		for _, v := range baseline {
			if !nowSet[v] {
				out = append(out, errf(check, v, "stale baseline entry under %s: the drift is gone, delete the entry so the ratchet stays tight", label))
			}
		}
	}
	compare("missing from docker-compose.yml", drift.MissingInCompose, m.Baseline.MissingInCompose,
		"add it to the first-party service environment blocks in docker-compose.yml, or record an exemption with a reason")
	compare("missing from the Helm chart", drift.MissingInHelm, m.Baseline.MissingInHelm,
		"add it to templates/configmap.yaml (non-secret) or templates/secret.yaml (credential) plus values.yaml")
	compare("declared in docker-compose.yml but unknown to internal/config", drift.UnknownInCompose, m.Baseline.UnknownInCompose,
		"the variable is dead config or a typo; remove it or bind it in config.go")
	compare("declared in the Helm chart but unknown to internal/config", drift.UnknownInHelm, m.Baseline.UnknownInHelm,
		"the variable is dead config or a typo; remove it or bind it in config.go")
	return out
}

// CheckParity loads the manifest, snapshots the sources, and validates.
func CheckParity(fsys fs.FS) []Finding {
	m, err := LoadParityManifest(fsys, ParityManifestPath)
	if err != nil {
		return []Finding{errf("config-parity", ParityManifestPath, "%v", err)}
	}
	snap, err := m.Snapshot(fsys)
	if err != nil {
		return []Finding{errf("config-parity", ParityManifestPath, "%v", err)}
	}
	return ValidateParity(m, snap)
}
