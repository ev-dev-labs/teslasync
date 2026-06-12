// Pure, framework-free model + projection for the EnvironmentalImpact feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/charging/components/cost-analysis/EnvironmentalImpact.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// EnvironmentalImpact is a purely presentational tile of the charging Cost-Analysis page — the web component
// takes its `coreStats` (a `CoreStats`) as a prop from the page that owns the data (the `useCostAnalysisData`
// hook computes `coreStats` from the cached charging sessions via `useMemo`), so this surface binds NO data
// hook of its own (its only `t()` calls are the eleven `costAnalysis.environment.*` labels). As in the sibling
// EnvironmentSlide / SummaryHeroCards ports, the cache-then-network lifecycle (loading / error / stale /
// offline) lives on that owning page, not here; modelling those states on a presentational tile would invent
// behaviour the web spec does not have (honesty covenant: no silent drift). The branches the web source
// actually defines are exactly two — `coreStats` present (the full breakdown) and `coreStats == null` (the
// friendly "No data" surface, never a blank box) — and both are reproduced by the composable.
//
// Units note: every figure this tile shows is a domain "equivalence" the web renders verbatim through
// `fmtNumber`, never through the user unit-preference system, so the native port does the same (no `useUnits`
// at the boundary). `co2SavedKg` is already SI (the kilogram is the SI unit of mass); `metricTonsCo2` is the
// web's only derivation, `co2_saved_kg / 1000`. `gallonsEquiv` (US-gallons-of-gasoline-avoided), `treeEquiv`
// (tree-years), and `savings` (currency) are equivalence / count / money quantities with no unit-preference
// dimension, exactly as on the web. There is therefore no `_mi`/`_kwh`/`_mph` field here (Phase-48 clean).
//
// [EnvironmentalImpactData] mirrors the slice of the web `CoreStats` interface this tile reads. `CoreStats` is
// a client-computed projection (not a wire payload), so this is a plain value type with camelCase fields that
// match the web property names 1:1 — inventing snake_case @SerialName keys would fabricate an API contract the
// web spec does not have (drift). The owning page's session→CoreStats reduction is its own concern (P3 page
// scope), exactly as the web `useCostAnalysisData` owns it rather than this tile.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/EnvironmentalImpact — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling EnvironmentSlide surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.environmentalimpact

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The slice of the web `CoreStats` payload this tile reads — the four figures the web component renders
 * (`co2SavedKg`, `treeEquiv`, `gallonsEquiv`, `savings`). Defaulted to zero so a partial / still-computing
 * `coreStats` projects the friendly no-impact surface rather than throwing.
 *
 * @property co2SavedKg CO₂ avoided vs. a gas car, in kilograms (already SI); web `coreStats.co2SavedKg`.
 * @property treeEquiv equivalent tree-years of carbon absorption; web `coreStats.treeEquiv`.
 * @property gallonsEquiv US gallons of gasoline avoided; web `coreStats.gallonsEquiv`.
 * @property savings total money saved vs. gasoline, in the user's currency; web `coreStats.savings`.
 */
data class EnvironmentalImpactData(
    val co2SavedKg: Double = 0.0,
    val treeEquiv: Double = 0.0,
    val gallonsEquiv: Double = 0.0,
    val savings: Double = 0.0,
)

/**
 * The fully projected, render-ready view — the native analogue of the lone derivation the web component
 * performs inline before returning JSX (`coreStats.co2SavedKg / 1000` for the metric-tonnes tile). Pure data
 * (no Compose types) so the projection is unit-tested without a UI host; the composable only formats these
 * doubles for display (web `fmtNumber`).
 *
 * @property co2SavedKg pass-through of [EnvironmentalImpactData.co2SavedKg] (the kg hero + the in-sentence kg).
 * @property treeEquiv pass-through of [EnvironmentalImpactData.treeEquiv] (the tree-years hero + the sentence).
 * @property gallonsEquiv pass-through of [EnvironmentalImpactData.gallonsEquiv] (the "gallons avoided" mini-stat).
 * @property savings pass-through of [EnvironmentalImpactData.savings] (the "$ saved total" mini-stat).
 * @property metricTonsCo2 the web's `co2SavedKg / 1000` derivation (the "metric tons CO₂" mini-stat).
 */
data class EnvironmentalImpactDisplay(
    val co2SavedKg: Double,
    val treeEquiv: Double,
    val gallonsEquiv: Double,
    val savings: Double,
    val metricTonsCo2: Double,
)

/**
 * Pure projection from an [EnvironmentalImpactData] to its render-ready [EnvironmentalImpactDisplay] — a 1:1
 * port of the only value the web component derives (the kilograms→metric-tonnes conversion); every other
 * figure is rendered straight from `coreStats`.
 */
object EnvironmentalImpactProjection {
    /** Kilograms per metric tonne — the web divisor in `fmtNumber(coreStats.co2SavedKg / 1000, 2)`. */
    const val KG_PER_METRIC_TON: Double = 1000.0

    /** The CO₂ figure expressed in metric tonnes (web `co2SavedKg / 1000`). */
    fun metricTons(co2SavedKg: Double): Double = co2SavedKg / KG_PER_METRIC_TON

    /** Select the render-ready view for [data]. */
    fun project(data: EnvironmentalImpactData): EnvironmentalImpactDisplay =
        EnvironmentalImpactDisplay(
            co2SavedKg = data.co2SavedKg,
            treeEquiv = data.treeEquiv,
            gallonsEquiv = data.gallonsEquiv,
            savings = data.savings,
            metricTonsCo2 = metricTons(data.co2SavedKg),
        )
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the CO₂
 * figure, tree count, gallons, or dollar savings — so a diagnostics line can never leak a user's driving or
 * spending footprint.
 */
object EnvironmentalImpactDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "EnvironmentalImpact"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
