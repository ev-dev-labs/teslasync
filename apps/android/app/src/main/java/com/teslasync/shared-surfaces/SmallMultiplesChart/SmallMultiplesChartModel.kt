// Pure, framework-free model + projection + diagnostics for the SmallMultiplesChart shared surface — the native
// analogue of every decision the web component makes (web/src/components/charts/SmallMultiplesChart.tsx) before
// it paints its grid of mini line charts. No Compose, no Android, no HTTP: every declaration here is unit-tested
// off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL "small multiples" / "trellis" grid. Its only hooks are `useTranslation` (mapped to the
//     P1/S10 i18n catalog, for the per-cell "No data" label), `useId` (a stable fallback cross-cell cursor-sync
//     id) and `useDateFormat` (x-axis tick formatting). It takes a `data` array (one row per timestamp) plus a
//     list of `series` keys to project into one cell each — it knows nothing about telemetry or any endpoint. So
//     there is no data port to bind (no P1/S8 state holder, no Source/ViewModel): modelling one would invent a
//     fetch the web spec does not have (honesty covenant: no scope narrowing, no silent drift). The closest
//     precedents are the equally presentational ChartExportMenu / AiLimitBanner / RouteAnnouncer surfaces
//     (composable + model, no Source/ViewModel).
//   • One cell per `series` key, each with its OWN y-scale so series of very different magnitudes don't flatten
//     each other — the headline feature. Cells share a single cursor `syncId` so a cursor on one cell appears at
//     the same timestamp on every other cell ("that's the whole point of small multiples").
//   • A cell with no finite value for its series renders a localized "No data" empty state instead of an empty
//     plot (web `!hasData` branch). A series with at least one finite value renders its line.
//   • Three performance layers (per-cell projection, stride downsampling to `maxPointsPerCell`, lazy mount). The
//     first two are data decisions reproduced here; the third (IntersectionObserver lazy mount) is a web-DOM perf
//     detail with no user-visible state and no Compose analogue (Compose composes lazily by construction), so it
//     is intentionally not ported — see the rendering note in SmallMultiplesChart.kt.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this surface
// fetches nothing — it renders a grid from data its parent already loaded. Its real, fully-reproduced states are
// the populated grid, the per-cell "No data" empty state, and the overall empty grid (no series), each
// reduced here and asserted in the off-device test.
//
// Projection adaptation (documented, not a shortcut): the web projects each cell to only the rows where its
// series is finite, then stride-downsamples that filtered list — a perf trick that works because Recharts aligns
// cells by x-VALUE. Vico aligns by index, so to keep cells index-aligned (the precondition for the cross-cell
// cursor "that's the whole point") this adapter keeps a single SHARED x-axis (every row's x) and projects each
// cell to a finite-or-null value at every shared index, then stride-samples the shared axis once. `hasData` is
// still decided by a full scan of the unsampled rows, so it matches the web exactly; downsampling only thins what
// is plotted, never the has-data decision. At the default `maxPointsPerCell` no thinning happens at all.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/SmallMultiplesChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ChartExportMenu shared surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.smallmultipleschart

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). A constant identifier carrying no
 * series key, timestamp, or value, so a diagnostics line can never leak what the operator was viewing.
 */
const val SMALL_MULTIPLES_CHART_SLUG: String = "SmallMultiplesChart"

/**
 * One time-ordered input row — the native mirror of the web `data` element (`{ timestamp, [seriesKey]: value }`).
 * [x] is the already-formatted x-axis label for this row (web rows carry a `timestamp`; the host formats it via
 * `useDateFormat` before handing it in, keeping this model free of any date library). [values] maps each series
 * key to its sample at this row, `null` for a gap.
 */
data class SmallMultiplesRow(
    val x: String,
    val values: Map<String, Double?>,
)

/**
 * One render-ready cell — the projection of a single series across the shared, stride-sampled x-axis. [xLabels]
 * is the shared sampled axis (identical across all cells in a grid so the cross-cell cursor aligns by index);
 * [values] holds this series' finite-or-null sample at each kept index; [hasData] is true when the series had at
 * least one finite value anywhere in the unsampled rows (web `hasData`).
 */
data class SmallMultiplesCell(
    val key: String,
    val xLabels: List<String>,
    val values: List<Double?>,
    val hasData: Boolean,
)

/**
 * Whether [value] is a plottable point — non-null and finite. The native mirror of the web `isFinitePoint`
 * guard: `NaN`, `+∞`, `-∞`, and `null` are all treated as gaps / no-data.
 */
fun isFiniteValue(value: Double?): Boolean = value != null && value.isFinite()

/**
 * The original indices kept by a stride downsample of a [size]-length axis to at most [cap] points, always
 * preserving the first and last index. The native port of the web `strideSample` (which keeps first + last so a
 * downsampled line still spans the full time range). Returns the identity index list when [size] already fits
 * under [cap]; an empty list when there is nothing to sample.
 */
fun strideIndices(
    size: Int,
    cap: Int,
): List<Int> {
    if (size <= 0 || cap <= 0) return emptyList()
    val stride = if (size <= cap) 1 else ((size + cap - 1) / cap).coerceAtLeast(1)
    val kept = ArrayList<Int>()
    var i = 0
    while (i < size) {
        kept.add(i)
        i += stride
    }
    val lastIndex = size - 1
    if (kept.last() != lastIndex) kept.add(lastIndex)
    return kept
}

/**
 * Project the input [rows] into one render-ready [SmallMultiplesCell] per entry in [series] — the native port of
 * the web `cellProjections` memo. Cells share a single stride-sampled x-axis (capped at [maxPointsPerCell]) so
 * they stay index-aligned for the cross-cell cursor; each cell carries its series' finite-or-null value at every
 * kept index. `hasData` is decided by a full scan of the unsampled rows (matching the web), so a series with a
 * value only outside the sampled subset is still reported as having data. Empty [series] yields no cells (the
 * overall empty grid).
 */
fun projectCells(
    rows: List<SmallMultiplesRow>,
    series: List<String>,
    maxPointsPerCell: Int,
): List<SmallMultiplesCell> {
    if (series.isEmpty()) return emptyList()
    val keptIndices = strideIndices(rows.size, maxPointsPerCell)
    val xLabels = keptIndices.map { rows[it].x }
    return series.map { key ->
        val hasData = rows.any { isFiniteValue(it.values[key]) }
        val values = keptIndices.map { index -> rows[index].values[key].takeIf(::isFiniteValue) }
        SmallMultiplesCell(key = key, xLabels = xLabels, values = values, hasData = hasData)
    }
}

/**
 * The brand-palette color index for the cell at [position] holding [key] — the native port of the web
 * `colorIndex?.[sig] ?? i` with its `Math.max(0, idx)` floor. An explicit [colorIndex] entry overrides the
 * positional default; the result is clamped to `>= 0` (palette wrap-around is handled by the color resolver).
 */
fun cellColorIndex(
    position: Int,
    key: String,
    colorIndex: Map<String, Int>?,
): Int = (colorIndex?.get(key) ?: position).coerceAtLeast(0)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a series key,
 * timestamp, or value — so a diagnostics line can never leak what the operator was viewing.
 */
object SmallMultiplesChartDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = SMALL_MULTIPLES_CHART_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
