package ops

import (
	"fmt"
	"io/fs"
	"net/http"
	"strings"
	"time"
)

// SmokeManifestPath is the canonical location of the OPS-01 manifest.
const SmokeManifestPath = "ops/smoke/checks.yaml"

// SmokeManifest is the parsed ops/smoke/checks.yaml.
type SmokeManifest struct {
	Version  int           `yaml:"version"`
	Defaults SmokeDefaults `yaml:"defaults"`
	Auth     SmokeAuth     `yaml:"auth"`
	Checks   []SmokeCheck  `yaml:"checks"`
}

// SmokeDefaults supplies per-check fallbacks.
type SmokeDefaults struct {
	Timeout      time.Duration `yaml:"timeout"`
	MaxLatency   time.Duration `yaml:"max_latency"`
	ExpectStatus []int         `yaml:"expect_status"`
}

// SmokeAuth describes how the gate authenticates. Credentials are always
// referenced by environment variable NAME — never by value.
type SmokeAuth struct {
	Mode      string     `yaml:"mode"`
	Header    string     `yaml:"header"`
	ValueEnv  string     `yaml:"value_env"`
	Secondary *SmokeAuth `yaml:"secondary"`
	Optional  bool       `yaml:"optional"`
}

// SmokeCheck is one probe.
type SmokeCheck struct {
	ID                  string        `yaml:"id"`
	Description         string        `yaml:"description"`
	Method              string        `yaml:"method"`
	Path                string        `yaml:"path"`
	Target              string        `yaml:"target"` // "api" (default) or "web"
	Authenticated       bool          `yaml:"authenticated"`
	Stream              bool          `yaml:"stream"`
	Critical            bool          `yaml:"critical"`
	Tags                []string      `yaml:"tags"`
	ExpectStatus        []int         `yaml:"expect_status"`
	MaxLatency          time.Duration `yaml:"max_latency"`
	ExpectJSONField     string        `yaml:"expect_json_field"`
	ExpectJSONEquals    string        `yaml:"expect_json_equals"`
	ExpectBodyContains  string        `yaml:"expect_body_contains"`
	ExpectHeader        string        `yaml:"expect_header"`
	ExpectHeaderContain string        `yaml:"expect_header_contains"`
}

// validSmokeAuthModes enumerates the credential shapes the runner knows.
var validSmokeAuthModes = map[string]bool{
	"forward_auth_header": true,
	"bearer":              true,
	"api_key":             true,
	"none":                true,
}

// validSmokeMethods restricts smoke probes to HTTP's safe methods.
//
// A post-deploy smoke gate runs against a LIVE deployment. Anything it
// sends must be side-effect free by construction, so POST/PUT/DELETE are
// rejected outright rather than reviewed case by case.
var validSmokeMethods = map[string]bool{
	http.MethodGet:  true,
	http.MethodHead: true,
}

// forbiddenSmokePaths are endpoints that a smoke gate must never touch,
// with the reason surfaced in the failure so the next person does not
// have to rediscover it.
var forbiddenSmokePaths = map[string]string{
	DrainPath: "the drain endpoint is one-way and pod-fatal (permanent readiness 503, all SSE streams released, response held open for the propagation delay); probe " + DrainStatusPath + " instead and cover drain execution in lifecycle tests",
}

// LoadSmokeManifest reads and validates the OPS-01 manifest.
func LoadSmokeManifest(fsys fs.FS, path string) (*SmokeManifest, error) {
	var m SmokeManifest
	if err := loadYAML(fsys, path, &m); err != nil {
		return nil, err
	}
	m.applyDefaults()
	return &m, nil
}

func (m *SmokeManifest) applyDefaults() {
	for i := range m.Checks {
		c := &m.Checks[i]
		if c.Method == "" {
			c.Method = http.MethodGet
		}
		c.Method = strings.ToUpper(c.Method)
		if c.Target == "" {
			c.Target = "api"
		}
		if len(c.ExpectStatus) == 0 {
			c.ExpectStatus = append([]int(nil), m.Defaults.ExpectStatus...)
		}
		if c.MaxLatency == 0 {
			c.MaxLatency = m.Defaults.MaxLatency
		}
	}
}

// ValidateSmoke enforces the manifest invariants that must hold without
// any deployment: unique IDs, known auth modes, rooted paths, sane
// budgets, no inline credentials, and coverage of the surfaces a
// post-deploy gate has to touch.
func ValidateSmoke(m *SmokeManifest) []Finding {
	const check = "smoke"
	var out []Finding

	if m.Version != 1 {
		out = append(out, errf(check, SmokeManifestPath, "unsupported manifest version %d (want 1)", m.Version))
	}
	if m.Defaults.Timeout <= 0 {
		out = append(out, errf(check, "defaults.timeout", "must be a positive duration"))
	}
	if m.Defaults.MaxLatency <= 0 {
		out = append(out, errf(check, "defaults.max_latency", "must be a positive duration"))
	}
	if len(m.Defaults.ExpectStatus) == 0 {
		out = append(out, errf(check, "defaults.expect_status", "must list at least one acceptable status"))
	}
	out = append(out, validateSmokeAuth(check, "auth", &m.Auth)...)

	seen := map[string]bool{}
	var authenticated, critical int
	tags := map[string]bool{}
	for _, c := range m.Checks {
		subject := "checks[" + c.ID + "]"
		switch {
		case c.ID == "":
			out = append(out, errf(check, "checks[]", "every check needs an id"))
			continue
		case seen[c.ID]:
			out = append(out, errf(check, subject, "duplicate check id"))
			continue
		}
		seen[c.ID] = true

		if strings.TrimSpace(c.Description) == "" {
			out = append(out, errf(check, subject, "description is required so a red gate is self-explaining"))
		}
		if !validSmokeMethods[c.Method] {
			out = append(out, errf(check, subject, "method %q is not a safe method; a post-deploy gate runs against a live deployment, so only GET and HEAD are permitted", c.Method))
		}
		if !strings.HasPrefix(c.Path, "/") {
			out = append(out, errf(check, subject, "path %q must be rooted at /", c.Path))
		}
		if reason, forbidden := forbiddenSmokePaths[c.Path]; forbidden {
			out = append(out, errf(check, subject, "path %q must never be probed by the smoke gate: %s", c.Path, reason))
		}
		if c.Target != "api" && c.Target != "web" {
			out = append(out, errf(check, subject, "target %q must be api or web", c.Target))
		}
		if len(c.ExpectStatus) == 0 {
			out = append(out, errf(check, subject, "no expected status (and defaults.expect_status is empty)"))
		}
		for _, s := range c.ExpectStatus {
			if s < 100 || s > 599 {
				out = append(out, errf(check, subject, "expect_status %d is not an HTTP status", s))
			}
		}
		if c.MaxLatency <= 0 {
			out = append(out, errf(check, subject, "max_latency must be positive"))
		}
		if c.MaxLatency > m.Defaults.Timeout && !c.Stream {
			out = append(out, errf(check, subject, "max_latency %s exceeds defaults.timeout %s — the request would be cancelled before the budget is hit", c.MaxLatency, m.Defaults.Timeout))
		}
		if c.ExpectJSONEquals != "" && c.ExpectJSONField == "" {
			out = append(out, errf(check, subject, "expect_json_equals needs expect_json_field"))
		}
		if c.ExpectHeaderContain != "" && c.ExpectHeader == "" {
			out = append(out, errf(check, subject, "expect_header_contains needs expect_header"))
		}
		if looksLikeSecret(c.ExpectBodyContains) {
			out = append(out, errf(check, subject, "expect_body_contains looks like an embedded credential; reference an env var instead"))
		}
		if c.Authenticated {
			authenticated++
		}
		if c.Critical {
			critical++
		}
		for _, t := range c.Tags {
			tags[t] = true
		}
	}

	if authenticated == 0 {
		out = append(out, errf(check, SmokeManifestPath, "no authenticated check — an unauthenticated-only gate cannot prove the deploy serves real users"))
	}
	if critical == 0 {
		out = append(out, errf(check, SmokeManifestPath, "no critical check — the gate could never fail a deploy"))
	}
	for _, required := range []string{"availability", "frontend", "observability", "recovery"} {
		if !tags[required] {
			out = append(out, errf(check, SmokeManifestPath, "no check tagged %q — the gate does not cover that surface", required))
		}
	}
	return out
}

func validateSmokeAuth(check, subject string, a *SmokeAuth) []Finding {
	var out []Finding
	if a == nil {
		return out
	}
	if !validSmokeAuthModes[a.Mode] {
		out = append(out, errf(check, subject+".mode", "unknown auth mode %q", a.Mode))
	}
	if a.Mode != "none" {
		if a.Header == "" {
			out = append(out, errf(check, subject+".header", "auth mode %q needs a header name", a.Mode))
		}
		if a.ValueEnv == "" {
			out = append(out, errf(check, subject+".value_env", "credentials must be referenced by env var name"))
		}
		if looksLikeSecret(a.ValueEnv) {
			out = append(out, errf(check, subject+".value_env", "value_env must be an env var NAME, not a credential"))
		}
	}
	if a.Secondary != nil {
		out = append(out, validateSmokeAuth(check, subject+".secondary", a.Secondary)...)
	}
	return out
}

// looksLikeSecret is a conservative heuristic for an inline credential:
// long, high-entropy-ish, and not a plain identifier.
func looksLikeSecret(s string) bool {
	if len(s) < 24 {
		return false
	}
	if strings.ContainsAny(s, " <>/") {
		return false
	}
	var digits, upper, lower int
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
			digits++
		case r >= 'A' && r <= 'Z':
			upper++
		case r >= 'a' && r <= 'z':
			lower++
		}
	}
	return digits > 0 && upper > 0 && lower > 0
}

// CheckSmoke loads and validates the manifest at the canonical path.
func CheckSmoke(fsys fs.FS) []Finding {
	m, err := LoadSmokeManifest(fsys, SmokeManifestPath)
	if err != nil {
		return []Finding{errf("smoke", SmokeManifestPath, "%v", err)}
	}
	return ValidateSmoke(m)
}

// String renders a check for log output.
func (c SmokeCheck) String() string {
	return fmt.Sprintf("%s %s (%s)", c.Method, c.Path, c.ID)
}
