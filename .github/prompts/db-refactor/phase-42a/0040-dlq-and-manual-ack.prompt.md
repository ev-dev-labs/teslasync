---
description: "Phase 42a - DLQ + manual-ack production wiring for PipelineSubscriber"
---

# Prompt 0040 — DLQ + manual-ack production wiring

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0040-dlq-and-manual-ack.log` |
| Depends on | `phase-42a-0030-normalize-observer.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/mqtt/dlq_production.go`, `internal/mqtt/dlq_production_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

Per ADR-004 #8 and `internal/mqtt/mqtt.go:224-236`, the
`PipelineSubscriber` requires the paho client to be constructed with
`SetAutoAckDisabled(true)` so messages are only acked AFTER
`pipeline.Process` returns. Without this:

- A successful Process is acked at message-arrival time (default paho
  behavior), so a crash mid-Process loses the message
- An `ErrPayloadDrop` cannot be NACKed → DLQ writes happen but the
  broker never redelivers → poison pills are silently dropped on the
  floor instead of capturing for forensic analysis

Phase-42 prompt 0060 added the `MQTTDLQPublisher` type
(`internal/mqtt/mqtt.go:831`) but did NOT wire it into a production
constructor — it's currently only constructible by tests. This prompt
adds the production-side helper that:

1. Constructs a paho client configured with manual-ack
2. Constructs an `MQTTDLQPublisher` with the configured DLQ topic
3. Returns both, ready for `cmd/teslasync` to hand to `NewPipelineSubscriber`

The cutover prompt (0050) calls this helper.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **File location** | `internal/mqtt/dlq_production.go`. Function: `NewProductionPipelineMQTT(ctx, brokerURL, clientID, username, password, dlqTopic, log) (paho.Client, *MQTTDLQPublisher, error)`. |
| 2 | **paho.Client config** | `mqtt.NewClientOptions().AddBroker(brokerURL).SetClientID(clientID).SetUsername(username).SetPassword(password).SetAutoAckDisabled(true).SetCleanSession(false).SetKeepAlive(30s).SetPingTimeout(10s).SetConnectTimeout(30s).SetMaxReconnectInterval(5min).SetOrderMatters(false)`. The `SetCleanSession(false)` ensures broker-side queue persists across reconnects. `SetOrderMatters(false)` allows concurrent message handling (writers are idempotent). |
| 3 | **Connection test** | After `Connect()` returns, the function `Wait()` with a 30-second context-bounded timeout. If connection fails, return wrapped error AND DO NOT leak the client (call `Disconnect(0)` in defer). |
| 4 | **DLQ topic naming convention** | `dlqTopic` is constructor-supplied. Recommended convention (documented in code comment, NOT enforced): `tesla/dlq/${env}` where env is dev/staging/prod. |
| 5 | **Tests** | (a) Verify the returned client has AutoAckDisabled=true via the paho options inspection. (b) Verify connection failure is wrapped with broker URL context. (c) Use a test broker (testcontainers mosquitto or in-memory paho test broker) — fall back to skipping if neither available. |
| 6 | **NO ack/nack logic in this file** | Ack/nack happens in `PipelineSubscriber.handleMessage` (already implemented in phase-42 mqtt.go). This prompt only ensures the client is *configured* to permit manual ack. |

## Action Steps

1. `git status` clean.
2. Predecessor 0030 DONE.
3. `=== AUDIT_EVIDENCE ===` capture:
   - Current `MQTTDLQPublisher` struct + constructor (mqtt.go:831+).
   - `PipelineSubscriber.handleMessage` ack/nack logic (find and quote the message handler).
   - The `SetAutoAckDisabled(true)` documentation comment (mqtt.go:224-236).
4. Implement `dlq_production.go` per Decisions #1-#4.
5. Implement `dlq_production_test.go` per Decision #5.
6. Gate:
   - `go build ./internal/mqtt/...`
   - `go vet ./internal/mqtt/...`
   - `go test -race ./internal/mqtt/...`
   - `git status --short` allowed only.
7. Commit `feat(mqtt): production wiring helper for PipelineSubscriber + DLQ + manual-ack`.
8. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If `paho.Client` does NOT expose an options-inspection API for the test
in Decision #5(a), test the client's runtime behavior instead by
publishing a message and verifying it isn't auto-acked (requires test
broker). If neither is feasible, document the gap in
`=== IMPLEMENTATION ===` and fall back to a code-review-only assertion
(grep the file for `SetAutoAckDisabled(true)`).
