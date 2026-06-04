---
description: "P2-WINDOWS W7 — system/StateMachineDebuggerPage at web parity (WinUI 3 / Fluent)"
---

# p2-windows · W7 · page:system/StateMachineDebuggerPage — WinUI 3 / Fluent

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** windows
> Native WinUI 3 / Fluent implementation of the web page `StateMachineDebuggerPage` at full panel/state/string parity.
> If no .NET/Windows runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:system/StateMachineDebuggerPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/system/pages/StateMachineDebuggerPage.tsx` (952 LOC) |
| Output | `apps/windows/TeslaSync/Features/System/StateMachineDebuggerPage.xaml` (+ view-model) |
| Allowed files | `apps/windows/TeslaSync/Features/System/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/windows-page-system-StateMachineDebuggerPage.log` |

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
  - `useSelectedVehicle`
  - `useSearchParams`
  - `useTimezone`
  - `useRangeState`
  - `useMemo`
  - `useState`
  - `useVehicleStateMachine`
  - `useFSMStats`
  - `useFSMTransitions`
  - `useCallback`
  - `useSignalSnapshot`
  - `useEffect`
  - `useDateFormat`

**Delegated feature components — open these too and port their panels:**
  - `<StateBadge />` → `web/src/features/system/components/StateBadge.tsx` — titles: _(no titled panels in the delegate either)_
  - `<FSMStateDiagram />` → `web/src/features/system/components/FSMStateDiagram.tsx` — titles: `State Diagram`
  - `<FSMHealthPanel />` → `web/src/features/system/components/FSMHealthPanel.tsx` — titles: `FSM Health`
  - `<FSMTimelineChart />` → `web/src/features/system/components/FSMTimelineChart.tsx` — titles: `fsm.timelineChart`
  - `<FSMSubFSMPanel />` → `web/src/features/system/components/FSMSubFSMPanel.tsx` — titles: `Active Sub-FSMs`
  - `<StateTimeline />` → `web/src/features/system/components/state-machine/StateTimeline.tsx` — titles: _(no titled panels in the delegate either)_
  - `<LiveControls />` → `web/src/features/system/components/state-machine/LiveControls.tsx` — titles: `5 min`, `10 min`, `30 min`, `2 h`
  - `<SnapshotInspector />` → `web/src/features/system/components/state-machine/SnapshotInspector.tsx` — titles: `Transition snapshot`, `Signals at transition`

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - `PieChart`
  - `AreaChart`
  - _(no map)_

**Named panels/sections — implement every one (23 title(s) extracted from page + delegates):**

  1. fsm.distributionByState
  2. Vehicle Live State
  3. Transition Counts
  4. Transition Log
  5. Transition Detail
  6. Vehicle
  7. 25
  8. 50
  9. 100
  10. fsm.col.state
  11. fsm.col.count
  12. State
  13. Count
  14. State Diagram
  15. FSM Health
  16. fsm.timelineChart
  17. Active Sub-FSMs
  18. 5 min
  19. 10 min
  20. 30 min
  21. 2 h
  22. Transition snapshot
  23. Signals at transition

> If the count of extracted titles is less than the total region count in the web source,
> the difference is anonymous `<GlassPanel>` regions (containers grouping content with a sibling heading
> or none). Open the web source AND every delegated component listed above and reproduce **every** region
> in the same data + grouping + order.

**States (for EACH data source):** loading → native skeleton/redacted; empty → EmptyState/ContentUnavailable; error → error + Retry. Never blank.

**Strings:** Every visible string resolves from the platform string catalog — zero hardcoded literals. Source the i18n keys used by the web page (and its delegated components) and port the same key names.

`PARITY_REQUIRED=6` (named sections + charts + map + data-source states). The `=== PARITY ===`
log section must enumerate each with binding evidence and reach `PARITY_COVERED=6`.

## Implementation spec (Microsoft Fluent Design + WinUI guidelines)

- Build a view-model that consumes a generated C# client + C# behavior port (ADR-004), bound via an ObservableObject ViewModel; expose typed state + `load()`/`refresh()` and (if any live hook above) an SSE subscription tied to the view lifecycle with >2 min staleness indication (ADR-013).
- Lay out every panel above using XAML + C# and the design tokens (no hardcoded colors/typography; Microsoft Fluent Design + WinUI guidelines).
- Implement loading/empty/error for each source; honor dark mode, theme resources, pointer + keyboard, and accessibility (labels/traits on panels + charts, ≥ touch target sizes) per ADR-015.
- Units/formatting MUST use the shared SI converters (P1/S5) at the display boundary — never store/compute non-SI.

## Gate

```powershell
# Build + test + lint + placeholder-scan for windows; EXIT=0 only if all pass AND PARITY_COVERED==PARITY_REQUIRED.
& ./apps/tools/check-placeholders.ps1 -Path apps/windows/TeslaSync/Features/System -Language csharp *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p2-windows/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 6 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `windows` ledger row for `page:system/StateMachineDebuggerPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/windows/TeslaSync/Features/System apps/parity/windows-ledger.json .github/prompts/monorepo/logs/windows-page-system-StateMachineDebuggerPage.log
git commit -m "feat(apps/windows): StateMachineDebuggerPage at web parity (W7 system)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
