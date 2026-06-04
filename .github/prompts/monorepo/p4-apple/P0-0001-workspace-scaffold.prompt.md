---
description: "P4/P0 — Apple (SwiftUI) Xcode workspace scaffold (macOS + iOS targets)"
---

# P4 · P0 · 0001 — Apple Xcode workspace scaffold

> **Severity:** Foundation (blocks all Apple pages) · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode; if the gate can't run → STATUS=BLOCKED.
> The native Apple app shell: a SwiftUI Xcode project with macOS + iOS/iPadOS targets
> consuming the KMP shared core (P1/S3) as `Shared.xcframework`.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/` (Xcode workspace + SwiftUI app) |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P0/0003 (version lock), P0/0001 (apps skeleton), P1/S3 (`Shared.xcframework` assembles) |
| Blocks | every Apple page (P4/P7) + P1..P6 phases |
| ADR refs | ADR-002, ADR-004, ADR-012 |
| Log | `../logs/p4-p0-0001-apple-scaffold.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Stand up a buildable, testable SwiftUI app with **shared macOS + iOS targets** (one app layer,
adaptive), linking `Shared.xcframework`, launching to an empty HIG-native `NavigationStack`
shell on both. The spine, not a stub: builds + tests green on both destinations.

## Spec

- **Stack (version lock, P0/0003):** Swift 6, SwiftUI lifecycle (`@main App`), deployment targets
  per lock. Two targets (`TeslaSync` iOS, `TeslaSync-macOS`) sharing one SwiftUI source group.
- **Shared core:** link `Shared.xcframework` (built by P1/S3 `assembleSharedXCFramework`);
  prove consumption with a test reading the `Platform` seam value.
- **Theme:** apply `apps/design/generated/apple/Tokens.swift` (P2/Apple); light/dark; Dynamic Type.
- **Shell:** `ContentView` → empty `NavigationStack`/`NavigationSplitView` (adaptive) with a
  title; no page content.
- **Quality:** SwiftLint --strict + SwiftFormat --lint clean; one XCTest (core reachable) + one
  XCUITest (app launches) per target.

## Implementation steps

1. Generate the Xcode project (prefer an XcodeGen/Tuist spec checked into `apps/apple/` for
   reproducibility) with the two targets sharing sources.
2. Add the `Shared.xcframework` dependency + a Run Script (or SPM binary target) to locate it.
3. `App` + `ContentView` adaptive empty shell; wire generated tokens.
4. Add XCTest (core value) + XCUITest (launch) for both targets.
5. Run the gate on iOS Simulator + macOS.

## Gate

```powershell
xcodebuild -scheme TeslaSync -destination 'platform=iOS Simulator,name=iPhone 16' build test 2>&1 | Tee-Object $log -Append; "IOS_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
xcodebuild -scheme TeslaSync-macOS build test 2>&1 | Tee-Object $log -Append; "MAC_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftlint --strict 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftformat --lint apps/apple 2>&1 | Tee-Object $log -Append; "FORMAT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/apple -Language swift *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if IOS/MAC/LINT/FORMAT/PLACEHOLDER all 0
```

## Acceptance Criteria

- [ ] iOS + macOS targets build; XCUITest launch + XCTest core-reachable green on both.
- [ ] `Shared.xcframework` linked; generated tokens applied; dark/light + Dynamic Type verified.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; deployment targets per lock.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if no macOS/Xcode runner).

## Out of Scope

Navigation graph, auth, live data, and any page — each is its own later P-phase prompt.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p0-0001-apple-scaffold.log
git commit -m "feat(apps/apple): scaffold SwiftUI app (macOS+iOS) consuming Shared.xcframework (P4/P0)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
