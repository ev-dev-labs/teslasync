---
description: "Phase 43a - GET/POST /vehicles/{id}/guard/* (sentry events, acknowledge, panic)"
---

# Prompt 0006 — Guard endpoints

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-43a-0006-guard.log` |
| Depends on | `phase-43a-0005-vampire-drain.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/api/guard_handler.go`, `internal/api/guard_handler_test.go`, `internal/database/guard_repo.go`, `internal/database/guard_repo_test.go`, `internal/api/router.go`, `migrations/000189_security_events_ack.up.sql`, `migrations/000189_security_events_ack.down.sql`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-43a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== DESIGN ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`useGuard.ts` calls 4 missing routes — sentry/security UI for the
Tesla "Guard" feature:

- `GET    /vehicles/{vehicle_id}/guard` — current guard status
- `GET    /vehicles/{vehicle_id}/guard/events` — list of sentry events
- `POST   /vehicles/{vehicle_id}/guard/events/{event_id}/acknowledge` — mark event seen
- `POST   /vehicles/{vehicle_id}/guard/panic` — trigger panic mode (proxy to Tesla command API)

Source data: `security_events` table (mig 000186) populated by
phase-42a writer 0018; `signal_log` for live SentryMode field; existing
`tesla_command_proxy` for the panic POST.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Guard status response** | `{ vehicle_id, sentry_mode_active: bool, last_state: string, last_state_at, recent_event_count_24h: int }`. sentry_mode_active = latest signal_log row for `SentryMode` field is true. |
| 2 | **Events list response** | `{ vehicle_id, events: [{ id, ts, event_type, from_state, to_state, details, acknowledged_at? }] }`. Most recent first; default limit 100, max 1000. acknowledged_at is NULL if unacknowledged. |
| 3 | **Acknowledge** | `POST /guard/events/{event_id}/acknowledge` (no body required). UPDATE security_events SET acknowledged_at=now(), acknowledged_by=actorFromRequest(r) WHERE id=$1 AND vehicle_id=$2. Returns 200 with the updated row. 404 if event_id not found OR not for this vehicle. |
| 4 | **Schema migration** | Migration 000189 adds idempotent columns: `ALTER TABLE security_events ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS acknowledged_by TEXT`. Down migration drops them with IF EXISTS. |
| 5 | **Panic** | `POST /guard/panic` returns 501 Not Implemented if no Tesla command proxy is configured (`cfg.Tesla.CommandProxyURL` empty); else proxies to existing command client. This prompt does NOT implement the proxy from scratch — it wires the EXISTING command client (find via grep in AUDIT). If no proxy client exists, return 501 with message "Tesla command proxy not configured". |
| 6 | **Auth** | All 4 endpoints require auth. Acknowledge + panic also require write capability (existing middleware). |
| 7 | **Tests** | (a) Status with active+inactive sentry. (b) Events list ordering DESC + limit clamp. (c) Acknowledge sets columns + 404 on cross-vehicle. (d) Panic returns 501 when proxy unconfigured. (e) Migration up + down idempotency. |

## Action Steps

1. `git status` clean.
2. Predecessor 0005 DONE.
3. `=== AUDIT_EVIDENCE ===` capture:
   - `Get-Content migrations/000186_*.up.sql` (current security_events schema).
   - `grep -rn 'CommandProxy\|command_proxy\|TeslaCommand' internal/ --include='*.go' | head -20` (existing command-proxy client).
   - `grep -n 'guard' internal/api/router.go` (must be 0).
4. `=== DESIGN ===` document the migration up/down + acknowledge SQL.
5. Implement migration + repo (status, list, acknowledge, panic) + handler (4 routes).
6. Tests per Decision #7.
7. Gate:
   - `go build ./...`, `go vet ./...`, `go test -race ./internal/api/... ./internal/database/...`
   - `git status --short` allowed only.
8. Commit `feat(api): /vehicles/{id}/guard/* endpoints (sentry status, events, acknowledge, panic)`.
9. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If `SentryMode` field is not routed in routing.yaml, derive
sentry_mode_active from the most recent security_events row instead
(event_type IN ('sentry_armed','sentry_disarmed')). If the panic
proxy turns out to be a 200-line implementation (not a "find existing
client" task), BLOCK — that's its own prompt.
