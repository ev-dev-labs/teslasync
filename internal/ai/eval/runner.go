package eval

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider/mock"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
)

// Runner executes goldens against the dispatcher with a deterministic
// per-golden mock provider. Construct one Runner per top-level invocation
// (CLI run or test); the Runner is safe for serial use.
type Runner struct {
	// Mode controls fast/full/judged/record behaviour.
	Mode Mode

	// MaxIterations caps the dispatcher loop. Zero ⇒
	// dispatch.DefaultMaxIterations.
	MaxIterations int

	// JudgeProvider is the real provider used in ModeJudged. Required
	// when Mode is ModeJudged; ignored otherwise.
	JudgeProvider provider.Provider

	// JudgeModel pins the judge's model name (passed verbatim into
	// the ChatRequest). Defaults to "gpt-4o" if unset.
	JudgeModel string

	// JudgeSeed is the deterministic seed surfaced in the judge
	// prompt template to keep judged runs repeatable. Defaults
	// to 42.
	JudgeSeed int

	// Now is the wall-clock function used for Result.Duration.
	// Tests inject a fake; production leaves it nil and time.Now is
	// used.
	Now func() time.Time
}

// now is the internal clock helper.
func (r *Runner) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

// RunSet runs every golden in the set and returns the per-case
// results in the same order as set.Goldens.
//
// RunSet does NOT short-circuit on failure: it always evaluates the
// full set so the report shows the complete pass/fail matrix.
func (r *Runner) RunSet(ctx context.Context, set *GoldenSet) ([]Result, error) {
	if set == nil {
		return nil, errors.New("eval: nil GoldenSet")
	}
	out := make([]Result, 0, len(set.Goldens))
	for _, g := range set.Goldens {
		res := r.RunGolden(ctx, set, g)
		out = append(out, res)
	}
	return out, nil
}

// RunGolden runs a single golden end-to-end. Steps:
//
//  1. Resolve the Strategy (registered override or GenericStrategy).
//  2. Build a per-golden Mock with the canned reply sequence.
//  3. Build a stub tools.Registry from the FeatureSpec.
//  4. Build a CaptureWriter for the dispatcher's outbound stream.
//  5. Invoke Dispatcher.Run with auto-approve confirm + the user
//     message in StrategyInput.
//  6. Apply Expectations to captureWriter.
//  7. In ModeJudged, run the judge as a follow-up step.
func (r *Runner) RunGolden(ctx context.Context, set *GoldenSet, g Golden) Result {
	start := r.now()
	res := Result{
		FeatureID:  set.Feature.ID,
		GoldenName: g.Name,
	}

	if r.Mode == ModeRecord {
		res.Reasons = append(res.Reasons, "record mode is not implemented in F6 (canned files must be hand-authored)")
		res.Pass = false
		res.Duration = r.now().Sub(start)
		return res
	}

	cannedPath := set.CannedFilePath(g.Name)
	cannedFile, err := mock.LoadCannedFile(cannedPath)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			res.Reasons = append(res.Reasons, fmt.Sprintf("missing canned reply file: %s", cannedPath))
		} else {
			res.Reasons = append(res.Reasons, fmt.Sprintf("canned file load: %v", err))
		}
		res.Err = err
		res.Pass = false
		res.Duration = r.now().Sub(start)
		return res
	}

	strat := r.resolveStrategy(set.Feature)
	regStub := buildStubRegistry(set.Feature)

	mockProv := mock.NewSequencedMock(mock.New(provider.Capabilities{Tools: true, Streaming: false}))
	mockProv.SetSequence(cannedFile.ToReplies())

	capW := dispatch.NewCaptureWriter()

	disp := dispatch.New(regStub, mockProv, autoApproveConfirm, r.MaxIterations)

	in := strategy.StrategyInput{
		LastMessage: g.Input.UserMessage,
		History: []provider.Message{
			{Role: provider.RoleUser, Content: g.Input.UserMessage},
		},
	}
	runErr := disp.Run(ctx, strat, in, capW)

	res.ToolCallsCalled = collectToolNames(capW.ToolCalls())
	res.Answer = strings.Join(capW.Deltas(), "")

	// Tool errors recorded by the dispatcher (e.g. validation
	// rejections for stub tools) are included in Reasons so a golden
	// that unexpectedly produced a tool error fails loudly.
	for name, errs := range capW.ToolErrors() {
		for _, e := range errs {
			res.Reasons = append(res.Reasons, fmt.Sprintf("tool %s error: %v", name, e))
		}
	}

	if runErr != nil {
		// ErrConfirmationDenied is expected for goldens that
		// explicitly test the deny path. Surface dispatcher errors
		// verbatim so future goldens can assert on the message.
		res.Err = runErr
		res.Reasons = append(res.Reasons, fmt.Sprintf("dispatcher run error: %v", runErr))
	}

	// Apply expectations even on dispatcher error so the report
	// shows EVERY assertion outcome (helps triage).
	if violations := applyExpectations(g.Expect, res.ToolCallsCalled, res.Answer); len(violations) > 0 {
		res.Reasons = append(res.Reasons, violations...)
	}

	res.Pass = runErr == nil && len(res.Reasons) == 0

	if r.Mode == ModeJudged && res.Pass && g.Expect.JudgeRubric != "" {
		score, reason, jerr := runJudge(ctx, r.JudgeProvider, r.judgeModel(), r.judgeSeed(), g.Input.UserMessage, res.Answer, g.Expect.JudgeRubric)
		res.JudgeScore = score
		res.JudgeReason = reason
		threshold := g.Expect.JudgePassThreshold
		if threshold == 0 {
			threshold = 4
		}
		if jerr != nil {
			res.Reasons = append(res.Reasons, fmt.Sprintf("judge error: %v", jerr))
			res.Pass = false
		} else if score < threshold {
			res.Reasons = append(res.Reasons, fmt.Sprintf("judge score %d < threshold %d (reason: %s)", score, threshold, reason))
			res.Pass = false
		}
	}

	res.Duration = r.now().Sub(start)
	return res
}

// resolveStrategy returns the registered Strategy for the feature, or
// a GenericStrategy synthesized from the YAML header.
func (r *Runner) resolveStrategy(spec FeatureSpec) strategy.Strategy {
	if s, ok := LookupStrategy(spec.ID); ok {
		return s
	}
	return NewGenericStrategy(spec)
}

// judgeModel resolves the judge model name with default.
func (r *Runner) judgeModel() string {
	if r.JudgeModel == "" {
		return "gpt-4o"
	}
	return r.JudgeModel
}

// judgeSeed resolves the judge seed with default.
func (r *Runner) judgeSeed() int {
	if r.JudgeSeed == 0 {
		return 42
	}
	return r.JudgeSeed
}

// autoApproveConfirm approves every golden by default. Future
// deny-path goldens can override this through per-golden wiring.
func autoApproveConfirm(ctx context.Context, req dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmApproved, nil
}

// collectToolNames returns the (sorted) unique set of tool names from
// a slice of ToolCalls.
func collectToolNames(calls []provider.ToolCall) []string {
	seen := map[string]struct{}{}
	for _, c := range calls {
		seen[c.Name] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for n := range seen {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

// applyExpectations checks each Expect.* field and returns a list of
// human-readable violation strings. Empty list ⇒ all assertions held.
func applyExpectations(e Expectations, toolsCalled []string, answer string) []string {
	var out []string
	called := map[string]struct{}{}
	for _, t := range toolsCalled {
		called[t] = struct{}{}
	}
	for _, must := range e.MustCallTools {
		if _, ok := called[must]; !ok {
			out = append(out, fmt.Sprintf("must_call_tools: tool %q was not called (got: %v)", must, toolsCalled))
		}
	}
	for _, mustNot := range e.MustNotCallTools {
		if _, ok := called[mustNot]; ok {
			out = append(out, fmt.Sprintf("must_not_call_tools: tool %q WAS called", mustNot))
		}
	}
	for _, sub := range e.AnswerMustContain {
		if !strings.Contains(answer, sub) {
			out = append(out, fmt.Sprintf("answer_must_contain: %q not found in answer (answer=%q)", sub, truncate(answer, 200)))
		}
	}
	for _, sub := range e.AnswerMustNotContain {
		if strings.Contains(answer, sub) {
			out = append(out, fmt.Sprintf("answer_must_not_contain: %q found in answer", sub))
		}
	}
	return out
}

// truncate returns s capped at n runes, with an ellipsis if truncated.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
