---
description: "Phase-50 / Prompt 0002 — F1: Provider Abstraction (Hexagonal / Port-Adapter)"
---

# Phase-50 / Prompt 0002 — F1: Provider Abstraction (Hexagonal / Port-Adapter)

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | .github/prompts/db-refactor/logs/phase-50-0002-F1-provider-abstraction.log |
| Depends-on | See this prompt header and Phase-50 methodology. |
| Allowed files to change | See the **Allowed files** section below; methodology-only edits may change only Phase-50 prompt/ADR artifacts. |

## Honesty Covenant

1. No red-as-green - EXIT != 0 -> STATUS=BLOCKED, no exceptions
2. No scope narrowing - run the exact gate command, no subsets
3. No skip-and-assume - can't run gate -> BLOCKED, never DONE
4. No field resurrection - don't add back deleted fields to "fix" things
5. No stubs - no eturn nil, // TODO, panic("not impl")
6. No delegation - NO sub-agents, NO parallel, NO background tasks
7. No predecessor bypass - verify predecessor STATUS=DONE first
8. No commit on red - commit only the log when BLOCKED
9. No silent drift - git status outside allowed files -> BLOCKED
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on own lines

## Logging Requirements

The slice log MUST include these sections, in order:

| Section | Purpose |
|---|---|
| === PREFLIGHT === | Branch, predecessor logs, and dirty-tree check. |
| === SURVEY === | Files, routes, DTOs, hooks, registry entries, and baseline behavior inspected before edits. |
| === REASONING === | Why the selected design preserves ADR-015 and the Phase-50 methodology. |
| === CHANGES === | Summary of production, test, registry, i18n, prompt, and golden changes. |
| === GATE === | Full command transcripts with EXIT markers. |
| === COMMIT === | git add/commit transcript, or blocked-log-only commit transcript. |
| === AI-OFF CONTRACT === | ADR-015 footer with evidence for every invariant this slice touches. |
| === STATUS === | Final EXIT=<int> and STATUS=<DONE|BLOCKED> markers on their own lines. |

## Problem

This Phase-50 foundation or gate prompt must preserve ADR-015: AI is additive, default-off, and every non-AI baseline remains available. Execute the slice without adding unguarded AI surfaces, duplicate provider logic, raw SQL mutation paths, or hidden egress.

## Action Steps

1. Read ADR-015 and this prompt before making any changes.
2. Verify predecessor logs and branch state in === PREFLIGHT ===.
3. Survey the current code and document the baseline in === SURVEY === before editing.
4. Make only the changes allowed by this prompt and preserve the non-AI baseline.
5. Run every verification command exactly as written and paste raw output into === GATE ===.
6. If any gate fails, stop with STATUS=BLOCKED and commit only the log.

## Gate

The prompt is DONE only if every required verification command exits 0, the log contains EXIT=0 and STATUS=DONE on their own lines, the ADR-015 footer is present with evidence, and git status --short contains only allowed files before commit.

## Commit

Use a conventional commit for this slice and include the required trailer:

~~~text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
~~~

## Blocked Path

If a predecessor is missing, verification cannot run, or any gate fails, write the log with:

~~~text
=== STATUS ===
EXIT=1
STATUS=BLOCKED
~~~

Commit only the blocked log and include the command output that proves the blocker.

> **Read first:** [Methodology P1, P5, D2, D3, D14](./0000-methodology.prompt.md), [ADR-015](../adrs/ADR-015-ai-off-contract.md)
> **Depends on:** F0 (slice 0001) — registry + guard

## Why

Per the methodology pattern P1 (hexagonal), every AI feature must
talk to a single `ai.Provider` port. Adapters (Ollama,
OpenAI-compatible, Anthropic, mock) implement the port. Without this
foundation, every feature would import a concrete SDK and the
codebase would be impossible to retarget, mock, or self-host.

## Design

### D2.1 Port

`internal/ai/provider/provider.go`:

```go
package provider

import "context"

// Message is a single chat turn.
type Message struct {
    Role    string  `json:"role"`              // "system" | "user" | "assistant" | "tool"
    Content string  `json:"content"`
    Name    string  `json:"name,omitempty"`    // for tool messages
    ToolID  string  `json:"tool_id,omitempty"` // when role="tool"
    Tool    *ToolCall `json:"tool,omitempty"`   // when assistant proposes a tool call
}

type ToolCall struct {
    ID        string          `json:"id"`
    Name      string          `json:"name"`
    Arguments json.RawMessage `json:"arguments"`
}

type ChatRequest struct {
    Model      string
    Messages   []Message
    Tools      []ToolSpec
    Temperature float32
    MaxTokens  int
}

type ChatResponse struct {
    Message    Message
    ToolCalls  []ToolCall
    InputTokens, OutputTokens int
    FinishReason string // "stop" | "tool_calls" | "length" | "content_filter"
}

type Chunk struct {
    Delta     string
    ToolDelta *ToolCall // accumulated until complete
    Done      bool
    Err       error
}

type EmbedRequest struct {
    Model string
    Input []string
}

type EmbedResponse struct {
    Vectors      [][]float32
    InputTokens  int
}

type ToolSpec struct {
    Name        string
    Description string
    Parameters  json.RawMessage // JSON Schema
}

// Provider is the single port. Adapters implement this.
type Provider interface {
    Name() string                                                     // "ollama" | "openai" | "anthropic" | "mock"
    Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error)
    Stream(ctx context.Context, req ChatRequest) (<-chan Chunk, error)
    Embed(ctx context.Context, req EmbedRequest) (*EmbedResponse, error)
    Capabilities() Capabilities
}

type Capabilities struct {
    Tools     bool
    Streaming bool
    Embeddings bool
    MaxContext int
}
```

### D2.2 Adapters

- `internal/ai/provider/ollama/ollama.go` — uses `/api/chat` and
  `/api/embeddings`. Honors `Capabilities{Tools:true (model-dependent),Streaming:true,Embeddings:true,MaxContext:8192}` for `llama3.1`.
- `internal/ai/provider/openai/openai.go` — uses
  `/v1/chat/completions` and `/v1/embeddings`. Reads
  `base_url` from settings (so OpenAI-compatible endpoints like
  vLLM, LiteLLM, Together work transparently).
- `internal/ai/provider/anthropic/anthropic.go` — uses
  `/v1/messages`. No embeddings (returns
  `Capabilities.Embeddings=false`).
- `internal/ai/provider/mock/mock.go` — deterministic mock for
  tests + eval. Canned responses keyed by `sha256(req)`.

### D2.3 Local-mode validator (R3 mitigation)

`internal/ai/provider/local_validator.go`:

```go
// ValidateLocal asserts that providerCfg.BaseURL resolves to an
// RFC1918 / loopback / link-local IP at config-save time AND that the
// resolved IP is pinned for runtime calls. DNS rebinding is caught
// at request time by re-resolving and comparing to the pinned IP.
func ValidateLocal(cfg ProviderConfig) (resolvedIP string, err error)
```

Whitelist hostnames: `localhost`, `127.0.0.1`, `[::1]`, `host.docker.internal`,
plus any host whose A/AAAA record is in 10/8, 172.16/12, 192.168/16,
fc00::/7, fe80::/10, 169.254/16. Anything else → reject with a clear
error message.

### D2.4 Registry (selection)

`internal/ai/provider/registry.go`:

```go
type Registry struct {
    mu        sync.RWMutex
    adapters  map[string]Provider // keyed by name
    settings  SettingsReader      // current ai_provider_config
}

// For returns the adapter for the given (mode, feature) tuple.
// Honors per-feature provider override if set in settings, else
// uses mode default (D2/D3).
func (r *Registry) For(ctx context.Context, userID int64, featureID string) (Provider, error)
```

### D2.5 Decorator chain (P5 — defined here, populated by F8/F9/F3)

`internal/ai/provider/decorator.go`:

```go
type Decorator func(Provider) Provider

// Chain wraps base with decorators in order. Order is fixed in
// app.New(): Trace → Audit → CostCap → RateLimit → Redaction → base.
// Defined here so adapters never know about decorators.
func Chain(base Provider, decs ...Decorator) Provider
```

In F1 we ship only `Trace` (using existing OTel wrapper). The other
decorators are added in F3/F8/F9.

## Tasks

1. Write the port + types.
2. Write the four adapters with adapter-level unit tests using
   `httptest.NewServer` for HTTP fixtures.
3. Write `ValidateLocal` + tests covering each RFC1918 range, IPv6
   ULA / link-local, DNS rebinding, public IP rejection.
4. Write `Registry` + tests.
5. Write `Decorator` + `Chain` + `Trace` decorator (wraps OTel).
6. Wire registry construction in `internal/app/new.go` (constructor
   only, NOT yet wired to any handler).
7. Add a feature-flagged provider-health endpoint
   `/api/v1/ai/_internal/health` guarded by F0 + admin RBAC for ops
   debugging. Returns adapter `Name()` + `Capabilities()`.

## Allowed files

- `internal/ai/provider/**` (new package tree)
- `internal/app/new.go` (wire constructor)
- `internal/api/router.go` (register health route under guard)
- `internal/api/ai_internal_handler.go` (new file, health route)

## Verification

```
go test -race ./internal/ai/provider/...
go vet ./internal/ai/provider/...
docker compose up -d ollama          # optional in CI; mock adapter is canonical
go run ./tools/aivet                 # health route must be guarded
```

End-to-end smoke (manual, document in log):

```
# Save provider config (local mode + ollama)
curl -X PUT /api/v1/settings -d '{"ai_mode":"local","ai_provider_config":{"base_url":"http://localhost:11434"}}'

# Health check
curl /api/v1/ai/_internal/health
# expect: {"name":"ollama","capabilities":{"tools":true,"streaming":true,"embeddings":true,"max_context":8192}}
```

## Deliverable

Log includes the AI-OFF compliance footer (I1, I6 verified — health
returns 404 with mode=off).

## Forward dependency

- F3 (audit), F8 (redaction), F9 (rate/cost) wrap this with
  decorators.
- F4 (tools) consumes `ChatRequest.Tools`.
- F5 (streaming) consumes `Stream`.
- F7 (embeddings) consumes `Embed`.

