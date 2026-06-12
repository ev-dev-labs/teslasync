// Pure, framework-free model + projection for the TemperatureGauges feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/driving/components/drivetrain-health/TemperatureGauges.tsx). No Compose, no Android UI,
// no HTTP: every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer (the same split the sibling HeroGauges + DrivingTemperatureStats ports use).
//
// ── Web parity ─────────────────────────────────────────────────────────────────────────────────────
// TemperatureGauges is a presentational surface. The owning drive-detail page (web `DrivetrainHealthPage`)
// builds a `TempSensor[]` from its `useDrivetrainHealth` query and threads it in; the component binds only
// two context hooks — `useTranslation` (the title + the "Max" caption label) and `useUnits` (the temperature
// display preference) — and renders exactly one branch: a `GlassPanel` titled "Temperature Gauges" holding a
// responsive grid (`Grid cols={{ default: 2, md: 4 }}`) of one `RadialGauge` per sensor, each with a
// "Max: N°U" caption beneath it. There is no loading / error / stale / offline branch on this child; those
// cache-then-network states live on the owning page, exactly as the sibling ports document. An empty
// `sensors` array (the page threads `[]` until its health query resolves) renders a friendly empty state so
// the panel is never a blank box.
//
// Each gauge reproduces the web derivations verbatim. The value is `convertTempFromSI(value)` when the sensor
// reading is present and `0` when it is null (web `sensor.value !== null ? toTemperatureDisplay(...) : 0`),
// clamped into the gauge's `[0, max]` track exactly as the shared RadialGauge does. The axis maximum is
// `convertTempFromSI(maxTemp)` (web `max={toTemperatureDisplay(sensor.maxTemp)}`). The arc color is the
// severity hue computed from the *SI* ratio `value / maxTemp` (web `tempSeverityColor`): >= 0.85 critical,
// >= 0.65 warning, otherwise good, and a neutral grey when the reading is null — the composable maps those
// four accents onto the design tokens (P1/S9). The fraction-digit count reproduces the web RadialGauge's
// `decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision())` rule, and the "Max" caption value is
// `fmtNumber(convertTempFromSI(maxTemp), 0)` immediately followed by the unit symbol (web `...{tempUnit}`).
//
// Sensor labels are NOT this component's concern: the web reads them from each `sensor` prop
// (`t(sensor.labelKey, sensor.defaultLabel)`), with the page owning the keys — and the web catalog has no
// `drivetrain.frontMotor` / `.rearMotor` / `.inverter` / `.battery` entry, so the web shows the inline
// defaults. This port mirrors that boundary exactly: [TempSensorInput.label] carries the already-resolved
// label the parent passes in, so the only i18n keys this surface owns are `drivetrain.tempGauges` (title) and
// `drivetrain.maxLabel` (caption) — both present in the P1/S10 catalog.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TemperatureGauges — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.temperaturegauges

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.floor

// ── Web-parity constants ─────────────────────────────────────────────────────────────────────────────

/** Critical severity threshold — web `ratio >= 0.85` in `tempSeverityColor`. */
private const val CRITICAL_RATIO = 0.85

/** Warning severity threshold — web `ratio >= 0.65` in `tempSeverityColor`. */
private const val WARNING_RATIO = 0.65

/** Cold-start decimal precision before `/settings` loads — the web `getGlobalPrecision()` default (2). */
internal const val DEFAULT_PRECISION = 2

/** The "Max" caption value is whole-degree — web `fmtNumber(toTemperatureDisplay(maxTemp), 0)`. */
private const val MAX_CAPTION_FRACTION_DIGITS = 0

/** Whole-number gauges render at zero decimals (web `Number.isInteger(clamped) ? 0 : ...`). */
private const val WHOLE_GAUGE_DECIMALS = 0

// ── Inputs ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * One temperature sensor the surface renders — the native shape of a single web `TempSensor`. The owning
 * drive-detail page builds the list (front motor, rear motor, inverter, battery, ...) from its
 * drivetrain-health query and threads it in; this surface is presentational and renders each entry verbatim.
 *
 * Only the three fields TemperatureGauges actually reads are modelled — the web `sensor.color` and
 * `sensor.icon` are unused by this component (the gauge color is the *severity* hue, not `sensor.color`).
 *
 * @property label the already-resolved, localized sensor label (web `t(sensor.labelKey, sensor.defaultLabel)`,
 *   resolved by the owning page); rendered as the gauge's label.
 * @property valueC the current sensor temperature in SI degrees Celsius, or `null` when the reading is absent
 *   (web `sensor.value`); a null reading renders a zero gauge with the neutral "unknown" accent.
 * @property maxTempC the sensor's ceiling temperature in SI degrees Celsius (web `sensor.maxTemp`); the gauge's
 *   axis maximum and the "Max" caption value, and the denominator of the severity ratio.
 */
data class TempSensorInput(
    val label: String,
    val valueC: Double?,
    val maxTempC: Double,
)

/**
 * The two localized strings this surface owns and resolves once (P1/S10): the panel title and the "Max"
 * caption prefix, plus the empty + loading affordances the native states need. Keeping them injectable lets
 * the stateless content composable be exercised without a resources host and keeps the projection free of any
 * English literal. The title + max keys map 1:1 to the web `t()` calls.
 *
 * @property title the panel heading (`drivetrain.tempGauges`, "Temperature Gauges").
 * @property maxLabel the per-gauge caption prefix (`drivetrain.maxLabel`, "Max"); rendered as "Max: N°U".
 * @property noData the empty-state message shown when no sensors are present (`drivetrain.noData`, "No data").
 * @property loadingLabel the TalkBack announcement for the skeleton grid (`a11y.loading`, "Loading").
 */
data class TemperatureGaugesStrings(
    val title: String,
    val maxLabel: String,
    val noData: String,
    val loadingLabel: String,
)

// ── Render-ready model ─────────────────────────────────────────────────────────────────────────────────

/** Which design-token accent a gauge arc carries (web `tempSeverityColor`), resolved to a Color in the view. */
enum class TempGaugeAccent { Good, Warning, Critical, Unknown }

/**
 * One fully resolved radial gauge — the native analogue of a single web `<RadialGauge>` invocation plus its
 * "Max" caption. Pure data (no Compose types) so the whole projection is asserted off-device.
 *
 * @property label the localized sensor label (passed straight through from [TempSensorInput.label]).
 * @property value the display value, already converted to the user's unit and clamped into `[0, max]` exactly
 *   as the web RadialGauge renders it (so the shared Android RadialGauge can render it verbatim at [decimals]).
 * @property max the gauge's axis maximum — the converted `sensor.maxTemp` (web `max={toTemperatureDisplay(...)}`).
 * @property unit the temperature unit symbol shown beside the value (web `tempUnit`: `°C` / `°F`).
 * @property maxValueLabel the formatted ceiling with its unit (e.g. "150°C") — the web caption's
 *   `fmtNumber(toTemperatureDisplay(maxTemp), 0)` + `tempUnit`; the view prefixes it with the localized "Max".
 * @property decimals the fraction-digit count the value renders at — the web `Number.isInteger(clamped) ? 0 :
 *   getGlobalPrecision()` rule.
 * @property accent the severity accent slot, resolved to a design-token Color in the composable.
 */
data class TempGauge(
    val label: String,
    val value: Double,
    val max: Double,
    val unit: String,
    val maxValueLabel: String,
    val decimals: Int,
    val accent: TempGaugeAccent,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes before
 * returning JSX. [gauges] holds one [TempGauge] per input sensor, in order; the list is empty only when the
 * surface has no sensors (the owning page's pre-resolve state), which drives the empty branch.
 *
 * @property loading whether the owning query is still in flight; the grid renders skeleton chrome while true.
 * @property hasData whether at least one sensor is present (web: a non-empty `sensors` array); when false the
 *   surface renders the empty state instead of the gauge grid.
 * @property gauges the resolved radial gauges, one per sensor, in web order.
 */
data class TemperatureGaugesDisplay(
    val loading: Boolean,
    val hasData: Boolean,
    val gauges: List<TempGauge>,
)

/**
 * Pure projection from the surface's `sensors` prop + display preferences to its render-ready
 * [TemperatureGaugesDisplay] — a 1:1 port of the derivations the web component performs: the per-sensor
 * `convertTempFromSI` value + axis conversion, the `[0, max]` clamp, the `tempSeverityColor` severity accent,
 * the `Number.isInteger`-or-precision decimals rule, and the `fmtNumber(..., 0) + unit` "Max" caption.
 */
object TemperatureGaugesProjection {
    /**
     * Selects the render-ready view for the given [sensors] (the owning page's `sensors` prop), the [loading]
     * flag, the temperature [tempUnit] (web `useUnits().unitPrefs.temperature`), the decimal [precision] (web
     * `getGlobalPrecision()`), and the grouping [locale] (web `fmtNumber`'s active locale). An empty [sensors]
     * list yields `hasData = false` so the surface renders its empty state rather than a blank grid.
     */
    fun project(
        sensors: List<TempSensorInput>,
        loading: Boolean,
        tempUnit: TemperatureUnitPref,
        precision: Int,
        locale: Locale,
    ): TemperatureGaugesDisplay =
        TemperatureGaugesDisplay(
            loading = loading,
            hasData = sensors.isNotEmpty(),
            gauges = sensors.map { gauge(it, tempUnit, precision, locale) },
        )

    /** Projects one sensor onto its render-ready [TempGauge]. */
    private fun gauge(
        sensor: TempSensorInput,
        tempUnit: TemperatureUnitPref,
        precision: Int,
        locale: Locale,
    ): TempGauge {
        val axisMax = convertTempFromSI(sensor.maxTempC, tempUnit)
        val rawValue = if (sensor.valueC != null) convertTempFromSI(sensor.valueC, tempUnit) else 0.0
        // web RadialGauge `Math.max(0, Math.min(value, max))`; coerceAtLeast keeps the range valid for any axis.
        val clamped = rawValue.coerceIn(0.0, axisMax.coerceAtLeast(0.0))
        val unit = tempUnit.label
        return TempGauge(
            label = sensor.label,
            value = clamped,
            max = axisMax,
            unit = unit,
            maxValueLabel = formatWhole(axisMax, locale) + unit,
            decimals = decimalsFor(clamped, precision),
            accent = severity(sensor.valueC, sensor.maxTempC),
        )
    }

    /**
     * The severity accent for an SI reading [celsius] against its SI ceiling [maxTempC] — a verbatim port of
     * the web `tempSeverityColor`: a null reading is [TempGaugeAccent.Unknown] (web grey `#6b7280`); otherwise
     * the ratio `celsius / maxTempC` selects [TempGaugeAccent.Critical] (>= 0.85), [TempGaugeAccent.Warning]
     * (>= 0.65), or [TempGaugeAccent.Good]. A non-finite ratio compares exactly as the web `>=` does (NaN is
     * never >= a threshold, so it falls through to Good), so the accent never throws.
     */
    fun severity(
        celsius: Double?,
        maxTempC: Double,
    ): TempGaugeAccent {
        if (celsius == null) return TempGaugeAccent.Unknown
        val ratio = celsius / maxTempC
        return when {
            ratio >= CRITICAL_RATIO -> TempGaugeAccent.Critical
            ratio >= WARNING_RATIO -> TempGaugeAccent.Warning
            else -> TempGaugeAccent.Good
        }
    }

    /** Web RadialGauge `decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision())`. */
    fun decimalsFor(
        clamped: Double,
        precision: Int,
    ): Int = if (clamped == floor(clamped)) WHOLE_GAUGE_DECIMALS else precision

    /**
     * Formats a converted ceiling the way the web `fmtNumber(value, 0)` does:
     * `Number.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 })` — grouping
     * separators and ECMAScript `halfExpand` rounding (round half away from zero). A signed zero is normalized
     * to positive zero so a converted `-0.0` renders "0", matching `Intl`.
     */
    fun formatWhole(
        value: Double,
        locale: Locale,
    ): String {
        val normalized = if (value == 0.0) 0.0 else value
        val formatter =
            NumberFormat.getNumberInstance(locale).apply {
                minimumFractionDigits = MAX_CAPTION_FRACTION_DIGITS
                maximumFractionDigits = MAX_CAPTION_FRACTION_DIGITS
                roundingMode = RoundingMode.HALF_UP
                isGroupingUsed = true
            }
        return formatter.format(normalized)
    }
}

/**
 * Resolves the BCP-47 [tag] from the user's settings (web `useUnits` locale) to a [Locale], falling back to
 * en-US for a blank/absent tag — the same default the web `fmtNumber` applies when no locale is configured.
 */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a
 * temperature value, sensor label, or unit preference — so a diagnostics line can never leak fleet telemetry.
 */
object TemperatureGaugesDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (the prompt's surface slug). */
    const val SLUG: String = "TemperatureGauges"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
