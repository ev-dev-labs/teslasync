---
description: "Phase-50 / Prompt 0005 — F4: Tool-Use Framework"
---

# Phase-50 / Prompt 0005 — F4: Tool-Use Framework

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | .github/prompts/db-refactor/logs/phase-50-0005-F4-tool-use-framework.log |
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

> **Depends on:** F0, F1
> **Patterns:** P2 (tool-use as only mutation path), P4 (strategy)
> **Reads:** ADR-015 §D13 (LLM never writes raw SQL)

## Why

Without a typed tool registry, every AI feature would either
(a) hand-craft prompt parsing + `db.Exec`, or (b) invent its own
function-calling layer. P2 forbids both. This slice defines the
single canonical tool-use surface: LLM proposes → framework
validates → existing handler executes → user confirms. Mutations
re-use existing typed DTOs verbatim — no parallel implementations,
no parallel validation paths.

## Design

### D5.1 Tool interface

`internal/ai/tools/tool.go`:

```go
package tools

import (
    "context"
    "encoding/json"
)

type Tool interface {
    Name() string
    Description() string
    InputSchema() json.RawMessage  // JSON Schema, generated from DTO via reflection
    OutputSchema() json.RawMessage // optional; describes Execute return
    Mutates() bool                 // true ⇒ requires user confirm before Execute
    RequiredScope() string         // RBAC scope to invoke (mirrors handler's required scope)

    // Validate parses and validates raw against InputSchema; returns
    // a typed value of the tool's input type. Implementations are
    // generated from the same DTO struct used by the handler.
    Validate(raw json.RawMessage) (any, error)

    // Execute runs the tool. For mutating tools, this is invoked
    // ONLY after the user confirms via the dispatcher.
    Execute(ctx context.Context, in any) (any, error)
}
```

### D5.2 Schema generation (R2 mitigation — single source of truth)

Tool schemas are NOT hand-written. They are reflected from the
existing handler DTO via `internal/ai/tools/schema.Generate(reflect.Type)`.
Validation rules (`validate:"required,gte=0,..."`) become JSON-schema
constraints. This guarantees the LLM cannot propose a payload the
handler will later reject.

Test: `TestEverySchemaMatchesHandlerValidation` iterates the
registered tool list, fuzz-tests payloads against (a) the JSON-schema
validator AND (b) the handler's `validator.Struct(...)`, asserts the
two accept/reject the same set.

### D5.3 Tool registry

`internal/ai/tools/registry.go`:

```go
type Registry struct {
    mu    sync.RWMutex
    tools map[string]Tool
}

func (r *Registry) Register(t Tool)
func (r *Registry) Get(name string) (Tool, bool)
func (r *Registry) Specs() []provider.ToolSpec       // serialized to LLM
func (r *Registry) Filter(scope []string) *Registry  // RBAC-aware subset
```

### D5.4 Strategy interface (P4)

`internal/ai/strategy/strategy.go`:

```go
type Strategy interface {
    FeatureID() string                              // matches registry P9
    System() string                                 // system prompt
    Tools() []string                                // tool names this strategy uses
    Context(ctx context.Context, in StrategyInput) ([]provider.Message, error)
    RedactionPolicy() redact.Policy                 // F8 hook
    EvalGoldens() []eval.Golden                     // F6 hook
}
```

Each later feature slice ships exactly one Strategy implementation.

### D5.5 Dispatcher (the loop)

`internal/ai/dispatch/dispatch.go`:

```go
// Run executes the chat loop:
//   - Strategy.Context → redact → Provider.Stream
//   - On tool_calls: validate, optionally pause for user confirm
//     (mutating tools), execute, append tool result message,
//     repeat
//   - Stops at finish_reason="stop", max iterations (8), or error
//
// Streaming chunks are forwarded via StreamWriter.
type Dispatcher struct {
    reg      *Registry
    provider provider.Provider
    confirm  ConfirmFn  // injected; UI implements
}

func (d *Dispatcher) Run(ctx context.Context, s Strategy, in StrategyInput, w StreamWriter) error
```

`ConfirmFn` is an interface satisfied by an SSE round-trip:
dispatcher emits `confirm_request`, frontend renders, user clicks
Confirm/Cancel, frontend POSTs to a continuation endpoint. The
dispatcher resumes from the saved continuation. State is persisted
in `ai_chat_continuations(continuation_id, state, expires_at)`.

### D5.6 Built-in tool examples (one per major data domain — DRY seed)

This slice ships a starter set of read-only tools so later
conversational slices have something to call:

- `query_vehicle_count`, `query_vehicle_state`, `query_vehicle_location`
- `query_drives_recent`, `query_drive_detail`
- `query_charges_recent`, `query_charge_detail`
- `query_alerts_active`, `query_alerts_recent`
- `query_geofences_list`
- `query_battery_status`, `query_efficiency_period`

Each is a thin Tool wrapper over an existing handler. **No new SQL
written.** Schemas reflected from the handler's request DTO.

Mutating tools are NOT shipped in this slice — they belong with the
features that use them (N1, N2, etc.).

## Tasks

1. Tool interface + registry + tests.
2. Schema generator (reflection on `validate:"..."` tags) + tests
   covering: required, gte/lte, oneof, len, dive.
3. Strategy interface (no implementations yet).
4. Dispatcher with mock provider tests covering: simple chat, single
   tool call, multi-step tool chain, max-iteration cutoff, confirm
   pause + resume.
5. `ai_chat_continuations` table migration + repo + 24h expiry job.
6. Wrap the 12 starter read-only tools.
7. Frontend confirm dialog component + SSE protocol contract doc.

## Allowed files

- `internal/ai/tools/**` (new package)
- `internal/ai/strategy/**` (new package, interface only)
- `internal/ai/dispatch/**` (new package)
- `internal/database/ai_chat_continuations_repo.go` (+ test)
- `migrations/000199_ai_chat_continuations.up.sql`, `.down.sql`
- `web/src/components/ai/ConfirmDialog.tsx` (+ test)
- `docs/architecture/ai-tool-use.md` (new short doc)

## Verification

```
go test -race ./internal/ai/tools/... ./internal/ai/dispatch/...
go test -race ./internal/database/... -run Continuations
cd web && npm test -- --run ConfirmDialog
go run ./tools/aivet
```

Critical: `TestEverySchemaMatchesHandlerValidation` must pass.

## Deliverable

Log includes ADR-015 footer.

## Forward dependency

- F5 (streaming) plugs into Dispatcher's StreamWriter.
- F6 (eval) feeds Strategies through Dispatcher.
- Every U/N/D/etc. slice that mutates state defines its mutating
  Tool here-style and registers it.

