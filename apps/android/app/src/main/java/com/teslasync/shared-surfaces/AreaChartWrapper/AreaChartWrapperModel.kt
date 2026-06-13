// Pure, framework-free model + projection for the AreaChartWrapper shared surface — the native analogue of
// everything the web component does before it hands data to Recharts
// (web/src/components/charts/AreaChartWrapper.tsx). No Compose, no Android, no HTTP: every declaration here
// is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays a thin render
// layer over these pure functions.
//
// The web component is purely presentational. Its parent passes a generic `data: Record<string, unknown>[]`,
// the `xKey` that names the category field, and a `series: SeriesConfig[]` ({ key, label, color }); it then
// renders one gradient-filled `<Area>` per series over a shared X/Y grid, formatting axis ticks + the tooltip
// through the optional `xFormatter` / `yFormatter`. This file owns that derivation: it resolves each row's
// X label (web `<XAxis dataKey={xKey} tickFormatter={xFormatter} />`), coerces each series cell to a nullable
// number exactly as Recharts does (numbers and numeric strings plot; everything else is a gap), and builds the
// accessible fallback table the native ChartContainer renders for the opaque chart canvas. Row order is
// preserved end to end, so the native area chart and its fallback table read in the same order the caller
// supplied — mirroring the web, which plots `data` in array order.
//
// Color parity: the web `SeriesConfig.color` is a CSS hex string. Native callers hand a resolved ARGB int
// instead (the idiomatic Android form); a `null` color defers to the shared chart palette by series position,
// the same fallback the atomic `ChartSeries(color = null)` already encodes. The conversion to a Compose
// `Color` happens at the render boundary, never here, so this model stays framework-free.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AreaChartWrapper — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.areachartwrapper

import io.teslasync.shared.core.diagnostics.Logger

/** Em dash shown for a `null` / non-numeric cell in the accessible fallback table (the web empty marker). */
internal const val AREA_EM_DASH: String = "\u2014"

/**
 * One configured series — the native analogue of the web `SeriesConfig` (`{ key, label, color }`).
 *
 * @property key the data-row field this series reads (web `<Area dataKey={s.key} />`).
 * @property label the human label shown in the tooltip / legend / fallback-table header (web `s.label`).
 * @property colorArgb the resolved ARGB color (the native form of the web CSS-hex `s.color`); `null` defers
 *   to the shared chart palette by the series' position, mirroring the atomic `ChartSeries(color = null)`.
 */
data class AreaSeries(
    val key: String,
    val label: String,
    val colorArgb: Int? = null,
)

/**
 * One generic data row — the native analogue of the web `Record<string, unknown>`. [cells] maps a field name
 * (the `xKey` or a series `key`) to its raw value; the projection resolves the X label from the `xKey` cell
 * and coerces each series cell to a nullable number.
 */
data class AreaChartRow(
    val cells: Map<String, Any?>,
) {
    /** Vararg convenience for call-sites / tests: `AreaChartRow("t" to "Jan", "soc" to 80)`. */
    constructor(vararg pairs: Pair<String, Any?>) : this(pairs.toMap())
}

/**
 * One projected, render-ready series column — pure data (no Compose types). The composable wraps [values]
 * into an atomic `ChartSeries`, resolving [colorArgb] to a Compose `Color` (or the palette when `null`).
 */
data class AreaSeriesColumn(
    val key: String,
    val label: String,
    val colorArgb: Int?,
    val values: List<Double?>,
)

/**
 * The fully projected chart inputs — the native analogue of the data Recharts plots. [xLabels] feed the
 * bottom axis (one per row, in row order), [columns] become the gradient area series, and [isEmpty] is `true`
 * when there is nothing to plot (no rows or no series) so the composable shows the empty state, never a blank
 * box.
 */
data class AreaChartProjection(
    val xLabels: List<String>,
    val columns: List<AreaSeriesColumn>,
    val isEmpty: Boolean,
) {
    companion object {
        /** The nothing-to-plot projection (web: no `<Area>` rendered). */
        val EMPTY: AreaChartProjection = AreaChartProjection(emptyList(), emptyList(), isEmpty = true)
    }
}

/**
 * The pure projection the composable renders — a 1:1 port of the data preparation the web `AreaChartWrapper`
 * performs inline before returning JSX. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate; the composable only resolves localized chrome, palette colors, and freshness state.
 */
object AreaChartWrapperProjection {
    /**
     * Coerces a generic cell to the nullable number Recharts would plot — a verbatim port of the web's
     * implicit coercion: a [Number] (or a numeric [String]) becomes its [Double] value; a non-finite number
     * or any other type becomes `null`, which the chart draws as a gap (the Android `connectNulls`).
     */
    fun toNullableDouble(value: Any?): Double? =
        when (value) {
            is Number -> value.toDouble().takeIf { it.isFinite() } // parity:allow stdlib numeric conversion, not a TODO
            is String -> value.toDoubleOrNull()?.takeIf { it.isFinite() } // parity:allow stdlib parse, not a TODO
            else -> null
        }

    /**
     * Resolves a row's X label — the web `<XAxis dataKey={xKey} tickFormatter={xFormatter} />`. The raw cell
     * is stringified (a `null` cell becomes the empty string, as Recharts renders a missing category) and then
     * passed through [formatter] (the web `xFormatter`, identity by default).
     */
    fun formatX(
        value: Any?,
        formatter: (String) -> String,
    ): String = formatter(value?.toString() ?: "")

    /**
     * Projects [rows] into render-ready chart inputs. Returns [AreaChartProjection.EMPTY] when there is
     * nothing to plot (no rows or no series — the web renders no `<Area>`). Otherwise [AreaChartProjection.xLabels]
     * is one resolved label per row (in row order) and each [series] entry becomes an [AreaSeriesColumn] whose
     * values are the per-row coerced numbers for that series' `key`.
     *
     * @param xFormatter the web `xFormatter`; defaults to identity (raw category label).
     */
    fun project(
        rows: List<AreaChartRow>,
        xKey: String,
        series: List<AreaSeries>,
        xFormatter: (String) -> String = { it },
    ): AreaChartProjection {
        if (rows.isEmpty() || series.isEmpty()) return AreaChartProjection.EMPTY
        val xLabels = rows.map { formatX(it.cells[xKey], xFormatter) }
        val columns =
            series.map { s ->
                AreaSeriesColumn(
                    key = s.key,
                    label = s.label,
                    colorArgb = s.colorArgb,
                    values = rows.map { toNullableDouble(it.cells[s.key]) },
                )
            }
        return AreaChartProjection(xLabels = xLabels, columns = columns, isEmpty = false)
    }

    /**
     * The accessible fallback-table header: the [xAxisLabel] for the category column followed by each
     * projected series' label, in series order — so the table columns line up with [tableRows].
     */
    fun tableHeader(
        xAxisLabel: String,
        projection: AreaChartProjection,
    ): List<String> = listOf(xAxisLabel) + projection.columns.map { it.label }

    /**
     * The accessible fallback-table rows: one row per X label, each carrying the category label then every
     * series' value at that row, formatted via [formatValue]. A `null` (gap) cell renders as [AREA_EM_DASH]
     * so a sparse series never shows a blank or `NaN` cell.
     */
    fun tableRows(
        projection: AreaChartProjection,
        formatValue: (Double) -> String,
    ): List<List<String>> =
        projection.xLabels.indices.map { i ->
            listOf(projection.xLabels[i]) +
                projection.columns.map { column -> column.values[i]?.let(formatValue) ?: AREA_EM_DASH }
        }
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened` event
 * tagged with the surface [SLUG] — never any plotted value, category, or series label, so a diagnostics line
 * can never leak the data the chart renders.
 */
object AreaChartWrapperDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "area-chart-wrapper"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "AreaChartWrapper"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the view's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
