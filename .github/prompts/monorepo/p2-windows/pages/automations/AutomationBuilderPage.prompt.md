---
description: "P2-WINDOWS W7 — automations/AutomationBuilderPage at web parity (WinUI 3 / Fluent)"
---

# p2-windows · W7 · page:automations/AutomationBuilderPage — WinUI 3 / Fluent

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** windows
> Native WinUI 3 / Fluent implementation of the web page `AutomationBuilderPage` at full panel/state/string parity.
> If no .NET/Windows runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:automations/AutomationBuilderPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/automations/pages/AutomationBuilderPage.tsx` (837 LOC) |
| Output | `apps/windows/TeslaSync/Features/Automations/AutomationBuilderPage.xaml` (+ view-model) |
| Allowed files | `apps/windows/TeslaSync/Features/Automations/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/windows-page-automations-AutomationBuilderPage.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Parity unit — implement ALL (extracted from the real web source)

**Data sources / hooks the page (and any delegated component) uses:**
  - `useTranslation`
  - `useNavigate`
  - `useSearchParams`
  - `useEditLease`
  - `useSelectedVehicle`
  - `usePageTitle`
  - `useAutomation`
  - `useVehicles`
  - `useNotificationChannels`
  - `useAutomationPreset`
  - `useCreateAutomationFull`
  - `useUpdateAutomationFull`
  - `useTestRunAutomation`
  - `useState`
  - `useRef`
  - `useEffect`
  - `useDirtyForm`
  - `useNavigationGuard`
  - `useConfirm`
  - `useMemo`
  - `useCallback`
  - `useGeofences`

**Delegated feature components — open these too and port their panels:**
  - `<TriggerConfigurator />` → `web/src/features/automations/pages/TriggerConfigurator.tsx` — titles: `Days`, `common.true`, `common.false`, `Select geofence...`, `True`, `False`
  - `<ConditionBuilder />` → `web/src/features/automations/pages/ConditionBuilder.tsx` — titles: `Days`, `common.true`, `common.false`, `Select geofence...`, `True`, `False`
  - `<ActionBuilder />` → `web/src/features/automations/pages/ActionBuilder.tsx` — titles: `automations.builder.noChannels`, `automations.builder.valueText`, `automations.builder.valueNumber`, `automations.builder.valueBoolean`, `common.true`, `common.false`, `Select command...`, `No channels configured`, `Text`, `Number`, `Boolean`, `True`, `False`
  - `<ConflictWarnings />` → `web/src/features/automations/pages/ConflictWarnings.tsx` — titles: _(no titled panels in the delegate either)_

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - _(no charts)_
  - _(no map)_

**Named panels/sections — implement every one (21 title(s) extracted from page + delegates):**

  1. automations.builder.general
  2. automations.builder.when
  3. automations.builder.onlyIf
  4. automations.builder.then
  5. All Vehicles
  6. Select trigger type...
  7. Days
  8. common.true
  9. common.false
  10. Select geofence...
  11. True
  12. False
  13. automations.builder.noChannels
  14. automations.builder.valueText
  15. automations.builder.valueNumber
  16. automations.builder.valueBoolean
  17. Select command...
  18. No channels configured
  19. Text
  20. Number
  21. Boolean

> If the count of extracted titles is less than the total region count in the web source,
> the difference is anonymous `<GlassPanel>` regions (containers grouping content with a sibling heading
> or none). Open the web source AND every delegated component listed above and reproduce **every** region
> in the same data + grouping + order.

**States (for EACH data source):** loading → native skeleton/redacted; empty → EmptyState/ContentUnavailable; error → error + Retry. Never blank.

**Strings:** Every visible string resolves from the platform string catalog — zero hardcoded literals. Source the i18n keys used by the web page (and its delegated components) and port the same key names.

`PARITY_REQUIRED=3` (named sections + charts + map + data-source states). The `=== PARITY ===`
log section must enumerate each with binding evidence and reach `PARITY_COVERED=3`.

## Implementation spec (Microsoft Fluent Design + WinUI guidelines)

- Build a view-model that consumes a generated C# client + C# behavior port (ADR-004), bound via an ObservableObject ViewModel; expose typed state + `load()`/`refresh()` and (if any live hook above) an SSE subscription tied to the view lifecycle with >2 min staleness indication (ADR-013).
- Lay out every panel above using XAML + C# and the design tokens (no hardcoded colors/typography; Microsoft Fluent Design + WinUI guidelines).
- Implement loading/empty/error for each source; honor dark mode, theme resources, pointer + keyboard, and accessibility (labels/traits on panels + charts, ≥ touch target sizes) per ADR-015.
- Units/formatting MUST use the shared SI converters (P1/S5) at the display boundary — never store/compute non-SI.

## Gate

```powershell
# Build + test + lint + placeholder-scan for windows; EXIT=0 only if all pass AND PARITY_COVERED==PARITY_REQUIRED.
& ./apps/tools/check-placeholders.ps1 -Path apps/windows/TeslaSync/Features/Automations -Language csharp *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p2-windows/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 3 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `windows` ledger row for `page:automations/AutomationBuilderPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/windows/TeslaSync/Features/Automations apps/parity/windows-ledger.json .github/prompts/monorepo/logs/windows-page-automations-AutomationBuilderPage.log
git commit -m "feat(apps/windows): AutomationBuilderPage at web parity (W7 automations)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
