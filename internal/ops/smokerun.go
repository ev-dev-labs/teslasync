package ops

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// SmokeTargets resolves the two base URLs a check can address.
// Web defaults to API when left empty (single-origin deployments where
// nginx fronts both).
type SmokeTargets struct {
	API string
	Web string
}

// SmokeOutcome is the result of executing one SmokeCheck.
type SmokeOutcome struct {
	ID       string        `json:"id"`
	Target   string        `json:"target"`
	Method   string        `json:"method"`
	URL      string        `json:"url"`
	Critical bool          `json:"critical"`
	Status   int           `json:"status"`
	Latency  time.Duration `json:"latency_ns"`
	Passed   bool          `json:"passed"`
	Failures []string      `json:"failures,omitempty"`
}

// SmokeReport is the machine-readable result of a whole run.
type SmokeReport struct {
	BaseURL   string         `json:"base_url"`
	WebURL    string         `json:"web_url"`
	StartedAt time.Time      `json:"started_at"`
	Duration  time.Duration  `json:"duration_ns"`
	Outcomes  []SmokeOutcome `json:"outcomes"`
	Passed    bool           `json:"passed"`
}

// ErrMissingSmokeCredential is returned when the manifest declares an
// authenticated check but the referenced environment variable is unset.
// The gate deliberately refuses to silently downgrade to an
// unauthenticated run — that would make a green gate meaningless.
var ErrMissingSmokeCredential = errors.New("smoke gate: authenticated checks are configured but the credential environment variable is empty")

// SmokeRunner executes a SmokeManifest against a deployment.
type SmokeRunner struct {
	Manifest *SmokeManifest
	Targets  SmokeTargets
	Client   *http.Client
	Getenv   func(string) string
	Now      func() time.Time
}

func (r *SmokeRunner) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

func (r *SmokeRunner) client() *http.Client {
	if r.Client != nil {
		return r.Client
	}
	return &http.Client{}
}

func (r *SmokeRunner) getenv(k string) string {
	if r.Getenv != nil {
		return r.Getenv(k)
	}
	return ""
}

// credentials resolves the header set applied to authenticated checks.
// A missing REQUIRED credential is a hard error; a missing OPTIONAL
// secondary credential is simply omitted.
func (r *SmokeRunner) credentials() (map[string]string, error) {
	headers := map[string]string{}
	add := func(a *SmokeAuth) error {
		if a == nil || a.Mode == "none" {
			return nil
		}
		v := strings.TrimSpace(r.getenv(a.ValueEnv))
		if v == "" {
			if a.Optional {
				return nil
			}
			return fmt.Errorf("%w: set %s", ErrMissingSmokeCredential, a.ValueEnv)
		}
		switch a.Mode {
		case "bearer":
			headers[a.Header] = "Bearer " + v
		default:
			headers[a.Header] = v
		}
		return nil
	}
	if err := add(&r.Manifest.Auth); err != nil {
		return nil, err
	}
	if err := add(r.Manifest.Auth.Secondary); err != nil {
		return nil, err
	}
	return headers, nil
}

func (r *SmokeRunner) baseFor(target string) string {
	if target == "web" && strings.TrimSpace(r.Targets.Web) != "" {
		return strings.TrimRight(r.Targets.Web, "/")
	}
	return strings.TrimRight(r.Targets.API, "/")
}

// Run executes every check sequentially and returns a report. It returns
// an error only for setup problems (missing credentials); check failures
// are carried in the report so callers can print all of them.
func (r *SmokeRunner) Run(ctx context.Context) (*SmokeReport, error) {
	if r.Manifest == nil {
		return nil, errors.New("smoke gate: nil manifest")
	}
	if strings.TrimSpace(r.Targets.API) == "" {
		return nil, errors.New("smoke gate: empty API base URL")
	}
	needsAuth := false
	for _, c := range r.Manifest.Checks {
		if c.Authenticated {
			needsAuth = true
			break
		}
	}
	headers := map[string]string{}
	if needsAuth {
		var err error
		if headers, err = r.credentials(); err != nil {
			return nil, err
		}
	}

	report := &SmokeReport{
		BaseURL:   r.baseFor("api"),
		WebURL:    r.baseFor("web"),
		StartedAt: r.now(),
		Passed:    true,
	}
	for _, c := range r.Manifest.Checks {
		outcome := r.runCheck(ctx, c, headers)
		if !outcome.Passed && c.Critical {
			report.Passed = false
		}
		report.Outcomes = append(report.Outcomes, outcome)
	}
	report.Duration = r.now().Sub(report.StartedAt)
	return report, nil
}

func (r *SmokeRunner) runCheck(ctx context.Context, c SmokeCheck, headers map[string]string) SmokeOutcome {
	url := r.baseFor(c.Target) + c.Path
	out := SmokeOutcome{ID: c.ID, Target: c.Target, Method: c.Method, URL: url, Critical: c.Critical}

	timeout := r.Manifest.Defaults.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, c.Method, url, nil)
	if err != nil {
		out.Failures = append(out.Failures, "build request: "+err.Error())
		return out
	}
	if c.Authenticated {
		for k, v := range headers {
			req.Header.Set(k, v)
		}
	}
	if c.Stream {
		req.Header.Set("Accept", "text/event-stream")
	}

	start := r.now()
	resp, err := r.client().Do(req)
	out.Latency = r.now().Sub(start)
	if err != nil {
		out.Failures = append(out.Failures, "request failed: "+err.Error())
		return out
	}
	defer resp.Body.Close()
	out.Status = resp.StatusCode

	out.Failures = append(out.Failures, evaluateStatus(c, resp.StatusCode)...)
	out.Failures = append(out.Failures, evaluateHeaders(c, resp.Header)...)
	if c.MaxLatency > 0 && out.Latency > c.MaxLatency {
		out.Failures = append(out.Failures, fmt.Sprintf("latency %s exceeds budget %s", out.Latency.Round(time.Millisecond), c.MaxLatency))
	}

	// A streaming endpoint never reaches EOF; we only validate the
	// negotiated headers and status, then drop the connection.
	if !c.Stream && (c.ExpectBodyContains != "" || c.ExpectJSONField != "") {
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if readErr != nil {
			out.Failures = append(out.Failures, "read body: "+readErr.Error())
		} else {
			out.Failures = append(out.Failures, evaluateBody(c, body)...)
		}
	}

	out.Passed = len(out.Failures) == 0
	return out
}

func evaluateStatus(c SmokeCheck, status int) []string {
	for _, want := range c.ExpectStatus {
		if status == want {
			return nil
		}
	}
	return []string{fmt.Sprintf("status %d not in %v", status, c.ExpectStatus)}
}

func evaluateHeaders(c SmokeCheck, h http.Header) []string {
	if c.ExpectHeader == "" {
		return nil
	}
	got := h.Get(c.ExpectHeader)
	if got == "" {
		return []string{fmt.Sprintf("missing header %s", c.ExpectHeader)}
	}
	if c.ExpectHeaderContain != "" && !strings.Contains(strings.ToLower(got), strings.ToLower(c.ExpectHeaderContain)) {
		return []string{fmt.Sprintf("header %s = %q, want it to contain %q", c.ExpectHeader, got, c.ExpectHeaderContain)}
	}
	return nil
}

func evaluateBody(c SmokeCheck, body []byte) []string {
	var failures []string
	if c.ExpectBodyContains != "" && !strings.Contains(string(body), c.ExpectBodyContains) {
		failures = append(failures, fmt.Sprintf("body does not contain %q", c.ExpectBodyContains))
	}
	if c.ExpectJSONField != "" {
		var doc map[string]any
		if err := json.Unmarshal(body, &doc); err != nil {
			failures = append(failures, "body is not a JSON object: "+err.Error())
			return failures
		}
		raw, ok := doc[c.ExpectJSONField]
		if !ok {
			failures = append(failures, fmt.Sprintf("JSON field %q absent", c.ExpectJSONField))
			return failures
		}
		if c.ExpectJSONEquals != "" && fmt.Sprint(raw) != c.ExpectJSONEquals {
			failures = append(failures, fmt.Sprintf("JSON field %q = %v, want %q", c.ExpectJSONField, raw, c.ExpectJSONEquals))
		}
	}
	return failures
}
