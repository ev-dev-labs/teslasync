---
description: "P5/H0 — Parity reconciliation: re-run manifest --check, assert all 4 ledgers 100%, close drift"
---

# P5 · H0 · 0001 — Parity reconciliation (hardening entry gate)

> **Severity:** Program gate · **Delegation:** FORBIDDEN
> The first prompt of P5. Before any hardening starts, reconcile what was actually shipped
> against the canonical parity manifest. No drift, no missed pages, no quietly-skipped panels.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | Updated `apps/parity/{windows,android,apple-macos,apple-ios}-ledger.json` + a `apps/parity/reconciliation-report.md` |
| Allowed files | `apps/parity/**`, the log file |
| Depends on | P2/W99, P3/A99, P4/P99 all `STATUS=DONE` for at least one platform |
| Blocks | every other H-phase |
| ADR refs | ADR-006, ADR-011 |
| Log | `../logs/p5-h0-0001-parity-reconciliation.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Run `gen-parity-manifest.ps1 --check` to detect any web-side change since each platform's
acceptance gate; for every drift, either re-run the affected page prompt or open a tracked
exception in `reconciliation-report.md` with explicit owner/rationale; finally re-assert every
ledger reaches 100%. No hardening work begins until this passes.

## Spec

- Re-emit the parity manifest from current `web/src`; diff against the version frozen at each
  platform's acceptance gate. Any page added/removed/modified post-freeze is "drift".
- For each drift: regenerate the affected page prompts; if the platform team accepts the change
  it is re-implemented; if deferred, an exception entry is written (date, owner, ticket id).
- Re-validate the placeholder gate over every `apps/<platform>` tree.
- Recount per-platform `PARITY_COVERED` from logs and write final ledgers.

## Implementation steps

1. `gen-parity-manifest.ps1 --check`; capture drift list in the log.
2. Per drift: rerun the page prompt or add to the exception register.
3. Placeholder scan over every platform tree.
4. Write `reconciliation-report.md` (drift list + resolutions + exceptions) and updated ledgers.

## Gate

```powershell
& ./apps/tools/gen-parity-manifest.ps1 -Check 2>&1 | Tee-Object $log -Append; "DRIFT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
foreach($p in 'windows','android','apple'){ & ./apps/tools/check-placeholders.ps1 -Path "apps/$p" *>$null; "PH_${p}_EXIT=$LASTEXITCODE" | Tee-Object $log -Append }
node ./apps/tools/verify-ledgers.mjs 2>&1 | Tee-Object $log -Append; "LEDGER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if DRIFT=0, every PH_*=0, LEDGER=0 (every shipped platform reaches 100% covered)
```

## Acceptance Criteria

- [ ] Manifest drift list empty OR every entry has a resolution/exception with owner.
- [ ] Placeholder gates clean on every shipped platform tree.
- [ ] Every shipped platform ledger 100% covered.
- [ ] `reconciliation-report.md` committed.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

New features; backend changes; perf/a11y/l10n work (later H-phases).

## Commit

```powershell
git add apps/parity .github/prompts/monorepo/logs/p5-h0-0001-parity-reconciliation.log
git commit -m "chore(parity): hardening entry — reconcile ledgers, close drift (P5/H0)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
