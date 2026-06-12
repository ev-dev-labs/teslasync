// Pure, framework-free model + projection for the TemperatureSection feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/driving/components/drive-detail/TemperatureSection.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// The web component is purely presentational. Its parent (`useDriveDetailData`) builds the per-sample
// `ChartDataPoint[]` and the aggregate `DriveStats`, having ALREADY converted every temperature from SI
// Celsius into the user's display unit via `convertTempFromSI` (Phase-48: the backend serves SI, the
// conversion is display-only and happens once at the data boundary). The component therefore performs no
// unit math itself — it formats the pre-converted values with `fmtNumber`/`fmtInt` and appends the unit
// symbol `tempUnit`. This port keeps that exact contract: [TemperatureSample] carries display-unit temps
// and the projection only labels + formats them; it never re-converts.
//
// This file owns the parts the web render derives from those props:
//   * the `chartData.length > 1 && stats.hasAnyTemp` content/empty boundary (web shows the friendly
//     "No temperature telemetry…" surface otherwise),
//   * the six conditional stat tiles — Outside (`stats.avgOutsideTemp`), Inside (`stats.avgInsideTemp`),
//     Driver / Passenger (the component's own `reduce`-based averages of `stats.driverTemps` /
//     `stats.passengerTemps`), Climate (`stats.climateStatus`) and Fan (`stats.maxFanSpeed`) — each
//     present only when its value exists, exactly as the web `x != null ? <tile/> : null` guards,
//   * the four conditional lines (Outside / Inside / Driver / Passenger), each plotted only when that
//     series has at least one sample (web `stats.outsideTemps.length > 0` …), and
//   * the climate-status classification and the fan avg/max figures, which the web parent precomputes
//     from the same `climateOn` / `fanStatus` samples — reproduced here so the whole derivation is one
//     pure, testable unit.
// Sample order is preserved exactly as received (the web generator emits ascending time and the chart
// maps in array order), so the native plot, legend and x-axis read in the same order.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TemperatureSection — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.temperaturesection

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Web `fmtNumber`'s default precision (`_globalPrecision`), used when settings carry none. */
const val DEFAULT_PRECISION: Int = 2

/** Fan averages/maxima render as whole numbers — web `fmtInt(avgFanSpeed)` / raw `${maxFanSpeed}`. */
private const val FAN_FRACTION_DIGITS: Int = 0

/** Upper bound on fraction digits, guarding a hostile precision setting (mirrors `Intl`'s clamp). */
private const val MAX_PRECISION: Int = 20

/** The four temperature traces, in the web render + legend order. Each maps to a label + palette color. */
enum class TemperatureSeriesId { Outside, Inside, Driver, Passenger }

/**
 * The climate-control status the web parent derives from the drive's `climateOn` samples (web
 * `useDriveDetailData`): `On` when the cabin HVAC was on for at least half the samples, `MostlyOff` when
 * it was on for some but fewer than half, and `Off` when it was never on but was explicitly off. A drive
 * with no climate samples yields no tile (the projection emits `null`). The web colors only `On` green.
 */
enum class ClimateStatus { On, MostlyOff, Off }

/**
 * One per-sample point on the temperature trace — the native mirror of the subset of the web
 * `ChartDataPoint` this surface reads. The parent supplies the four temperatures ALREADY converted into
 * the user's display unit (web `convertTempFromSI(...)` in `useDriveDetailData`), so this surface only
 * labels them; [climateOn] / [fanStatus] are the raw climate samples the web parent aggregates.
 *
 * @property time the x-axis category label (web `<XAxis dataKey="time" />`).
 * @property outsideTemp display-unit ambient temperature (web `dataKey="outsideTemp"`), or `null`.
 * @property insideTemp display-unit cabin temperature (web `dataKey="insideTemp"`), or `null`.
 * @property driverTemp display-unit driver setpoint (web `dataKey="driverTemp"`), or `null`.
 * @property passengerTemp display-unit passenger setpoint (web `dataKey="passengerTemp"`), or `null`.
 * @property climateOn whether HVAC was on at this sample (web `climateOn`), or `null` when unknown.
 * @property fanStatus the fan speed level at this sample (web `fanStatus`), or `null` when unknown.
 */
data class TemperatureSample(
    val time: String,
    val outsideTemp: Double? = null,
    val insideTemp: Double? = null,
    val driverTemp: Double? = null,
    val passengerTemp: Double? = null,
    val climateOn: Boolean? = null,
    val fanStatus: Double? = null,
)

/**
 * One render-ready stat tile — the native mirror of a single web `<div class="…tile">`. A tile is only
 * present in [TemperatureSectionDisplay.tiles] when its web guard passed, so the renderer never has to
 * decide presence. The localized caption + accent color are resolved at the Compose boundary from the
 * variant; the numeric/value text is fully formatted here so it is covered by the off-device gate.
 */
sealed interface TemperatureTile {
    /**
     * A cabin/ambient/driver/passenger average tile (web blue/orange/rose/purple). [value] is the
     * web `fmtNumber(avg)` + `tempUnit` string, e.g. `"21.00°C"`.
     */
    data class Temp(
        val id: TemperatureSeriesId,
        val value: String,
    ) : TemperatureTile

    /** The climate on/off status tile (web colors green only when [status] is [ClimateStatus.On]). */
    data class Climate(
        val status: ClimateStatus,
    ) : TemperatureTile

    /**
     * The fan-status tile (web cyan). [avg] is `fmtInt(avgFanSpeed)`, [max] the raw `maxFanSpeed`; the
     * Compose boundary composes them as `"{Avg} {avg} · {Max} {max}"` with the localized Avg/Max labels.
     */
    data class Fan(
        val avg: String,
        val max: String,
    ) : TemperatureTile
}

/**
 * One render-ready chart line — the native mirror of a web `<Line dataKey=… name="{label} {tempUnit}">`.
 * Present in [TemperatureSectionDisplay.series] only when the web guard (`stats.{x}Temps.length > 0`)
 * passed. [values] preserves sample order with `null` gaps bridged by the chart wrapper; the label +
 * color resolve from [id] at the Compose boundary.
 */
data class TemperatureSeries(
    val id: TemperatureSeriesId,
    val values: List<Double?>,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property isEmpty the web `!(chartData.length > 1 && stats.hasAnyTemp)` boundary; when true the surface
 *   renders the friendly empty state instead of the tiles + chart.
 * @property unitLabel the temperature unit symbol appended to each value + each line name (web `tempUnit`).
 * @property tiles the present stat tiles, in the web render order (Outside, Inside, Driver, Passenger,
 *   Climate, Fan); never includes an absent tile, so the renderer maps the list 1:1.
 * @property xLabels the x-axis category labels (web `dataKey="time"`), in sample order.
 * @property series the present temperature lines, in the web render + legend order.
 */
data class TemperatureSectionDisplay(
    val isEmpty: Boolean,
    val unitLabel: String,
    val tiles: List<TemperatureTile>,
    val xLabels: List<String>,
    val series: List<TemperatureSeries>,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's tile + chart
 * derivation. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object TemperatureSectionProjection {
    /**
     * Projects the loaded [samples] into the render-ready [TemperatureSectionDisplay], preserving order.
     * Reproduces the web guards verbatim: the `chartData.length > 1 && hasAnyTemp` empty boundary, the six
     * conditional tiles (Outside/Inside via the precomputed averages, Driver/Passenger via the component's
     * own `reduce` averages, Climate via the classified status, Fan via the avg/max), and the four
     * conditional lines. [unitLabel] is the user's temperature symbol (web `useUnits().unitPrefs.temperature`,
     * e.g. `°C` / `°F`), [precision] the global `fmtNumber` precision, and [locale] the grouping locale.
     */
    fun project(
        samples: List<TemperatureSample>,
        unitLabel: String,
        precision: Int,
        locale: Locale,
    ): TemperatureSectionDisplay {
        val outside = column(samples) { it.outsideTemp }
        val inside = column(samples) { it.insideTemp }
        val driver = column(samples) { it.driverTemp }
        val passenger = column(samples) { it.passengerTemp }
        val hasAnyTemp =
            outside.any { it != null } ||
                inside.any { it != null } ||
                driver.any { it != null } ||
                passenger.any { it != null }

        return TemperatureSectionDisplay(
            isEmpty = samples.size <= 1 || !hasAnyTemp,
            unitLabel = unitLabel,
            tiles = buildTiles(samples, outside, inside, driver, passenger, unitLabel, precision, locale),
            xLabels = samples.map { it.time },
            series =
                buildList {
                    tempSeries(TemperatureSeriesId.Outside, outside)?.let { add(it) }
                    tempSeries(TemperatureSeriesId.Inside, inside)?.let { add(it) }
                    tempSeries(TemperatureSeriesId.Driver, driver)?.let { add(it) }
                    tempSeries(TemperatureSeriesId.Passenger, passenger)?.let { add(it) }
                },
        )
    }

    /** Builds the ordered present tiles — the native mirror of the web tile grid's conditional children. */
    @Suppress("LongParameterList")
    private fun buildTiles(
        samples: List<TemperatureSample>,
        outside: List<Double?>,
        inside: List<Double?>,
        driver: List<Double?>,
        passenger: List<Double?>,
        unitLabel: String,
        precision: Int,
        locale: Locale,
    ): List<TemperatureTile> =
        buildList {
            tempTile(TemperatureSeriesId.Outside, mean(outside), unitLabel, precision, locale)?.let { add(it) }
            tempTile(TemperatureSeriesId.Inside, mean(inside), unitLabel, precision, locale)?.let { add(it) }
            tempTile(TemperatureSeriesId.Driver, mean(driver), unitLabel, precision, locale)?.let { add(it) }
            tempTile(TemperatureSeriesId.Passenger, mean(passenger), unitLabel, precision, locale)?.let { add(it) }
            climateStatus(samples)?.let { add(TemperatureTile.Climate(it)) }
            fanTile(samples, locale)?.let { add(it) }
        }

    /**
     * One temperature tile, or `null` when the series has no sample (web `avg != null ? <tile/> : null`).
     * The value mirrors the web `fmtNumber(avg)` + `tempUnit`: the converted average is already in display
     * units, so it is only formatted (with [safe] coercion, the web `fmtNumber` NaN→0) and unit-suffixed.
     */
    private fun tempTile(
        id: TemperatureSeriesId,
        avg: Double?,
        unitLabel: String,
        precision: Int,
        locale: Locale,
    ): TemperatureTile.Temp? = avg?.let { TemperatureTile.Temp(id, formatNumber(safe(it), precision, locale) + unitLabel) }

    /** One temperature line, or `null` when the series has no sample (web `stats.{x}Temps.length > 0`). */
    private fun tempSeries(
        id: TemperatureSeriesId,
        values: List<Double?>,
    ): TemperatureSeries? = if (values.any { it != null }) TemperatureSeries(id, values) else null

    /**
     * Classifies the climate status from the [samples], reproducing the web parent's derivation
     * (`useDriveDetailData`): `On` when the cabin was on for ≥ half the on/off samples, `MostlyOff` when on
     * for some but fewer than half, `Off` when only-ever-off, and `null` (no tile) when no climate sample.
     */
    fun climateStatus(samples: List<TemperatureSample>): ClimateStatus? {
        val onCount = samples.count { it.climateOn == true }
        val offCount = samples.count { it.climateOn == false }
        return when {
            onCount > 0 -> if (onCount >= offCount) ClimateStatus.On else ClimateStatus.MostlyOff
            offCount > 0 -> ClimateStatus.Off
            else -> null
        }
    }

    /**
     * The fan tile, or `null` when no fan sample (web `stats.maxFanSpeed != null`). [TemperatureTile.Fan.avg]
     * is `fmtInt(avgFanSpeed)` (zero-decimal, grouped); [TemperatureTile.Fan.max] mirrors the web's raw
     * `${maxFanSpeed}` interpolation — a plain integer with no grouping for the small fan-speed range.
     */
    private fun fanTile(
        samples: List<TemperatureSample>,
        locale: Locale,
    ): TemperatureTile.Fan? {
        val values = samples.mapNotNull { it.fanStatus }.filter { it.isFinite() }
        if (values.isEmpty()) return null
        val avg = values.sum() / values.size
        val max = values.max()
        return TemperatureTile.Fan(
            avg = formatNumber(avg, FAN_FRACTION_DIGITS, locale),
            max = plainInt(max),
        )
    }

    /** Extracts a per-sample value column in order (web `chartData.map((d) => d.field)`). */
    private fun column(
        samples: List<TemperatureSample>,
        selector: (TemperatureSample) -> Double?,
    ): List<Double?> = samples.map(selector)

    /**
     * The mean of the present samples, or `null` when none — the web
     * `arr.length > 0 ? arr.reduce((a,b)=>a+b,0)/arr.length : null`. Only `null` samples are dropped (the
     * web `filter((d) => d.field !== null)`); a non-finite value is left to [safe] at format time, matching
     * the web `fmtNumber` NaN→0 coercion.
     */
    fun mean(values: List<Double?>): Double? {
        val present = values.filterNotNull()
        if (present.isEmpty()) return null
        return present.sum() / present.size
    }

    /**
     * Coerce a reading to a finite number, returning 0 for a NaN / infinite input — the web
     * `fmtNumber`'s `safeNumber(v) = Number.isFinite(v) ? v : 0` guard.
     */
    fun safe(value: Double): Double = if (value.isFinite()) value else 0.0

    /**
     * Format a number the way the web `fmtNumber(value, precision)` does: en-US-style grouping at a fixed
     * [precision] fraction digits with `halfExpand` (round half away from zero) rounding, via the
     * platform's `%,.Nf`. A signed zero is normalized to positive zero so a `-0.0` renders `"0.0"`,
     * matching `Intl.NumberFormat`.
     */
    fun formatNumber(
        value: Double,
        precision: Int,
        locale: Locale,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val normalized = if (safe == 0.0) 0.0 else safe
        val digits = precision.coerceIn(0, MAX_PRECISION)
        return String.format(locale, "%,.${digits}f", normalized)
    }

    /**
     * Render a fan-speed maximum as the web does (`${maxFanSpeed}`): a plain integer with no grouping when
     * the value is whole (the only case the discrete fan-speed scale produces), else its plain decimal form.
     */
    private fun plainInt(value: Double): String {
        if (!value.isFinite()) return "0"
        return if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
    }
}

/**
 * Resolve the BCP-47 [tag] from the user's settings (web `useUnits` locale) to a [Locale], falling back to
 * en-US for a blank/absent tag — the same default the web `fmtNumber` applies when no locale is configured.
 */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a
 * temperature value, the unit preference, or the climate/fan state — so a diagnostics line can never leak
 * fleet telemetry.
 */
object TemperatureSectionDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "TemperatureSection"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
