---
description: "P1/S1-0001 — Emit OpenAPI 3.1 spec from the Go API + conformance test"
---

# P1 · S1-0001 — OpenAPI 3.1 contract from the Go API

> **Severity:** Foundational (contract = source of truth) · **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `api/openapi/teslasync.openapi.json` + spec-emission wiring + conformance test |
| Allowed files | `api/openapi/**`, `internal/api/**` (annotations/spec route ONLY, no logic change), `cmd/openapi-gen/**` (new), test files, the log file |
| Depends on | P0/0099 DONE |
| Blocks | S2 (codegen), all client work |
| ADR refs | ADR-003 (OpenAPI source of truth) |
| Log | `../logs/p1-s1-0001-openapi-emit.log` |
| Instr refs | `.github/instructions/go-backend.instructions.md`, `.github/instructions/observability.instructions.md` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Produce an accurate **OpenAPI 3.1** document describing every `/api/v1/*` route (paths,
params, request/response schemas with snake_case fields, SI semantics in descriptions, SSE
endpoints noted) and a test proving the spec matches the live server.

## Approach (choose, justify in REASONING)

- **Preferred:** generate the spec from the Chi router + typed handlers using a Go OpenAPI
  toolchain (e.g. `swaggest/rest` / `ogen` reverse / annotation-based `swag`), OR a custom
  `cmd/openapi-gen` that walks `internal/api/router.go` and the response structs (reflection on
  JSON tags) to assemble paths + component schemas.
- Whichever path: the **router is the source of truth** (matches the standing rule). Every
  route in `internal/api/router.go` MUST appear in the spec; a missing route fails the gate.

## Required spec content

1. All routes from `router.go` (vehicles, drives, charging, motor, tire/climate/security/media,
   analytics/*, signals/*, alerts, notifications, system/*, exports, locations, trips, user,
   admin, automations, sharing, watch, dashboard, telemetry, vehicle-systems, …).
2. Path + query params as **snake_case** (e.g. `vehicle_id`), matching backend rules.
3. Component schemas from Go response structs via JSON tags; nullable → `nullable: true`
   (Go pointer fields). **SI units documented** in field `description` (meters, mps, Wh, Pa, °C).
4. SSE endpoints (`.../live`) marked (text/event-stream) with the event payload schema.
5. Auth: bearer security scheme (ADR-008) + note ForwardAuth for web.

## Conformance test

`internal/api/openapi_conformance_test.go`: boot the router (httptest), for each spec path+method
issue a representative request and assert status + that the response JSON keys are a subset of
the documented schema (catches drift). Add a test asserting **every** `router.go` route appears
in the spec.

## Gate

```powershell
go run ./cmd/openapi-gen -out api/openapi/teslasync.openapi.json 2>&1 | Tee-Object $log -Append
go test ./internal/api -run OpenAPI 2>&1 | Tee-Object $log -Append
"EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# spec parses as OpenAPI 3.1
npx --yes @redocly/cli lint api/openapi/teslasync.openapi.json 2>&1 | Tee-Object $log -Append
"LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
```

## Acceptance Criteria

- [ ] Spec is valid OpenAPI 3.1 (`redocly lint` clean).
- [ ] Every `router.go` route present; params snake_case; nullable from pointers.
- [ ] SI units documented in field descriptions; SSE endpoints marked.
- [ ] Conformance + route-coverage tests green.
- [ ] No business-logic change in `internal/api` (only annotations/spec route).
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope (reject)

- No new endpoints (device-registration for push is a separate ADR-009 prompt).
- No response-shape changes — document what exists.

## Commit

```powershell
git add api/openapi cmd/openapi-gen internal/api .github/prompts/monorepo/logs/p1-s1-0001-openapi-emit.log
git commit -m "feat(api): emit OpenAPI 3.1 contract + conformance test (P1/S1-0001)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
