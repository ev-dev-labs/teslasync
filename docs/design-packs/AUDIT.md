# Design packs: baseline audit

Baseline: `feature/app-design-themes` at `3cdc0c198d`. This is a source audit,
not a completed visual review. Scores and viewport-specific defects belong in
the individual review files after screenshots have actually been inspected.

## How the packs work

- `web/src/features/dashboard/widgets/designPacks/types.ts` owns the 27 stable
  IDs, including the seven historical `v1`-`v7` IDs and their aliases.
- `manifest.ts` supplies the settings labels and filters. Widget presentations
  and application-wide styling share the selection but have separate renderers.
- `useWidgetDesignPack` verifies the server and identity before reading the
  server-stored preference. `AppDesignBridge` applies the complete profile only
  when the verified preference opts into the whole application.
- `app-designs/designs.ts` chooses navigation, header, content, control, data,
  chart, map and feedback compositions. Category styles then combine with one
  of 27 pack stylesheets. Owner attributes keep nested previews and portals
  isolated.
- `ThemeProvider`, `FontProvider`, density settings and chart preferences remain
  the authorities for user-selected color, type and sizing. Shared primitives
  such as Card, GlassPanel, DataTable and ChartContainer consume those roles.

## Problems to address

1. The profiles are mostly composition switches, not complete presentation
   token sets. They reuse the same user-selected color, font and density
   values, while many pack-specific rules repeat similar treatments. For
   example, Classic and Ambient both use a four-percent accent wash and an
   eleven-percent selected-navigation tint. Their identity can therefore be
   difficult to distinguish without examining individual components.
2. There is no single pack-level source for typography, surface hierarchy,
   spacing, shape, motion, chart and Helix treatments. The 27 pack sheets
   repeat selectors and contain about 538 KB of CSS; related treatments can
   drift independently. Empty title rules in the Classic and Ambient sheets
   illustrate that pack-specific hierarchy is not consistently expressed.
3. Default shared body typography uses `text-sm` (14px at the default scale);
   that is below the requested 16px phone body size. App-owned button, tab and
   navigation rules provide 44px mobile targets, but that selector alone does
   not establish target size for every interactive control.
4. The active palette computes muted-text contrast against base mode surfaces,
   but pack-specific mixed and gradient surfaces still need rendered contrast
   verification. Source inspection alone does not establish a WCAG failure or
   certify the final composed colors.
5. The settings grid displays a live battery-widget thumbnail, not a miniature
   application composition. The full application preview exists only after
   opening a separate dialog, making differences across packs hard to compare.
6. Application styling is installed by a lazy bridge after asynchronous
   identity and preference verification. Until then, the bridge clears the
   profile, so an unstyled-to-styled transition is possible and must be
   measured on a real reload rather than assumed fixed.
7. Existing documentation screenshots cover six desktop routes. The existing
   pack acceptance suite produces selective test artifacts, not the requested
   persistent, per-pack page and viewport matrix. Neither is evidence that all
   pages are polished or that phone layouts have no overflow.

The shared mobile grid, safe-area-aware bottom navigation, original vehicle
images, and Digital Twin presentations are existing assets to preserve rather
than replace.

## Baseline checks

`cd web; npx tsc --noEmit` exited 0 with no output.

The existing `.github/skills/audit-violations/audit.sh` exited 0:

```text
▸ [1/7] Static inline styles (var(--*))...
  ✅ 0 violations
▸ [2/7] Raw HTML elements...
  ✅ 0 violations
▸ [3/7] Direct library imports...
  ✅ 0 violations
▸ [4/7] Old API imports...
  ✅ 0 violations
▸ [5/7] Double /api/v1/ prefix...
  ✅ 0 violations
▸ [6/7] camelCase query params (vehicleId=)...
  ✅ 0 violations
▸ [7/7] TypeScript compilation...
  ✅ TypeScript passes
  ✅ ALL CHECKS PASSED — 0 total violations
```

`cd web; npm run build` exited 0. Its final checks included:

```text
[bundle-size] OK (transitive startup ≤ 400 KB, vendor ≤ 140 KB, route ≤ 100 KB, locale ≤ 67 KB, per-namespace locale fallback ≤ 20 KB)
[pwa-precache] OK — route chunks remain on-demand
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
```

These are baseline results, not approval of any redesigned pack.
