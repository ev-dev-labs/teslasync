# Horizontal navigation decisions

- **Scope**: `APPLICATION_DESIGNS.navigation === 'top'` selects the shared header for Expressive Form (`v6`), Editorial, Bauhaus, Swiss Grid, Deco, and Brutal. Hybrid packs have a vertical section rail and keep it. Widget-only appearances and report/kiosk mode do not activate the header.
- **Priority**: Use persona-ordered sections from the existing navigation registry, including existing auth and vehicle visibility rules. Measure translated labels and the available navigation lane; reserve More only when needed. Account remains reachable through the trailing profile control and through the touch sheet.
- **Content**: Reuse the registry's collection groups, route badges and scoped search; place ungrouped destinations under Pages or Other pages. Pins remain bookmarks: the original group retains its destinations but only one group is rendered at a time. Edit pins uses the same canonical destinations.
- **Interaction**: At 1024px and up with a hover-capable pointer, use the fixed-height two-pane flyout. Both panes scroll only if their content exceeds available height. Below that breakpoint or without hover, use the same groups and pages in a bottom sheet with Back. Keyboard users can move between panes without opening a second popup.
- **Header**: Mount only one banner and one bell for top-nav packs. The notification route indicator and bell share `/notifications/unread-count` via the same query cache; the old alerts preview length is not used for these packs. Preserve the existing command palette, appearance, vehicle and View settings controls.
- **Preservation checks**: Verify the exact navigation source and English catalog changes before reconstructing the older localization checkpoints. Keep the historical hashes, call counts, and translation assertions intact.
- **Browser review**: Exercised Driving in all six packs at 1440px, 1024px, and 390px in both themes. Used synthetic data and captured before/after screenshots for Expressive Form, Editorial, and Swiss Grid.
- **Search styling**: The shared search trigger uses the icon treatment only in horizontal navigation. The labeled trigger retains its regular weight and original forced-colors border so vertical and hybrid visuals do not change.
- **Existing browser checks**: Assert the exact banner name for each pack's navigation mode. Keep the existing route, containment, and layout assertions for every pack.
- **Local pack selection**: Keep the picker disabled when the saved preference cannot be loaded. A web-only Docker update left the older API returning 404 for `/api/v1/settings/widget-design-pack`. Rebuild the API from the same revision and let startup apply additive migrations 257 and 258 to the existing database. Verify the deployed preference route, not just container health: local writes returned 200, and Edge showed the saved pack after reload with both picker controls enabled.
- **Panel styling**: Use the selected pack's overlay surface, display typography, and frame on the section flyout, More menu, and portaled phone sheet. Preserve pack signatures (such as Deco's double rule, Expressive Form's asymmetric corners, and Brutal's hard shadow) through tokens; the panel markup and navigation behavior stay shared.

## Matching navigation orientations

- `Layout` still resolves the primary orientation from `ActiveAppNavigation`.
  The six `top` packs retain the shared two-pane flyout. All remaining packs
  retain Atlas beside the rail. The six `hybrid` packs keep their palette,
  density, and rail width but no longer arrange Atlas in a horizontal strip.
- The full vertical rail shows every eligible section in persona order,
  including Settings, without a desktop **More** button. This replaces the
  768px no-scroll compaction at the user's request. The rail scrolls internally
  with edge fades; the horizontal width-based overflow and phone drill-down
  are unchanged. No secondary owns a second route list.
- Keep the reference layout of rail, section heading, filter, and vertical
  groups. The active application design still supplies the rail and Atlas
  panel styling through their existing tokens and design ownership. Do not
  bring back rail utility icons or empty pin groups from the reference.
- Match production vertical rail density and preserve registry order when
  standalone pages and collections are interleaved. The horizontal flyout
  still gathers standalone pages in one group. Theme and pack tokens apply
  without overriding anyone's appearance, pins, or group preferences.
- Settings thumbnails depict the desktop shell even on a phone. They and the
  interactive preview's desktop layout use the same orientation resolver as
  the live shell: only `top` shows navigation above the content. Iconic
  Showroom, Motorsport, Atlas, Material Play, Kinetic Type, and Memphis Pop
  now preview their rail beside the content. Pack descriptors and saved
  preferences stay unchanged.
- Keep both vertical rail fades tied to the remaining scroll range. A fade
  appears only if there are more sections above or below that edge.
- Rail buttons, icon highlights, and page rows take their corners from the
  app design's navigation token. Keep the vertical layout and do not apply
  app styling in widgets-only mode.
- Horizontal packs use the reference's icon and section title, close
  control, filter, chevrons, and group counts in the shared top-bar flyout.
  Keep the two panes and prefer the active page's group when the section
  opens. The frame, heading, and selected rows use the active pack's tokens.
- Below 1024px both primary orientations open `NavSheet`, with Back between
  sections, groups and pages. Rail quick tabs can open a section directly.
  At 1024–1279px the rail opens Atlas as a modal beside the rail; from 1280px
  Atlas docks beside it. Top-bar priority measurement stays active from 1024px.
- Group filters, pins and badge definitions share the route model. Atlas
  shows Pinned only when the current section has matching pins and opens
  the active route's group on entry without preventing manual collapse.
- The workspace header owns the rail layout's search, notifications,
  appearance, and account shortcut at all widths. The alert list still
  drives suggestions; the inbox badge and bell use the unread-count query.
  The compact rail layout still exposes the same Workspace command bar
  landmark; browser checks no longer expect a second Site header on phones.
- The shared phone sheet uses the selected pack's navigation frame, not its
  generic dialog frame. This preserves the Swiss Grid cap and other pack
  details without changing unrelated dialogs.
- The consolidated header and restored full rail intentionally change the Windows
  shell screenshots. Refresh only existing baselines that the Windows
  comparison flagged; keep the same viewport projects, masks, and thresholds.
