---
description: "P4/P99 — Apple macOS + iOS acceptance gate"
---

# P4 · P99 · 0001 — Apple acceptance gate

> **Severity:** Acceptance gate · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode, simulators, signing identities, and archive credentials; if the gate can't run → STATUS=BLOCKED.
> Verify Apple native-app acceptance: both parity ledgers at 100%, gates green, and archives sign
> for macOS + iOS/iPadOS.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | Apple acceptance log, signed archives, ledger verification results |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P4/P0..P9 all STATUS=DONE, all generated P7 page prompts DONE |
| Blocks | Native Apple release readiness |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-008, ADR-009, ADR-010, ADR-011, ADR-013, ADR-014, ADR-015, ADR-016 |
| Log | `../logs/p4-p99-0001-apple-acceptance-gate.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Run the non-negotiable Apple acceptance gate without fixing code: prove macOS and iOS/iPadOS
parity ledgers are 100%, all quality gates are green, and signed archives are producible.

## Spec

- **CRITICAL:** Do NOT fix code. Do NOT narrow scope. Do NOT launch agents. Only run the gate,
  record evidence, and commit the log according to DONE/BLOCKED rules.
- **Predecessors:** verify every P4/P0..P9 prompt log and generated P7 page log contains `STATUS=DONE`.
- **Parity:** `apps/parity/apple-macos-ledger.json` and `apps/parity/apple-ios-ledger.json` must both report
  100% coverage; every page/component/platform row covered on both idioms.
- **Build/test/lint:** full iOS Simulator and macOS `xcodebuild build test`; SwiftLint strict;
  SwiftFormat lint; placeholder scanner.
- **Archive/sign:** produce signed iOS/iPadOS archive and macOS archive with locked schemes/configurations;
  notarization/export checks if configured.
- **Evidence:** log exact tool versions, destinations, ledger totals, archive paths, and EXIT/STATUS.

## Implementation steps

1. Create the log with `=== PREFLIGHT ===`, verify predecessor logs, runner capabilities, clean tree,
   Xcode/SwiftLint/SwiftFormat versions, signing identities, and destinations.
2. Verify both Apple ledgers are 100% and record totals.
3. Run iOS Simulator and macOS build/test gates, lint, format, placeholder scan.
4. Run archive/sign commands for iOS/iPadOS and macOS; record archive/export/notarization status.
5. If any command fails or any predecessor/ledger is incomplete, write `EXIT=<nonzero>` and `STATUS=BLOCKED`.
6. If all pass, write `EXIT=0` and `STATUS=DONE` and commit only the acceptance log.

## Gate

```powershell
xcodebuild -scheme TeslaSync -destination 'platform=iOS Simulator,name=iPhone 16' build test 2>&1 | Tee-Object $log -Append; "IOS_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
xcodebuild -scheme TeslaSync-macOS build test 2>&1 | Tee-Object $log -Append; "MAC_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftlint --strict 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftformat --lint apps/apple 2>&1 | Tee-Object $log -Append; "FORMAT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/apple -Language swift *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
& ./apps/tools/check-parity-ledger.ps1 -Path apps/parity/apple-macos-ledger.json -RequiredPercent 100 2>&1 | Tee-Object $log -Append; "MAC_LEDGER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
& ./apps/tools/check-parity-ledger.ps1 -Path apps/parity/apple-ios-ledger.json -RequiredPercent 100 2>&1 | Tee-Object $log -Append; "IOS_LEDGER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
xcodebuild -scheme TeslaSync -destination 'generic/platform=iOS' archive 2>&1 | Tee-Object $log -Append; "IOS_ARCHIVE_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
xcodebuild -scheme TeslaSync-macOS archive 2>&1 | Tee-Object $log -Append; "MAC_ARCHIVE_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if IOS/MAC/LINT/FORMAT/PLACEHOLDER/MAC_LEDGER/IOS_LEDGER/IOS_ARCHIVE/MAC_ARCHIVE all 0
```

## Acceptance Criteria

- [ ] All P4/P0..P9 and P7 predecessor logs show `STATUS=DONE`.
- [ ] `apps/parity/apple-macos-ledger.json` and `apps/parity/apple-ios-ledger.json` are both 100%.
- [ ] iOS Simulator + macOS build/test, SwiftLint, SwiftFormat, and placeholder gates are green.
- [ ] iOS/iPadOS and macOS archives sign successfully; archive paths recorded.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` with exact failing command/capability).

## Out of Scope

Fixing code, creating missing pages/components, modifying parity definitions, or changing signing configuration.

## Commit

```powershell
git add .github/prompts/monorepo/logs/p4-p99-0001-apple-acceptance-gate.log
git commit -m "chore(apps/apple): record Apple acceptance gate (P4/P99)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
