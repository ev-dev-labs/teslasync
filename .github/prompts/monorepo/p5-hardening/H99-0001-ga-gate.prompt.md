---
description: "P5/H99 — GA acceptance: all platforms shipped at parity; final program close-out"
---

# P5 · H99 · 0001 — GA acceptance gate

> **Severity:** Program gate · **Delegation:** FORBIDDEN
> The final gate of the entire effort. Certifies every shipping platform reached GA at full
> web-parity, post-release stability is healthy, and the program is closed.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/parity/GA.md` (signed-off summary), final program checkpoint |
| Allowed files | `apps/parity/GA.md`, the log file |
| Depends on | P5/H0..H9 all `STATUS=DONE`; 72h watch from H9 complete |
| Blocks | (none — this is the terminal gate) |
| ADR refs | ADR-006, ADR-011 |
| Log | `../logs/p5-h99-0001-ga-gate.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Verify — with evidence, not assertion — that every shipping platform is at GA: parity 100%,
post-release crash-free-rate above threshold, no Critical/High open issues, store listings live,
push verified, runbook on-call active. Write GA.md and close the program.

## Verification (each MUST pass — collect EXITs)

1. Every platform ledger (`apps/parity/{windows,android,apple-macos,apple-ios}-ledger.json`) at 100%.
2. Every H-phase log `STATUS=DONE`.
3. 72h post-release crash-free-rate ≥ 99.5% per platform (from H7 dashboards; link captured in GA.md).
4. Open issue tracker: 0 Critical + 0 High blocking issues across the apps boards.
5. Store status: each platform listing live or in approved release.
6. Push delivery health: smoke notification round-trip green on each platform.

## Gate

```powershell
$fail = 0
node ./apps/tools/verify-ledgers.mjs --strict 2>&1 | Tee-Object $log -Append; if($LASTEXITCODE){$fail=1}
node ./apps/tools/verify-h-logs.mjs 2>&1 | Tee-Object $log -Append; if($LASTEXITCODE){$fail=1}
node ./apps/tools/check-crash-free.mjs --threshold 99.5 2>&1 | Tee-Object $log -Append; if($LASTEXITCODE){$fail=1}
node ./apps/tools/check-issues.mjs --max-critical 0 --max-high 0 2>&1 | Tee-Object $log -Append; if($LASTEXITCODE){$fail=1}
node ./apps/tools/check-store-status.mjs 2>&1 | Tee-Object $log -Append; if($LASTEXITCODE){$fail=1}
foreach($p in 'windows','android','apple'){ & "./apps/$p/push/smoke.ps1" 2>&1 | Tee-Object $log -Append; if($LASTEXITCODE){$fail=1} }
"GA_FAIL=$fail" | Tee-Object $log -Append
# EXIT=0 only if GA_FAIL=0; then write GA.md with evidence links + sign-off.
```

## Acceptance Criteria

- [ ] Every ledger 100%; every H-phase DONE.
- [ ] Crash-free-rate ≥ 99.5% per platform over the 72h window.
- [ ] Zero Critical/High open issues across the apps boards.
- [ ] All store listings live (or in approved release schedule).
- [ ] Push smoke round-trip green on every platform.
- [ ] `GA.md` committed with evidence + named sign-off.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Post-GA feature roadmap; user-facing announcements.

## Commit

```powershell
git add apps/parity/GA.md .github/prompts/monorepo/logs/p5-h99-0001-ga-gate.log
git commit -m "chore(release): GA acceptance gate — program complete (P5/H99)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
