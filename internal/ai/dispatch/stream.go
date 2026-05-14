package dispatch

import (
	"encoding/json"
	"sync"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

// captureWriter is an in-memory StreamWriter useful for tests and
// non-streaming HTTP responses. F5 will ship the SSE-backed
// implementation; until then this is the only StreamWriter the
// dispatcher knows about.
type captureWriter struct {
	mu      sync.Mutex
	deltas  []string
	tcalls  []provider.ToolCall
	tres    map[string][]json.RawMessage
	terr    map[string][]error
	done    bool
	doneErr error
}

// NewCaptureWriter returns a fresh in-memory StreamWriter. Safe
// for concurrent use.
func NewCaptureWriter() *CaptureWriter {
	return &CaptureWriter{inner: &captureWriter{
		tres: map[string][]json.RawMessage{},
		terr: map[string][]error{},
	}}
}

// CaptureWriter is the public wrapper around captureWriter so tests
// can inspect the recorded events.
type CaptureWriter struct {
	inner *captureWriter
}

func (c *CaptureWriter) WriteDelta(s string) error {
	c.inner.mu.Lock()
	defer c.inner.mu.Unlock()
	if s != "" {
		c.inner.deltas = append(c.inner.deltas, s)
	}
	return nil
}

func (c *CaptureWriter) WriteToolCall(call provider.ToolCall) error {
	c.inner.mu.Lock()
	defer c.inner.mu.Unlock()
	c.inner.tcalls = append(c.inner.tcalls, call)
	return nil
}

func (c *CaptureWriter) WriteToolResult(name string, result json.RawMessage) error {
	c.inner.mu.Lock()
	defer c.inner.mu.Unlock()
	c.inner.tres[name] = append(c.inner.tres[name], result)
	return nil
}

func (c *CaptureWriter) WriteToolError(name string, err error) error {
	c.inner.mu.Lock()
	defer c.inner.mu.Unlock()
	c.inner.terr[name] = append(c.inner.terr[name], err)
	return nil
}

func (c *CaptureWriter) WriteDone() error {
	c.inner.mu.Lock()
	defer c.inner.mu.Unlock()
	c.inner.done = true
	return c.inner.doneErr
}

// --- inspectors ---

// Deltas returns every WriteDelta payload, in order.
func (c *CaptureWriter) Deltas() []string {
	c.inner.mu.Lock()
	defer c.inner.mu.Unlock()
	out := make([]string, len(c.inner.deltas))
	copy(out, c.inner.deltas)
	return out
}

// ToolCalls returns every announced tool call, in order.
func (c *CaptureWriter) ToolCalls() []provider.ToolCall {
	c.inner.mu.Lock()
	defer c.inner.mu.Unlock()
	out := make([]provider.ToolCall, len(c.inner.tcalls))
	copy(out, c.inner.tcalls)
	return out
}

// ToolResults returns every successful tool result, keyed by name.
func (c *CaptureWriter) ToolResults() map[string][]json.RawMessage {
	c.inner.mu.Lock()
	defer c.inner.mu.Unlock()
	out := map[string][]json.RawMessage{}
	for k, v := range c.inner.tres {
		cp := make([]json.RawMessage, len(v))
		copy(cp, v)
		out[k] = cp
	}
	return out
}

// ToolErrors returns every tool-error event, keyed by name.
func (c *CaptureWriter) ToolErrors() map[string][]error {
	c.inner.mu.Lock()
	defer c.inner.mu.Unlock()
	out := map[string][]error{}
	for k, v := range c.inner.terr {
		cp := make([]error, len(v))
		copy(cp, v)
		out[k] = cp
	}
	return out
}

// Done reports whether WriteDone was called exactly once.
func (c *CaptureWriter) Done() bool {
	c.inner.mu.Lock()
	defer c.inner.mu.Unlock()
	return c.inner.done
}
