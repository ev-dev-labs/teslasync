---
description: "P4-APPLE P7 — notifications/AlertStudioPage at web parity (SwiftUI / HIG)"
---

# p4-apple · P7 · page:notifications/AlertStudioPage — SwiftUI / HIG

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** apple
> Native SwiftUI / HIG implementation of the web page `AlertStudioPage` at full panel/state/string parity.
> If no Xcode runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:notifications/AlertStudioPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/notifications/pages/AlertStudioPage.tsx` (2343 LOC) |
| Output | `apps/apple/TeslaSync/Features/Notifications/AlertStudioPage.swift` (SwiftUI View + Observable model; adaptive macOS + iOS) |
| Allowed files | `apps/apple/TeslaSync/Features/Notifications/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/apple-page-notifications-AlertStudioPage.log` |

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
  - `useAlertRules`
  - `useNotificationChannels`
  - `useVehicles`
  - `useMemo`
  - `useSaveAlertRule`
  - `useDeleteAlertRule`
  - `useToggleAlertRule`
  - `useTestAlertRule`
  - `useSnoozeAlertRule`
  - `useConfirm`
  - `useSelectedVehicle`
  - `useCallback`
  - `useBulkEnableRules`
  - `useBulkDisableRules`
  - `useState`
  - `useUrlString`
  - `useEffect`
  - `useDirtyForm`
  - `useNavigationGuard`
  - `useAlertMetrics`
  - `usePreviewComputedMetric`
  - `useAlertMessagePlaceholders`
  - `useAlertMessagePresets`
  - `useAlertMessagePreview`

**Delegated feature components — open these too and port their panels:**
  - `<ComputedMetricEditor />` → `web/src/features/notifications/components/ComputedMetricEditor.tsx` — titles: `Live preview`
  - `<AlertMessageEditor />` → `web/src/features/notifications/components/AlertMessageEditor.tsx` — titles: `notifications.alertStudio.editor.presetModalTitle`

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - _(no charts)_
  - _(no map)_

**Named panels/sections — implement every one (32 title(s) extracted from page + delegates):**

  1. pageTitle
  2. notifications.alertStudio.templates.noMatchesTitle
  3. notifications.alertStudio.rules.emptyTitle
  4. notifications.alertStudio.rules.onceModeHint
  5. forms.validationFailed
  6. notifications.alertStudio.channels.emptyTitle
  7. Rules
  8. Allowed Operators
  9. bulk.actions.enable
  10. bulk.actions.disable
  11. notifications.alertStudio.severity.info
  12. notifications.alertStudio.severity.warn
  13. notifications.alertStudio.severity.critical
  14. notifications.alertStudio.editor.enabled
  15. notifications.alertStudio.editor.disabled
  16. notifications.alertStudio.editor.alertBehavior.repeatLabel
  17. notifications.alertStudio.editor.alertBehavior.onceLabel
  18. notifications.alertStudio.boolean.true
  19. notifications.alertStudio.boolean.false
  20. Enable
  21. Disable
  22. Info
  23. Warning
  24. Critical
  25. Enabled
  26. Disabled
  27. Re-alert until resolved
  28. Notify on event
  29. True
  30. False
  31. Live preview
  32. notifications.alertStudio.editor.presetModalTitle

> If the count of extracted titles is less than the total region count in the web source,
> the difference is anonymous `<GlassPanel>` regions (containers grouping content with a sibling heading
> or none). Open the web source AND every delegated component listed above and reproduce **every** region
> in the same data + grouping + order.

**States (for EACH data source):** loading → native skeleton/redacted; empty → EmptyState/ContentUnavailable; error → error + Retry. Never blank.

**Strings:** Every visible string resolves from the platform string catalog — zero hardcoded literals. Source the i18n keys used by the web page (and its delegated components) and port the same key names.

`PARITY_REQUIRED=3` (named sections + charts + map + data-source states). The `=== PARITY ===`
log section must enumerate each with binding evidence and reach `PARITY_COVERED=3`.

## Implementation spec (Apple Human Interface Guidelines (macOS + iOS))

- Build a view-model that consumes a KMP shared client + behavior port (ADR-004), bound via an Observable model and AsyncSequence; expose typed state + `load()`/`refresh()` and (if any live hook above) an SSE subscription tied to the view lifecycle with >2 min staleness indication (ADR-013).
- Lay out every panel above using SwiftUI declarative views and the design tokens (no hardcoded colors/typography; Apple Human Interface Guidelines (macOS + iOS)).
- Implement loading/empty/error for each source; honor dark mode, theme resources, pointer + keyboard, and accessibility (labels/traits on panels + charts, ≥ touch target sizes) per ADR-015.
- Units/formatting MUST use the shared SI converters (P1/S5) at the display boundary — never store/compute non-SI.

## Gate

```powershell
# Build + test + lint + placeholder-scan for apple; EXIT=0 only if all pass AND PARITY_COVERED==PARITY_REQUIRED.
& ./apps/tools/check-placeholders.ps1 -Path apps/apple/TeslaSync/Features/Notifications -Language swift *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p4-apple/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 3 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `apple` ledger row for `page:notifications/AlertStudioPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/apple/TeslaSync/Features/Notifications apps/parity/apple-ledger.json .github/prompts/monorepo/logs/apple-page-notifications-AlertStudioPage.log
git commit -m "feat(apps/apple): AlertStudioPage at web parity (P7 notifications)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
