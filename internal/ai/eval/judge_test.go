package eval

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

// fakeJudgeProvider returns a canned chat response. Used to exercise
// the judge code without spinning a real LLM.
type fakeJudgeProvider struct {
	mu        sync.Mutex
	resp      string
	calls     int
	lastModel string
	lastTemp  float32
	lastMsg   string
	err       error
}

func (f *fakeJudgeProvider) Name() string                          { return "fake-judge" }
func (f *fakeJudgeProvider) Capabilities() provider.Capabilities   { return provider.Capabilities{} }
func (f *fakeJudgeProvider) Stream(context.Context, provider.ChatRequest) (<-chan provider.Chunk, error) {
	return nil, provider.ErrCapabilityNotSupported
}
func (f *fakeJudgeProvider) Embed(context.Context, provider.EmbedRequest) (*provider.EmbedResponse, error) {
	return nil, provider.ErrCapabilityNotSupported
}
func (f *fakeJudgeProvider) Chat(ctx context.Context, req provider.ChatRequest) (*provider.ChatResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.lastModel = req.Model
	f.lastTemp = req.Temperature
	if len(req.Messages) > 0 {
		f.lastMsg = req.Messages[len(req.Messages)-1].Content
	}
	if f.err != nil {
		return nil, f.err
	}
	return &provider.ChatResponse{
		Message:      provider.Message{Role: provider.RoleAssistant, Content: f.resp},
		FinishReason: provider.FinishStop,
	}, nil
}

func TestRenderJudgePrompt_IncludesAllFields(t *testing.T) {
	t.Parallel()
	got, err := renderJudgePrompt("Q?", "A.", "rubric", 42)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	for _, want := range []string{"Q?", "A.", "rubric", "seed=42"} {
		if !strings.Contains(got, want) {
			t.Errorf("rendered prompt missing %q. Got:\n%s", want, got)
		}
	}
}

func TestRunJudge_HappyPath(t *testing.T) {
	t.Parallel()
	jp := &fakeJudgeProvider{resp: `{"score": 5, "reason": "perfect"}`}
	score, reason, err := runJudge(context.Background(), jp, "judge-model", 7, "q", "a", "r")
	if err != nil {
		t.Fatalf("runJudge: %v", err)
	}
	if score != 5 {
		t.Errorf("score = %d", score)
	}
	if reason != "perfect" {
		t.Errorf("reason = %q", reason)
	}
	if jp.lastModel != "judge-model" {
		t.Errorf("model passthrough = %q", jp.lastModel)
	}
	if jp.lastTemp != 0 {
		t.Errorf("temperature should be 0, got %v", jp.lastTemp)
	}
	if !strings.Contains(jp.lastMsg, "seed=7") {
		t.Errorf("seed not in prompt: %q", jp.lastMsg)
	}
}

func TestRunJudge_RejectsNilProvider(t *testing.T) {
	t.Parallel()
	_, _, err := runJudge(context.Background(), nil, "m", 1, "q", "a", "r")
	if err == nil || !strings.Contains(err.Error(), "no JudgeProvider") {
		t.Errorf("err = %v", err)
	}
}

func TestRunJudge_PropagatesProviderError(t *testing.T) {
	t.Parallel()
	want := errors.New("upstream boom")
	jp := &fakeJudgeProvider{err: want}
	_, _, err := runJudge(context.Background(), jp, "m", 1, "q", "a", "r")
	if err == nil || !errors.Is(err, want) {
		t.Errorf("err = %v", err)
	}
}

func TestRunJudge_RejectsUnparseableReply(t *testing.T) {
	t.Parallel()
	jp := &fakeJudgeProvider{resp: "no json here"}
	_, _, err := runJudge(context.Background(), jp, "m", 1, "q", "a", "r")
	if err == nil || !strings.Contains(err.Error(), "no JSON object") {
		t.Errorf("err = %v", err)
	}
}

func TestRunJudge_RejectsScoreOutOfRange(t *testing.T) {
	t.Parallel()
	jp := &fakeJudgeProvider{resp: `{"score": 99, "reason": "x"}`}
	_, _, err := runJudge(context.Background(), jp, "m", 1, "q", "a", "r")
	if err == nil || !strings.Contains(err.Error(), "[1,5]") {
		t.Errorf("err = %v", err)
	}
}

func TestExtractJSONObject_ToleratesPreamble(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in   string
		want string
		ok   bool
	}{
		{`{"a":1}`, `{"a":1}`, true},
		{`preamble {"a":1} suffix`, `{"a":1}`, true},
		{`nested {"a":{"b":2}} text`, `{"a":{"b":2}}`, true},
		{`no braces`, "", false},
		{`{"unbalanced":`, "", false},
	}
	for _, tc := range tests {
		got, ok := extractJSONObject(tc.in)
		if ok != tc.ok {
			t.Errorf("%q: ok = %v, want %v", tc.in, ok, tc.ok)
			continue
		}
		if got != tc.want {
			t.Errorf("%q: got = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestParseJudgeReply_RejectsNonInteger(t *testing.T) {
	t.Parallel()
	_, _, err := parseJudgeReply(`{"score": "five", "reason": "x"}`)
	if err == nil || !strings.Contains(err.Error(), "unmarshal") {
		t.Errorf("err = %v", err)
	}
}
