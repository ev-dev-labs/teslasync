---
description: "P0/0010 — Pin crash/analytics/diagnostics sink (ADR-016)"
---

# P0 · 0010 — Observability decision doc

> **Severity:** Foundational · **Delegation:** FORBIDDEN · **Prompt:** 10 of 12 (P0)

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/docs/observability.md` |
| Allowed files | `apps/docs/observability.md`, the log file |
| Depends on | 0001 |
| Blocks | P1 logging/redaction module; every platform crash-reporter init |
| ADR refs | ADR-016 (app observability) |
| Log | `../logs/p0-0010-observability.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Pin the concrete crash + analytics + diagnostic-logging choice (ADR-016 left default
"self-hosted Sentry") and define the PII-redaction contract every app logger must honor.

## Output — doc must contain

1. **Final choice** for crash reporting + analytics sink (default: self-hosted Sentry across
   all platforms; record SDK per platform). If choosing otherwise, justify against ADR-016.
2. **PII redaction contract**: the canonical deny-list (VIN, tokens, lat/long, email) and the
   rule that only the shared redacting logger may emit logs. Include redaction examples.
3. **Opt-out / consent**: Settings toggle behavior; iOS ATT; Play Data Safety; Store privacy labels.
4. **Self-hosting plan**: where the sink runs (Helm/config), deferred to P5 with a pointer.
5. **Event taxonomy**: minimal product-analytics events (screen_view, command_issued, error) —
   no third-party ad SDKs.

## Implementation steps

1. PREFLIGHT: 0001 DONE + clean tree.
2. Write the doc.
3. GATE: doc exists, all 5 sections present (grep headings); emit `EXIT=`.
4. Commit.

## Acceptance Criteria

- [ ] Crash/analytics sink pinned with per-platform SDK.
- [ ] PII redaction deny-list + single-logger rule documented.
- [ ] Consent + store-privacy obligations noted; P5 self-host pointer present.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Commit

```powershell
git add apps/docs/observability.md .github/prompts/monorepo/logs/p0-0010-observability.log
git commit -m "docs(monorepo): app observability + PII redaction contract (P0/0010)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
