# Dashboard UX Audit

_Phase 40 / Prompt 30 — Dashboard customization completeness_

This audit captures the state of the dashboard customization surface as of the
implementation of Prompt 30. It answers the five baseline questions from the
prompt and documents the new affordances added.

## 1. `useDashboardLayout` — persistence scope

`web/src/features/dashboard/hooks/useDashboardLayout.ts`

Storage is layered:

| Layer | Mechanism | Scope |
|-------|-----------|-------|
| L1 | `localStorage["teslasync-dashboards"]` + `localStorage["teslasync-active-dashboard"]` | Per-browser |
| L2 | `useDashboardLayouts` / `useSaveDashboardLayouts` (`/settings/dashboard-layouts`) | Per-user blob |
| L3 (new) | `dashboard_layouts` table via `/api/v1/dashboard/layouts` | Per-user library, optionally pinned per-vehicle |

The hook hydrates from the L2 backend blob if local storage holds only the
shipped default. A 2-second debounce coalesces rapid edits and forwards to the
blob endpoint. The new `dirty` boolean (added in this prompt) flips `true` while
the debounce timer is in flight or the mutation is unresolved, and clears on
mutation success — that drives the "modified" badge in the new
`<LayoutSwitcher>`.

The L3 table is reserved for user-curated **named presets** (a "layout
library"). It does not replace L2; rather it lets users save snapshots of their
working layout and apply them later or pin them to a specific vehicle. Schema:
`(id, user_id, vehicle_id, name, is_default, layout jsonb, created_at, updated_at)`.

A new optional `vehicleId?: number | null` field on `SavedDashboard` carries
per-vehicle scope at the L1/L2 layer. `null`/`undefined` means user-global;
a numeric value pins a dashboard to one vehicle. The new `pinToVehicle(id, vid)`
hook action and `visibleFor(vid)` filter expose this to the UI.

## 2. `<TemplateGallery>` — shipped templates

`web/src/features/dashboard/components/TemplateGallery.tsx`

Lists the 4 presets defined in `DASHBOARD_PRESETS` (in
`useDashboardLayout.ts`):

* **Default** — full dashboard (vehicle hero + recent activity + live
  telemetry + alerts).
* **Quick Glance** — battery + range + live activity.
* **Driving Focus** — drive history + map + speed.
* **Charging Focus** — charging stats + cost.

Users save their own presets indirectly today — they create a new dashboard
(via the `+ New` tab in `<LayoutManager>` or the `Save as` action in the new
`<LayoutSwitcher>`), customize it, and use it as a personal preset. The new
`/dashboard/layouts` endpoints introduced in Prompt 30 make first-class "save
preset to library" possible from the API layer; UI surfacing of that library
beyond the initial Save-As flow is queued for a follow-up prompt.

## 3. `<WidgetPicker>` — search / grouping / preview

`web/src/features/dashboard/components/WidgetPicker.tsx`

Before Prompt 30:
* ✅ Debounced search box (case-insensitive, matches name/description/category).
* ✅ Categorized view when not searching (16 categories from
  `WidgetCategory`).
* ✅ "Add all" button per category.
* ✅ Layout-preset shortcuts at the top.
* ❌ No category filter pills — users had to scroll.
* ❌ No persistence of recently-added widgets across sessions.
* ❌ No category badge on individual widget cards in unfiltered view.

After Prompt 30:
* ✅ Category filter pill row (All + per-category) above the list.
* ✅ "Recently Added" section, persisted in
  `localStorage["teslasync-widgets-recent"]`, capped at 8.
* ✅ Layout presets remain hidden when filtering by category (they're
  cross-cutting).

`<MiniGridPreview>` exists and is reused by the template gallery; integrating
it as a hover preview in the picker is queued (deferred for v1 — added it as
an explicit follow-up so it isn't lost).

## 4. `<LayoutManager>` — surface

`web/src/features/dashboard/components/LayoutManager.tsx`

Exposes:

* Dashboard tabs (drag-to-reorder plus one-click/keyboard move-earlier and move-later actions)
* Per-tab action menu: Move earlier/later, Rename, Duplicate, Delete, Settings
* Edit mode toggle, Auto-arrange, Undo/Redo (with `undoCount` indicator)
* Templates button (opens `<TemplateGallery>`)
* Reset (now confirmed via `useConfirm()` in the new `<LayoutSwitcher>`)

The tab strip remains the primary "manage many layouts" surface. The new
`<LayoutSwitcher>` sits **above** the tab strip and is the primary
"switch / save-as / reset" affordance — a more discoverable single-target
header dropdown. The two coexist intentionally: the strip is for management,
the switcher is for one-click switching with a Modified badge.

## 5. Kiosk mode

`web/src/features/dashboard/components/KioskOverlay.tsx`,
`web/src/features/dashboard/components/KioskSettingsModal.tsx`,
`web/src/features/dashboard/hooks/useKioskMode.ts`

"Kiosk mode" is a presentation mode for always-on displays (wall-mounted
tablets, garage displays). It:

* Hides the rest of the chrome (sidebar, top bar)
* Optionally cycles between selected dashboards on a configurable interval
* Optionally dims after inactivity, hides the cursor, prevents sleep via
  `wakeLock`
* Exits via Esc or by leaving the route

Surfaced today via the `<Tv>` icon in `DashboardPage`'s header. Settings live
in `<KioskSettingsModal>` (keyed by `localStorage["teslasync-kiosk-config"]`).
Documentation link from Settings → Dashboard is queued (out of scope for this
prompt; Kiosk affordance remains in the dashboard header for now).

## Keyboard shortcuts

`web/src/features/dashboard/hooks/useLayoutKeyboard.ts`

| Key | Action |
|-----|--------|
| `E` | Toggle edit mode (added in Prompt 30) |
| `Esc` | Exit edit mode (added in Prompt 30) |
| `?` | Open keyboard shortcuts help via `toggle-keyboard-shortcuts` event (added in Prompt 30) |
| `Alt+1`…`Alt+9` | Switch to dashboard at that index |
| `Ctrl+Z` / `Cmd+Z` | Undo (edit mode only) |
| `Ctrl+Y` / `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo (edit mode only) |

All shortcuts skip when focus is inside `INPUT`, `TEXTAREA`, `SELECT`, or any
contenteditable element.

## Command palette entries (Phase 40 / Prompt 19)

Four new commands added to `web/src/lib/commandRegistry.ts`:

* `action.dashboard.edit` — Edit dashboard layout
* `action.dashboard.switch` — Switch dashboard layout…
* `action.dashboard.addWidget` — Add widget to dashboard
* `action.dashboard.reset` — Reset dashboard to default

Each navigates to `/dashboard` and dispatches a `dashboard:*` `CustomEvent`
so the `DashboardPage` listener can route the call into `useDashboardLayout`
without coupling the palette to dashboard internals.

## Visual polish during edit (status)

Already in place via `<DashboardGrid>`:

* React-Grid-Layout's drag/drop placeholder shows a solid drop-zone outline.
* Resize handles are visible on every widget while `editMode` is true.
* `prefers-reduced-motion` is honoured by the global CSS reset (see
  `web/src/index.css`) and by `<FadeIn>` / `<CarAnimation>` via
  `useMotionPreference()`.

The "(modified)" badge on the layout switcher closes the loop on unsaved-state
visibility — previously the user had no signal that the 2-second debounce was
in flight.

## Discoverability follow-ups

* Settings → Dashboard panel with "Open dashboard" / "Reset all" / "Manage
  presets" controls — _queued (out of scope for this prompt; reset & switch
  reachable via switcher header and command palette today)_.
* First-run `<TourOverlay>` step pointing at the Edit button — _existing
  `data-tour="edit-mode-btn"` selector is in place; activating it requires
  coordination with the onboarding tour rollout_.
