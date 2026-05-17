# AI Tool-Use Framework

> Phase-50 / F4 (slice 0005)
>
> Status: shipped at commit (this slice).
> ADR: ADR-015 (AI is additive, default-off).
> Related slices: F0 (off-contract), F1 (provider abstraction),
> F3 (audit log), F5 (streaming, planned), F6 (eval harness, planned),
> F8 (redaction policy, planned).

## Why we need this

Without a typed tool registry every AI feature would either:

a. Hand-craft prompt parsing and call `db.Exec` directly
   (P2 violation: LLM writes raw SQL), or
b. Invent its own function-calling layer
   (P4 violation: parallel implementations of the same gate).

F4 ships the canonical surface so neither happens.

## Architecture

```
                                   ┌──────────────────────────┐
   user prompt ─────► Strategy.Context ─┐                     │
                                        ▼                     │
                       Provider.Chat(messages, tools=Specs)   │
                                        │                     │
                          ┌─────────────┴────────┐            │
                          │                      │            │
                   FinishStop?            ToolCalls?          │
                          │                      │            │
                          ▼                      ▼            │
                    return text            for each call:     │
                                            tool.Validate ────┤  R2: schema and validator
                                                  │           │      both reflect the SAME
                                            mutates?          │      validate:"..." tags
                                                  │           │
                                          yes ─►  ConfirmFn   │  ai_chat_continuations
                                                  │           │  (24h expiry)
                                              decision?       │
                                            ┌────┴────┐       │
                                       approved      denied   │
                                            │          │      │
                                            ▼          ▼      │
                                       tool.Execute   abort   │
                                            │                 │
                                            ▼                 │
                                     append tool result ──────┘
                                            │
                                       (loop, max 8)
```

## The five rules every implementor must internalise

1. **`tools.Tool.Execute` is the only place mutations happen.**
   The dispatcher refuses to call `db.Exec` on the LLM's behalf;
   the LLM cannot reach the DB except by emitting a registered
   tool call, and even then `Validate` runs first.

2. **Schemas are reflected, not hand-written.**
   `tools.Generate(reflect.TypeOf(MyInput{}))` produces the
   `InputSchema()` payload from the same `validate:"..."` tags
   that drive `tools.ValidateStruct[MyInput]`. Adding a constraint
   in one place without the other breaks
   `TestEverySchemaMatchesHandlerValidation` (R2 mitigation).

3. **Mutating tools require user confirmation.**
   If `tool.Mutates() == true`, the dispatcher pauses, persists
   `ContinuationState` to `ai_chat_continuations`, emits a
   `confirm_request` SSE frame, and resumes only after the
   continuation endpoint confirms approval. The user sees the
   tool name + JSON args in `<AiConfirmDialog>`.

4. **Strategies whitelist the tools they may invoke.**
   The dispatcher intersects `strategy.Tools()` with the tool
   registry before exposing anything to the LLM. Even if the LLM
   hallucinates a tool name, the dispatcher returns
   `tool ... not allowed for this strategy` to the LLM rather
   than executing.

5. **The loop is bounded.**
   `DefaultMaxIterations = 8` is a hard cap. Long tool chains
   that exceed this surface as `ErrMaxIterations`; the user sees
   a "conversation got stuck" message rather than an unbounded
   spend.

## Building a new feature on this stack

A feature slice (e.g. N1 — alert-rule chatbot) ships:

1. **One Strategy** in
   `internal/ai/{feature}/strategy.go` implementing
   `strategy.Strategy` — system prompt, tool whitelist, context
   builder, redaction policy, eval goldens.

2. **Mutating tools** (if any) in
   `internal/ai/{feature}/tools.go`, registered into the
   process-wide registry at boot via `RegisterFeatureTools(reg)`.
   Each tool wraps an existing typed handler DTO; **no new SQL
   is written** — the tool's `Validate()` reuses
   `tools.ValidateStruct[MyDTO]` against the same struct the
   handler already validates.

3. **HTTP boundary** at
   `internal/api/ai_{feature}_handler.go` mounted via
   `g.Wrap("{feature-id}", handler)` so off-mode returns 404 by
   default. The handler constructs a `dispatch.Dispatcher`,
   calls `Run` with the per-request `StrategyInput`, and
   forwards events to an SSE writer.

4. **Frontend** mounted via `withAiFeature("{feature-id}", ...)`
   so the entire UI subtree is gated by the AI mode flag.
   Confirmation dialogs reuse `<AiConfirmDialog>`.

## Built-in starter tools (12, all read-only)

Bundled in `tools.Register12Builtins(reg, sources)` so later
slices have something to call:

| Name                    | Wraps                              | Mutates |
|-------------------------|------------------------------------|---------|
| `query_vehicle_count`   | `VehicleRepo.GetAll`               | no      |
| `query_vehicle_state`   | `VehicleRepo.GetByID` + signal store | no    |
| `query_vehicle_location`| signal store                       | no      |
| `query_drives_recent`   | `DriveRepo.GetByVehicle`           | no      |
| `query_drive_detail`    | `DriveRepo.GetByID`                | no      |
| `query_charges_recent`  | `ChargingRepo.GetByVehicle`        | no      |
| `query_charge_detail`   | `ChargingRepo.GetByID`             | no      |
| `query_alerts_active`   | `AlertRuleRepo.GetAll` + filter    | no      |
| `query_alerts_recent`   | `NotificationRepo.GetLogs`         | no      |
| `query_geofences_list`  | `GeofenceRepo.GetAll`              | no      |
| `query_battery_status`  | signal store                       | no      |
| `query_efficiency_period`| `DriveRepo` aggregation in Go     | no      |

The **mutating** tools (toggle alert rule, snooze notification,
re-run trip aggregation, etc.) are NOT shipped here — they
belong with the feature slices that consume them, so the audit
trail of "what feature added this mutation?" stays intact.

## Continuations table (000204_ai_chat_continuations)

Schema:

```sql
CREATE TABLE ai_chat_continuations (
    id            TEXT        PRIMARY KEY,
    user_subject  TEXT        NOT NULL DEFAULT '',
    feature_id    TEXT        NOT NULL,
    state         JSONB       NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,

    CONSTRAINT ai_chat_continuations_expiry_chk
        CHECK (expires_at > created_at)
);
```

Operational invariants:

- 24h hard expiry (`DefaultContinuationTTL`).
- Subject scoping in SQL — wrong-subject Load returns
  `ErrContinuationNotFound`, indistinguishable from a missing
  row (constant-time defence against id enumeration).
- Cleanup repo method removes expired rows; wiring into a
  worker tick lands with the next worker-touching slice.

## SSE protocol contract (forward dependency on F5)

F5 (streaming) will define the on-the-wire SSE frames the
dispatcher emits. The dispatcher already speaks four event
types via `dispatch.StreamWriter`:

| Method            | Payload                                         |
|-------------------|-------------------------------------------------|
| `WriteDelta`      | `{ "type": "delta", "text": "..." }`            |
| `WriteToolCall`   | `{ "type": "tool_call", "call": {...} }`        |
| `WriteToolResult` | `{ "type": "tool_result", "name": "...", "result": ... }` |
| `WriteToolError`  | `{ "type": "tool_error", "name": "...", "error": "..." }` |
| `WriteDone`       | `{ "type": "done" }`                            |

For mutating tools the dispatcher additionally emits
`{ "type": "confirm_request", "continuation_id": "...", ... }`
between `WriteToolCall` and execution, then awaits a
`POST /api/v1/ai/chat/continue/{id}` from the frontend.

## Forward dependencies

- **F5 (streaming)** plugs into `Dispatcher.StreamWriter` via
  an SSE-backed implementation.
- **F6 (eval)** feeds Strategies through Dispatcher and
  asserts `EvalGolden` outputs match.
- **F8 (redaction)** widens `RedactionPolicy` with a concrete
  `Apply(...)` method, replacing the `NoRedaction{}` placeholder.
- **N1, N2, U1, ...** each register one mutating Tool and one
  Strategy in their own slice.
