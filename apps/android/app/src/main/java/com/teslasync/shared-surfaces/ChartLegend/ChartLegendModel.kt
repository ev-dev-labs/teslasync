// Pure, framework-free model + projection + diagnostics for the ChartLegend shared surface — the native
// analogue of web/src/components/charts/ChartLegend.tsx together with the toggle source it binds to
// (web/src/components/charts/ChartHiddenSeriesContext.tsx → useChartHiddenSeries, backed by
// web/src/hooks/useHiddenSeries.ts / web/src/components/charts/useChartLegendState.ts). No Compose, no
// Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source actually is (and therefore the COMPLETE branch set this surface reproduces): the
// web `ChartLegend` is a Recharts `<Legend>` wrapper whose only job is series-visibility toggling. It
// resolves a toggle source — the `state` prop, else the surrounding `<ChartContainer chartKey="…">`
// context, else nothing — and then, per legend entry:
//   • resolves a stable series key (web `pickKey`: prefer the entry `dataKey`, else `payload.dataKey`,
//     else the entry value) → [pickSeriesKey];
//   • on click toggles that key in the resolved source (web `resolved.toggle(key)`) → [toggleHidden];
//   • renders the entry dimmed when hidden — 40% opacity + line-through — and interactive (pointer +
//     `aria-pressed`) only when a source resolved → [ChartLegendProjection.project] emits the per-entry
//     [LegendItem.hidden] / [LegendItem.interactive] the composable paints.
// The web component deliberately does NOT hide the plotted series itself (the chart owner does that via
// `<Line hide={…} />`); likewise this surface only renders the legend, never the chart.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: the
// toggle source is a client-side visibility store (URL state via `useHiddenSeries`, or localStorage via
// `useChartLegendState`), NOT an async cache-then-network feed. It never loads, errors, goes stale or
// goes offline — so modelling those would fabricate behaviour the web spec does not have (Honesty
// Covenant: no scope narrowing, no silent drift). The same rationale the accepted VisuallyHidden /
// RouteAnnouncer ports document. The surface's REAL, fully-reproduced states are instead: the empty
// legend (no series → a friendly empty state, never a blank box), the passive legend (no resolved
// source → entries shown, no toggle, no dimming), and the interactive legend with each entry in its
// visible or hidden (dimmed + struck-through) form. Each is projected here and asserted off-device.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ChartLegend — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.chartlegend

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the ChartLegend surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`ChartLegend`).
 */
object ChartLegendRegistration {
    /** Stable surface id (also the `viewModel` key prefix the host binds the legend with). */
    const val ID: String = "chart-legend"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ChartLegend"
}

/**
 * One legend row the caller hands the surface — the native analogue of a Recharts legend payload entry
 * reduced to the fields the toggle UX needs. [key] is the stable series key (web `dataKey`) the hidden
 * set is keyed by; [label] is the already-localized series name the caller renders (web entry `value`);
 * [colorArgb] is the swatch color as a packed `0xAARRGGBB` value so this model stays framework-free and
 * JVM-testable (the composable converts it to a Compose `Color` at the render boundary).
 */
data class LegendSeries(
    val key: String,
    val label: String,
    val colorArgb: Long,
)

/**
 * The projected render state for a single legend entry — the native analogue of the per-entry decision
 * the web `formatter` makes. [hidden] drives the dim (40% opacity + line-through) the web applies when
 * `resolved.isHidden(key)`; [interactive] drives whether the entry is tappable + announces a toggle
 * state (web `aria-pressed` / pointer cursor), which is true only when a toggle source resolved.
 */
data class LegendItem(
    val key: String,
    val label: String,
    val colorArgb: Long,
    val hidden: Boolean,
    val interactive: Boolean,
)

/**
 * Resolves a stable series key from a chart payload — the faithful port of the web `pickKey`. The web
 * accepts a `dataKey` of `string | number | function`; only the string/number forms have a stable
 * identity for persistence, and a `function` dataKey (a computed accessor) is modelled here as `null`,
 * exactly the cases the web `typeof === 'string' || 'number'` guard rejects. Preference order mirrors
 * the source: the entry [dataKey], else the nested [payloadDataKey], else the [fallback] (web `value`).
 */
fun pickSeriesKey(
    dataKey: String?,
    payloadDataKey: String?,
    fallback: String,
): String = dataKey ?: payloadDataKey ?: fallback

/**
 * Pure projection + toggle math for the legend — the native mirror of everything the web `ChartLegend`
 * decides between its resolved toggle source and the rendered `<span>`s. Framework-free so the whole
 * contract is covered by the JVM unit gate without a Compose host.
 */
object ChartLegendProjection {
    /**
     * Projects the caller's [series] and the current [hidden] set into the per-entry render states the
     * composable paints. When [interactive] is false (the web "no resolved toggle source" branch) every
     * entry renders visible and non-tappable regardless of [hidden] — the web `isHidden` short-circuits
     * to `false` when nothing resolved, so a passive legend never dims. Order is preserved 1:1 so the
     * legend reads in the caller's series order.
     */
    fun project(
        series: List<LegendSeries>,
        hidden: Set<String>,
        interactive: Boolean,
    ): List<LegendItem> =
        series.map { entry ->
            LegendItem(
                key = entry.key,
                label = entry.label,
                colorArgb = entry.colorArgb,
                hidden = interactive && entry.key in hidden,
                interactive = interactive,
            )
        }

    /**
     * Toggles [key] in [hidden] — the native mirror of the web `toggle` (add when absent, remove when
     * present). Returns a new set so the caller's `StateFlow` emits a distinct value.
     */
    fun toggleHidden(
        hidden: Set<String>,
        key: String,
    ): Set<String> = if (key in hidden) hidden - key else hidden + key
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted (PII-free) whenever a legend entry's visibility is toggled. */
const val EVENT_TOGGLE: String = "chartLegend.toggle"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface
 * [ChartLegendRegistration.SLUG] (P1/S11) — never a chart id nor a series key, so a diagnostics line can
 * never leak which chart a user was viewing. Kept free of Compose so it is unit-tested with a recording
 * [Logger]; the ViewModel calls it once per surface open.
 */
fun recordChartLegendOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to ChartLegendRegistration.SLUG))
}

/**
 * Emits the PII-safe toggle diagnostic carrying only the surface slug — never the toggled series key nor
 * the chart id — so visibility interactions are observable without leaking what a user was looking at.
 */
fun recordChartLegendToggle(logger: Logger) {
    logger.info(EVENT_TOGGLE, mapOf(FIELD_SURFACE to ChartLegendRegistration.SLUG))
}
