---
description: "P2/W99-0001 — Windows final acceptance gate"
---

# P2 · W99-0001 — Windows acceptance gate

> **Severity:** Acceptance gate · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+, UI automation runner, and MSIX signing capability; if any runner/signing capability is absent, gate must end STATUS=BLOCKED with exact reason.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | Acceptance log and signed MSIX/package artifacts under `apps/windows/**` |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W0-0001 through W9-0002 DONE; all generated W7 page prompts DONE |
| Blocks | P2 Windows release readiness |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-008, ADR-009, ADR-010, ADR-011, ADR-013, ADR-015, ADR-016 |
| Instr refs | P2 README exit criteria; version lock `apps/versions.lock.md`; parity ledger `apps/parity/windows-ledger.json` (read-only) |
| Log | `../logs/p2-w99-0001-windows-acceptance-gate.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Run the final Windows acceptance gate: parity ledger 100%, full build/format/analyzers/tests/UI automation green, no placeholders, generated client/golden vectors in sync, and signed MSIX package produced.

## Spec

- Do not fix code in this prompt. This is a gate prompt: inspect, run, package, and report.
- Verify every predecessor log under `.github/prompts/monorepo/logs/` for Windows shows `STATUS=DONE` and `EXIT=0`; any BLOCKED/missing log blocks W99.
- Read `apps/parity/windows-ledger.json` and require 100% Windows parity: every unit `status=done` and `covered==required`.
- Run full Windows Release build, format verification, analyzers, unit tests, UI automation tests, placeholder scan, golden-vector/conformance tests, and package publish.
- Produce/sign MSIX using configured signing capability. If signing certificate/identity is absent, STATUS=BLOCKED; do not claim package success.
- Verify app manifest/package metadata: identity, protocol activation, notification capabilities, WNS, assets, privacy settings, version.
- Verify no secrets/tokens/PII are present in package artifacts or logs.
- Log raw command output and final `EXIT`/`STATUS` only after all sub-gates complete.

## Implementation steps

1. Log `=== PREFLIGHT ===`; verify clean tree and predecessor logs.
2. Log `=== SURVEY ===`; summarize ledger totals and package/signing environment.
3. Do not edit production files. If drift is discovered, STATUS=BLOCKED and commit only the log.
4. Run every gate command exactly as specified; no filters/subsets except explicit UI category split shown in the gate.
5. Build and sign MSIX; verify package exists and signature validation succeeds.
6. Record `PARITY_COVERED`, `PARITY_REQUIRED`, `MSIX_SIGNED`, and every exit code.
7. Commit only the acceptance log/artifacts allowed by the packaging workflow if DONE; if BLOCKED, commit only the log.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w99-0001-windows-acceptance-gate.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object $log -Append
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { "EXIT=1" | Tee-Object $log -Append; "STATUS=BLOCKED" | Tee-Object $log -Append; return }
$predecessorFailures = Select-String -Path .github/prompts/monorepo/logs/*.log -Pattern '^STATUS=BLOCKED|^EXIT=(?!0$)' -ErrorAction SilentlyContinue
"PREDECESSOR_FAILURES=$(@($predecessorFailures).Count)" | Tee-Object $log -Append
$ledger = Get-Content apps/parity/windows-ledger.json -Raw | ConvertFrom-Json
$rows = @($ledger)
if ($ledger.items) { $rows = @($ledger.items) }
$required = $rows.Count
$covered = @($rows | Where-Object { $_.status -eq 'done' -and $_.covered -eq $_.required }).Count
"PARITY_REQUIRED=$required" | Tee-Object $log -Append
"PARITY_COVERED=$covered" | Tee-Object $log -Append
dotnet build apps/windows/TeslaSync.sln -c Release 2>&1 | Tee-Object $log -Append
$buildExit = $LASTEXITCODE; "BUILD_EXIT=$buildExit" | Tee-Object $log -Append
dotnet format apps/windows/TeslaSync.sln --verify-no-changes 2>&1 | Tee-Object $log -Append
$formatExit = $LASTEXITCODE; "FORMAT_EXIT=$formatExit" | Tee-Object $log -Append
dotnet test apps/windows/TeslaSync.sln -c Release --no-build 2>&1 | Tee-Object $log -Append
$testExit = $LASTEXITCODE; "TEST_EXIT=$testExit" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/windows -Language csharp 2>&1 | Tee-Object $log -Append
$placeholderExit = $LASTEXITCODE; "PLACEHOLDER_EXIT=$placeholderExit" | Tee-Object $log -Append
dotnet publish apps/windows/TeslaSync.App/TeslaSync.App.csproj -c Release 2>&1 | Tee-Object $log -Append
$publishExit = $LASTEXITCODE; "PUBLISH_EXIT=$publishExit" | Tee-Object $log -Append
$msix = Get-ChildItem apps/windows -Recurse -Include *.msix,*.msixbundle,*.appx,*.appxbundle | Select-Object -First 1
"MSIX_FOUND=$([int]($null -ne $msix))" | Tee-Object $log -Append
$signatureStatus = if ($msix) { (Get-AuthenticodeSignature $msix.FullName).Status } else { 'NotFound' }
$msixSigned = [int]($signatureStatus -eq 'Valid')
"MSIX_SIGNATURE_STATUS=$signatureStatus" | Tee-Object $log -Append
"MSIX_SIGNED=$msixSigned" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($testExit -ne 0) -or ($publishExit -ne 0) -or ($placeholderExit -ne 0) -or (@($predecessorFailures).Count -ne 0) -or ($covered -ne $required) -or ($null -eq $msix) -or ($msixSigned -ne 1))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] Every Windows predecessor prompt log shows `EXIT=0` and `STATUS=DONE`.
- [ ] `apps/parity/windows-ledger.json` is 100% complete (`covered==required`, `status=done` for all units).
- [ ] Build, format/analyzers, unit tests, UI automation, golden vectors, placeholder scan, and publish are green.
- [ ] Signed MSIX/MSIX bundle exists and signature validation is logged.
- [ ] No secrets/PII are present in logs or package artifacts.
- [ ] `EXIT=0` / `STATUS=DONE`; otherwise BLOCKED with exact failing sub-gate.

## Out of Scope

- Do not fix code or narrow gates.
- Do not edit the parity ledger in this acceptance prompt.
- Do not create unsigned release claims or bypass UI automation/signing.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w99-0001-windows-acceptance-gate.log
git commit -m "chore(apps/windows): pass Windows acceptance gate (P2/W99-0001)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
