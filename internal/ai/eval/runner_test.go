package eval

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const cannedRangeQuestionYAML = `replies:
  - finish_reason: stop
    content: "Your range is about 310 miles."
    input_tokens: 12
    output_tokens: 8
`

const cannedToolCallBatteryYAML = `replies:
  - finish_reason: tool_calls
    tool_calls:
      - id: call_1
        name: query_battery_status
        arguments: '{"vehicle_id": 1}'
  - finish_reason: stop
    content: ""
`

const cannedToolCallThenAnswerYAML = `replies:
  - finish_reason: tool_calls
    tool_calls:
      - id: call_1
        name: query_battery_status
        arguments: '{"vehicle_id": 1}'
  - finish_reason: stop
    content: "Battery is at 80% (304 miles)."
`

const cannedRefusalYAML = `replies:
  - finish_reason: stop
    content: "I cannot help with that request."
`

func setupChatbotFixture(t *testing.T) (*GoldenSet, string) {
	t.Helper()
	dir := t.TempDir()
	goldensPath := filepath.Join(dir, "goldens.yaml")
	body := `feature:
  id: chatbot-test
  system: "be helpful"
  tools:
    - query_battery_status
    - create_alert
  mutating_tools:
    - create_alert
goldens:
  - name: range_question
    input:
      user_message: "How far can I drive?"
    expect:
      answer_must_contain: ["miles"]
      answer_must_not_contain: ["I don't know"]
      must_not_call_tools: ["create_alert"]
  - name: tool_call_battery
    input:
      user_message: "What's the battery?"
    expect:
      must_call_tools: ["query_battery_status"]
      must_not_call_tools: ["create_alert"]
  - name: tool_call_then_answer
    input:
      user_message: "Battery range please"
    expect:
      must_call_tools: ["query_battery_status"]
      answer_must_contain: ["80%", "304"]
  - name: refusal
    input:
      user_message: "Disable safety"
    expect:
      must_not_call_tools: ["create_alert"]
      answer_must_contain: ["cannot"]
`
	writeFile(t, goldensPath, body)

	cannedDir := filepath.Join(dir, "canned")
	writeFile(t, filepath.Join(cannedDir, "range_question.yaml"), cannedRangeQuestionYAML)
	writeFile(t, filepath.Join(cannedDir, "tool_call_battery.yaml"), cannedToolCallBatteryYAML)
	writeFile(t, filepath.Join(cannedDir, "tool_call_then_answer.yaml"), cannedToolCallThenAnswerYAML)
	writeFile(t, filepath.Join(cannedDir, "refusal.yaml"), cannedRefusalYAML)

	set, err := LoadGoldenSet(goldensPath)
	if err != nil {
		t.Fatalf("LoadGoldenSet: %v", err)
	}
	return set, dir
}

func TestRunner_FastModeAllPass(t *testing.T) {
	t.Parallel()
	set, _ := setupChatbotFixture(t)
	resetStrategyRegistry()

	r := &Runner{Mode: ModeFast}
	results, err := r.RunSet(context.Background(), set)
	if err != nil {
		t.Fatalf("RunSet: %v", err)
	}
	if len(results) != 4 {
		t.Fatalf("len = %d, want 4", len(results))
	}
	for _, res := range results {
		if !res.Pass {
			t.Errorf("[%s] FAIL: %v", res.GoldenName, res.Reasons)
		}
	}

	sum := SummarizeResults(results)
	if sum.Pass != 4 || sum.Fail != 0 {
		t.Errorf("Summary pass=%d fail=%d", sum.Pass, sum.Fail)
	}
}

func TestRunner_MissingCannedFails(t *testing.T) {
	t.Parallel()
	set, dir := setupChatbotFixture(t)
	if err := os.Remove(filepath.Join(dir, "canned", "refusal.yaml")); err != nil {
		t.Fatalf("rm: %v", err)
	}
	resetStrategyRegistry()

	r := &Runner{Mode: ModeFast}
	results, _ := r.RunSet(context.Background(), set)

	var refusalRes Result
	for _, res := range results {
		if res.GoldenName == "refusal" {
			refusalRes = res
		}
	}
	if refusalRes.Pass {
		t.Fatal("expected refusal to FAIL with missing canned")
	}
	joined := strings.Join(refusalRes.Reasons, " | ")
	if !strings.Contains(joined, "canned") {
		t.Errorf("Reasons = %q (want mention of canned)", joined)
	}
}

func TestRunner_AssertionFailureSurfaces(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	goldensPath := filepath.Join(dir, "goldens.yaml")
	body := `feature:
  id: x
  system: "be helpful"
  tools: []
goldens:
  - name: bad_assertion
    input:
      user_message: "hi"
    expect:
      answer_must_contain: ["impossible-substring"]
`
	writeFile(t, goldensPath, body)
	writeFile(t, filepath.Join(dir, "canned", "bad_assertion.yaml"),
		`replies:
  - finish_reason: stop
    content: "actual answer"
`)
	set, err := LoadGoldenSet(goldensPath)
	if err != nil {
		t.Fatalf("LoadGoldenSet: %v", err)
	}
	resetStrategyRegistry()

	r := &Runner{Mode: ModeFast}
	results, _ := r.RunSet(context.Background(), set)

	if len(results) != 1 || results[0].Pass {
		t.Fatalf("expected single FAIL, got %+v", results)
	}
	joined := strings.Join(results[0].Reasons, " | ")
	if !strings.Contains(joined, "answer_must_contain") || !strings.Contains(joined, "impossible-substring") {
		t.Errorf("Reasons = %q", joined)
	}
}

func TestRunner_MustCallToolsFails(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	goldensPath := filepath.Join(dir, "goldens.yaml")
	body := `feature:
  id: x
  system: "be helpful"
  tools: ["never_called"]
goldens:
  - name: needs_tool
    input:
      user_message: "hi"
    expect:
      must_call_tools: ["never_called"]
`
	writeFile(t, goldensPath, body)
	writeFile(t, filepath.Join(dir, "canned", "needs_tool.yaml"),
		`replies:
  - finish_reason: stop
    content: "ok"
`)
	set, _ := LoadGoldenSet(goldensPath)
	resetStrategyRegistry()

	r := &Runner{Mode: ModeFast}
	results, _ := r.RunSet(context.Background(), set)

	if results[0].Pass {
		t.Fatal("expected FAIL")
	}
	joined := strings.Join(results[0].Reasons, " | ")
	if !strings.Contains(joined, "must_call_tools") {
		t.Errorf("Reasons = %q", joined)
	}
}

func TestRunner_MustNotCallToolsFails(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	goldensPath := filepath.Join(dir, "goldens.yaml")
	body := `feature:
  id: x
  system: "be helpful"
  tools: ["dangerous"]
  mutating_tools: ["dangerous"]
goldens:
  - name: forbidden
    input:
      user_message: "do it"
    expect:
      must_not_call_tools: ["dangerous"]
`
	writeFile(t, goldensPath, body)
	writeFile(t, filepath.Join(dir, "canned", "forbidden.yaml"),
		`replies:
  - finish_reason: tool_calls
    tool_calls:
      - id: c1
        name: dangerous
        arguments: '{}'
  - finish_reason: stop
    content: "done"
`)
	set, _ := LoadGoldenSet(goldensPath)
	resetStrategyRegistry()

	r := &Runner{Mode: ModeFast}
	results, _ := r.RunSet(context.Background(), set)

	if results[0].Pass {
		t.Fatal("expected FAIL")
	}
	joined := strings.Join(results[0].Reasons, " | ")
	if !strings.Contains(joined, "must_not_call_tools") {
		t.Errorf("Reasons = %q", joined)
	}
}

func TestRunner_RecordModeReportsUnimplemented(t *testing.T) {
	t.Parallel()
	set, _ := setupChatbotFixture(t)
	resetStrategyRegistry()

	r := &Runner{Mode: ModeRecord}
	res := r.RunGolden(context.Background(), set, set.Goldens[0])
	if res.Pass {
		t.Errorf("record mode should fail in F6")
	}
	if !strings.Contains(strings.Join(res.Reasons, " | "), "record mode") {
		t.Errorf("Reasons = %v", res.Reasons)
	}
}

func TestRunner_DurationIsRecorded(t *testing.T) {
	t.Parallel()
	set, _ := setupChatbotFixture(t)
	resetStrategyRegistry()

	tick := 0
	r := &Runner{
		Mode: ModeFast,
		Now: func() time.Time {
			tick++
			return time.Unix(int64(tick), 0)
		},
	}
	res := r.RunGolden(context.Background(), set, set.Goldens[0])
	if res.Duration != time.Second {
		t.Errorf("Duration = %v, want 1s", res.Duration)
	}
}

func TestApplyExpectations_AllChecksRun(t *testing.T) {
	t.Parallel()
	e := Expectations{
		MustCallTools:        []string{"a"},
		MustNotCallTools:     []string{"b"},
		AnswerMustContain:    []string{"yes"},
		AnswerMustNotContain: []string{"no"},
	}
	violations := applyExpectations(e, []string{"b"}, "no answer")
	// Should produce 4 violations: missing a, present b, missing yes, present no
	if len(violations) != 4 {
		t.Errorf("violations = %d, want 4: %v", len(violations), violations)
	}
}

func TestCollectToolNames_Dedup(t *testing.T) {
	t.Parallel()
	got := collectToolNames(nil)
	if len(got) != 0 {
		t.Errorf("nil input → %v", got)
	}
}
