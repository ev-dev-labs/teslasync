// Pure, framework-free model + projection for the Motor Torque history chart feature view — the native
// analogue of everything the web component reads before it returns JSX
// (web/src/features/driving/components/drivetrain-health/TorqueHistoryChart.tsx). No Compose, no Android, no
// HTTP: every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational. Its parent (the Drivetrain Health surface) builds the
// per-sample `MotorChartDataPoint[]` and passes it down; the component then plots the single `torque` trace
// (cyan area, with a zero baseline `<ReferenceLine y={0}>`) over a `time` X axis inside a shared
// `<ChartContainer height={280}>` that also exposes a `data`/`dataColumns` accessible fallback table
// (`Time`, `Torque (Nm)`). Its only branch is the content/empty boundary `data.length <= 1 ||
// !data.some(d => d.torque !== null)` — i.e. it returns nothing unless there is more than one sample AND at
// least one non-null torque reading. This file owns that render-ready projection plus the accessible-table
// rows; the composable only resolves localized strings, the palette color, and the lifecycle/freshness
// chrome the shared P1/S8 state layer implies.
//
// Units (Phase-48 SI-canonical / unit-conversion instructions): torque is reported in newton-metres (Nm),
// which is already SI — there is no user display-unit preference for torque and no conversion here, exactly
// as the web component performs none (unlike its sibling `TemperatureTrendChart`, which routes through
// `useUnits`). The `time` value is an opaque, already-formatted X-axis label the parent emits, carried
// through verbatim.
//
// Accessible-table parity: the web `ChartContainer` renders each cell as `col.format != null ? col.format(raw)
// : raw == null ? '—' : String(raw)`. This surface passes no `format`, so each torque cell is the raw value
// stringified (no locale grouping) with a null reading rendered as the em dash. [formatTableCell] +
// [plainNumber] reproduce that `String(raw)` / `'—'` contract exactly.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TorqueHistoryChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.torquehistorychart

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.floor

/** The fixed torque unit suffix — newton-metres. SI; never converted (web literal `(Nm)`). */
internal const val TORQUE_UNIT: String = "Nm"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object TorqueHistoryChartRegistration {
    /** Stable surface id. */
    const val ID: String = "torque-history-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / drive data. */
    const val SLUG: String = "TorqueHistoryChart"
}

/**
 * One per-sample point on the torque trace — the native mirror of the subset of the web
 * `MotorChartDataPoint` this chart reads (`time` + `torque`). [torque] is the instantaneous motor torque in
 * newton-metres (web `dataKey="torque"`); it is nullable to represent a sample with no reading (web
 * `number | null`), drawn as a gap the area connects across (web `AREA_DEFAULTS.connectNulls`), and may be
 * negative under regenerative braking.
 *
 * @property time the x-axis category label (web `<XAxis dataKey="time" />`); opaque, already formatted.
 * @property torque instantaneous torque in Nm (web `dataKey="torque"`), or `null` when the sample has none.
 */
data class TorqueHistoryPoint(
    val time: String,
    val torque: Double?,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the keys the
 * web component resolves via `t(...)`: the panel [title] (`drivetrain.torqueHistory`), the [subtitle]
 * (`drivetrain.torqueHistorySub`), the base [torque] series word (`drivetrain.torque`, suffixed ` (Nm)` for
 * the legend), the accessible-table [timeColumn] (`drivetrain.col.time`) and [torqueColumn]
 * (`drivetrain.col.torque`) headers, and the [accessibleDescription] (`drivetrain.torqueHistory.aria`,
 * catalog-absent ⇒ the web English fallback). The lifecycle chrome (empty / error / retry / offline /
 * freshness) is resolved inline at the Compose boundary.
 */
data class TorqueHistoryChartStrings(
    val title: String,
    val subtitle: String,
    val torque: String,
    val timeColumn: String,
    val torqueColumn: String,
    val accessibleDescription: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of what the web `<AreaChart>` reads
 * from `data` plus the ChartContainer `data`/`dataColumns` accessible-table props. Pure data (no Compose
 * types) so the projection is unit-tested without a UI host: the composable wraps [torqueValues] into a
 * single area `ChartSeries`, feeds [times] to the bottom axis, and renders [tableRows] as the accessible
 * fallback table (`Time`, `Torque (Nm)`).
 *
 * [isEmpty] is the web content/empty boundary (`data.length <= 1 || !data.some(d => d.torque !== null)`):
 * true ⇒ the friendly empty surface (the native honest counterpart of the web's `return null`), and the
 * shared container then renders no table.
 */
data class TorqueHistoryChartProjectionResult(
    val times: List<String>,
    val torqueValues: List<Double?>,
    val tableRows: List<List<String>>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — a 1:1 port of the web component's chart + table bindings.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate; the composable only
 * resolves localized strings, the palette color, and the freshness chrome.
 */
object TorqueHistoryChartProjection {
    /**
     * Projects [points] into render-ready chart inputs, preserving input order (the web maps `data` in array
     * order and never re-sorts). [times] feed the X axis (web `<XAxis dataKey="time" />`), [torqueValues]
     * become the single area series (web `<Area dataKey="torque" />`, nulls = gaps), and each point
     * contributes one accessible-table row (`[time, formatTableCell(torque)]`). Injecting [formatTorqueCell]
     * keeps the projection deterministic for tests; the composable supplies [formatTableCell].
     * [TorqueHistoryChartProjectionResult.isEmpty] is the web `data.length <= 1 ||
     * !data.some(d => d.torque !== null)` boundary.
     */
    fun project(
        points: List<TorqueHistoryPoint>,
        formatTorqueCell: (Double?) -> String = ::formatTableCell,
    ): TorqueHistoryChartProjectionResult =
        TorqueHistoryChartProjectionResult(
            times = points.map { it.time },
            torqueValues = points.map { it.torque },
            tableRows = points.map { listOf(it.time, formatTorqueCell(it.torque)) },
            isEmpty = !isRenderable(points),
        )

    /**
     * Projects the web component's `{ data }` prop onto the shared cache-then-network [UiState], mirroring
     * the web component's only branch: a renderable series ([isRenderable]) is [UiPhase.Content]; an empty,
     * single-sample, all-null, or (defensively) `null` series is [UiPhase.Empty] — the web `return null`
     * surfaced honestly as a friendly empty state. The web component carries no loading or error branch (its
     * parent gates those), so neither does this overload projection; loading / error / stale / offline are
     * driven only through the stateful entry's host-owned [UiState].
     */
    fun projectUiState(points: List<TorqueHistoryPoint>?): UiState<List<TorqueHistoryPoint>> {
        val value = points ?: emptyList()
        return if (isRenderable(value)) {
            UiState(phase = UiPhase.Content, data = value)
        } else {
            UiState(phase = UiPhase.Empty, data = value)
        }
    }

    /**
     * The web content boundary `data.length > 1 && data.some(d => d.torque !== null)`: a torque chart needs
     * more than one sample AND at least one non-null reading to be worth drawing.
     */
    fun isRenderable(points: List<TorqueHistoryPoint>): Boolean = points.size > 1 && points.any { it.torque != null }

    /**
     * Formats one accessible-table torque cell — the web `raw == null ? '—' : String(raw)` (this surface
     * passes no `col.format`): a `null` reading renders as the em dash, any value as its plain, ungrouped
     * stringification.
     */
    fun formatTableCell(torque: Double?): String = if (torque == null) ChartFormat.EMPTY else plainNumber(torque)

    /**
     * Reproduces JavaScript `String(Number)` for a finite value: a whole number drops its fractional part
     * (`250.0` → `"250"`) and any other value keeps its natural, ungrouped representation (`248.5` →
     * `"248.5"`), exactly as the web `String(raw)` renders a table cell with no formatter. A non-finite value
     * (never produced by torque telemetry) degrades to the em dash so the table never shows `NaN`.
     */
    internal fun plainNumber(value: Double): String {
        if (!value.isFinite()) return ChartFormat.EMPTY
        return if (value == floor(value)) value.toLong().toString() else value.toString()
    }
}

/** Resource name (by-name; absent ⇒ [TorqueHistoryChartDefaults.ARIA_LABEL]) for web `drivetrain.torqueHistory.aria`. */
const val KEY_ARIA: String = "translation_drivetrain_torqueHistory_aria"

/**
 * Native fallback microcopy. The visible title/subtitle/series/column keys (`drivetrain.torqueHistory`,
 * `drivetrain.torqueHistorySub`, `drivetrain.torque`, `drivetrain.col.time`, `drivetrain.col.torque`) exist
 * in the i18n catalog (P1/S10) and resolve at compile time. This default backs the one string the catalog
 * does not define: the chart's accessible description (web `t('drivetrain.torqueHistory.aria', …)`). It
 * reproduces i18next's "return the default when the key is absent" behaviour, so the surface still carries
 * the web's English fallback verbatim while routing through the i18n facade.
 */
object TorqueHistoryChartDefaults {
    /** Web `t('drivetrain.torqueHistory.aria', '…')` default — the accessible chart description. */
    const val ARIA_LABEL: String = "Motor inverter torque output history area chart"
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a
 * thin seam over the Android string catalog in production (an optional by-name resource read) and a map in
 * tests, so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TorqueHistoryChartRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a timestamp or torque figure — so a diagnostics line can never
 * leak the drive's torque profile. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordTorqueHistoryChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TorqueHistoryChartRegistration.SLUG))
}
