---
description: "Phase-50 / Prompt 0006 — F5: SSE Streaming"
---

# Phase-50 / Prompt 0006 — F5: SSE Streaming

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | `.github/prompts/db-refactor/logs/phase-50-0006-F5-sse-streaming.log` |
| Depends-on | See this prompt header and Phase-50 methodology. |
| Allowed files to change | See the **Allowed files** section below; methodology-only edits may change only Phase-50 prompt/ADR artifacts. |

## Honesty Covenant

1. No red-as-green - EXIT != 0 -> STATUS=BLOCKED, no exceptions
2. No scope narrowing - run the exact gate command, no subsets
3. No skip-and-assume - can't run gate -> BLOCKED, never DONE
4. No field resurrection - don't add back deleted fields to "fix" things
5. No stubs - no `return nil`, `// TODO`, `panic("not impl")`
6. No delegation - NO sub-agents, NO parallel, NO background tasks
7. No predecessor bypass - verify predecessor STATUS=DONE first
8. No commit on red - commit only the log when BLOCKED
9. No silent drift - `git status` outside allowed files -> BLOCKED
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on own lines

## Logging Requirements

The slice log MUST include these sections, in order:

| Section | Purpose |
|---|---|
| `=== PREFLIGHT ===` | Branch, predecessor logs, and dirty-tree check. |
| `=== SURVEY ===` | Files, routes, DTOs, hooks, registry entries, and baseline behavior inspected before edits. |
| `=== REASONING ===` | Why the selected design preserves ADR-015 and the Phase-50 methodology. |
| `=== CHANGES ===` | Summary of production, test, registry, i18n, prompt, and golden changes. |
| `=== GATE ===` | Full command transcripts with EXIT markers. |
| `=== COMMIT ===` | git add/commit transcript, or blocked-log-only commit transcript. |
| `=== AI-OFF CONTRACT ===` | ADR-015 footer with evidence for every invariant this slice touches. |
| `=== STATUS ===` | Final `EXIT=<int>` and `STATUS=<DONE|BLOCKED>` markers on their own lines. |

## Problem

This Phase-50 foundation or gate prompt must preserve ADR-015: AI is additive, default-off, and every non-AI baseline remains available. Execute the slice without adding unguarded AI surfaces, duplicate provider logic, raw SQL mutation paths, or hidden egress.

## Action Steps

1. Read ADR-015 and this prompt before making any changes.
2. Verify predecessor logs and branch state in `=== PREFLIGHT ===`.
3. Survey the current code and document the baseline in `=== SURVEY ===` before editing.
4. Make only the changes allowed by this prompt and preserve the non-AI baseline.
5. Run every verification command exactly as written and paste raw output into `=== GATE ===`.
6. If any gate fails, stop with `STATUS=BLOCKED` and commit only the log.

## Gate

The prompt is DONE only if every required verification command exits 0, the log contains `EXIT=0` and `STATUS=DONE` on their own lines, the ADR-015 footer is present with evidence, and `git status --short` contains only allowed files before commit.

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

> **Depends on:** F0, F1, F4
> **Pattern:** P3 (async-generator over SSE), R4 (back-pressure)

## Why

Today `ChatbotPage` simulates streaming with a fake typewriter
(`setInterval` reveals canned text char-by-char). Real LLMs stream
tokens as they're generated; a 4 KB response from a 7B model takes
8–15 seconds total but emits the first token in 300 ms. Without
streaming, the UX feels broken. P3 + R4 mandate the canonical
streaming primitive lives ONCE; every conversational feature
consumes it.

## Design

### D6.1 Backend writer

`internal/ai/stream/writer.go`:

```go
type Writer struct {
    w        http.ResponseWriter
    flusher  http.Flusher
    ch       chan event           // bounded (cap=64) — back-pressure SIGNAL only
    done     chan struct{}
    cancel   context.CancelFunc   // cancels upstream provider stream on stall
    drainErr atomic.Value
}

type event struct {
    Type string  // "delta" | "tool_call" | "tool_result" | "confirm_request" | "done" | "error"
    Data any
}

// Send blocks the producer until the consumer drains a slot.
// We DO NOT drop chunks — dropping mid-stream corrupts JSON / tool_calls
// and produces unsafe UI. If the consumer stalls past
// `stallTimeout` (default 5s, tunable), Send cancels the upstream
// provider context, emits a single terminal {Type: "error", Data:
// "stream_stalled"} event, closes ch, and returns ErrStallTimeout
// to the dispatcher. The dispatcher surfaces this as a normal
// failure → frontend banner → baseline fallback (R8).
func (w *Writer) Send(ev event) error
func (w *Writer) Done() error
func (w *Writer) Error(err error) error
func (w *Writer) Close()
```

SSE format:
```
event: delta
data: {"text":"The "}

event: delta
data: {"text":"car "}

event: tool_call
data: {"id":"c_abc","name":"query_drives_recent","arguments":{...}}

event: tool_result
data: {"id":"c_abc","ok":true,"data":{...}}

event: confirm_request
data: {"continuation_id":"k_xyz","tool":"create_alert","args":{...},"summary":"..."}

event: done
data: {"finish_reason":"stop","usage":{"in":120,"out":340}}
```

### D6.2 Frontend hook

`web/src/hooks/useAiStream.ts`:

```ts
type AiStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; data?: unknown; error?: string }
  | { type: 'confirm_request'; continuation_id: string; tool: string; args: unknown; summary: string }
  | { type: 'done'; finish_reason: string; usage: { in: number; out: number } }
  | { type: 'error'; message: string };

interface UseAiStreamArgs {
  url: string;
  body: unknown;
  onEvent: (ev: AiStreamEvent) => void;
  enabled?: boolean;
}

export function useAiStream({ url, body, onEvent, enabled = true }): {
  start: () => void;
  cancel: () => void;
  state: 'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error';
  text: string; // accumulated assistant text
}
```

Built on `fetch + ReadableStream`, NOT EventSource (we POST a body).
Cancellation propagates via `AbortController`.

### D6.3 Confirm round-trip

When the hook receives `confirm_request`:
- `state` → `'paused-confirm'`
- The component renders `<ConfirmDialog>` (built in F4).
- On Confirm: POST `/api/v1/ai/_internal/continue` with
  `{continuation_id}`. Server resumes dispatcher; new SSE stream
  reuses the same connection.

### D6.4 Refactor existing fake-stream

Replace the typewriter in `ChatbotPage.tsx` with `useAiStream`. In
`ai_mode='off'`, `useAiStream` is wrapped (since the route returns
404), and the page falls back to the existing baseline responder
synchronously — covered by U1 slice (0011), this slice only ships
the primitive.

> **Phase-50 / W1 (slice 0065) cross-reference:** the SPA-side wiring
> for `ChatbotPage` (and for every other AI feature with a registered
> `/api/v1/ai/*` route) is completed by 0065 — see
> `internal/ai/features/spa_wiring.go` for the per-feature
> Component → Endpoint table, methodology principles P11 + P12 for
> the "wired-or-absent" / "no placeholder buttons" rules, and
> `tools/aivet` rules W1-A + W1-B for the static checks that enforce
> them.

## Tasks

1. Backend `Writer` + tests with `httptest.ResponseRecorder` plus a
   custom flusher mock; cover back-pressure drop path.
2. Define event schema in TS + Go (one source of truth via JSON-Schema
   or codegen — for now, hand-mirrored with a contract test).
3. Frontend `useAiStream` + tests using `MockReadableStream`.
4. Integration test: dispatcher → writer → `useAiStream` → assert
   delta accumulation.
5. Stream metrics: `ai_stream_open`, `ai_stream_chunk_total`,
   `ai_stream_stall_total`, `ai_stream_cancel_total`,
   `ai_stream_duration_ms` (Prom histogram). No drop metric — drops
   are not allowed (R4).

## Allowed files

- `internal/ai/stream/**` (new package)
- `web/src/hooks/useAiStream.ts` (+ test)
- `web/src/hooks/__tests__/useAiStream.test.ts`
- `internal/ai/dispatch/dispatch.go` (wire StreamWriter)
- Contract test `tools/aistream-contract/main.go` asserting Go +
  TS event schemas match.

## Verification

```
go test -race ./internal/ai/stream/...
cd web && npm test -- --run useAiStream
# Contract:
go run ./tools/aistream-contract  # exit 0
```

## Deliverable

Log + ADR-015 footer (no UI surfaces here, so I5/I6 verified at the
F0 level remain green).

## Forward dependency

Every U/N/GEN slice consumes `useAiStream`. No alternative streaming
implementations allowed (ESLint rule
`teslasync/no-raw-fetch-stream-for-ai` enforces).

