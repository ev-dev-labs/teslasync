# P3/A2 — Compose chart components: web → Android SURVEY

Maps every `web/src/components/charts/*` export to its native Compose/Vico equivalent in
`io.teslasync.android.components.charts`. Full cartesian charts are rendered with **Vico 2.0.0**
(ADR-012 lock, `apps/versions.lock.md`); micro-visuals use Compose `Canvas`. Vico is imported
**only** inside this package — pages consume the typed wrappers and never import a chart library.
All colors come from the P3/A1 generated palette / `TeslaTokens` / Material 3 scheme.

## Direct equivalents

| Web export | Android file | Notes |
|---|---|---|
| `ChartContainer` | `ChartContainer.kt` | `GlassPanel` + header (title/subtitle/action) + export menu + fullscreen toggle; switches real loading/empty/error/content by `ChartStatus`; expandable accessible data table (the web hidden-`<table>` fallback) |
| `AreaChartWrapper` | `CartesianChartWrappers.kt` | Vico line layer + gradient `AreaFill` |
| line chart wrapper | `CartesianChartWrappers.kt` → `LineChartWrapper` | Vico `LineCartesianLayer` |
| bar chart wrapper | `CartesianChartWrappers.kt` → `BarChartWrapper` | Vico `ColumnCartesianLayer` |
| composed/combined chart | `CartesianChartWrappers.kt` → `ComboChart` | column + line layers (per-series `kind`) |
| (Vico core) | `VicoChartScaffold.kt` → `VicoCartesianChart` | the one internal renderer behind all of the above |
| `MetricSwitcherChart` | `MetricSwitcherChart.kt` | `TabNav` pill row + `VicoCartesianChart` |
| `Sparkline` | `Sparkline.kt` | Compose `Canvas` line + gradient fill |
| `MiniChart` | `MiniChart.kt` | Compose `Canvas` stroke-only line |
| `RadialGauge` | `RadialGauge.kt` | Compose `Canvas` arc + centered value; one a11y summary |
| `SmallMultiplesChart` | `SmallMultiplesChart.kt` | `FlowRow` grid of compact `VicoCartesianChart` cells, per-cell stride downsampling, Canvas cursor overlay |
| `ElevationProfile` | `ElevationProfile.kt` | `AreaChartWrapper` + gain/loss caption + cursor marker |
| `ChartLegend` | `ChartLegend.kt` | tappable swatch+label chips; dims hidden; drives `ChartLegendState` |
| `ChartTooltip` | `ChartTooltip.kt` | `rememberChartMarker()` (Vico `DefaultCartesianMarker`) for hover + `ChartTooltipContent` standalone body |
| `ChartGradient` | `ChartGradient.kt` | top→bottom fade tokens + `Brush` builder for Canvas / Vico fills |
| `ChartExportMenu` | `ChartExportMenu.kt` | overflow menu: save image / copy image / export CSV (controlled callbacks) |
| `ChartBrush` | `ChartBrush.kt` | `RangeSlider` over the index domain, drives `ChartTimeRangeState` |
| `ChartAnnotationLayer` (`renderAnnotationLines`) | `ChartAnnotationLayer.kt` → `ChartMarkerRail` / `ChartAnnotationLayer` | aligned marker-rail overlay (see merger note) |
| `AnnotationList` | `AnnotationList.kt` | category-dot rows with remove action |
| `AddAnnotationPopover` | `AddAnnotationPopover.kt` | `Modal` form: label + category `TabNav` + description |
| `TimeMarker` | `TimeMarker.kt` | severity marker + `timeMarker()` builder, rendered on the rail |
| `useChartLegendState` | `ChartLegendState.kt` | `rememberChartLegendState` (`rememberSaveable`, the Android analog of the web `localStorage` persistence) |
| `cursorSync` store | `CursorSyncStore.kt` | process-wide store + `cursorSyncPosition` Compose bridge |
| `ChartTimeRangeContext` / cursor sync | `ChartTimeRangeState.kt` | `rememberChartTimeRange`, `ChartSyncScope`, `LocalChartSyncId` |
| `chartUtils` / `chartDefaults` | `ChartDefaults.kt`, `ChartLogic.kt`, `ChartFormat.kt` | sizing/tick defaults, axis math, formatters |
| annotation types | `AnnotationModels.kt` | `AnnotationCategory`, `DataAnnotation`, `annotationMarkers` |

## Android-native mergers (documented deviations)

- **Sparkline / MiniChart / RadialGauge → Compose `Canvas`.** The web draws these as
  hand-rolled SVG (not a Recharts chart), so a Compose `Canvas` is the faithful, lightweight
  Android equivalent. Geometry is the JVM-tested `sparklinePoints` / `gaugeFraction`.
- **Annotations / TimeMarker → marker rail, not `<ReferenceLine>`.** Vico 2.0 has no public
  vertical-line decoration, so point-in-time markers render as a severity-colored pin rail
  aligned by x-fraction above the plot (the web itself uses this rail on small screens). Pins
  are tappable and carry screen-reader labels; `AnnotationList` provides the readable roster.
  Axis-less contexts (small-multiples cells) get a pixel-precise Canvas cursor overlay instead.
- **`ChartExportMenu` → controlled callbacks.** Image/CSV capture + file IO is host/OS
  territory (out of this prompt's scope per "no networking/business logic"), so the menu is a
  controlled primitive that surfaces actions and fires callbacks — mirroring how the predecessor
  treated `PrintButton`/`FullscreenButton`. **SVG export is web-only** (Android has no SVG
  canvas); image export is PNG.
- **Persistence → `rememberSaveable` / in-memory store.** The web persists hidden-series and
  cursor state in `localStorage`/URL. The Android analogs are `rememberSaveable` (legend) and a
  process-wide `CursorSyncStore` (cursor) — no storage/router dependency.
- **Tooltip → Vico marker.** Recharts tooltips are arbitrary DOM; on Vico the hover affordance is
  a `CartesianMarker`, so `ChartTooltip.kt` provides both the Vico marker and a standalone body.

## Out of scope (not chart-category primitives)

- Page-specific data transforms, backend changes, and non-chart components — per the prompt.
- `*.test.tsx` — re-covered by `ChartLogicTest`/`CursorSyncStoreTest` (JVM gate) and
  `ChartInteractionTest` (instrumented).

## Tests & previews

- `src/test/.../charts/ChartLogicTest.kt` (18) + `CursorSyncStoreTest.kt` (6) — pure logic
  (axis ranges, gaps, downsampling, sparkline/gauge geometry, a11y summary + table, CSV, cursor
  store). Run in the `:android:testDebugUnitTest` gate.
- `src/androidTest/.../charts/ChartInteractionTest.kt` (7) — container states, legend toggle,
  annotation remove, popover, gauge a11y, chart render. Device-run (connectedDebugAndroidTest).
- `ChartGallery.kt` — `@Preview` Light / Dark / High-contrast galleries exercising every
  component and the loading/empty/error/data states.
