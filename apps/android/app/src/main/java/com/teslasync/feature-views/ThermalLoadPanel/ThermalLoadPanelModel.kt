// Pure, framework-free model + projection for the ThermalLoadPanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/driving/components/drivetrain-health/ThermalLoadPanel.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// ThermalLoadPanel is a presentational surface — the web component takes its `sensors`, `peakPower`,
// `avgPowerMax`, and `stats` as props from the owning DrivetrainHealthPage (which owns the `useDrivetrain`
// query), so this surface binds no data fetch. Its two bound data sources are `useTranslation` (the i18n
// catalog, P1/S10) and `useUnits` (the temperature display preference + locale, P1/S8). The cache-then-network
// lifecycle states (error / stale / offline) live on that owning page, not here — exactly as the web source
// delegates them to its parent. The branches this surface itself renders are the complete state set: the
// resolved panel (a MetricBar per sensor + four InlineMetrics), a friendly empty state when there is nothing
// to show (no sensors and no power/stats), and a skeleton loading branch offered behind an opt-in `loading`
// flag the owning page threads while its query is first in flight — defaulting to the web's no-loading contract.
//
// Per sensor the web renders a `MetricBar` whose fill is `value ?? 0` over `maxTemp`, whose accent is
// `tempSeverityColor(value, maxTemp)`, and whose readout is `displayTemp(value, formatTemperature)`. This
// module reproduces that exactly: the bar value coerces a null/non-finite reading to 0, the severity is the
// same ratio bucketing (>=0.85 critical, >=0.65 warning, else good; null -> unknown), and the readout runs
// through the shared `formatTemperature` (the SI-Celsius -> display conversion + the user's precision + the
// degree-unit suffix, returning the em dash for an absent reading — the SI display boundary, ADR/Phase-48).
// The four InlineMetrics mirror the web 1:1: peak power `fmtInt(kW) + " kW"` (em dash when <= 0), average power
// `fmtNumber(kW, 1) + " kW"` (em dash when <= 0), drive count `fmtInt(totalDrives)` (em dash without stats),
// and regen ratio `fmtNumber(ratio * 100, 1) + "%"` (em dash without stats). Power arrives as SI watts and is
// converted at this boundary, so nothing downstream stores a kW value.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ThermalLoadPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.thermalloadpanel

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatTemperature
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/** The em-dash sentinel rendered for an absent reading / metric (web `value ?? 0` -> '—' and `data ? … : '—'`). */
internal const val EM_DASH: String = "\u2014"

/** Web `fmtInt(value)` — peak power and the drive count render as whole numbers. */
private const val INT_FRACTION_DIGITS: Int = 0

/** Web `fmtNumber(value, 1)` — average power and the regen-ratio percent render with one fractional digit. */
private const val ONE_FRACTION_DIGIT: Int = 1

/** Web `tempSeverityColor`: at or above 85% of the ceiling the reading is critical. */
private const val SEVERITY_CRITICAL_RATIO: Double = 0.85

/** Web `tempSeverityColor`: at or above 65% of the ceiling the reading is a warning. */
private const val SEVERITY_WARNING_RATIO: Double = 0.65

/** SI watts per kilowatt — power arrives as SI watts and converts to kW at this display boundary. */
private const val WATTS_PER_KILOWATT: Double = 1000.0

/** Web `stats.regenRatio * 100` — the regen ratio is stored as a 0..1 fraction and shown as a percent. */
private const val PERCENT_SCALE: Double = 100.0

/** Web literal `%` suffix on the regen-ratio readout — a universal symbol, not translatable prose. */
private const val PERCENT_SUFFIX: String = "%"

/**
 * One drivetrain thermal sensor — the native slice of the web `TempSensor` this surface consumes (the web
 * `color`/`icon` fields are not read by ThermalLoadPanel, which derives its own accent and renders a bar).
 * The [label] is the already-resolved display string the owning page computed (web `t(labelKey, defaultLabel)`),
 * threaded in as domain data exactly as the web threads the `sensors` prop; the sensor label keys are not in
 * the shared catalog, so resolving them is the owning page's responsibility, not this presentational surface's.
 *
 * @property key the stable identity for this row (web `sensor.key`).
 * @property label the resolved display label (web `t(sensor.labelKey, sensor.defaultLabel)`).
 * @property value the reading in SI degrees Celsius, or `null` when the sensor is unavailable.
 * @property maxTemp the SI-Celsius ceiling (web `sensor.maxTemp`) that scales the bar and the severity ratio.
 */
data class ThermalSensor(
    val key: String,
    val label: String,
    val value: Double?,
    val maxTemp: Double,
)

/**
 * The two `DrivingStats` fields this surface reads (web `stats.totalDrives` and `stats.regenRatio`); a `null`
 * summary is the web `stats === undefined`, which renders the drive-count and regen-ratio metrics as em dashes.
 *
 * @property totalDrives the lifetime drive count (web `stats.totalDrives`).
 * @property regenRatio the regenerative-braking ratio as a 0..1 fraction (web `stats.regenRatio`).
 */
data class DrivingStatsSummary(
    val totalDrives: Int,
    val regenRatio: Double,
)

/**
 * The surface's props bundled into one value — the native shape of the web `ThermalLoadPanelProps`. Bundling
 * keeps the pure [ThermalLoadPanelProjection.project] within the parameter budget and gives the owning page a
 * single object to construct.
 *
 * @property sensors the drivetrain thermal sensors rendered as bars (web `sensors`).
 * @property peakPowerW the peak drive power in SI watts (web `peakPower`, supplied pre-divided to kW), or `null`.
 * @property avgPowerW the average drive power in SI watts (web `avgPowerMax`), or `null`.
 * @property stats the lifetime driving stats summary, or `null` when absent (web `stats`).
 */
data class ThermalLoadInputs(
    val sensors: List<ThermalSensor>,
    val peakPowerW: Double?,
    val avgPowerW: Double?,
    val stats: DrivingStatsSummary?,
)

/** Severity bucket for a sensor reading — the native shape of the web `tempSeverityColor` outcome. */
enum class ThermalSeverity {
    /** Below 65% of the ceiling (web `HEALTH_COLOR.good`, emerald). */
    Good,

    /** At or above 65% but below 85% of the ceiling (web `HEALTH_COLOR.warning`, amber). */
    Warning,

    /** At or above 85% of the ceiling (web `HEALTH_COLOR.critical`, red). */
    Critical,

    /** No reading (web `celsius === null` -> grey). */
    Unknown,
}

/** Identifies one of the four InlineMetrics so the renderer can bind its icon + label (P1/S9 + P1/S10). */
enum class ThermalMetricKind {
    PeakPower,
    AvgPower,
    Drives,
    RegenRatio,
}

/**
 * One render-ready thermal bar — the native projection of a web `MetricBar` row. Pure data (no Compose types)
 * so the projection is unit-tested without a UI host.
 *
 * @property key the row's stable identity (web `key={sensor.key}`).
 * @property label the resolved sensor label.
 * @property value the bar's fill numerator (web `value ?? 0`, with non-finite coerced to 0).
 * @property maxTemp the bar's fill denominator (web `max={sensor.maxTemp}`).
 * @property severity the accent bucket (web `tempSeverityColor`), mapped to a design token by the renderer.
 * @property readout the formatted temperature shown beside the bar, or [EM_DASH] when the reading is absent.
 */
data class ThermalBar(
    val key: String,
    val label: String,
    val value: Double,
    val maxTemp: Double,
    val severity: ThermalSeverity,
    val readout: String,
)

/**
 * One render-ready InlineMetric — the native projection of a web `InlineMetric`. The [kind] selects the icon
 * and the localized label at render time; [value] is the fully formatted readout (or [EM_DASH]).
 *
 * @property kind which metric this is (selects icon + label).
 * @property value the formatted value (e.g. `"123 kW"`, `"12.5%"`) or [EM_DASH].
 */
data class ThermalInlineMetric(
    val kind: ThermalMetricKind,
    val value: String,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes before
 * returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property loading whether the owning query is still in flight; the panel renders skeleton chrome while true.
 * @property bars the per-sensor bars (web `sensors.map(...)`); empty when no sensors were supplied.
 * @property metrics the four InlineMetrics in web order (peak / average power, drives, regen ratio).
 * @property hasContent whether any bar or non-empty metric exists; when false the surface renders the empty
 *   state instead of a blank panel.
 */
data class ThermalLoadDisplay(
    val loading: Boolean,
    val bars: List<ThermalBar>,
    val metrics: List<ThermalInlineMetric>,
    val hasContent: Boolean,
)

/**
 * Pure projection from the surface's props to its render-ready [ThermalLoadDisplay] — a 1:1 port of the
 * derivations the web component performs: the per-sensor `value ?? 0` / `tempSeverityColor` / `displayTemp`
 * bar, and the four `> 0` / `stats ? … : '—'` InlineMetrics with their `fmtInt` / `fmtNumber(…, 1)` formatting.
 */
object ThermalLoadPanelProjection {
    /**
     * Select the render-ready view for the given [inputs] and [loading] flag. [prefs] is the user's display
     * preference (web `useUnits`) used by [formatTemperature] for the conversion, precision, and degree unit;
     * [locale] is the grouping/separator locale (web `fmtNumber`'s active locale) for the power/count readouts.
     */
    fun project(
        inputs: ThermalLoadInputs,
        loading: Boolean,
        prefs: UnitPref,
        locale: Locale,
    ): ThermalLoadDisplay {
        val bars = inputs.sensors.map { sensor -> bar(sensor, prefs) }
        val metrics =
            listOf(
                ThermalInlineMetric(ThermalMetricKind.PeakPower, powerReadout(inputs.peakPowerW, INT_FRACTION_DIGITS, locale)),
                ThermalInlineMetric(ThermalMetricKind.AvgPower, powerReadout(inputs.avgPowerW, ONE_FRACTION_DIGIT, locale)),
                ThermalInlineMetric(ThermalMetricKind.Drives, drivesReadout(inputs.stats, locale)),
                ThermalInlineMetric(ThermalMetricKind.RegenRatio, regenReadout(inputs.stats, locale)),
            )
        val hasContent = bars.isNotEmpty() || metrics.any { it.value != EM_DASH }
        return ThermalLoadDisplay(loading = loading, bars = bars, metrics = metrics, hasContent = hasContent)
    }

    /** Projects one sensor onto its [ThermalBar] (web `<MetricBar value max color sublabel />`). */
    private fun bar(
        sensor: ThermalSensor,
        prefs: UnitPref,
    ): ThermalBar =
        ThermalBar(
            key = sensor.key,
            label = sensor.label,
            value = barValue(sensor.value),
            maxTemp = sensor.maxTemp,
            severity = severityOf(sensor.value, sensor.maxTemp),
            readout = formatTemperature(sensor.value, prefs),
        )

    /** Web `value ?? 0`, hardened so a NaN/Infinite reading never reaches the bar's width math. */
    fun barValue(value: Double?): Double = if (value != null && value.isFinite()) value else 0.0

    /**
     * The severity bucket for a [celsius] reading against its [max] ceiling — a verbatim port of the web
     * `tempSeverityColor`: `null` is [ThermalSeverity.Unknown]; otherwise the `celsius / max` ratio buckets to
     * critical (>= 0.85), warning (>= 0.65), or good. A non-positive [max] degrades to [ThermalSeverity.Unknown]
     * rather than dividing by zero.
     */
    fun severityOf(
        celsius: Double?,
        max: Double,
    ): ThermalSeverity {
        if (celsius == null || !celsius.isFinite() || max <= 0.0) return ThermalSeverity.Unknown
        val ratio = celsius / max
        return when {
            ratio >= SEVERITY_CRITICAL_RATIO -> ThermalSeverity.Critical
            ratio >= SEVERITY_WARNING_RATIO -> ThermalSeverity.Warning
            else -> ThermalSeverity.Good
        }
    }

    /** Web `peakPower/avgPowerMax > 0 ? \`${fmt} kW\` : '—'`, converting the SI [watts] to kW at this boundary. */
    private fun powerReadout(
        watts: Double?,
        digits: Int,
        locale: Locale,
    ): String {
        if (watts == null || !watts.isFinite() || watts <= 0.0) return EM_DASH
        val kilowatts = watts / WATTS_PER_KILOWATT
        return "${formatGrouped(kilowatts, digits, locale)} ${PowerUnitPref.KW.label}"
    }

    /** Web `stats ? fmtInt(stats.totalDrives) : '—'`. The `* 1.0` widens the Int count to the Double the formatter takes. */
    private fun drivesReadout(
        stats: DrivingStatsSummary?,
        locale: Locale,
    ): String = if (stats == null) EM_DASH else formatGrouped(stats.totalDrives * 1.0, INT_FRACTION_DIGITS, locale)

    /** Web `stats ? \`${fmtNumber(stats.regenRatio * 100, 1)}%\` : '—'`. */
    private fun regenReadout(
        stats: DrivingStatsSummary?,
        locale: Locale,
    ): String =
        if (stats == null) {
            EM_DASH
        } else {
            "${formatGrouped(stats.regenRatio * PERCENT_SCALE, ONE_FRACTION_DIGIT, locale)}$PERCENT_SUFFIX"
        }

    /**
     * Format a number the way the web `fmtNumber(value, digits)` does:
     * `Number.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })` with
     * grouping separators and ECMAScript `halfExpand` rounding (round half away from zero). A signed zero is
     * normalized to positive zero so a value of `-0.0` renders `"0"`, matching `Intl`.
     */
    fun formatGrouped(
        value: Double,
        digits: Int,
        locale: Locale,
    ): String {
        val normalized = if (value == 0.0) 0.0 else value
        val formatter =
            NumberFormat.getNumberInstance(locale).apply {
                minimumFractionDigits = digits
                maximumFractionDigits = digits
                roundingMode = RoundingMode.HALF_UP
                isGroupingUsed = true
            }
        return formatter.format(normalized)
    }
}

/**
 * Resolve the BCP-47 [tag] from the user's settings (web `useUnits` locale) to a [Locale], falling back to
 * en-US for a blank/absent tag — the same default the web `fmtNumber` applies when no locale is configured.
 */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a
 * temperature, power, or drive value — so a diagnostics line can never leak fleet telemetry.
 */
object ThermalLoadPanelDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "ThermalLoadPanel"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
