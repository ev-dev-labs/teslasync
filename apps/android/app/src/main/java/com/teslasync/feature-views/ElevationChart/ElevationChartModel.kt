// Pure, framework-free model + projection for the Elevation Profile chart feature view — the native
// analogue of everything the web component reads from its props before returning JSX
// (web/src/features/driving/components/drive-detail/ElevationChart.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational. Its parent (the Drive Detail page, web `useDriveDetailData`)
// builds the `ChartDataPoint[]` — converting each sample's SI `speed` to the user's display unit via
// `convertSpeedFromSI(_, unitPrefs.speed)` and leaving `elevation` in SI metres — and computes the
// `DriveStats` (cumulative `elevGain` / `elevLoss` in metres). The component then renders a `ComposedChart`
// of an elevation Area (metres) + a speed Line (display unit) over the time axis, with a gain / loss / net
// header above it, and a friendly "No telemetry data available" surface when `chartData.length <= 1`.
// This file owns that contract's pure half: the prop slice the surface reads, the lifecycle-state builder
// (`elevationChartState`), the render-ready projection (x labels, the two series' value lists, the
// formatted gain / loss / net strings, and the `< 2 samples` empty guard), the web `fmtNumber`-faithful
// number formatter, and the PII-safe `view.opened` diagnostic.
//
// SI boundary (unit-conversion instructions, ADR / Phase-48): `elevationMeters` and the gain / loss totals
// are SI metres exactly as the API serves them — the web shows them with a literal `m`, so no preference
// conversion happens here. `speed` arrives ALREADY in the user's display unit (the web parent converts it,
// mirrored by the host on Android); this surface only labels it with the unit symbol, so — like the web
// component — the projection performs no speed math, only formatting.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ElevationChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.elevationchart

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/** Minimum samples the web renders a chart for — the web `chartData.length > 1` guard; below it, empty. */
internal const val MIN_RENDERABLE_SAMPLES: Int = 2

/**
 * Default fraction digits — the web `fmtNumber` `_globalPrecision` default (2) used before a
 * `decimal_precision` setting loads. The composable overrides it with the user's resolved precision.
 */
internal const val DEFAULT_DECIMALS: Int = 2

/** Upper bound on fraction digits — the web `fmtNumber` `Math.min(20, decimals)` clamp. */
internal const val MAX_DECIMALS: Int = 20

/** The SI metre symbol — the web's literal `m` suffix on gain / loss / net and the elevation series name. */
internal const val METERS_UNIT: String = "m"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ElevationChartRegistration {
    /** Stable surface id. */
    const val ID: String = "elevation-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ElevationChart"
}

/**
 * One telemetry sample along the drive timeline — the native slice of the web `ChartDataPoint` this
 * surface reads (`time`, `elevation`, `speed`); the rest of the web type (battery, power, temps, ranges,
 * tyres, …) belongs to the sibling drive-detail charts and is intentionally omitted.
 *
 * @property time the formatted clock label for the X axis (web `ChartDataPoint.time`).
 * @property elevationMeters the elevation above sea level in SI metres (web `elevation`, never converted).
 * @property speed the speed ALREADY in the user's display unit (web `chartData.speed`, pre-converted by the
 *   parent via `convertSpeedFromSI`); `null` marks a gap the line bridges (the Android `connectNulls`).
 */
data class ElevationSample(
    val time: String,
    val elevationMeters: Double,
    val speed: Double?,
)

/**
 * The cumulative elevation totals the header reads — the native slice of the web `DriveStats`
 * (`elevGain` / `elevLoss`). Both are SI metres (sums of the per-sample positive / negative elevation
 * deltas the web computes upstream), so the header renders them with the literal `m` symbol.
 *
 * @property elevGainMeters total metres climbed over the drive (web `stats.elevGain`).
 * @property elevLossMeters total metres descended over the drive (web `stats.elevLoss`).
 */
data class ElevationStats(
    val elevGainMeters: Double,
    val elevLossMeters: Double,
)

/**
 * The full prop bundle this surface renders — the native pairing of the web component's `chartData` and
 * `stats` props. The host (the Drive Detail page's state holder, P1/S8) supplies it; the surface performs
 * no fetch and no unit conversion of its own.
 */
data class ElevationChartData(
    val samples: List<ElevationSample>,
    val stats: ElevationStats,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the
 * `driveDetail.*` keys the web component resolves via `t(...)`. The lifecycle-chrome strings
 * (empty / error / retry / offline / freshness) are resolved inline at the Compose boundary, not here, so
 * this holder stays a thin content carrier.
 *
 * @property title the panel title (web `driveDetail.elevProfile`).
 * @property ariaLabel the chart's screen-reader description (web `driveDetail.elevProfile.aria`).
 * @property elevationSeriesLabel the elevation series / legend name (web `driveDetail.elevation`).
 * @property speedSeriesLabel the speed series / legend name (web `driveDetail.speed`).
 * @property gainLabel the gain header suffix (web `driveDetail.gain`).
 * @property lossLabel the loss header suffix (web `driveDetail.loss`).
 * @property netLabel the net header prefix (web `driveDetail.net`).
 */
data class ElevationChartStrings(
    val title: String,
    val ariaLabel: String,
    val elevationSeriesLabel: String,
    val speedSeriesLabel: String,
    val gainLabel: String,
    val lossLabel: String,
    val netLabel: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of what the web component reads
 * from its props inline. Pure data (no Compose types) so the projection is unit-tested without a UI host:
 * the composable feeds [xLabels] to the bottom axis, wraps [elevationValues] / [speedValues] into the two
 * `ChartSeries`, renders [gainText] / [lossText] / [netText] in the header, and shows the friendly empty
 * state when [isEmpty] (the web `chartData.length <= 1` branch — a single point cannot draw a trace).
 */
data class ElevationChartProjectionResult(
    val xLabels: List<String>,
    val elevationValues: List<Double?>,
    val speedValues: List<Double?>,
    val gainText: String,
    val lossText: String,
    val netText: String,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — a 1:1 port of the inline derivations in the web
 * `ElevationChart`. Stateless and side-effect-free so it is fully covered by the off-device unit gate; the
 * composable only resolves localized strings, palette colors, the synced cursor, and freshness chrome.
 */
object ElevationChartProjection {
    /**
     * Projects [data] into render-ready inputs. [xLabels] are the per-sample time labels (web
     * `<XAxis dataKey="time" />`), [elevationValues] / [speedValues] become the Area / Line series (kept
     * index-aligned with the labels, `null` speed preserved as a gap), and [gainText] / [lossText] /
     * [netText] are the metre-suffixed header figures (`fmtNumber(elevGain) m`, …, and the web
     * `elevGain - elevLoss` net). [isEmpty] is true for fewer than [MIN_RENDERABLE_SAMPLES] samples,
     * reproducing the web `chartData.length > 1` gate. Injecting [formatMeters] keeps the projection
     * locale-deterministic under test.
     */
    fun project(
        data: ElevationChartData,
        formatMeters: (Double) -> String,
    ): ElevationChartProjectionResult {
        val samples = data.samples
        val gain = data.stats.elevGainMeters
        val loss = data.stats.elevLossMeters
        return ElevationChartProjectionResult(
            xLabels = samples.map { it.time },
            elevationValues = samples.map { it.elevationMeters },
            speedValues = samples.map { it.speed },
            gainText = withMeters(gain, formatMeters),
            lossText = withMeters(loss, formatMeters),
            netText = withMeters(gain - loss, formatMeters),
            isEmpty = samples.size < MIN_RENDERABLE_SAMPLES,
        )
    }

    /** `"<formatted> m"` — the web template `{fmtNumber(value)} m`. */
    private fun withMeters(
        value: Double,
        formatMeters: (Double) -> String,
    ): String = "${formatMeters(value)} $METERS_UNIT"

    /**
     * Locale-aware fixed-precision number formatting — the faithful port of the web `fmtNumber`
     * (`toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d })` over
     * `safeNumber(v)`). A non-finite value renders as `0` (the web `safeNumber` guard), [decimals] is
     * clamped to `0..`[MAX_DECIMALS] (the web `Math.min(20, …)`), and grouping + the decimal separator come
     * from [locale]. Half-up rounding matches the sibling surfaces' formatters.
     */
    fun formatNumber(
        value: Double,
        decimals: Int = DEFAULT_DECIMALS,
        locale: Locale = Locale.getDefault(),
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val safeDecimals = decimals.coerceIn(0, MAX_DECIMALS)
        val pattern =
            buildString {
                append("#,##0")
                if (safeDecimals > 0) {
                    append('.')
                    repeat(safeDecimals) { append('0') }
                }
            }
        return DecimalFormat(pattern, DecimalFormatSymbols(locale))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(safe)
    }
}

/**
 * Builds the prop-driven [UiState] the web-parity overload renders — the native mirror of the web
 * component receiving `chartData` + `stats` directly from its parent. A `null`/short sample list maps to
 * [UiPhase.Empty] (the web `chartData.length <= 1` branch); two or more samples map to [UiPhase.Content].
 * Missing [stats] default to zero totals so the header still renders. There is no fetch behind this, so it
 * carries no freshness/error fields — those live on the host feed when the stateful entry is used.
 */
fun elevationChartState(
    samples: List<ElevationSample>?,
    stats: ElevationStats?,
): UiState<ElevationChartData> {
    val resolved = samples ?: emptyList()
    val data = ElevationChartData(samples = resolved, stats = stats ?: ElevationStats(0.0, 0.0))
    val phase = if (resolved.size < MIN_RENDERABLE_SAMPLES) UiPhase.Empty else UiPhase.Content
    return UiState(phase = phase, data = data)
}

/** Resolves a BCP-47 [tag] to a [Locale], falling back to US for a blank/absent preference. */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ElevationChartRegistration.SLUG]
 * (P1/S11). Carries only the slug — never an elevation, speed, or timestamp — so a diagnostics line can
 * never leak the fleet's routes. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordElevationChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ElevationChartRegistration.SLUG))
}
