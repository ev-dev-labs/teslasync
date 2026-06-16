---
description: "P3 parity-fix — LocationsPage to full web parity (WinUI 3)"
---

# P3 - parity-fix - LocationsPage

> **Severity:** Production parity - **Delegation:** FORBIDDEN - **Target:** windows
> The EXISTING Windows page is INCOMPLETE / gutted versus the web version. Do **not**
> rebuild from scratch and do **not** narrow scope. Read BOTH, diff them, and implement
> EVERY missing element so the Windows page reaches full production parity with web.

## Targets
| | |
|---|---|
| Web source (parity target) | `web/src/features/maps` page `web/src/features/maps/pages/LocationsPage.tsx` + ALL its imported sub-components/hooks |
| Web app (compare live) | http://localhost:3000 - navigate to this page |
| Windows page | `apps/windows/TeslaSync.App/feature-views/LocationsPage/` (`LocationsPage.cs` + `.Model`/`.ViewModel`/`.Source`) |
| Build | `dotnet build apps/windows/TeslaSync.sln -c Release` must end 0 errors |

## Mandatory method (do ALL, in order)
1. **Read the web page fully**, following every imported component, hook, and helper it uses.
   Write down EVERY: panel/section, card, chart/graph, stat tile, table, list, filter,
   tab, toggle, button, dialog, badge, and the loading / empty / error / populated states.
2. **Read the current Windows page** (all partial files). List exactly what is MISSING,
   STUBBED, or VISUALLY WRONG versus the web enumeration above.
3. **Implement every gap.** Add the missing panels, charts, cards, stat tiles, tables,
   filters, tabs, dialogs, and the missing states. Match the web's section ORDER and layout.
4. **Card / surface consistency:** use the shared `TsGlassPanel` / `TsCard` /
   `PageContainer` / typography components and `DisplayTokens` brushes. NO ad-hoc colors,
   NO hardcoded hex, NO inconsistent padding. Must render correctly in BOTH light and dark theme.
5. **Data:** bind real data through the page's `Source`/feed to the generated API client
   (snake_case query params; SI->display conversion at the boundary). Never leave a panel
   showing a permanent empty/zero state that the web fills with data.
6. **Strings:** every visible literal resolves through the localizer (en/ar/he resw).

## Forbidden
- Stubs, "coming soon", placeholder panels, `RoutePendingView` as final.
- Scope narrowing, skipping "complex" sections, reducing the page.
- Hardcoded colors / ad-hoc card styling / neon body text.

## Gate (must pass before STATUS=DONE)
```
cd apps/windows ; dotnet build TeslaSync.sln -c Release   # 0 errors
```
- Ensure the page is registered in `Shell/ShellWindow.xaml.cs` (route already in RouteTable.cs).
- Commit only on green. Log ends with `EXIT=<int>` and `STATUS=<DONE|BLOCKED>`.
