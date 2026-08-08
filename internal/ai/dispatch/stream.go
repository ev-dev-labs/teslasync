package dispatch

import (
	"encoding/json"
	"sync"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

// captureWriter is an in-memory StreamWriter for tests and
// non-streaming HTTP responses.
type captureWriter struct {
	mu       sync.Mutex
	deltas   []string
	tcalls   []provider.ToolCall
	tres     map[string][]json.RawMessage
	terr     map[string][]error
	done     bool
	doneErr  error
	runErr   error
	finish   string
	usageIn  int
	usageOut int
}

// NewCaptureWriter returns a concurrency-safe in-memory StreamWriter.
func NewCaptureWriter() *CaptureWriter {
	return &CaptureWriter{inner: &captureWriter{
		tres: map[string][]json.RawMessage{},
		terr: map[string][]error{},
	}}
}

// CaptureWriter exposes recorded stream events for tests.
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
	return c.WriteDoneFull(provider.FinishStop, 0, 0)
}

func (c *CaptureWriter) WriteDoneFull(finishReason string, usageIn, usageOut int) error {
	c.inner.mu.Lock()
	defer c.inner.mu.Unlock()
	c.inner.done = true
	c.inner.finish = finishReason
	c.inner.usageIn = usageIn
	c.inner.usageOut = usageOut
	return c.inner.doneErr
}

func (c *CaptureWriter) WriteError(err error) error {
	c.inner.mu.Lock()
	defer c.inner.mu.Unlock()
	c.inner.runErr = err
	return nil
}

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

// Done reports whether WriteDone was called.
func (c *CaptureWriter) Done() bool {
	c.inner.mu.Lock()
	defer c.inner.mu.Unlock()
	return c.inner.done
}

// RunError returns the terminal run error emitted by the dispatcher.
func (c *CaptureWriter) RunError() error {
	c.inner.mu.Lock()
	defer c.inner.mu.Unlock()
	return c.inner.runErr
}

// Completion returns the successful terminal metadata.
func (c *CaptureWriter) Completion() (string, int, int) {
	c.inner.mu.Lock()
	defer c.inner.mu.Unlock()
	return c.inner.finish, c.inner.usageIn, c.inner.usageOut
}
