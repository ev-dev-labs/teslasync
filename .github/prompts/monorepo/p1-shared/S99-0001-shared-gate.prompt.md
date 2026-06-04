---
description: "P1/S99 — Shared acceptance gate: freeze contract + core, unlock platforms"
---

# P1 · S99 · 0001 — Shared acceptance gate (contract + core freeze)

> **Severity:** Program gate · **Delegation:** FORBIDDEN
> The single gate that certifies the shared program complete and FREEZES the OpenAPI contract +
> shared core so P2/P3/P4 can build on a stable base. Nothing in P2/P3/P4 may start until this
> logs `STATUS=DONE`.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/parity/shared-ledger.json`, `apps/shared/CONTRACT_FROZEN.md` |
| Allowed files | `apps/parity/**`, `apps/shared/CONTRACT_FROZEN.md`, the log file |
| Depends on | P1/S0..S12 all `STATUS=DONE` |
| Blocks | P2 (Windows), P3 (Android), P4 (Apple) start |
| ADR refs | ADR-003, ADR-004, ADR-006, ADR-010 |
| Log | `../logs/p1-s99-0001-shared-gate.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Verify every shared phase is genuinely DONE (not asserted): parity manifest 100% generated,
OpenAPI conformance green, clients generate clean, KMP core builds + tests + golden vectors pass,
tokens + i18n generate for all three platforms, diagnostics redaction proven. Then record a
`shared-ledger.json` of shipped shared modules and write `CONTRACT_FROZEN.md` (version + hash of
the OpenAPI spec + tokens.json + golden vectors) as the immutable base for platforms.

## Verification (each MUST pass — collect EXITs)

1. `S0` manifest exists + `--check` drift green; `page-units.json` count == routed web pages.
2. `S1` OpenAPI conformance green; `S2` client drift `--check` green.
3. `S3..S8` `:core:allTests` green; coverage floor met (S12).
4. `S5` units golden + any `S8` derivations golden pass.
5. `S9` themes generate + `--check` green; `S10` i18n completeness green.
6. `S11` redaction/consent tests green.
7. No placeholder hits anywhere under `apps/shared`, `apps/design`.

## Gate

```powershell
$fail = 0
Push-Location apps/shared/core; ./gradlew :core:allTests koverVerify 2>&1 | Tee-Object $log -Append; if($LASTEXITCODE){$fail=1}; Pop-Location
& ./apps/tools/codegen/gen-clients.ps1 -Check 2>&1 | Tee-Object $log -Append; if($LASTEXITCODE){$fail=1}
& ./apps/tools/gen-parity-manifest.ps1 -Check 2>&1 | Tee-Object $log -Append; if($LASTEXITCODE){$fail=1}
& ./apps/design/generators/gen-themes.ps1 -Check 2>&1 | Tee-Object $log -Append; if($LASTEXITCODE){$fail=1}
& ./apps/shared/i18n/generators/gen-i18n.ps1 -Check 2>&1 | Tee-Object $log -Append; if($LASTEXITCODE){$fail=1}
& ./apps/tools/check-placeholders.ps1 -Path apps/shared -Language kotlin *>$null; if($LASTEXITCODE){$fail=1}
"GATE_FAIL=$fail" | Tee-Object $log -Append
# EXIT=0 only if GATE_FAIL=0; then write CONTRACT_FROZEN.md with spec/tokens/golden hashes
```

## Acceptance Criteria

- [ ] Every check above green; `shared-ledger.json` lists all shipped shared modules.
- [ ] `CONTRACT_FROZEN.md` records OpenAPI + tokens.json + golden-vector versions/hashes.
- [ ] Any later contract change requires a superseding ADR + coordinated regen (documented).
- [ ] `EXIT=0` / `STATUS=DONE` → P2/P3/P4 unblocked.

## Out of Scope

Any platform UI; backend changes.

## Commit

```powershell
git add apps/parity/shared-ledger.json apps/shared/CONTRACT_FROZEN.md .github/prompts/monorepo/logs/p1-s99-0001-shared-gate.log
git commit -m "chore(apps/shared): shared acceptance gate — freeze contract + core (P1/S99)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
