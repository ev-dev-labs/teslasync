package ops

import (
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// Severity classifies a Finding. Only SeverityError fails a gate;
// SeverityAdvisory is reported so drift is visible without blocking a
// merge on pre-existing debt.
type Severity string

const (
	// SeverityError fails the gate (non-zero exit).
	SeverityError Severity = "error"
	// SeverityAdvisory is informational only.
	SeverityAdvisory Severity = "advisory"
)

// Finding is one gate result. Check is the gate name (e.g. "migrations"),
// Subject identifies what was inspected (a file, an epic ID, an env var).
type Finding struct {
	Check    string   `json:"check"`
	Severity Severity `json:"severity"`
	Subject  string   `json:"subject"`
	Message  string   `json:"message"`
}

func errf(check, subject, format string, a ...any) Finding {
	return Finding{Check: check, Severity: SeverityError, Subject: subject, Message: fmt.Sprintf(format, a...)}
}

func advisef(check, subject, format string, a ...any) Finding {
	return Finding{Check: check, Severity: SeverityAdvisory, Subject: subject, Message: fmt.Sprintf(format, a...)}
}

// Result aggregates the findings of one or more checks.
type Result struct {
	Findings []Finding `json:"findings"`
}

// Add appends findings, tolerating nil slices.
func (r *Result) Add(f ...Finding) { r.Findings = append(r.Findings, f...) }

// Errors returns only the blocking findings.
func (r *Result) Errors() []Finding {
	out := make([]Finding, 0, len(r.Findings))
	for _, f := range r.Findings {
		if f.Severity == SeverityError {
			out = append(out, f)
		}
	}
	return out
}

// Advisories returns only the non-blocking findings.
func (r *Result) Advisories() []Finding {
	out := make([]Finding, 0, len(r.Findings))
	for _, f := range r.Findings {
		if f.Severity == SeverityAdvisory {
			out = append(out, f)
		}
	}
	return out
}

// OK reports whether the result contains no blocking findings.
func (r *Result) OK() bool { return len(r.Errors()) == 0 }

// Sort orders findings deterministically so gate output is diffable.
func (r *Result) Sort() {
	sort.SliceStable(r.Findings, func(i, j int) bool {
		a, b := r.Findings[i], r.Findings[j]
		if a.Check != b.Check {
			return a.Check < b.Check
		}
		if a.Severity != b.Severity {
			return a.Severity < b.Severity
		}
		if a.Subject != b.Subject {
			return a.Subject < b.Subject
		}
		return a.Message < b.Message
	})
}

// loadYAML reads and strictly decodes a YAML manifest from fsys.
// KnownFields is enabled so a typo'd key is a hard error rather than a
// silently-ignored field that makes a gate pass for the wrong reason.
func loadYAML(fsys fs.FS, path string, into any) error {
	raw, err := fs.ReadFile(fsys, path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	dec := yaml.NewDecoder(strings.NewReader(string(raw)))
	dec.KnownFields(true)
	if err := dec.Decode(into); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	return nil
}

// exists reports whether path resolves inside fsys. Directories count.
func exists(fsys fs.FS, path string) bool {
	if path == "" {
		return false
	}
	if _, err := fs.Stat(fsys, path); err == nil {
		return true
	}
	// fstest.MapFS has no implicit directories for Stat in some Go
	// versions; fall back to a directory read.
	if entries, err := fs.ReadDir(fsys, path); err == nil && entries != nil {
		return true
	}
	return false
}
