---
description: "P3-ANDROID A7 — settings/SettingsPage at web parity (Compose / Material 3)"
---

# p3-android · A7 · page:settings/SettingsPage — Compose / Material 3

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** android
> Native Compose / Material 3 implementation of the web page `SettingsPage` at full panel/state/string parity.
> If no Android SDK / Gradle runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:settings/SettingsPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/settings/pages/SettingsPage.tsx` (204 LOC) |
| Output | `apps/android/app/src/main/kotlin/com/teslasync/settings/SettingsPage.kt` (@Composable screen + ViewModel) |
| Allowed files | `apps/android/app/src/main/kotlin/com/teslasync/settings/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/android-page-settings-SettingsPage.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Parity unit — implement ALL (extracted from the real web source)

**Data sources / hooks the page (and any delegated component) uses:**
  - `useTranslation`
  - `usePageTitle`
  - `useSettings`
  - `useToast`
  - `useLocation`
  - `useNavigate`
  - `useEditLease`
  - `useEffect`
  - `useSaveSettings`
  - `useNavigationGuard`
  - `useVehicles`
  - `useCarPreferences`
  - `useChartPalette`
  - `useStatusBarPrefs`
  - `useAchievementCelebrationPrefs`
  - `useSidebarStyle`
  - `useSilenceKeyLabel`
  - `useId`
  - `useSectionRows`
  - `useDeniedRows`
  - `useResetSection`
  - `useResetAllSettings`

**Delegated feature components — open these too and port their panels:**
  - `<GeneralSettings />` → `web/src/features/settings/components/GeneralSettings.tsx` — titles: `Application`, `Car uses`, `app.kilometers`, `app.miles`, `app.celsius`, `app.fahrenheit`, `app.bar`, `app.psi`, `app.rated`, `app.ideal`, `English`, `Deutsch`, `Français`, `Español`, `中文`, `USD ($)`, `EUR (€)`, `GBP (£)`, `CAD (C$)`, `AUD (A$)`, `JPY (¥)`, `CNY (元)`, `CHF (CHF)`, `SEK / NOK / DKK (kr)`, `INR (₹)`, `app.tzVehicle`, `app.tzUser`, `app.tzUtc`, `app.perGallon`, `app.perLiter`, `Kilometers`, `Miles`, `Celsius`, `Fahrenheit`, `Bar`, `PSI`, `Rated`, `Ideal`, `My local time`, `UTC`
  - `<AppearanceSettings />` → `web/src/features/settings/components/AppearanceSettings.tsx` — titles: `Appearance`, `Information density`, `Preview`, `Sidebar style`, `Default time format`, `Chart palette`, `Status bar`, `Show status bar`, `Celebration`, `Show celebration toasts`, `Play sound on unlock`, `Show recently unlocked on dashboard`, `Send push notifications for achievements`, `Product tours`, `theme.chartPalette.cbSafe`, `theme.chartPalette.neon`, `theme.timeFormat.relative`, `theme.timeFormat.absolute`, `theme.density.compact`, `theme.density.comfortable`, `theme.density.spacious`, `theme.sidebarStyle.linear`, `theme.sidebarStyle.notion`, `theme.sidebarStyle.legacy`, `Color-blind safe`, `Stylistic neon`, `Relative (2h ago)`, `Absolute (Nov 12, 13:42)`, `Compact`, `Comfortable`, `Spacious`, `Minimal`, `Classic`
  - `<AdvancedSettings />` → `web/src/features/settings/components/AdvancedSettings.tsx` — titles: `Confirmation prompts`
  - `<SettingsSearch />` → `web/src/features/settings/components/SettingsSearch.tsx` — titles: _(no titled panels in the delegate either)_
  - `<ResetSection />` → `web/src/features/settings/components/ResetSection.tsx` — titles: `t(`, `Reset to defaults`, `Sections that aren’t user-resettable`, `Danger zone`, `settingsReset.section.general.title`, `settingsReset.section.appearance.title`, `settingsReset.section.alertRules.title`, `settingsReset.section.geofences.title`, `settingsReset.section.notificationChannels.title`, `settingsReset.section.dashboardLayout.title`, `settingsReset.section.automations.title`, `settingsReset.section.quietHours.title`, `settingsReset.denied.tariffs.title`, `settingsReset.denied.soundPrefs.title`

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - _(no charts)_
  - _(no map)_

**Named panels/sections — implement every one (91 title(s) extracted from page + delegates):**

  1. Data Export
  2. Onboarding Tour
  3. Setup Checklist
  4. Application
  5. Car uses
  6. app.kilometers
  7. app.miles
  8. app.celsius
  9. app.fahrenheit
  10. app.bar
  11. app.psi
  12. app.rated
  13. app.ideal
  14. English
  15. Deutsch
  16. Français
  17. Español
  18. 中文
  19. USD ($)
  20. EUR (€)
  21. GBP (£)
  22. CAD (C$)
  23. AUD (A$)
  24. JPY (¥)
  25. CNY (元)
  26. CHF (CHF)
  27. SEK / NOK / DKK (kr)
  28. INR (₹)
  29. app.tzVehicle
  30. app.tzUser
  31. app.tzUtc
  32. app.perGallon
  33. app.perLiter
  34. Kilometers
  35. Miles
  36. Celsius
  37. Fahrenheit
  38. Bar
  39. PSI
  40. Rated
  41. Ideal
  42. My local time
  43. UTC
  44. Appearance
  45. Information density
  46. Preview
  47. Sidebar style
  48. Default time format
  49. Chart palette
  50. Status bar
  51. Show status bar
  52. Celebration
  53. Show celebration toasts
  54. Play sound on unlock
  55. Show recently unlocked on dashboard
  56. Send push notifications for achievements
  57. Product tours
  58. theme.chartPalette.cbSafe
  59. theme.chartPalette.neon
  60. theme.timeFormat.relative
  61. theme.timeFormat.absolute
  62. theme.density.compact
  63. theme.density.comfortable
  64. theme.density.spacious
  65. theme.sidebarStyle.linear
  66. theme.sidebarStyle.notion
  67. theme.sidebarStyle.legacy
  68. Color-blind safe
  69. Stylistic neon
  70. Relative (2h ago)
  71. Absolute (Nov 12, 13:42)
  72. Compact
  73. Comfortable
  74. Spacious
  75. Minimal
  76. Classic
  77. Confirmation prompts
  78. t(
  79. Reset to defaults
  80. Sections that aren’t user-resettable
  81. Danger zone
  82. settingsReset.section.general.title
  83. settingsReset.section.appearance.title
  84. settingsReset.section.alertRules.title
  85. settingsReset.section.geofences.title
  86. settingsReset.section.notificationChannels.title
  87. settingsReset.section.dashboardLayout.title
  88. settingsReset.section.automations.title
  89. settingsReset.section.quietHours.title
  90. settingsReset.denied.tariffs.title
  91. settingsReset.denied.soundPrefs.title

> If the count of extracted titles is less than the total region count in the web source,
> the difference is anonymous `<GlassPanel>` regions (containers grouping content with a sibling heading
> or none). Open the web source AND every delegated component listed above and reproduce **every** region
> in the same data + grouping + order.

**States (for EACH data source):** loading → native skeleton/redacted; empty → EmptyState/ContentUnavailable; error → error + Retry. Never blank.

**Strings:** Every visible string resolves from the platform string catalog — zero hardcoded literals. Source the i18n keys used by the web page (and its delegated components) and port the same key names.

`PARITY_REQUIRED=5` (named sections + charts + map + data-source states). The `=== PARITY ===`
log section must enumerate each with binding evidence and reach `PARITY_COVERED=5`.

## Implementation spec (Google Material 3 + Android UX guidelines)

- Build a view-model that consumes a Kotlin Multiplatform shared client (KMP) + behavior port (ADR-004), bound via a Hilt-scoped ViewModel exposing StateFlow; expose typed state + `load()`/`refresh()` and (if any live hook above) an SSE subscription tied to the view lifecycle with >2 min staleness indication (ADR-013).
- Lay out every panel above using Jetpack Compose @Composable and the design tokens (no hardcoded colors/typography; Google Material 3 + Android UX guidelines).
- Implement loading/empty/error for each source; honor dark mode, theme resources, pointer + keyboard, and accessibility (labels/traits on panels + charts, ≥ touch target sizes) per ADR-015.
- Units/formatting MUST use the shared SI converters (P1/S5) at the display boundary — never store/compute non-SI.

## Gate

```powershell
# Build + test + lint + placeholder-scan for android; EXIT=0 only if all pass AND PARITY_COVERED==PARITY_REQUIRED.
& ./apps/tools/check-placeholders.ps1 -Path apps/android/app/src/main/kotlin/com/teslasync/settings -Language kotlin *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p3-android/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 5 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `android` ledger row for `page:settings/SettingsPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/android/app/src/main/kotlin/com/teslasync/settings apps/parity/android-ledger.json .github/prompts/monorepo/logs/android-page-settings-SettingsPage.log
git commit -m "feat(apps/android): SettingsPage at web parity (A7 settings)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
