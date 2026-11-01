# Experiments

Experiments are playful, optional ways to explore your vehicle's recorded data.
They are not vehicle controls, safety advice, or a substitute for the regular
analytics pages. The six lazy-loaded routes and their navigation are available;
the interactive experiences below are being implemented through `docs/tasks/`.
Implementation progress and verification belong in `docs/tasks/STATUS.md` and
`docs/progress-log.md`.

## The six experiences

### Vehicle lab

`/experiments/vehicle-lab` now has a theme-aware studio, five camera views,
mouse/touch orbit and zoom, and a readable unknown-state summary without WebGL.
Live binding is still pending: opening doors, lowering windows, lighting the charge port, and anchoring
tire-pressure readings beside each wheel. An equally complete text summary and
keyboard-accessible part details must remain usable without WebGL. The vehicle
is illustrative, not a Tesla render or an exact representation of its hardware.

### Route flyover

`/experiments/route-flyover` will replay a recorded drive along its actual
coordinates, with scrubbing, speed control, and a camera that makes the journey
feel cinematic. Route, elevation, and telemetry gaps must stay visible rather
than being filled with invented data. Terrain and map sources require terms
that permit this use and visible attribution.

### Where did my energy go?

`/experiments/energy-flow` will tell a charge or drive's energy story as a flow
from grid to battery to wheels, using only energy quantities the API can
actually establish. Unsupported losses or consumers are unavailable, not
inferred facts. This experiment has a distinct navigation name so the existing
Energy flow analytics destination remains unambiguous.

### Year in motion

`/experiments/year-in-motion` will let a year's recorded journeys unfold on an
animated map and timeline. A printable recap and reduced-motion view should
make the same recorded totals understandable without playback. Calendar-year
navigation is distinct from the workspace's shared analysis-window selector.

### Battery what-if lab

`/experiments/battery-what-if` will compare explicitly labeled **Estimate**
scenarios using real charge and discharge history when sufficient evidence is
available. Assumptions, missing inputs, and uncertainty must accompany the
result; projections are not measurements, guarantees, or battery-care advice.

### Drive art

`/experiments/drive-art` will turn a recorded route, speed, and power into
generative art with reproducible controls and an export. Art is an expressive
transformation of the source data, not a new measurement. Exported route art
can reveal private locations, so export is always an explicit user action.

## Guardrails

- **Licensing:** never use Tesla images, logos, renders, or 3D models, or assets
  ripped from games or apps. Use original work, CC0, or CC-BY assets; retain
  required attribution and record sources below. Check map and terrain terms
  before use.
- **Evidence:** use real API data. Missing or unsupported values are
  unavailable, never silent zeroes. Synthetic scenes are explicitly **Demo**
  and projections **Estimate**; neither is silently mixed into recorded data.
- **Loading:** each experiment remains a separate lazy route. Heavy libraries
  stay behind their owning experiment's import boundary. Keep the existing
  startup-bundle budget, tests, and quality guards unchanged.
- **Shared conventions:** translate every user-facing string with `t()`, use
  the shared SI/display-unit, timezone/date, number, palette, and icon helpers,
  and use the existing FreshnessDot for real data sources. The application
  header owns workspace vehicle and date scope; do not duplicate its pickers.
- **Inclusive interaction:** support light/dark themes, 390px screens,
  keyboard and screen readers, and reduced motion. Provide WebGL fallback
  content with the same information, not a blank canvas or a dead end.
- **State and safety:** preserve loading, error, stale, and empty states.
  Experiments are read-only unless a task explicitly defines another action;
  never send vehicle commands as part of a visualization or Demo.

The default-on **Show experiments** preference is in Appearance settings.
Turning it off hides the section and its navigation/discovery entries, without
deleting pins or preventing direct bookmarks from opening.

## Libraries

Record exact versions, compatibility, and licenses when a dependency is added.
Use versions published at least two weeks before selection. Existing shared UI
and helpers are reused rather than duplicated.

| Name | Version | License | Used by |
|---|---|---|---|
| three | 0.180.0 | MIT | Vehicle lab only |
| @react-three/fiber | 8.18.0 | MIT | Vehicle lab only; React 18 renderer |
| @react-three/drei | 9.122.0 | MIT | Vehicle lab only; React 18-compatible scene helpers |
| @types/three | 0.180.0 | MIT | Vehicle lab development types |
| three-mesh-bvh | 0.8.3 | MIT | Drei dependency; scoped compatibility override |
| zustand | 4.5.7 | MIT | Shared Fiber/Drei store API; no application store migration |
| @types/react-reconciler | 0.28.9 | MIT | Shared Fiber/its-fine development types |
| scheduler | 0.23.2 | MIT | Existing React DOM scheduler shared with Fiber |
| fflate | 0.8.3 | MIT | Existing Three types dependency shared with three-stdlib |

Versions were checked against npm publication metadata on 2026-11-01:
Three and its types were published 2025-09-03; Fiber and Drei were published
2025-02-19. All exceed the two-week minimum. Fiber 8 supports React 18
(`>=18 <19`); Drei 9 accepts React 18 and Fiber 8. Their Three peer minimums
are 0.133 and 0.137 respectively, satisfied by the pinned Three version.
Do not import these libraries outside `web/src/features/experiments/vehicle-lab/`.

Drei 9 declares the deprecated Three-incompatible BVH 0.7.8 range. Its
dependency is pinned to BVH 0.8.3 (published 2024-11-11, Three peer `>=0.159.0`)
with a scoped override, rather than ignoring the incompatibility warning or
upgrading the application's React version. Debug-only helpers are not required
by the scene; do not import them merely because Drei provides them.

The first CI duplication check exposed five new duplicate dependency families.
Scoped overrides share Zustand 4's default and named create APIs across
Fiber/Drei/tunnel-rat, the existing reconciler types and fflate versions, and
Three itself in the unused stats helper. React's scheduler is shared at its
existing 0.23.2 version. No duplication baseline or budget was relaxed.
Publication dates: Zustand 4.5.7 2025-05-15, reconciler types 0.28.9
2024-12-11, scheduler 0.23.2 2024-04-26, fflate 0.8.3 2026-05-16; all MIT.

The scene imports only Drei's OrbitControls module, with no downloaded studio
environment. Three's published source entry is aliased consistently and its
core/renderer modules are separate lazy vendor chunks; the original 224.6KB
scene chunk exceeded the unchanged 100KB route budget. The resulting engine
chunks measure 99.8KB and 84.7KB under the unchanged 140KB vendor limit.
Camera changes are immediate, without autorotation or damping; demand rendering
pauses in hidden tabs and DPR is capped at two. Context loss leaves the same
seventeen unknown-state rows visible. Live values, part details and Demo controls
remain subsequent tasks, not claimed complete.

## Assets

Original work is covered by the repository's MIT license. Downloaded assets
must have a verified CC0 or CC-BY license and a source/author record here.

| Name | Source URL | Author | License | Used by |
|---|---|---|---|---|
| Four-part flask geometry | [Source](https://github.com/ev-dev-labs/teslasync/blob/next-upgrades/web/src/components/layout/sidebar/navIconParts.ts) | TeslaSync Contributors | Original work, MIT | Experiments navigation |
| Studio SUV primitive model | [Source](https://github.com/ev-dev-labs/teslasync/blob/next-upgrades/web/src/features/experiments/vehicle-lab/model/createVehicleModel.ts) | TeslaSync Contributors | Original work, MIT; no downloaded assets | Vehicle lab |

## Design decisions

| Decision | Rationale | Used by |
|---|---|---|
| One canonical section, six Experimental badges | Every rail, panel, and phone sheet agrees without duplicate navigation definitions. | Navigation |
| A flask with settling liquid and staggered bubbles | A recognizable, self-made glyph plays once within 380ms; shared reduced-motion handling keeps it static. | Navigation |
| Distinct destination names and glyphs | Preserve the existing navigation's uniqueness and keep Energy flow analytics separate. | Navigation and discovery |
| A default-on local, cross-tab preference | Instant, offline-capable hiding; direct routes and stored pins remain intact. | Appearance and navigation |
| Original stylized vehicle, not a vendor replica | Primitive geometry in meters, +Y up/+Z forward/+X left; separately named hinge groups and door-attached windows support replacement and animation. | Vehicle lab model |
| Text information is a first-class experience | Keyboard, screen-reader, and WebGL-fallback users must receive the same signals and details. | Vehicle lab and replay |
