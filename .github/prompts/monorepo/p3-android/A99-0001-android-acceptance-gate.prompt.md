---
description: "P3/A99 — Android acceptance gate, parity ledger 100%, signed release AAB"
---

# P3 · A99 · 0001 — Android acceptance gate

> **Severity:** Final gate · **Delegation:** FORBIDDEN
> Run the Android final acceptance gate: parity ledger 100%, all gates green, release AAB assembles and signs, no code fixes inside this prompt unless explicitly part of allowed release metadata.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**` release metadata/signing config verification, acceptance log |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P3/A0..A9 and all generated P3/A7 page prompts |
| Blocks | Android native-app track completion |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-008, ADR-009, ADR-010, ADR-011, ADR-013, ADR-015, ADR-016 |
| Log | `../logs/p3-a99-0001-android-acceptance-gate.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Prove the Android native app is complete and release-buildable: 100% parity ledger, green tests/lint/build, no placeholders, signed AAB produced.

## Spec

This is a gate prompt. Do not implement missing pages or broaden scope to make the gate pass. Verify:
- `apps/parity/android-ledger.json` exists, is valid JSON, and every Android parity unit has `covered == required` and `status == DONE` (or equivalent accepted schema) for 100%.
- All predecessor logs under `.github/prompts/monorepo/logs/` for P3/A0..A9 and generated A7 pages contain `STATUS=DONE`, no nonzero `EXIT=`, and no `STATUS=BLOCKED`.
- Full Android gates are green: unit tests, connected/Compose tests, assemble debug, lint, detekt/ktlint, placeholder scanner.
- Release build produces a signed AAB using configured signing inputs; never print secrets. If signing material is unavailable, BLOCKED with evidence.
- App versioning, manifest permissions, notification channels, deep links/app links, privacy/analytics opt-out, accessibility baseline, and Play release metadata checks are recorded.

## Implementation steps

1. Verify all predecessor logs and the parity ledger before running builds.
2. Run JSON validation and ledger coverage script/PowerShell check; write exact covered/required totals.
3. Run full Android debug/release gates including connected tests and placeholder scanner.
4. Assemble/sign release AAB without leaking secrets; record artifact path and signing verification result.
5. Commit only the acceptance log and any allowed release metadata if all checks pass; otherwise commit only BLOCKED log.

## Gate

```powershell
$ledger = Get-Content apps/parity/android-ledger.json -Raw | ConvertFrom-Json
# Validate 100% according to the ledger schema; write LEDGER_EXIT=0 only when every unit is DONE and covered==required.
$bad = @($ledger.units | Where-Object { $_.status -ne 'DONE' -or $_.covered -ne $_.required })
if ($bad.Count -eq 0) { "LEDGER_EXIT=0" | Tee-Object $log -Append } else { "LEDGER_EXIT=1" | Tee-Object $log -Append; $bad | ConvertTo-Json -Depth 6 | Tee-Object $log -Append }
Push-Location apps/android
./gradlew :android:testDebugUnitTest 2>&1 | Tee-Object $log -Append; "UNIT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:connectedDebugAndroidTest 2>&1 | Tee-Object $log -Append; "ANDROID_TEST_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:assembleDebug :android:lintDebug ktlintCheck detekt 2>&1 | Tee-Object $log -Append; "DEBUG_GATE_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:bundleRelease 2>&1 | Tee-Object $log -Append; "AAB_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
Pop-Location
& ./apps/tools/check-placeholders.ps1 -Path apps/android -Language kotlin *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if LEDGER/UNIT/ANDROID_TEST/DEBUG_GATE/AAB/PLACEHOLDER all 0 and predecessor logs are DONE
```

## Acceptance Criteria

- [ ] Android parity ledger is 100% covered with no BLOCKED/partial units.
- [ ] All predecessor prompt logs are DONE and acceptance log has exact gate output.
- [ ] Unit, connected/Compose UI, assemble, lint, detekt/ktlint, placeholder, and release AAB gates are green.
- [ ] Signed release AAB is produced without printing secrets.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Fixing broken code, implementing missing pages, changing parity requirements, bypassing signing, or modifying backend/shared-core code.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a99-0001-android-acceptance-gate.log
git commit -m "chore(apps/android): pass Android acceptance gate (P3/A99)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
