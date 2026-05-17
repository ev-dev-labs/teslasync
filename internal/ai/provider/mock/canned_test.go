package mock

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

func newSeqMock(t *testing.T, replies []Reply) *SequencedMock {
	t.Helper()
	m := New(provider.Capabilities{Tools: true, Streaming: true})
	s := NewSequencedMock(m)
	s.SetSequence(replies)
	return s
}

func TestSequencedMock_FIFOOrder(t *testing.T) {
	t.Parallel()
	s := newSeqMock(t, []Reply{
		{ChatResponse: provider.ChatResponse{
			Message:      provider.Message{Role: provider.RoleAssistant, Content: "first"},
			FinishReason: provider.FinishStop,
		}},
		{ChatResponse: provider.ChatResponse{
			Message:      provider.Message{Role: provider.RoleAssistant, Content: "second"},
			FinishReason: provider.FinishStop,
		}},
	})

	req := provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "hi"}},
	}
	r1, err := s.Chat(context.Background(), req)
	if err != nil {
		t.Fatalf("Chat #1: %v", err)
	}
	if r1.Message.Content != "first" {
		t.Errorf("Chat #1 content = %q", r1.Message.Content)
	}
	r2, err := s.Chat(context.Background(), req)
	if err != nil {
		t.Fatalf("Chat #2: %v", err)
	}
	if r2.Message.Content != "second" {
		t.Errorf("Chat #2 content = %q", r2.Message.Content)
	}
}

func TestSequencedMock_FallsThroughToEmbeddedMock(t *testing.T) {
	t.Parallel()
	m := New(provider.Capabilities{Tools: true})
	m.Default = Reply{ChatResponse: provider.ChatResponse{
		Message:      provider.Message{Role: provider.RoleAssistant, Content: "fallback"},
		FinishReason: provider.FinishStop,
	}}
	s := NewSequencedMock(m)
	s.SetSequence([]Reply{{
		ChatResponse: provider.ChatResponse{
			Message:      provider.Message{Role: provider.RoleAssistant, Content: "scripted"},
			FinishReason: provider.FinishStop,
		},
	}})

	req := provider.ChatRequest{Messages: []provider.Message{{Role: provider.RoleUser, Content: "hi"}}}
	r1, _ := s.Chat(context.Background(), req)
	if r1.Message.Content != "scripted" {
		t.Errorf("Chat #1 = %q", r1.Message.Content)
	}
	r2, _ := s.Chat(context.Background(), req)
	if r2.Message.Content != "fallback" {
		t.Errorf("Chat #2 (post-exhaustion) = %q", r2.Message.Content)
	}
	consumed, total := s.SequenceProgress()
	if consumed != 1 || total != 1 {
		t.Errorf("Progress consumed=%d total=%d", consumed, total)
	}
}

func TestSequencedMock_LoopingWraps(t *testing.T) {
	t.Parallel()
	m := New(provider.Capabilities{Tools: true})
	s := NewSequencedMock(m)
	s.SetSequenceLooping([]Reply{{
		ChatResponse: provider.ChatResponse{
			Message:      provider.Message{Role: provider.RoleAssistant, Content: "loop"},
			FinishReason: provider.FinishStop,
		},
	}})

	req := provider.ChatRequest{Messages: []provider.Message{{Role: provider.RoleUser, Content: "x"}}}
	for i := 0; i < 5; i++ {
		r, err := s.Chat(context.Background(), req)
		if err != nil {
			t.Fatalf("Chat #%d: %v", i, err)
		}
		if r.Message.Content != "loop" {
			t.Errorf("Chat #%d content = %q", i, r.Message.Content)
		}
	}
}

func TestSequencedMock_PropagatesReplyError(t *testing.T) {
	t.Parallel()
	want := errors.New("scripted boom")
	s := newSeqMock(t, []Reply{{Err: want}})
	req := provider.ChatRequest{Messages: []provider.Message{{Role: provider.RoleUser, Content: "x"}}}
	_, err := s.Chat(context.Background(), req)
	if !errors.Is(err, want) {
		t.Errorf("err = %v", err)
	}
}

func TestSequencedMock_ContextCancelledBeforeChat(t *testing.T) {
	t.Parallel()
	s := newSeqMock(t, []Reply{{ChatResponse: provider.ChatResponse{
		Message:      provider.Message{Role: provider.RoleAssistant, Content: "ok"},
		FinishReason: provider.FinishStop,
	}}})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := s.Chat(ctx, provider.ChatRequest{})
	if !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v", err)
	}
}

func TestSequencedMock_StreamConsumesSequence(t *testing.T) {
	t.Parallel()
	s := newSeqMock(t, []Reply{{
		ChatResponse: provider.ChatResponse{
			Message:      provider.Message{Role: provider.RoleAssistant, Content: "ab"},
			FinishReason: provider.FinishStop,
		},
	}})
	req := provider.ChatRequest{Messages: []provider.Message{{Role: provider.RoleUser, Content: "x"}}}
	ch, err := s.Stream(context.Background(), req)
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	var got []string
	done := false
	for chunk := range ch {
		if chunk.Err != nil {
			t.Fatalf("chunk.Err: %v", chunk.Err)
		}
		if chunk.Done {
			done = true
			continue
		}
		got = append(got, chunk.Delta)
	}
	if !done {
		t.Error("never saw Done chunk")
	}
	if strings.Join(got, "") != "ab" {
		t.Errorf("got = %v", got)
	}
}

func TestSequencedMock_StreamRequiresStreamingCap(t *testing.T) {
	t.Parallel()
	m := New(provider.Capabilities{Tools: true, Streaming: false})
	s := NewSequencedMock(m)
	s.SetSequence([]Reply{{ChatResponse: provider.ChatResponse{
		Message:      provider.Message{Role: provider.RoleAssistant, Content: "x"},
		FinishReason: provider.FinishStop,
	}}})
	_, err := s.Stream(context.Background(), provider.ChatRequest{})
	if !errors.Is(err, provider.ErrCapabilityNotSupported) {
		t.Errorf("err = %v", err)
	}
}

func TestLoadCannedFile_HappyPath(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	p := filepath.Join(dir, "g.yaml")
	body := `replies:
  - finish_reason: tool_calls
    tool_calls:
      - id: c1
        name: query_battery_status
        arguments: '{"vehicle_id": 1}'
  - finish_reason: stop
    content: "Battery is at 80%."
    input_tokens: 12
    output_tokens: 8
`
	if err := writeFileForTest(p, body); err != nil {
		t.Fatalf("write: %v", err)
	}
	f, err := LoadCannedFile(p)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(f.Replies) != 2 {
		t.Fatalf("Replies = %d", len(f.Replies))
	}
	if f.Replies[0].FinishReason != provider.FinishToolCalls {
		t.Errorf("Replies[0].FinishReason = %q", f.Replies[0].FinishReason)
	}
	if f.Replies[0].ToolCalls[0].Name != "query_battery_status" {
		t.Errorf("tool name = %q", f.Replies[0].ToolCalls[0].Name)
	}
	replies := f.ToReplies()
	if len(replies) != 2 {
		t.Fatalf("ToReplies = %d", len(replies))
	}
	if string(replies[0].ChatResponse.ToolCalls[0].Arguments) != `{"vehicle_id": 1}` {
		t.Errorf("Arguments = %q", string(replies[0].ChatResponse.ToolCalls[0].Arguments))
	}
}

func TestLoadCannedFile_MissingFile(t *testing.T) {
	t.Parallel()
	_, err := LoadCannedFile(filepath.Join(t.TempDir(), "nope.yaml"))
	if err == nil || !strings.Contains(err.Error(), "read canned file") {
		t.Errorf("err = %v", err)
	}
}

func TestLoadCannedFile_EmptyRepliesRejected(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	p := filepath.Join(dir, "g.yaml")
	if err := writeFileForTest(p, "replies: []\n"); err != nil {
		t.Fatalf("write: %v", err)
	}
	_, err := LoadCannedFile(p)
	if err == nil || !strings.Contains(err.Error(), "no replies") {
		t.Errorf("err = %v", err)
	}
}

func TestLoadCannedFile_InvalidFinishReasonRejected(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	p := filepath.Join(dir, "g.yaml")
	if err := writeFileForTest(p, "replies:\n  - finish_reason: bogus\n"); err != nil {
		t.Fatalf("write: %v", err)
	}
	_, err := LoadCannedFile(p)
	if err == nil || !strings.Contains(err.Error(), "bogus") {
		t.Errorf("err = %v", err)
	}
}

func TestLoadCannedFile_BadToolCallJSON(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	p := filepath.Join(dir, "g.yaml")
	body := `replies:
  - finish_reason: tool_calls
    tool_calls:
      - id: c1
        name: t
        arguments: 'not json'
`
	if err := writeFileForTest(p, body); err != nil {
		t.Fatalf("write: %v", err)
	}
	_, err := LoadCannedFile(p)
	if err == nil || !strings.Contains(err.Error(), "valid JSON") {
		t.Errorf("err = %v", err)
	}
}

func TestSetSequence_ReplacesPrevious(t *testing.T) {
	t.Parallel()
	s := newSeqMock(t, []Reply{{
		ChatResponse: provider.ChatResponse{
			Message:      provider.Message{Content: "first-set"},
			FinishReason: provider.FinishStop,
		},
	}})
	s.SetSequence([]Reply{{
		ChatResponse: provider.ChatResponse{
			Message:      provider.Message{Content: "replaced"},
			FinishReason: provider.FinishStop,
		},
	}})
	r, _ := s.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "hi"}},
	})
	if r.Message.Content != "replaced" {
		t.Errorf("content = %q", r.Message.Content)
	}
}

// writeFileForTest is a small helper to keep the test code readable.
func writeFileForTest(path, body string) error {
	return os.WriteFile(path, []byte(body), 0o644)
}
