---
description: "P1/S11 — Redacting logger + crash/analytics abstraction (shared)"
---

# P1 · S11 · 0001 — Diagnostics: redacting logger + telemetry abstraction

> **Severity:** Foundation · **Delegation:** FORBIDDEN
> Shared, privacy-first logging + a crash/analytics abstraction with `expect/actual` sinks,
> consent-gated, PII-redacting. Per ADR-016.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/shared/core/src/{common,android,apple}Main/.../diagnostics/**` |
| Allowed files | `apps/shared/core/**`, the log file |
| Depends on | P1/S3, P0/0010 (crash/analytics decision) |
| Blocks | platform observability wiring; H7 |
| ADR refs | ADR-016 |
| Log | `../logs/p1-s11-0001-diagnostics.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

A structured `Logger` + `Telemetry` (events) + `CrashReporter` abstraction that NEVER emits PII
(VINs, tokens, precise coordinates) — redaction enforced + tested — gated behind a user consent
flag (ADR-016), with `expect/actual` sinks bound to the chosen self-hosted backend (P0/0010).

## Spec

- **Logger**: levels (Error/Warn/Info/Debug), structured fields, a redaction filter with a
  forbidden-key/pattern set (vin, token, lat/lon, email, address). Redaction is applied centrally,
  not per-call.
- **Telemetry**: typed events (screen view, action, perf timing) — no free-form PII payloads.
- **CrashReporter**: `expect/actual` (android/apple sinks per the decision); breadcrumbs scrubbed.
- **Consent**: all sinks no-op until `DiagnosticsConsent.granted`; switching off purges queued data.
- **Testing**: feed records with planted PII → assert redaction; assert no-op when consent absent;
  assert event schema. No real network/sink in tests (fake sink).

## Implementation steps

1. `Logger` + redaction filter + forbidden set; central scrub.
2. `Telemetry` event types + `CrashReporter` `expect/actual` + fake sink.
3. Consent gate + purge-on-revoke.
4. Redaction/consent test suite; run gate.

## Gate

```powershell
Push-Location apps/shared/core
./gradlew :core:allTests 2>&1 | Tee-Object $log -Append; "TEST_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew ktlintCheck 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
Pop-Location
& ./apps/tools/check-placeholders.ps1 -Path apps/shared/core -Language kotlin *>$null; "PH_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if TEST/LINT/PH all 0
```

## Acceptance Criteria

- [ ] Planted-PII records are redacted (proven by tests); no PII reaches any sink.
- [ ] Sinks no-op without consent; revoke purges; event schema enforced.
- [ ] android+apple `actual` sinks present; ktlint + placeholder clean.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Backend ingestion infra (H7), platform-specific dashboards.

## Commit

```powershell
git add apps/shared/core .github/prompts/monorepo/logs/p1-s11-0001-diagnostics.log
git commit -m "feat(apps/shared): redacting logger + consent-gated telemetry/crash (P1/S11)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
