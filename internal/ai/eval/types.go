package eval

import (
	"time"
)

// FeatureSpec is the YAML header at the top of a goldens file. It
// supplies enough metadata for the eval harness to construct a
// generic Strategy on the fly when no real Strategy implementation
// has been registered yet.
//
// Future features that ship a real Strategy MAY register it via
// [RegisterStrategy]; the runner prefers the registered Strategy over
// the GenericStrategy built from this spec.
type FeatureSpec struct {
	// ID is the feature registry key (matches features.Registry).
	// REQUIRED.
	ID string `yaml:"id"`

	// System is the system prompt the GenericStrategy returns. May be
	// empty if a registered Strategy supplies its own.
	System string `yaml:"system,omitempty"`

	// Tools is the whitelist of tool names the GenericStrategy
	// declares. The runner registers a stub tool for every name here
	// unless the name is already in the dispatcher's real registry.
	Tools []string `yaml:"tools,omitempty"`

	// MutatingTools is a subset of Tools whose stub implementations
	// should declare Mutates() = true so the dispatcher's confirm
	// gate is exercised. The runner auto-approves all confirms in
	// fast/full mode.
	MutatingTools []string `yaml:"mutating_tools,omitempty"`
}

// GoldenInput is the per-case payload fed to the dispatcher.
//
// ContextOverrides is a free-form map authors can use to attach
// metadata that a real Strategy.Context method would read.
type GoldenInput struct {
	UserMessage      string         `yaml:"user_message"`
	ContextOverrides map[string]any `yaml:"context_overrides,omitempty"`
}

// Expectations is the assertion bundle the runner applies after the
// dispatcher returns. Every field is optional — a golden with NO
// expectations is allowed (it asserts only that the run completes
// without error).
type Expectations struct {
	// MustCallTools lists tool names that MUST appear in the
	// dispatcher's WriteToolCall stream.
	MustCallTools []string `yaml:"must_call_tools,omitempty"`

	// MustNotCallTools lists tool names that MUST NOT appear in the
	// dispatcher's WriteToolCall stream.
	MustNotCallTools []string `yaml:"must_not_call_tools,omitempty"`

	// AnswerMustContain lists substrings that MUST appear in the
	// concatenated text deltas the dispatcher produced.
	AnswerMustContain []string `yaml:"answer_must_contain,omitempty"`

	// AnswerMustNotContain lists substrings the answer MUST NOT
	// contain.
	AnswerMustNotContain []string `yaml:"answer_must_not_contain,omitempty"`

	// JudgeRubric is the human-readable scoring rubric the judged
	// mode passes to the LLM-as-judge call. Empty ⇒ judge step
	// skipped for this golden.
	JudgeRubric string `yaml:"judge_rubric,omitempty"`

	// JudgePassThreshold is the minimum integer score the judge must
	// emit for the golden to PASS in judged mode. Defaults to 4 when
	// JudgeRubric is set and this is zero.
	JudgePassThreshold int `yaml:"judge_pass_threshold,omitempty"`
}

// Golden is one test case. The canned-reply file (under
// canned/<Name>.yaml) supplies the FIFO sequence of provider replies
// the runner installs on the per-golden Mock.
type Golden struct {
	Name   string       `yaml:"name"`
	Input  GoldenInput  `yaml:"input"`
	Expect Expectations `yaml:"expect"`
}

// GoldenSet is the full goldens YAML document for one feature.
type GoldenSet struct {
	Feature FeatureSpec `yaml:"feature"`
	Goldens []Golden    `yaml:"goldens"`

	// Path is the on-disk location the set was loaded from.
	Path string `yaml:"-"`
}

// CannedDir returns the directory where canned-reply YAML files live
// for this set. Convention: `canned/` sibling of the goldens.yaml.
func (s *GoldenSet) CannedDir() string {
	if s.Path == "" {
		return "canned"
	}
	return defaultCannedDir(s.Path)
}

// Result is the outcome of running one Golden.
type Result struct {
	FeatureID  string
	GoldenName string
	Pass       bool
	Reasons    []string

	// JudgeScore is the LLM judge's score (0 if not judged or judge
	// failed to parse).
	JudgeScore int

	// JudgeReason is the LLM judge's natural-language reason; empty
	// if not judged.
	JudgeReason string

	// ToolCallsCalled is the captureWriter's recorded list of names.
	ToolCallsCalled []string

	// Answer is the concatenated WriteDelta payloads.
	Answer string

	// Duration is wall-clock time the run took.
	Duration time.Duration

	// Err is set when the dispatcher itself returned an error
	// (vs an assertion failure).
	Err error
}

// Mode controls the runner's behaviour.
type Mode int

const (
	// ModeFast uses the canned mock only. Missing canned ⇒ failure.
	ModeFast Mode = iota

	// ModeFull is identical to ModeFast; reserved for the
	// "block on >5pt drop" semantics delegated to the workflow gate.
	ModeFull

	// ModeJudged invokes the LLM-as-judge after each canned-pass
	// golden whose Expectations.JudgeRubric is non-empty. Requires
	// JudgeProvider on the Runner.
	ModeJudged

	// ModeRecord is reserved for human-in-loop golden recording.
	ModeRecord
)

// String renders Mode for diagnostics.
func (m Mode) String() string {
	switch m {
	case ModeFast:
		return "fast"
	case ModeFull:
		return "full"
	case ModeJudged:
		return "judged"
	case ModeRecord:
		return "record"
	}
	return "unknown"
}
