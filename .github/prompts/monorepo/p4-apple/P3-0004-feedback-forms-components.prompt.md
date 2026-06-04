---
description: "P4/P3 — Apple feedback and forms component library"
---

# P4 · P3 · 0004 — Feedback and forms components

> **Severity:** Foundation (blocks Apple pages) · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode; if the gate can't run → STATUS=BLOCKED.
> Implement HIG-native feedback, skeleton/redacted states, banners, auth gates, and forms
> corresponding to web `components/feedback` and `components/forms`.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/TeslaSync/Components/Feedback/`, `apps/apple/TeslaSync/Components/Forms/` |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P4/P3-0001 UI components, P4/P1 shared facade |
| Blocks | every Apple page state implementation; P4/P5 auth; P9 tests |
| ADR refs | ADR-002, ADR-005, ADR-008, ADR-010, ADR-011, ADR-014, ADR-015 |
| Log | `../logs/p4-p3-0004-feedback-forms-components.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Create complete feedback and forms primitives so every Apple page can render loading, empty,
error, stale, offline, auth, filtering, and input states without blanks or page-local controls.

## Spec

Implement concrete components:

- **Feedback/states:** `TSSpinner` (ProgressView), `TSEmptyState` (ContentUnavailableView),
  `TSErrorDisplay`, `TSQueryError`, `TSErrorBoundary`, `TSSectionErrorBoundary`,
  `TSPageErrorBoundary`, `TSSkeleton`/redacted shimmer, `TSChartSkeleton`, `TSStatSkeleton`,
  `TSPageHeaderSkeleton`, `TSStatGridSkeleton`, `TSChartBlockSkeleton`, `TSTableSkeleton`,
  `TSPageLoader`, `TSPageLoadSkeleton`.
- **Banners/drawers/modals:** `TSAlertBanner`, `TSInlineCallout`, `TSDraftRecoveryBanner`,
  `TSDraftRestorePrompt`, `TSOfflineBanner`, `TSLiveStaleDataBanner`, `TSTeslaReauthBanner`,
  `TSRateLimitBanner`, `TSMaintenanceBanner`, `TSImpersonationBanner`, `TSRequiresAuth`,
  `TSGotoIndicator`, `TSKeyboardShortcutsModal`, `TSTourOverlay`, `TSJobProgressDrawer`,
  `TSAchievementUnlockedToast`, `TSChangelogModal`, `TSTopProgress`, `TSSkipToContent`,
  `TSBrowserCompatBanner`, `TSTimeMachineBanner`, `TSEditConflictBanner`, `TSCookieConsentBanner`.
- **Forms:** `TSActiveFilterChips`, `TSCombobox`, `TSComboboxMulti`, `TSCurrencyInput`,
  `TSDatePresetChips`, `TSDateRangeFilter`, `TSRangePicker`, `TSFilterBar`, `TSFormField`,
  `TSFormSection`, `TSPillFilterBar`, `TSSearchInput`, `TSTagInput`, `TSTreeSelect`,
  `TSUnitInput`, `TSVehicleSelect`, `TSVehicleMultiSelect`.
- All visible strings resolve through Apple String Catalogs; input validation is accessible.

## Implementation steps

1. Survey `web/src/components/feedback/index.ts` and `forms/index.ts`; log mappings.
2. Implement feedback components using `ProgressView`, `.redacted`, `ContentUnavailableView`,
   alerts/sheets/popovers, and native validation styling.
3. Implement form controls with keyboard, pointer, VoiceOver, Dynamic Type, and compact-width behavior.
4. Add previews and XCTest coverage for every state: loading, empty, error, stale, offline, auth-required,
   validation error, disabled, and selected/filter states.
5. Run the full Apple gate on iOS Simulator and macOS.

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

- [ ] Every feedback/form export listed above has a native SwiftUI equivalent.
- [ ] Loading/empty/error/stale/offline/auth states are complete and localized.
- [ ] Forms are accessible, validated, keyboard-friendly, and adaptive across macOS+iOS/iPadOS.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS builds/tests green.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if no macOS/Xcode runner).

## Out of Scope

Auth protocol implementation, page-specific validation rules, maps, and charts.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p3-0004-feedback-forms-components.log
git commit -m "feat(apps/apple): add feedback and forms components (P4/P3)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
