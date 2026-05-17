package tools

import (
	"encoding/json"
	"fmt"
	"sort"
	"sync"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

// Registry is the per-process tool catalogue. The dispatcher resolves
// tool_call names through it; the strategy layer queries it for
// [provider.ToolSpec] payloads to feed the LLM.
//
// Implementations are safe for concurrent use. Add tools at boot
// (typically inside an app-startup wiring function) and treat the
// registry as effectively immutable thereafter — Register panics on
// duplicates so a typo at boot fails fast.
type Registry struct {
	mu    sync.RWMutex
	tools map[string]Tool
}

// NewRegistry returns an empty Registry. Call Register to populate
// it; pass the result to the dispatcher.
func NewRegistry() *Registry {
	return &Registry{tools: map[string]Tool{}}
}

// Register installs t under its declared Name. Panics if Name is
// empty (programming error) or duplicates an existing entry (also
// a programming error — every tool name MUST be unique).
//
// The duplicate panic is intentional: a silent overwrite would mean
// the LLM's tool catalogue and the dispatcher's executor disagree
// on which Go function answers a given call, an entire class of
// catastrophic-failure-mode bugs. Better to crash at boot.
func (r *Registry) Register(t Tool) {
	if t == nil {
		panic("tools: Register called with nil Tool")
	}
	name := t.Name()
	if name == "" {
		panic("tools: Register called with empty tool Name")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.tools[name]; dup {
		panic("tools: duplicate Register for " + name)
	}
	r.tools[name] = t
}

// Get returns the registered Tool for name and a boolean ok flag.
// Callers MUST check ok before using the returned tool — a missing
// tool means the LLM proposed a call that does not exist (typo,
// hallucination, or schema drift); the dispatcher returns a
// "no such tool" error to the LLM in that case.
func (r *Registry) Get(name string) (Tool, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	t, ok := r.tools[name]
	return t, ok
}

// Names returns every registered tool's Name in deterministic
// (lexicographic) order. Used by tests + diagnostics.
func (r *Registry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.tools))
	for n := range r.tools {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

// All returns a snapshot of every registered Tool. Order matches
// [Names]. Callers MUST treat the slice as read-only — mutating it
// does not change the registry.
func (r *Registry) All() []Tool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.tools))
	for n := range r.tools {
		names = append(names, n)
	}
	sort.Strings(names)
	out := make([]Tool, 0, len(names))
	for _, n := range names {
		out = append(out, r.tools[n])
	}
	return out
}

// Specs returns every registered tool serialised as a
// [provider.ToolSpec] ready to attach to a [provider.ChatRequest].
// Order is deterministic (lexicographic by Name) so cached prompt
// hashes survive a restart.
func (r *Registry) Specs() []provider.ToolSpec {
	tools := r.All()
	out := make([]provider.ToolSpec, 0, len(tools))
	for _, t := range tools {
		out = append(out, provider.ToolSpec{
			Name:        t.Name(),
			Description: t.Description(),
			Parameters:  t.InputSchema(),
		})
	}
	return out
}

// Filter returns a NEW Registry containing only the tools whose
// [Tool.RequiredScope] is empty OR is present in scopes. The original
// registry is not mutated — callers MAY freely build a per-request
// view without locking.
//
// scopes is a slice (not a set) because boot-time scope strings
// number in single digits; an O(N·M) check with stable order is
// simpler than a map allocation per request.
func (r *Registry) Filter(scopes []string) *Registry {
	allowed := map[string]struct{}{}
	for _, s := range scopes {
		allowed[s] = struct{}{}
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	out := NewRegistry()
	for _, name := range sortedKeys(r.tools) {
		t := r.tools[name]
		req := t.RequiredScope()
		if req == "" {
			out.Register(t)
			continue
		}
		if _, ok := allowed[req]; ok {
			out.Register(t)
		}
	}
	return out
}

// Definitions returns the metadata-only view of every registered
// tool. Useful for diagnostics + the confirm dialog payload.
func (r *Registry) Definitions() []Definition {
	tools := r.All()
	out := make([]Definition, 0, len(tools))
	for _, t := range tools {
		out = append(out, DefinitionOf(t))
	}
	return out
}

// MustValidate validates raw against the named tool's input schema +
// validate tags. It is a convenience for tests + the dispatcher's
// confirm-flow path; production code SHOULD call Tool.Validate
// directly via Get.
func (r *Registry) MustValidate(name string, raw json.RawMessage) (any, error) {
	t, ok := r.Get(name)
	if !ok {
		return nil, fmt.Errorf("tools: no such tool %q", name)
	}
	return t.Validate(raw)
}

func sortedKeys(m map[string]Tool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
