---
description: "P3 systemic — distinct nav icons per route (WinUI 3)"
---

# P3 - systemic - distinct, semantic nav icons

> **Severity:** Systemic / high-visible - **Delegation:** FORBIDDEN - **Target:** windows
> User complaint: "side nav icons is same for many." Confirmed: ``RouteTable.cs`` has 77 nav
> glyphs but only 37 distinct - e.g. ``\uE945`` is reused by 11 energy/charging routes,
> ``\uE9D9`` by 6 analytics routes, ``\uE7C0`` by 5 driving routes. Give every nav route a
> DISTINCT, semantically-appropriate Segoe Fluent / MDL2 glyph.

## Targets
| | |
|---|---|
| Web source (icon intent) | each route's lucide icon in ``web/src/App.tsx`` / the page's header (e.g. Drives=Route, Charging=Zap, Battery=BatteryCharging, Energy=Activity, Analytics=BarChart3, Map=Map, Settings=Settings) |
| Windows file | ``apps/windows/TeslaSync.App.Core/Navigation/RouteTable.cs`` (the 5th arg of each ``Page(...)`` is the ``"\uXXXX"`` glyph) |
| Glyph reference | Segoe Fluent Icons / Segoe MDL2 Assets - use ONLY valid glyph codepoints |

## Mandatory work
1. For EVERY ``Page(...)`` route, choose a Segoe Fluent glyph that matches the route's meaning and
   the web's lucide icon as closely as possible. Examples: Drives=car/route, Charging=lightning/plug,
   Battery*=battery, Energy*=power, Analytics/Statistics/Mileage=distinct chart glyphs, Maps/Geofences/
   Locations=map/pin variants, Climate=thermometer, Security/Guard/Safety=shield/lock variants,
   Notifications=bell, Settings/DevTools/Maintenance=gear/tools variants, Tesla*=account/car.
2. **No two routes in the same nav group may share a glyph.** Aim for near-zero duplicates overall.
3. Use only VALID Segoe Fluent codepoints (verify against the font - an invalid code renders as a
   blank box, which is worse than a duplicate).
4. Keep route names/paths/groups unchanged - only the glyph (5th arg) changes.

## Gate
``````
cd apps/windows ; dotnet build TeslaSync.sln -c Release   # 0 errors
``````
- After your change, no glyph should be reused more than ~2x across the whole RouteTable.
Log ends with ``EXIT=<int>`` and ``STATUS=<DONE|BLOCKED>``.
