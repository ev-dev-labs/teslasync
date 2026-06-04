---
description: "P2/W2-0004 — WinUI feedback and forms components"
---

# P2 · W2-0004 — Feedback, state, and forms components

> **Severity:** Foundational component library · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+; if no runner exists, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/TeslaSync.App/Components/Feedback/**`, `apps/windows/TeslaSync.App/Components/Forms/**` |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W0-0001 DONE, W1-0001 DONE, W2-0001 DONE |
| Blocks | W3 shell, W7 pages, W9 tests |
| ADR refs | ADR-002, ADR-005, ADR-008, ADR-011, ADR-014, ADR-015 |
| Instr refs | version lock `apps/versions.lock.md`; web sources `web/src/components/feedback/`, `web/src/components/forms/` |
| Log | `../logs/p2-w2-0004-feedback-forms-components.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Implement complete native feedback/state and form components so every page can render loading, empty, error, banners, validation, filtering, and vehicle selection without placeholders.

## Spec

Feedback components:
- `TsSpinner`, `TsSkeleton`, `TsChartSkeleton`, `TsStatSkeleton`, `TsPageHeaderSkeleton`, `TsStatGridSkeleton`, `TsChartBlockSkeleton`, `TsTableSkeleton`, `TsPageLoader`, `TsPageLoadSkeleton`, `TsTopProgress`.
- `TsEmptyState`, `TsErrorDisplay`, `TsQueryError`, `TsErrorBoundary`, `TsSectionErrorBoundary`, `TsPageErrorBoundary`.
- `TsAlertBanner`, `TsInlineCallout`, `TsDraftRecoveryBanner`, `TsDraftRestorePrompt`, `TsOfflineBanner`, `TsLiveStaleDataBanner`, `TsTeslaReauthBanner`, `TsRateLimitBanner`, `TsMaintenanceBanner`, `TsImpersonationBanner`, `TsBrowserCompatBanner`, `TsTimeMachineBanner`, `TsEditConflictBanner`, `TsCookieConsentBanner`.
- `TsRequiresAuth`, `TsKeyboardShortcutsDialog`, `TsTourOverlay`, `TsJobProgressDrawer`, `TsAchievementToastStack`, `TsChangelogDialog`, `TsSkipToContent`.
Forms components:
- `TsFormSection`, `TsFormField`, `TsSearchInput`, `TsCombobox`, `TsComboboxMulti`, `TsCurrencyInput`, `TsUnitInput`, `TsTagInput`, `TsTreeSelect`.
- `TsDateRangeFilter`, `TsRangePicker`, `TsDatePresetChips`, `TsActiveFilterChips`, `TsFilterBar`, `TsPillFilterBar`.
- `TsVehicleSelect`, `TsVehicleMultiSelect` bound to repository data with loading/empty/error states.

## Implementation steps

1. Verify predecessors W0/W1/W2-0001 are DONE.
2. Survey web feedback/forms barrels and current Windows localization resources.
3. Implement feedback controls with localized strings, retry commands, and AutomationProperties live-region announcements for state changes.
4. Implement forms with validation states, keyboard navigation, focus scopes, and MVVM command binding.
5. Ensure auth-related banners never expose tokens/PII and integrate with W4 auth state once available via interfaces.
6. Add tests for loading/empty/error/retry, validation, and vehicle-select repository states.
7. Run the gate and log component counts.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w2-0004-feedback-forms-components.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object $log -Append
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { "EXIT=1" | Tee-Object $log -Append; "STATUS=BLOCKED" | Tee-Object $log -Append; return }
dotnet build apps/windows/TeslaSync.sln -c Release 2>&1 | Tee-Object $log -Append
$buildExit = $LASTEXITCODE; "BUILD_EXIT=$buildExit" | Tee-Object $log -Append
dotnet format apps/windows/TeslaSync.sln --verify-no-changes 2>&1 | Tee-Object $log -Append
$formatExit = $LASTEXITCODE; "FORMAT_EXIT=$formatExit" | Tee-Object $log -Append
dotnet test apps/windows/TeslaSync.sln -c Release --no-build 2>&1 | Tee-Object $log -Append
$testExit = $LASTEXITCODE; "TEST_EXIT=$testExit" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/windows -Language csharp 2>&1 | Tee-Object $log -Append
$placeholderExit = $LASTEXITCODE; "PLACEHOLDER_EXIT=$placeholderExit" | Tee-Object $log -Append
$required = @('TsSpinner','TsSkeleton','TsEmptyState','TsErrorDisplay','TsAlertBanner','TsFormSection','TsDateRangeFilter','TsVehicleSelect','TsCombobox','TsFilterBar')
$all = Get-ChildItem apps/windows -Recurse -Include *.cs,*.xaml | Select-String -Pattern ($required -join '|')
$missing = @($required | Where-Object { $all -notmatch $_ })
"MISSING_FEEDBACK_FORM_COMPONENTS=$($missing.Count)" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($testExit -ne 0) -or ($placeholderExit -ne 0) -or ($missing.Count -ne 0))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] Every listed feedback and forms component exists and is native WinUI.
- [ ] Loading, empty, error, retry, validation, and auth-required states are real and localized.
- [ ] Keyboard, focus, Narrator, high-contrast, and reduced-motion behavior are implemented.
- [ ] Vehicle selectors bind to repository interfaces, not static sample data.
- [ ] Build, format, test, placeholder, and inventory gates are green.

## Out of Scope

- No page-specific form logic.
- No token/PII logging.
- No placeholder banners or mock-only vehicle lists.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w2-0004-feedback-forms-components.log
git commit -m "feat(apps/windows): add feedback and forms components (P2/W2-0004)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
