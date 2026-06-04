---
description: "P4/feature-views/0192 — Feature view: AlertStudioPage"
---

# P4 · Feature view · 0192 — `AlertStudioPage` (Apple)

> **Severity:** Per-surface parity · **Delegation:** FORBIDDEN
> **Capability:** requires SwiftUI + Swift Charts + MapKit, iOS 18 / iPadOS 18 / macOS 15 HIG. If unavailable on the runner → STATUS=BLOCKED with API evidence.
> **Web source:** `features/notifications/pages/AlertStudioPage.tsx` — this is THE specification; native must reproduce its data, composition, states, and i18n keys.

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Artifact Metadata

| Field | Value |
|---|---|
| Tier | Feature view (composed feature component below page level) |
| Web source | `features/notifications/pages/AlertStudioPage.tsx` |
| Native output | `apps/apple/TeslaSync/feature-views/AlertStudioPage.* ` |
| Allowed files | `apps/apple/TeslaSync/feature-views/AlertStudioPage.*`, the log file |
| Depends on | P4 core (theme, nav, live, cache, state-holders), P1/S8 state holders, P1/S9 tokens, P1/S10 i18n |
| Blocks | P4 acceptance gate |
| ADR refs | ADR-002, ADR-004, ADR-009 |
| Log | `../logs/p4-apple-feature-views-0192-AlertStudioPage.log` |

## Single Goal

Ship a production-polished, native Apple-idiomatic version of `AlertStudioPage` at parity with the web source. No stubs, no placeholder, no skeleton-only.

## Data sources (from web source — bind via shared P1/S8 state holders)

- `useNotifications`
- `useVehicles`
- `useTranslation`
- `usePageTitle`
- `useAlertRules`
- `useNotificationChannels`
- `useSaveAlertRule`
- `useDeleteAlertRule`
- `useToggleAlertRule`
- `useTestAlertRule`
- `useSnoozeAlertRule`
- `useConfirm`
- `useSelectedVehicle`
- `useBulkEnableRules`
- `useBulkDisableRules`
- `useUrlString`
- `useDirtyForm`
- `useNavigationGuard`
- `useAlertMetrics`

## Shared components used (from web source — must map to native counterparts)

- `@/components/ui`
- `@/components/data-display`
- `@/components/layout`
- `@/components/motion`
- `@/components/feedback`
- `@/components/forms`
- `@/components/ai/AINLAlertBuilder`
- `@/components/ai/AIAlertTuningSuggestions`
- `@/components/ai/AICrossRuleConflictDetection`

## Charts / maps used (from web source — native chart + map per Apple guidelines)

- _(none)_

> Map: web Recharts → Swift Charts.
> Map: web Leaflet → MapKit.

## Titles / labels / i18n keys extracted from source

- `Choose a signal`
- `No templates found`
- `No alert rules yet`
- `No matching rules`
- `Fires once until condition resets`
- `Delete rule`
- `Please fix the highlighted fields and try again.`
- `No external channels configured`
- `Alert Studio`
- `Create custom rules from Fleet Telemetry signals`
- `Untitled`
- `You have an unsaved alert rule.`
- `Unsaved changes`
- `You have unsaved changes. Discard them?`
- `Discard`
- `Keep editing`
- `Enable`
- `Disable`
- `1 rule`
- `{{count}} rules`
- `Info`
- `Warning`
- `Critical`
- `Enabled`
- `Disabled`
- `— Choose one —`
- `Re-alert until resolved`
- `Notify on event`
- `Numeric`
- `Text`
- `Boolean`
- `Custom`
- `{{name}} - {{type}} - {{category}}`
- `{{name}} - {{type}} - Custom`
- `True`
- `False`
- `Test notification from Alert Studio`
- `Minimum Value`
- `Maximum Value`
- `Text Value`
- `Value to compare`
- `Boolean Value`
- `This rule fires whenever the selected signal changes.`
- `Numeric Value`
- `Templates`
- `New Rule`
- `Rule Templates - {{count}} pre-built rules`
- `Search templates...`
- `All`
- `Use`
- `No templates match your search`
- `Rules`
- `Search rules...`
- `Create your first rule or pick a template above.`
- `No rules match `
- `alert rule`
- `alert rules`
- `Select rule {{name}}`
- `Once`
- `Snoozed until {{time}}`
- `Manage snooze`
- `Snooze`
- `Disable rule`
- `Enable rule`
- `Delete rule?`
- `Delete `
- `Delete`
- `Cancel`
- `Edit Rule`
- `Alert rule`
- `Name`
- `My alert rule`
- `Status`
- `Vehicles`
- `Rule type`
- `Signal threshold`
- `Computed metric`
- `Aggregate metric (cost, kWh, distance) over a time window.`
- `Fires when a raw telemetry signal crosses a threshold.`
- `Signal`
- `Select a telemetry signal`
- `{{type}} signal from {{category}}`
- `Operator`
- `Severity`
- `Allowed Operators`
- `Select a signal to see its operators`
- `Typed Value`
- `Cooldown (minutes)`
- `Alert Behavior`
- `Recommended for `
- `{{alternative}} is also valid — pick whatever fits.`
- `Pick how this alert should behave.`
- `Max alerts before condition resolves`
- `Leave blank for unlimited`
- `Escalate after (minutes)`
- `e.g. 30`
- `Escalated severity`
- `Select severity…`
- `Test Delivery Target`
- `Browser toast notification (real-time via SSE)`
- `Alert history (saved to database)`
- `External channels for test notifications:`
- `Saving...`
- `Update Rule`
- `Create Rule`
- `Test`
- `Reset`
- `Snooze `
- `Currently snoozed until {{time}}`
- `Snooze 1 hour`
- `Snooze 4 hours`
- `Snooze 24 hours`
- `Cancel snooze`

> All listed strings MUST resolve through the P1/S10 i18n facade. No English literals in native code.

## States (every state MUST render — no hidden surfaces)

- `loading` — initial fetch, skeleton chrome
- `empty` — data resolved, no rows / no value → friendly empty state, never a blank box
- `error` — fetch failed → `QueryError` equivalent with retry affordance
- `stale` — query data is older than freshness window → stale chip + auto-refresh
- `offline` — no connectivity → cached value + offline chip
- _(plus any state-specific branches that exist in the web source — read it and reproduce them all)_

## Implementation spec

1. **Read the web source** at `features/notifications/pages/AlertStudioPage.tsx` end-to-end before writing native code. Note every conditional render branch and every `t()` call.
2. **Bind data** via the shared state-holder for each hook listed above (P1/S8). No direct HTTP from the view.
3. **Compose layout** with native primitives per Apple HIG (SwiftUI + Swift Charts + MapKit, iOS 18 / iPadOS 18 / macOS 15 HIG). Do not port web Tailwind classes — use platform tokens (P1/S9).
4. **States**: render every state listed above. Test all branches.
5. **i18n**: every string from P1/S10 keys; no hardcoded English.
6. **Accessibility**: VoiceOver labels, Dynamic Type, reduce-motion respect; iOS 18 / iPadOS 18 / macOS 15 minimums.
7. **Tests**: unit test the data adapter (cached → projection), snapshot test the view in each state, accessibility test for label presence.
8. **Telemetry**: emit a `view.opened` event with the surface slug `AlertStudioPage` per P1/S11 diagnostics contract.

## Out of Scope

- Other surfaces in the same feature (each has its own prompt)
- Backend / API changes
- Atomic shared components (covered by P4 component-library bundle prompt)

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p4-apple-feature-views-0192-AlertStudioPage.log"
"=== P4 Feature view 0192 AlertStudioPage (Apple) ===" | Tee-Object $log
xcodebuild -scheme TeslaSync -destination 'platform=iOS Simulator,name=iPhone 16' build test 2>&1 | Tee-Object $log -Append; "IOS_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
xcodebuild -scheme TeslaSync-macOS build test 2>&1 | Tee-Object $log -Append; "MAC_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftlint --strict 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftformat --lint apps/apple 2>&1 | Tee-Object $log -Append; "FORMAT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/apple/TeslaSync/feature-views/AlertStudioPage *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only when every step above is 0
```

## Acceptance Criteria

- [ ] Surface renders on Apple with all states from the web source reproduced.
- [ ] Hooks bind to the shared P1/S8 state-holder layer; no direct HTTP from the view.
- [ ] Every i18n key from source has a matching key in P1/S10 catalog.
- [ ] Accessibility labels present on every interactive element.
- [ ] Tests: adapter unit test + per-state snapshot/UI test + a11y label test.
- [ ] No `TODO` / `stub` / `mock` / `placeholder` / `Lorem` in shipped code.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` with platform-capability evidence in the log).

## Commit

```powershell
git add apps/apple/TeslaSync/feature-views/AlertStudioPage .github/prompts/monorepo/logs/p4-apple-feature-views-0192-AlertStudioPage.log
git commit -m "feat(apps/apple/feature-views): add AlertStudioPage surface (P4)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
