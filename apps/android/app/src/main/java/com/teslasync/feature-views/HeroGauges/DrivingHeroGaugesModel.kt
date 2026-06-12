// Pure, framework-free model + projection for the *driving* (drive-detail) HeroGauges feature view — the
// native analogue of every value the web component derives before returning JSX
// (web/src/features/driving/components/drive-detail/HeroGauges.tsx). No Compose, no Android UI, no HTTP:
// every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer (the same split the sibling analytics + charging HeroGauges ports established).
//
// ── Surface-name collision (read before editing) ───────────────────────────────────────────────────
// The web tree has THREE distinct components named `HeroGauges`, one per feature, all mapped to the one native
// surface directory com/teslasync/feature-views/HeroGauges:
//   • features/analytics/components/analytics/HeroGauges.tsx    → P3 prompt A-0058 (six MetricCards)      — SHIPPED
//   • features/charging/components/charging-list/HeroGauges.tsx → P3 prompt A-0103 (RadialGauges + cell)  — SHIPPED
//   • features/driving/components/drive-detail/HeroGauges.tsx   → P3 prompt A-0143 (this file: five RadialGauges)
// A-0058 already occupies package `io.teslasync.android.featureviews.herogauges` with the public name
// `HeroGauges`, and A-0103 the `.charging` sub-package with `Charging`-prefixed names. This driving port lives
// in the `.driving` sub-package with `Driving`-prefixed names. All three surfaces coexist — A-0058 and A-0103
// are committed predecessors and are left untouched (honesty covenant #7, no predecessor bypass).
//
// ── Web parity ─────────────────────────────────────────────────────────────────────────────────────
// The web component is purely presentational: the owning drive-detail page computes `DriveStats` from the
// drive + telemetry (its `useDriveDetailData` helper) and threads it in alongside the `DriveDetail` as props.
// The component reads three context hooks — `useTranslation` (labels), `useSettings` (`isMiles`), and
// `useUnits` (`unitPrefs.distance`/`.speed`) — and renders exactly one branch: a centered, wrapping row of four
// RadialGauges (Distance, Max Speed, Duration, Consumption) plus a fifth (Efficiency) only when
// `stats.efficiencyPctPer100 != null`. There is no loading / empty / error branch on this child; the
// cache-then-network states (loading / stale / offline / fetch-error) live on the owning page, exactly as the
// sibling analytics + charging ports document. A `null` input is treated defensively as the all-zero rendering
// so the surface is never blank.
//
// Unit handling mirrors the web component precisely. Distance and duration arrive SI (drive.distanceM in metres,
// drive.durationS in seconds) and are converted here through the shared [convertDistanceFromSI] and a ÷60, just
// as the web component's own `toDistanceDisplay(...)` and `/ 60` do. Max speed and efficiency-percent arrive
// pre-converted to display units (the owning page's computeStats applies `toSpeedDisplay` / `toDistanceDisplay`
// before threading them in, so the component itself only rounds them), and consumption arrives as Wh/km and is
// scaled to Wh/mi by the same `KM_PER_MILE` the web `toEfficiencyDisplay` uses. Every gauge value is then
// clamped to its `[0, max]` track and rounded exactly as the web RadialGauge does (`Math.round` for the four
// whole-number gauges; `Number(fmtNumber(value, precision))` for the efficiency gauge), and the displayed
// fraction-digit count reproduces the web RadialGauge's `decimals ?? (Number.isInteger(clamped) ? 0 :
// getGlobalPrecision())` rule so the shared Android RadialGauge renders an identical number.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/HeroGauges — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.herogauges.driving

import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.floor
import kotlin.math.max

// ── Web-parity constants ───────────────────────────────────────────────────────────────────────────

/** km per mile — the web `KM_PER_MILE` used by `toEfficiencyDisplay` to scale Wh/km into Wh/mi. */
private const val KM_PER_MILE = 1.609344

/** Seconds per minute — the web Duration gauge's `(drive.durationS ?? 0) / 60`. */
private const val SECONDS_PER_MINUTE = 60.0

/** Distance gauge axis: `Math.max(dist * 1.5, 100)` — headroom factor + floor (web). */
private const val GAUGE_HEADROOM_FACTOR = 1.5
private const val DISTANCE_FLOOR_MAX = 100.0

/** Duration gauge axis floor — web `Math.max(minutes * 1.5, 60)`. */
private const val DURATION_FLOOR_MAX = 60.0

/** Consumption gauge axis floor — web `Math.max(eff * 1.5, 300)`. */
private const val CONSUMPTION_FLOOR_MAX = 300.0

/** Efficiency gauge axis — the web constant `max={30}`. */
private const val EFFICIENCY_MAX = 30.0

/**
 * Max-speed gauge axis ceiling, in SI metres-per-second. The web passes `max={toSpeedDisplay(250)}`, i.e. it
 * treats 250 as an SI m/s ceiling and converts it to the display unit; this port does the same via
 * [convertSpeedFromSI]. (250 m/s is a deliberately generous axis ceiling, not a realistic speed.)
 */
private const val SPEED_AXIS_CEILING_MPS = 250.0

/** Duration gauge unit — the web literal `unit="min"`. */
private const val DURATION_UNIT = "min"

/** Consumption gauge unit — web `unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`. */
private const val CONSUMPTION_UNIT_MI = "Wh/mi"
private const val CONSUMPTION_UNIT_KM = "Wh/km"

/** Efficiency gauge unit — web `isMiles ? '%/100mi' : '%/100km'`. */
private const val EFFICIENCY_UNIT_MI = "%/100mi"
private const val EFFICIENCY_UNIT_KM = "%/100km"

/** Default decimal precision when `/settings` carries none — the web `getGlobalPrecision()` cold-start (2). */
private const val DEFAULT_PRECISION = 2

private const val KEY_DISTANCE_M = "distance_m"
private const val KEY_DURATION_S = "duration_s"
private const val KEY_MAX_SPEED = "max_speed"
private const val KEY_CONSUMPTION_WH_KM = "consumption_wh_km"
private const val KEY_EFFICIENCY_PCT_PER_100 = "efficiency_pct_per_100"

// ── Inputs ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The five fields the web drive-detail HeroGauges reads off its `drive` + `stats` props. The owning page
 * (`useDriveDetailData`) computes these from `/drives/{id}` + `/drives/{id}/telemetry` and threads them in;
 * this surface is presentational and renders them verbatim, exactly as the web component does.
 *
 * Distance and duration are SI (the web component converts them itself); max speed and efficiency-percent
 * arrive already converted to the user's display units (the owning page's computeStats applies the conversion,
 * so the component only rounds them); consumption is Wh/km. Each numeric field defaults to `0.0` when missing
 * (web `?? 0`), and [efficiencyPctPer100] is nullable — `null` hides the fifth gauge (web
 * `stats.efficiencyPctPer100 != null && ...`).
 *
 * @property distanceM drive distance in SI metres (web `drive.distanceM`).
 * @property durationS drive duration in SI seconds (web `drive.durationS`).
 * @property maxSpeedDisplay maximum speed, pre-converted to the display speed unit (web `stats.maxSpd`).
 * @property consumptionWhKm energy intensity in Wh/km (web `stats.consumptionWhKm`).
 * @property efficiencyPctPer100 battery-percent per 100 display-distance units, or `null` when unavailable
 *   (web `stats.efficiencyPctPer100`); `null` omits the Efficiency gauge.
 */
data class DriveGaugesInput(
    val distanceM: Double,
    val durationS: Double,
    val maxSpeedDisplay: Double,
    val consumptionWhKm: Double,
    val efficiencyPctPer100: Double?,
) {
    public companion object {
        /** The all-zero, no-efficiency input — the defensive rendering when the page threads in `null`. */
        public val ZERO: DriveGaugesInput = DriveGaugesInput(0.0, 0.0, 0.0, 0.0, null)

        /**
         * Decodes a cached/serialized drive-gauges document [json] into the model, or `null` when the payload
         * is absent (`null` / JSON-null) so the owning page can keep its own loading branch. Any JSON object —
         * including an empty `{}` — decodes to an input, with each missing/JSON-null numeric field collapsing
         * to `0.0` (web `?? 0`). [efficiencyPctPer100] decodes to `null` only when its key is absent or
         * JSON-null (web `!= null` gate); a present `0.0` stays `0.0` and renders the gauge. Keys are
         * snake_case, the project's wire/cache convention.
         */
        public fun fromJson(json: JsonElement?): DriveGaugesInput? {
            val obj = json as? JsonObject ?: return null
            return DriveGaugesInput(
                distanceM = obj.double(KEY_DISTANCE_M),
                durationS = obj.double(KEY_DURATION_S),
                maxSpeedDisplay = obj.double(KEY_MAX_SPEED),
                consumptionWhKm = obj.double(KEY_CONSUMPTION_WH_KM),
                efficiencyPctPer100 = obj.doubleOrAbsent(KEY_EFFICIENCY_PCT_PER_100),
            )
        }
    }
}

/**
 * The display preferences this surface resolves from the live `/settings` document — the native union of the
 * web `useSettings().isMiles` and `useUnits().unitPrefs.{distance,speed}` reads. Resolving them from one
 * settings document mirrors the web hooks, which both derive from `useSettings`.
 *
 * @property distanceUnit the user's distance unit (web `unitPrefs.distance`); selects the Distance gauge unit,
 *   the Wh/mi-vs-Wh/km consumption branch, and the %/100mi-vs-%/100km efficiency branch (`isMiles`).
 * @property speedUnit the user's speed unit (web `unitPrefs.speed`); the Max Speed gauge unit + axis conversion.
 * @property precision the fraction digits the Efficiency gauge value is rounded to (web `getGlobalPrecision()`,
 *   the live `decimal_precision`; default 2).
 */
data class DrivingHeroGaugesDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val speedUnit: SpeedUnitPref,
    val precision: Int,
) {
    /** Whether miles are selected — the web `useSettings().isMiles`, gating the imperial unit/efficiency labels. */
    val isMiles: Boolean get() = distanceUnit == DistanceUnitPref.MI

    public companion object {
        /** The metric (km + km/h), 2-dp defaults applied before settings load (web cold-start defaults). */
        public val DEFAULT: DrivingHeroGaugesDisplayPrefs = from(null)

        /** Resolves the distance + speed unit and precision preferences from one `/settings` document. */
        public fun from(settings: JsonElement?): DrivingHeroGaugesDisplayPrefs {
            val unitPref = UnitPreferences.fromSettings(settings)
            val precision = unitPref.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION
            return DrivingHeroGaugesDisplayPrefs(
                distanceUnit = unitPref.distance,
                speedUnit = unitPref.speed,
                precision = precision,
            )
        }
    }
}

/**
 * The five localized gauge labels the composable resolves once (P1/S10) and threads into the projection so the
 * render-ready [DriveGauge.label]s carry no English literal. Keys map 1:1 to the web `t('driveDetail.*')` calls.
 *
 * @property distance web `driveDetail.distance` ("Distance").
 * @property maxSpeed web `driveDetail.maxSpeed` ("Max Speed").
 * @property duration web `driveDetail.duration` ("Duration").
 * @property consumption web `driveDetail.consumption` ("Consumption").
 * @property efficiency web `driveDetail.efficiency` ("Efficiency").
 */
data class DrivingHeroGaugesStrings(
    val distance: String,
    val maxSpeed: String,
    val duration: String,
    val consumption: String,
    val efficiency: String,
)

/** Which design-token accent a gauge carries (web RadialGauge `color`), resolved to a Color in the composable. */
enum class DriveGaugeAccent { Distance, MaxSpeed, Duration, Consumption, Efficiency }

/**
 * One fully resolved radial gauge — the native analogue of a single web `<RadialGauge>` invocation. Pure data
 * (no Compose types) so the whole projection is asserted off-device.
 *
 * @property label the localized gauge label.
 * @property value the display value, already clamped to `[0, max]` and rounded exactly as the web RadialGauge
 *   renders it (so the shared Android RadialGauge can render it verbatim at [decimals] digits).
 * @property max the gauge's denominator — the web `max={...}` (kept un-rounded, exactly as the web passes it).
 * @property unit the unit suffix shown beside the value.
 * @property decimals the fraction-digit count the value renders at — the web `Number.isInteger(clamped) ? 0 :
 *   getGlobalPrecision()` rule (0 for the four whole-number gauges, the user precision for a fractional
 *   efficiency value).
 * @property accent the design-token accent slot.
 */
data class DriveGauge(
    val label: String,
    val value: Double,
    val max: Double,
    val unit: String,
    val decimals: Int,
    val accent: DriveGaugeAccent,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes before
 * returning JSX. [gauges] holds the four mandatory gauges in web order, plus a fifth Efficiency gauge when the
 * input carries a non-null efficiency-percent (web `stats.efficiencyPctPer100 != null`). The list is never
 * empty, so the surface is never blank.
 *
 * @property gauges the resolved radial gauges (four or five, in web order).
 */
data class DrivingHeroGaugesDisplay(
    val gauges: List<DriveGauge>,
)

/**
 * Pure projection from the surface's `drive` + `stats` props + display preferences to its render-ready
 * [DrivingHeroGaugesDisplay] — a 1:1 port of the derivations the web component performs. The composable resolves
 * [DrivingHeroGaugesStrings] from the i18n catalog and [DrivingHeroGaugesDisplayPrefs] from the live settings,
 * then hands them here.
 */
object DrivingHeroGaugesProjection {
    /** The four always-present gauges (web: Distance, Max Speed, Duration, Consumption). */
    const val MANDATORY_GAUGE_COUNT: Int = 4

    /** The maximum gauge count — the four mandatory plus the conditional Efficiency gauge. */
    const val MAX_GAUGE_COUNT: Int = MANDATORY_GAUGE_COUNT + 1

    /** Whole-number gauges (Distance, Max Speed, Duration, Consumption) always render at zero decimals. */
    private const val WHOLE_GAUGE_DECIMALS = 0

    /** The `+ 0.5` bias that turns [floor] into round-half-toward-positive-infinity (the web `Math.round`). */
    private const val ROUND_HALF = 0.5

    /** Decimal base used to shift a value by N places before rounding (`10^decimals`). */
    private const val DECIMAL_BASE = 10.0

    /**
     * Selects the render-ready view for the given [input] (the owning page's `drive` + `stats` props; `null` is
     * treated defensively as [DriveGaugesInput.ZERO] so the surface is never blank), the resolved display
     * [prefs], and the localized [strings]. Reproduces the web derivations verbatim: the SI-floored distance
     * conversion + 1.5×-or-floor axis, the pre-converted max-speed value over a `convertSpeedFromSI(250)` axis,
     * the seconds→minutes duration, the Wh/km→Wh/mi consumption branch, and the conditional efficiency gauge.
     */
    fun project(
        input: DriveGaugesInput?,
        prefs: DrivingHeroGaugesDisplayPrefs,
        strings: DrivingHeroGaugesStrings,
    ): DrivingHeroGaugesDisplay {
        val data = input ?: DriveGaugesInput.ZERO
        return DrivingHeroGaugesDisplay(
            gauges =
                buildList {
                    add(distanceGauge(data, prefs, strings))
                    add(maxSpeedGauge(data, prefs, strings))
                    add(durationGauge(data, strings))
                    add(consumptionGauge(data, prefs, strings))
                    data.efficiencyPctPer100?.let { add(efficiencyGauge(strings.efficiency, it, prefs)) }
                },
        )
    }

    /** Distance gauge — web `round(toDistanceDisplay(distanceM))` over `max(dist * 1.5, 100)`. */
    private fun distanceGauge(
        data: DriveGaugesInput,
        prefs: DrivingHeroGaugesDisplayPrefs,
        strings: DrivingHeroGaugesStrings,
    ): DriveGauge {
        val display = convertDistanceFromSI(data.distanceM, prefs.distanceUnit)
        val axisMax = max(display * GAUGE_HEADROOM_FACTOR, DISTANCE_FLOOR_MAX)
        return wholeGauge(strings.distance, display, axisMax, prefs.distanceUnit.label, DriveGaugeAccent.Distance)
    }

    /** Max-speed gauge — web `round(stats.maxSpd)` (pre-converted) over `convertSpeedFromSI(250)`. */
    private fun maxSpeedGauge(
        data: DriveGaugesInput,
        prefs: DrivingHeroGaugesDisplayPrefs,
        strings: DrivingHeroGaugesStrings,
    ): DriveGauge {
        val axisMax = convertSpeedFromSI(SPEED_AXIS_CEILING_MPS, prefs.speedUnit)
        return wholeGauge(strings.maxSpeed, data.maxSpeedDisplay, axisMax, prefs.speedUnit.label, DriveGaugeAccent.MaxSpeed)
    }

    /** Duration gauge — web `round((durationS ?? 0) / 60)` over `max(minutes * 1.5, 60)`. */
    private fun durationGauge(
        data: DriveGaugesInput,
        strings: DrivingHeroGaugesStrings,
    ): DriveGauge {
        val minutes = data.durationS / SECONDS_PER_MINUTE
        val axisMax = max(minutes * GAUGE_HEADROOM_FACTOR, DURATION_FLOOR_MAX)
        return wholeGauge(strings.duration, minutes, axisMax, DURATION_UNIT, DriveGaugeAccent.Duration)
    }

    /** Consumption gauge — web `round(toEfficiencyDisplay(consumptionWhKm))` over `max(eff * 1.5, 300)`. */
    private fun consumptionGauge(
        data: DriveGaugesInput,
        prefs: DrivingHeroGaugesDisplayPrefs,
        strings: DrivingHeroGaugesStrings,
    ): DriveGauge {
        val display = if (prefs.isMiles) data.consumptionWhKm * KM_PER_MILE else data.consumptionWhKm
        val axisMax = max(display * GAUGE_HEADROOM_FACTOR, CONSUMPTION_FLOOR_MAX)
        val unit = if (prefs.isMiles) CONSUMPTION_UNIT_MI else CONSUMPTION_UNIT_KM
        return wholeGauge(strings.consumption, display, axisMax, unit, DriveGaugeAccent.Consumption)
    }

    /**
     * Builds one whole-number gauge. The web rounds the value with `Math.round` and the RadialGauge clamps it
     * into `[0, max]`; this reproduces both. The clamped value is always a whole number for every reachable
     * drive — the `100`/`60`/`300` axis floors and the `convertSpeedFromSI(250)` ceiling keep the rounded value
     * at or below `max` — so it renders at [WHOLE_GAUGE_DECIMALS], the web `Number.isInteger(clamped) ? 0 : …`.
     */
    private fun wholeGauge(
        label: String,
        rawValue: Double,
        max: Double,
        unit: String,
        accent: DriveGaugeAccent,
    ): DriveGauge =
        DriveGauge(
            label = label,
            value = roundHalfUp(rawValue, 0).coerceIn(0.0, max),
            max = max,
            unit = unit,
            decimals = WHOLE_GAUGE_DECIMALS,
            accent = accent,
        )

    /**
     * Builds the conditional Efficiency gauge. The web value is `Number(fmtNumber(efficiencyPctPer100))` — a
     * round to the user precision (half away from zero) — clamped by the RadialGauge into `[0, 30]`. The
     * displayed decimals follow the web `Number.isInteger(clamped) ? 0 : getGlobalPrecision()` rule, so an
     * integral efficiency shows no decimals while a fractional one shows the user precision.
     */
    private fun efficiencyGauge(
        label: String,
        efficiencyPctPer100: Double,
        prefs: DrivingHeroGaugesDisplayPrefs,
    ): DriveGauge {
        val clamped = roundHalfUp(efficiencyPctPer100, prefs.precision).coerceIn(0.0, EFFICIENCY_MAX)
        val unit = if (prefs.isMiles) EFFICIENCY_UNIT_MI else EFFICIENCY_UNIT_KM
        return DriveGauge(
            label = label,
            value = clamped,
            max = EFFICIENCY_MAX,
            unit = unit,
            decimals = decimalsFor(clamped, prefs.precision),
            accent = DriveGaugeAccent.Efficiency,
        )
    }

    /** Web RadialGauge `decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision())`. */
    private fun decimalsFor(
        clamped: Double,
        precision: Int,
    ): Int = if (clamped == floor(clamped)) 0 else precision

    /**
     * Rounds [value] to [decimals] fraction digits, ties toward positive infinity — the web `Math.round` for
     * the whole-number gauges and `Number(fmtNumber(value, precision))` for the efficiency gauge. Implemented as
     * `floor(value · 10^decimals + 0.5) / 10^decimals`, the same pattern the sibling charging HeroGauges port
     * uses for its avg-cost pre-round. For the rare exact decimal-half input the binary representation governs
     * the tie direction, so the result may differ by a single display ULP — imperceptible on the gauge.
     */
    private fun roundHalfUp(
        value: Double,
        decimals: Int,
    ): Double {
        if (!value.isFinite()) return 0.0
        var scale = 1.0
        repeat(decimals) { scale *= DECIMAL_BASE }
        return floor(value * scale + ROUND_HALF) / scale
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a distance,
 * speed, duration, consumption, efficiency, or any other drive figure — so a diagnostics line can never leak
 * fleet usage.
 */
object DrivingHeroGaugesDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (the prompt's surface slug). */
    const val SLUG: String = "HeroGauges"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

// ── JSON decode helpers (web `?? 0` / `!= null` parity) ──────────────────────────────────────────────

/** A numeric field with the web `?? 0` guard: missing / JSON-null / non-numeric collapses to `0.0`. */
private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

/** A nullable numeric field: present numeric -> value; absent / JSON-null / non-numeric -> `null` (web `!= null`). */
private fun JsonObject.doubleOrAbsent(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull
