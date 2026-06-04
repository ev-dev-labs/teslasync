---
description: "P3/A2 — Android feedback and forms component libraries"
---

# P3 · A2 · 0004 — Feedback + forms components

> **Severity:** Foundation UI (blocks settings, filters, and stateful pages) · **Delegation:** FORBIDDEN
> Implement native Compose feedback/state surfaces and form controls mirroring `components/feedback` and `components/forms`.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**/components/feedback/**`, `apps/android/**/components/forms/**` |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P3/A1, P3/A2-0001, P3/A2-0003 |
| Blocks | Android page prompts requiring loading/empty/error, banners, filters, selectors, and forms |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-010, ADR-011, ADR-013, ADR-015, ADR-016 |
| Log | `../logs/p3-a2-0004-feedback-forms-components.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Deliver complete Android-native feedback and form primitives so every page can show honest loading/empty/error/offline/auth states and robust filters/forms.

## Spec

Feedback components to implement: `AlertBanner`, `BrowserCompatBanner`→platform compatibility banner, `ChangelogModal`, `CookieConsentBanner`, `DraftRecoveryBanner`, `DraftRestorePrompt`, `EditConflictBanner`, `EmptyState`, `EmptyStateThreshold`, `ErrorBoundary`/page/section boundary equivalents, `ErrorDisplay`, `FeedbackModal`, `GotoIndicator`, `GuardedLink`, `ImpersonationBanner`, `InlineCallout`, `InstallPrompt`→Play install/update prompt wrapper, `JobProgressDrawer`, `KeyboardShortcutsModal`, `LiveStaleDataBanner`, `MaintenanceBanner`, `NavigationGuardProvider`, `NewVersionBanner`, `OfflineBanner`, `OnboardingWizard`, `PageLoadSkeleton`, `PageLoader`, `PageSkeleton`, `QueryError`, `RateLimitBanner`, `ReauthDialog`, `ReleaseNotes`, `ReloadPrompt`, `RequiresAuth`, `SessionExpiredModal`, `SessionExpiringModal`, `Skeleton`/shimmer, `SkipToContent`, `Spinner`, `StatSkeleton`, `SuspenseProgressBoundary` equivalent, `TeslaReauthBanner`, `TimeMachineBanner`, `Toast`, `TopProgress`, `TourOverlay`.
Forms components to implement: `ActiveFilterChips`, `Combobox`, `ComboboxMulti`, `CurrencyInput`, `DatePresetChips`, `DateRangeFilter`, `DensityToggle`, `FilterBar`, `FormField`, `FormSection`, `ListExportMenu`, `PillFilterBar`, `RangePicker`, `SearchInput`, `SortControl`, `TagInput`, `TreeSelect`, `UnitInput`, `VehicleSelect`, `VehicleMultiSelect`.
Use Material 3 `SnackbarHost`, dialogs, sheets, date pickers, text fields, chips, and accessible progress semantics.

## Implementation steps

1. Survey both web categories and record exact component mappings.
2. Implement feedback surfaces with non-blank loading/empty/error/offline/auth/stale states.
3. Implement forms with validation, error text, helper text, focus management, keyboard options, and state hoisting.
4. Add tests/previews for every state family and key inputs/selectors.
5. Run the gate.

## Gate

```powershell
Push-Location apps/android
./gradlew :android:testDebugUnitTest 2>&1 | Tee-Object $log -Append; "UNIT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:assembleDebug 2>&1 | Tee-Object $log -Append; "ASM_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:lintDebug ktlintCheck detekt 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
Pop-Location
& ./apps/tools/check-placeholders.ps1 -Path apps/android -Language kotlin *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if all *_EXIT values are 0 and the placeholder scanner is clean
```

## Acceptance Criteria

- [ ] All feedback and form components listed above exist with native Material 3 behavior.
- [ ] Loading, empty, error, offline, stale, auth, retry, validation, and toast/snackbar paths are real.
- [ ] Tests cover selectors, filters, validation, banners, dialogs, skeletons, and retry callbacks.
- [ ] Gate green; placeholder scanner clean.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Page implementation, auth flow internals, backend notification delivery, and maps/motion components.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a2-0004-feedback-forms-components.log
git commit -m "feat(apps/android): add feedback and forms components (P3/A2)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
