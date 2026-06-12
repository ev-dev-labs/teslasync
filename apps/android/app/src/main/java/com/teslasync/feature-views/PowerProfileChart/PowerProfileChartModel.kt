// Pure, framework-free model + projection for the Power Profile chart feature view — the native analogue of
// everything the web component reads before returning JSX
// (web/src/features/driving/components/drive-detail/PowerProfileChart.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is purely presentational — its parent (DriveDetailPage, via useDriveDetailData) builds
// the per-sample `ChartDataPoint[]` and the derived `DriveStats`, then passes both down. This file owns the
// two things the web render reads from those props:
//   * the per-sample `power` trace plotted as the single area (web `<Area dataKey="power" />`) and its
//     `time` x labels, with the `chartData.length > 1` content/empty boundary (web renders the
//     "No telemetry data available" branch for 0 or 1 samples),
//   * the three-figure footer the web shows below the chart when `chartData.length > 1` — Max Power
//     (`fmtInt(stats.powerMax) kW`), Max Regen (`fmtInt(stats.powerMin) kW`) and Avg
//     (`fmtNumber(stats.avgPower) kW`).
// [PowerProfileStats.from] additionally reproduces the exact web stat derivation
// (web/src/features/driving/components/drive-detail/useDriveDetailData.ts L144-151) so the host can build the
// `stats` prop the same way the web page does. Sample order is preserved exactly as received (the web
// generator emits ascending time and the chart maps in array order), so the native plot reads the same way.
//
// Units: the per-sample `power` arrives already in kW — the backend derives `power = pack_voltage *
// pack_current / 1000` per row (web useDriveDetailData comment), exactly as the web `chartData` carries it —
// so the only SI→display scale here is the fixed W→kW divide [PowerProfileStats.from] applies to the
// drive-level `avgPowerW` (SI watts), mirroring the web `drive.avgPowerW / 1000`. kW is the fixed power
// display unit (no `useUnits` preference is involved), matching the sibling charging surfaces.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/PowerProfileChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.powerprofilechart

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Watts per kilowatt — the fixed W→kW scale the web applies via `drive.avgPowerW / 1000`. */
internal const val WATTS_PER_KW: Double = 1000.0

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object PowerProfileChartRegistration {
    /** Stable surface id. */
    const val ID: String = "power-profile-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / drive data. */
    const val SLUG: String = "PowerProfileChart"
}

/**
 * One per-sample point on the power trace — the native mirror of the subset of the web `ChartDataPoint`
 * this chart reads (`time` + `power`). [power] is the instantaneous power in kW (web `dataKey="power"`),
 * already scaled by the backend; it may be negative under regen.
 *
 * @property time the x-axis category label (web `<XAxis dataKey="time" />`).
 * @property power instantaneous power in kW (web `dataKey="power"`); negative while regenerating.
 */
data class PowerProfilePoint(
    val time: String,
    val power: Double,
)

/**
 * The three power figures the footer renders — the native mirror of the subset of the web `DriveStats`
 * this component consumes (`powerMax` / `powerMin` / `avgPower`, all in kW). [from] reproduces the web
 * `useDriveDetailData` derivation verbatim so the host can build this the same way the web page does.
 *
 * @property powerMax the peak drive power in kW (web `stats.powerMax`).
 * @property powerMin the deepest regen power in kW (web `stats.powerMin`; negative under regen).
 * @property avgPower the time-averaged power in kW (web `stats.avgPower`).
 */
data class PowerProfileStats(
    val powerMax: Double,
    val powerMin: Double,
    val avgPower: Double,
) {
    companion object {
        /**
         * Derives the stats from the per-sample [points] and the drive-level [avgPowerW] — a verbatim port
         * of web useDriveDetailData.ts L144-151:
         *  - `powerValues = chartData.map(d => d.power).filter(p => p !== 0)` — non-zero samples only,
         *  - `powerMax = powerValues.length ? Math.max(...powerValues) : (avgPowerW ?? 0) / 1000`,
         *  - `powerMin = powerValues.length ? Math.min(...powerValues) : 0`,
         *  - `avgPower = avgPowerW != null ? avgPowerW / 1000 : (chartData.length ? mean(power) : 0)`.
         * [avgPowerW] is the drive's SI watts (web `drive.avgPowerW`), or `null` when the drive carries
         * none; the per-sample [PowerProfilePoint.power] is already kW, so only [avgPowerW] is scaled.
         */
        fun from(
            points: List<PowerProfilePoint>,
            avgPowerW: Double?,
        ): PowerProfileStats {
            val nonZero = points.map { it.power }.filter { it != 0.0 }
            val avgPowerKw = avgPowerW?.div(WATTS_PER_KW)
            return PowerProfileStats(
                powerMax = if (nonZero.isNotEmpty()) nonZero.max() else (avgPowerKw ?: 0.0),
                powerMin = if (nonZero.isNotEmpty()) nonZero.min() else 0.0,
                avgPower =
                    avgPowerKw ?: if (points.isNotEmpty()) points.sumOf { it.power } / points.size else 0.0,
            )
        }
    }
}

/**
 * The component's full input — the native mirror of the web `{ chartData, stats }` props. [from] is the
 * host convenience that derives [stats] from the trace + drive-level `avgPowerW` via [PowerProfileStats.from].
 *
 * @property points the per-sample power trace (web `chartData`).
 * @property stats the three footer figures (web `stats`).
 */
data class PowerProfileData(
    val points: List<PowerProfilePoint>,
    val stats: PowerProfileStats,
) {
    companion object {
        /** Builds the data from a raw trace, deriving the footer [PowerProfileStats] the web way. */
        fun from(
            points: List<PowerProfilePoint>,
            avgPowerW: Double? = null,
        ): PowerProfileData = PowerProfileData(points, PowerProfileStats.from(points, avgPowerW))
    }
}

/**
 * The injected display formatters + unit label the footer projection needs — the native analogue of the
 * web `fmtInt` / `fmtNumber` bound to the global precision/locale, plus the literal ` kW` suffix. Injecting
 * them keeps the projection locale/precision deterministic for the off-device tests.
 *
 * @property integer web `fmtInt(v)` — locale grouping, zero decimals (Max Power / Max Regen).
 * @property number web `fmtNumber(v)` — locale grouping at the user's precision (Avg).
 * @property powerUnit the fixed power unit suffix (`kW`).
 */
data class PowerProfileFormatters(
    val integer: (Double) -> String,
    val number: (Double) -> String,
    val powerUnit: String,
)

/**
 * The fully formatted footer row — the native mirror of the web `<div className="mt-3 …">` summary. Each
 * field is the value already formatted and unit-suffixed (e.g. `"95 kW"`), so the composable only colors
 * and labels them. Present only when the chart has content (web `{chartData.length > 1 && …}`).
 *
 * @property maxPower web `fmtInt(stats.powerMax) kW`.
 * @property maxRegen web `fmtInt(stats.powerMin) kW`.
 * @property avg web `fmtNumber(stats.avgPower) kW`.
 */
data class PowerProfileFooterData(
    val maxPower: String,
    val maxRegen: String,
    val avg: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of what the web `<AreaChart>` reads
 * from `chartData` plus the footer it renders below. Pure data (no Compose types) so the projection is
 * unit-tested without a UI host: the composable wraps [powerValues] into a single area `ChartSeries`, feeds
 * [xLabels] to the bottom axis, and renders [footer] as the Max/Regen/Avg summary.
 *
 * [footer] is `null` exactly when [isEmpty] is true (≤ 1 sample), reproducing the web boundary where the
 * footer renders only alongside the chart.
 */
data class PowerProfileChartProjectionResult(
    val xLabels: List<String>,
    val powerValues: List<Double?>,
    val footer: PowerProfileFooterData?,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's chart-data mapping
 * and footer derivation. Stateless and side-effect-free so it is fully covered by the off-device unit gate;
 * the composable only resolves localized strings, palette colors, the synced marker, and freshness chrome.
 */
object PowerProfileChartProjection {
    /**
     * Projects [data] into render-ready chart inputs, preserving the received order. [xLabels] feed the X
     * axis (web `dataKey="time"`), [powerValues] become the single area series (web `dataKey="power"`), and
     * the footer is built from `data.stats` via [buildFooter]. Sets
     * [PowerProfileChartProjectionResult.isEmpty] for the web `chartData.length > 1` boundary (≤ 1 sample ⇒
     * the empty surface and no footer).
     */
    fun project(
        data: PowerProfileData,
        formatters: PowerProfileFormatters,
    ): PowerProfileChartProjectionResult {
        val points = data.points
        val isEmpty = points.size <= 1
        return PowerProfileChartProjectionResult(
            xLabels = points.map { it.time },
            powerValues = points.map { it.power },
            footer = if (isEmpty) null else buildFooter(data.stats, formatters),
            isEmpty = isEmpty,
        )
    }

    /**
     * Builds the formatted footer — the web `Max Power: fmtInt(powerMax) kW` / `Max Regen: fmtInt(powerMin)
     * kW` / `Avg: fmtNumber(avgPower) kW`. Note the deliberate asymmetry the web encodes: the two extremes
     * use the integer formatter while the average keeps the user's decimal precision.
     */
    private fun buildFooter(
        stats: PowerProfileStats,
        formatters: PowerProfileFormatters,
    ): PowerProfileFooterData =
        PowerProfileFooterData(
            maxPower = withUnit(formatters.integer(stats.powerMax), formatters.powerUnit),
            maxRegen = withUnit(formatters.integer(stats.powerMin), formatters.powerUnit),
            avg = withUnit(formatters.number(stats.avgPower), formatters.powerUnit),
        )

    /** Joins a formatted number with a unit label (`"95 kW"`); the web template-literal `${v} ${unit}`. */
    private fun withUnit(
        value: String,
        unit: String,
    ): String = "$value $unit"
}

/**
 * Locale-aware number formatting that reproduces the web `numberFormat` helpers
 * (web/src/lib/numberFormat.ts) the footer uses. Pure (JVM-tested): a non-finite value is coerced to `0`
 * exactly as the web `safeNumber`, and grouping/precision follow `Intl.NumberFormat` with equal min/max
 * fraction digits. The composable binds these into a [PowerProfileFormatters] from the live unit prefs.
 */
object PowerProfileFormat {
    /** Web `numberFormat` default precision (`_globalPrecision`), used when settings carry none. */
    const val DEFAULT_PRECISION: Int = 2

    private const val MAX_PRECISION: Int = 20

    /** Web `fmtNumber(v, decimals)` — `safeNumber` then locale grouping at [precision] fraction digits. */
    fun number(
        value: Double,
        precision: Int,
        locale: Locale = Locale.getDefault(),
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val digits = precision.coerceIn(0, MAX_PRECISION)
        return String.format(locale, "%,.${digits}f", safe)
    }

    /** Web `fmtInt(v)` — [number] with zero fraction digits. */
    fun integer(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String = number(value, 0, locale)
}

/** Resource name (by-name; absent ⇒ [PowerProfileChartDefaults.ARIA_LABEL]) for web `driveDetail.powerProfile.aria`. */
const val KEY_ARIA: String = "translation_driveDetail_powerProfile_aria"

/**
 * Native fallback microcopy. The visible title/series/empty keys (`driveDetail.powerProfile`,
 * `driveDetail.power`, `driveDetail.noChartData`) and the footer labels (`driveDetail.maxPower`,
 * `driveDetail.maxRegen`, `driveDetail.avgLabel`) exist in the i18n catalog (P1/S10) and resolve at compile
 * time. This default backs the one string the catalog does not define: the chart's accessible description
 * (web `t('driveDetail.powerProfile.aria', …)`). It reproduces i18next's "return the default when the key
 * is absent" behaviour, so the surface still carries the web's English fallback verbatim while routing
 * through the i18n facade.
 */
object PowerProfileChartDefaults {
    /** Web `t('driveDetail.powerProfile.aria', '…')` default — the accessible chart description. */
    const val ARIA_LABEL: String = "Drive power profile area chart over time"
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
 * Emits the one PII-safe `view.opened` diagnostic with the surface [PowerProfileChartRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a timestamp or power figure — so a diagnostics line can never
 * leak the drive's power profile. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordPowerProfileChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to PowerProfileChartRegistration.SLUG))
}
