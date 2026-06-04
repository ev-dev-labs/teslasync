---
description: "P5/H7 — Crash/analytics sink live; crash-free-rate dashboards; consent flows verified"
---

# P5 · H7 · 0001 — Crash + analytics wiring (production)

> **Severity:** Hardening · **Delegation:** FORBIDDEN
> Turn the P1/S11 abstraction on against the self-hosted sink decided in P0/0010; confirm
> crash-free-rate dashboards populate; consent flows actually gate ingestion; no PII slips through.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | App-side sink wiring per platform, sink-side dashboards (linked), `apps/shared/observability/dashboards.md` |
| Allowed files | `apps/**`, `apps/shared/observability/**`, the log file |
| Depends on | P1/S11, P0/0010 |
| Blocks | P5/H99 |
| ADR refs | ADR-016 |
| Log | `../logs/p5-h7-0001-crash-analytics.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

A real crash (forced on each platform) appears in the self-hosted dashboard within minutes, with
a symbolicated stack trace and redacted breadcrumbs; a real analytics event appears the same way;
revoking consent stops both ingestion streams and purges queued local data.

## Spec

- **Sink wiring**: per the P0/0010 decision (e.g., self-hosted Sentry/GlitchTip/Bugsnag-OSS or
  similar). Endpoint configured via Helm + per-app build config; no hard-coded DSNs.
- **Symbolication**: upload symbol files (PDB / mapping.txt + R8 / dSYM) as part of CI release
  builds; verify a forced crash resolves to source lines, not addresses.
- **Breadcrumb redaction**: confirm the redaction layer from P1/S11 is applied — planted PII in
  breadcrumbs must NOT appear in the sink (verify by inspecting an issue).
- **Consent**: opt-in default OFF; UI toggle live in Settings; revoking purges the local queue
  AND stops new ingestion; verified via inspect.
- **Dashboards**: crash-free-rate (sessions + users), top issues by impact, version adoption,
  release-health regression alert — one shared dashboard doc linking each platform's view.

## Implementation steps

1. Wire endpoint + symbol upload into each platform's release build pipeline.
2. Force a crash on each platform; verify symbolicated trace + redacted breadcrumbs in sink.
3. Force an analytics event; verify shape + presence.
4. Toggle consent off; verify ingestion stops + local queue purged.
5. Author `dashboards.md` linking each platform's view + the release-health alert config.

## Gate

```powershell
foreach($p in 'windows','android','apple'){
  & "./apps/$p/observability/verify.ps1" 2>&1 | Tee-Object $log -Append; "OBS_${p}_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
}
# EXIT=0 only if every OBS_*=0 (forced crash + event verified + consent toggle proven).
```

## Acceptance Criteria

- [ ] Symbolicated crash visible in dashboard for each platform.
- [ ] Sample analytics event visible for each platform.
- [ ] Consent toggle proven (ingestion stops + local queue purged).
- [ ] Breadcrumb-PII redaction verified.
- [ ] `dashboards.md` links + release-health alert configured.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Backend observability; user-facing crash dialogs; A/B analytics; cohort analysis.

## Commit

```powershell
git add apps .github/prompts/monorepo/logs/p5-h7-0001-crash-analytics.log
git commit -m "observability(apps): crash + analytics wiring + dashboards (P5/H7)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
