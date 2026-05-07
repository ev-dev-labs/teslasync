---
description: "Phase 41-rewrite F005 - rate-limit geofence + similar mutation routes"
---

# Prompt 0100 — F005: Rate-limit mutation routes

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Finding:** F005 (MED, auth-security)

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0100-F005-rate-limit-mutations.log` |
| Depends on | `phase-41-rewrite-0000-preflight-and-baseline.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/api/router.go`, `internal/api/router_ratelimit_test.go` (NEW or existing), the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem (verbatim from `findings` table, F005)

`internal/api/router.go:921-930` mounts the geofence routes:
- L923 POST /api/v1/geofences (Create) — NO rate limit
- L926 POST /api/v1/geofences/bulk — has `httprate.LimitByIP(20, 1*time.Minute)`
- L929 PUT /api/v1/geofences/{id} (Update) — NO rate limit
- L930 DELETE /api/v1/geofences/{id} (Delete) — NO rate limit

The bulk endpoint has a rate limit; the per-resource mutations do not.
A malicious client can amplify writes by hitting Create/Update/Delete
in a tight loop.

## Invariant

Every mutation route (POST/PUT/DELETE) on a write-heavy domain MUST be
rate-limited. The default for non-bulk mutation routes is
`httprate.LimitByIP(20, 1*time.Minute)` — same as bulk per established
phase-46 precedent.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Scope (this prompt) | Geofence routes (the cited L921-930) AND audit similar `r.Route` blocks: charge_plans, automations, alert_rules, notification_channels, geofence_events. Apply the same rate limit to any unprotected POST/PUT/DELETE in those blocks. |
| 2 | Limit | `httprate.LimitByIP(20, 1*time.Minute)` for non-bulk mutations. Read endpoints (GET) UNCHANGED. |
| 3 | Tests | Add or extend a router test that asserts: (a) under the limit returns 200; (b) over the limit returns 429. Use httptest + a real httprate middleware. |
| 4 | Build/test gate | `go build ./internal/api/...` + `go test -count=1 ./internal/api/...`. Anchored grep: every cited mutation route line must contain `httprate.LimitByIP`. |

## Action Steps

1. `git status` clean. `=== PREFLIGHT ===`.
2. `=== AUDIT_EVIDENCE ===`:
   - Dump router.go L915-940 BEFORE.
   - List every `r.Route` block in router.go and grep for unprotected mutation routes within them.
3. `=== IMPLEMENTATION ===`:
   - Wrap each unprotected mutation handler with `httprate.LimitByIP(20, 1*time.Minute)`.
   - Add/extend the rate-limit test.
4. `=== GATE ===`:
   - Anchored grep: `grep -nE 'r\.(Post|Put|Delete)\("[^"]*", [a-zA-Z]+\)' internal/api/router.go` — every match must be on a line preceded by a LimitByIP wrapper OR be in an explicit allowlist (with reason in comment).
   - `go build ./internal/api/...` + `go vet ./internal/api/...` + `go test -count=1 ./internal/api/...`.
5. `=== COMMIT ===` commit `fix(api): F005 — rate-limit non-bulk mutation routes`.
