// Pure, framework-free model + reducers + diagnostics for the ChartHiddenSeriesContext shared surface —
// the native analogue of web/src/components/charts/ChartHiddenSeriesContext.tsx together with its data
// source web/src/hooks/useHiddenSeries.ts and the URL-state layer it sits on
// (web/src/hooks/useUrlState.ts `useUrlArray` over `useSearchParams`). No Compose, no Android framework,
// no HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// The web source is a CONTEXT BRIDGE, not a data-fetching view. `ChartHiddenSeriesContext` is a React
// context whose value is the URL-persisted hidden-series state for a named chart (or `null` when the
// chart did not opt into legend toggling); `useChartHiddenSeries()` reads it; `ChartHiddenSeriesProvider`
// resolves `useHiddenSeries(chartKey)` only when a `chartKey` is supplied and provides it to legends
// without prop-drilling. `useHiddenSeries` tracks which `dataKey`s of a chart are hidden, persisting an
// alphabetically-sorted, comma-joined list under `?hidden_{chartKey}=…` so a deep link carries the
// toggle and toggling A then B yields the same URL as B then A (canonical order). This file reproduces
// that persistence contract exactly: the param name, the sorted serialization, the toggle reducer, and
// the projected [HiddenSeriesState].
//
// Parity-with-honesty (Honesty Covenant #9 — documented, not silent): a context bridge over URL state is
// NOT an async cache-then-network feed, so it has no loading / empty / error / stale / offline lifecycle
// of its own — modelling those generic data-states would fabricate behaviour the web spec does not have
// (the same rationale the accepted VisuallyHidden / AIChatbotIndicator ports document). The surface's
// REAL states are reproduced instead and unit-tested below:
//   • absent        ← no chartKey: the chart did not opt into toggling (web context value `null`).
//   • all-visible   ← opted in, the hidden set is empty (no `hidden_*` param).
//   • some-hidden   ← opted in, one or more series hidden (`hidden_{chartKey}=a,b`, sorted).
//   • toggle/reset  ← the transitions between the two opted-in states.
// The web source renders no static copy of its own (it renders `children`), so the surface is anonymous
// and carries no i18n keys — there is none to map, and none is invented.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ChartHiddenSeriesContext — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package
// identifier), so the package intentionally diverges from the path — exactly as the sibling
// VisuallyHidden / AIChatbotIndicator surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.charthiddenseriescontext

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the ChartHiddenSeriesContext surface. The diagnostics [SLUG] is
 * emitted with the one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates
 * (`ChartHiddenSeriesContext`).
 */
object ChartHiddenSeriesRegistration {
    /** Stable surface id (also the per-chart `viewModel` key the provider binds the holder with). */
    const val ID: String = "chart-hidden-series"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ChartHiddenSeriesContext"
}

/** Web `HIDDEN_PARAM_PREFIX` — the `?hidden_{chartKey}=…` query-param prefix the toggle persists under. */
const val HIDDEN_PARAM_PREFIX: String = "hidden_"

/** Web `useUrlArray` delimiter — the comma the sorted hidden-series list is joined/split on. */
const val HIDDEN_SERIES_DELIMITER: String = ","

/**
 * The query-param name a chart's hidden-series list persists under — the native mirror of the web
 * `` `${HIDDEN_PARAM_PREFIX}${chartKey}` ``. A blank [chartKey] still yields a stable name so a caller
 * that does not always carry a chart id keeps a stable call site (the web hook allows an empty key but
 * callers must not toggle in that case); the provider gates on a present key before any write.
 */
fun hiddenParamName(chartKey: String): String = HIDDEN_PARAM_PREFIX + chartKey

/**
 * Parses the stored param value into the set of currently-hidden `dataKey`s — the native mirror of the
 * web `new Set(arr)` over `useUrlArray`'s parse (`raw === '' ? [] : raw.split(',')`). Blank entries are
 * dropped so a stray delimiter never yields a phantom `""` series, and the result is order-independent
 * (a set), exactly as the web `hidden` set is.
 */
fun parseHiddenSeries(values: List<String>): Set<String> = values.filter { it.isNotEmpty() }.toSet()

/**
 * Serializes the hidden set back to the canonical stored list — the native mirror of the web toggle's
 * `Array.from(next).sort()`. Sorted output keeps URLs canonical: toggling A then B persists the same
 * value as toggling B then A, so comparing two shared links is a plain equality check. An empty set
 * serializes to an empty list, which the store treats as "drop the param" (web `omitDefault`).
 */
fun serializeHiddenSeries(hidden: Set<String>): List<String> = hidden.sorted()

/**
 * Toggles [seriesKey] in [current], returning the next hidden set — the native mirror of the web
 * `toggle`'s `next.has(key) ? delete : add`. Pure (no store, no Compose) so the add/remove/round-trip
 * behaviour is unit-tested off-device for every input.
 */
fun toggleHiddenSeries(
    current: Set<String>,
    seriesKey: String,
): Set<String> = if (seriesKey in current) current - seriesKey else current + seriesKey

/**
 * The URL-persisted hidden-series state a chart's legend binds to — the native analogue of the web
 * `HiddenSeriesState` (`{ hidden, toggle, isHidden, reset }`) carried as the context value. It bundles
 * the immutable [hidden] set with the [toggle] / [reset] actions the host wires to the param store, so
 * a legend consumer toggles visibility without prop-drilling, exactly as the web context value does.
 *
 * Equality is intentionally value-based on ([chartKey], [hidden]) only — the action callbacks are stable
 * for a provider's lifetime, so excluding them keeps recomposition driven purely by the data changing.
 *
 * @property chartKey the chart this state belongs to (web `useHiddenSeries(chartKey)` argument).
 * @property hidden the set of `dataKey`s currently hidden for the chart (web `hidden`).
 * @property toggle flips a series' visibility, persisting the canonical sorted param (web `toggle`).
 * @property reset clears every hidden flag, dropping the param from the URL (web `reset`).
 */
class HiddenSeriesState(
    val chartKey: String,
    val hidden: Set<String>,
    val toggle: (String) -> Unit = {},
    val reset: () -> Unit = {},
) {
    /** Whether [seriesKey] is currently hidden for this chart (web `isHidden`). */
    fun isHidden(seriesKey: String): Boolean = seriesKey in hidden

    override fun equals(other: Any?): Boolean =
        this === other ||
            (other is HiddenSeriesState && chartKey == other.chartKey && hidden == other.hidden)

    override fun hashCode(): Int = 31 * chartKey.hashCode() + hidden.hashCode()

    override fun toString(): String = "HiddenSeriesState(chartKey=$chartKey, hidden=$hidden)"
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface first composes (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on the `view.opened` diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface
 * [ChartHiddenSeriesRegistration.SLUG] (P1/S11) — never a chart id or any hidden `dataKey`, so a
 * diagnostics line can never leak which chart a user is viewing or how they configured it. Kept free of
 * Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordChartHiddenSeriesOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to ChartHiddenSeriesRegistration.SLUG))
}
