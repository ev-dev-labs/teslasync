# Experiments

Experiments are playful, optional ways to explore your vehicle's recorded data.
They are not vehicle controls, safety advice, or a substitute for the regular
analytics pages. The six lazy-loaded routes and their navigation are available;
the interactive experiences below are being implemented through `docs/tasks/`.
Implementation progress and verification belong in `docs/tasks/STATUS.md` and
`docs/progress-log.md`.

## The six experiences

### Vehicle lab

`/experiments/vehicle-lab` will bring live signals into an original, stylized 3D
vehicle: opening doors, lowering windows, lighting the charge port, and anchoring
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

## Assets

Original work is covered by the repository's MIT license. Downloaded assets
must have a verified CC0 or CC-BY license and a source/author record here.

| Name | Source URL | Author | License | Used by |
|---|---|---|---|---|
| Four-part flask geometry | [Source](https://github.com/ev-dev-labs/teslasync/blob/next-upgrades/web/src/components/layout/sidebar/navIconParts.ts) | TeslaSync Contributors | Original work, MIT | Experiments navigation |

## Design decisions

| Decision | Rationale | Used by |
|---|---|---|
| One canonical section, six Experimental badges | Every rail, panel, and phone sheet agrees without duplicate navigation definitions. | Navigation |
| A flask with settling liquid and staggered bubbles | A recognizable, self-made glyph plays once within 380ms; shared reduced-motion handling keeps it static. | Navigation |
| Distinct destination names and glyphs | Preserve the existing navigation's uniqueness and keep Energy flow analytics separate. | Navigation and discovery |
| A default-on local, cross-tab preference | Instant, offline-capable hiding; direct routes and stored pins remain intact. | Appearance and navigation |
| Original stylized vehicle, not a vendor replica | License-safe expressive geometry with separately named parts for future model replacement. | Planned vehicle lab |
| Text information is a first-class experience | Keyboard, screen-reader, and WebGL-fallback users must receive the same signals and details. | Vehicle lab and replay |
