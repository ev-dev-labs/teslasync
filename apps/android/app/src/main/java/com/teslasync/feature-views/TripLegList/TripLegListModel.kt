// The pure, framework-free model + projection + diagnostics for the TripLegList feature view — the native
// analogue of everything the web component derives from its props before returning JSX
// (web/src/features/driving/components/TripLegList.tsx). No Compose, no Android, no HTTP: every declaration here
// is exercised off-device by the :app:testReleaseUnitTest gate, so the composable stays a thin render layer.
//
// TripLegList is a presentational panel — the web component renders a "Route Breakdown" GlassPanel listing each
// route leg (origin -> destination, distance, duration, energy, start -> arrival SOC) and, after every leg that
// has one, a charging stop (name, charge time, SOC delta, energy, cost, an optional "recommended" note). Its web
// hooks are `useTranslation` (mapped to the P1/S10 catalog), `useUnits` (the distance unit + `formatEnergy`) and
// `useFormatting` (`formatCurrency`); it binds NO data hook and performs NO fetch — the legs + charge stops arrive
// as props from the owning TripPlannerPage, whose plan feed genuinely carries loading/error/stale states. The
// owning page threads those props through the shared cache-then-network [UiState] (P1/S8), so the surface renders
// every lifecycle state that layer can carry while this file owns the value derivation: the SI -> display unit
// conversions, the per-leg/per-stop value strings (1:1 with each web conversion/format/`Math.round` call), the
// lifecycle projection, the PII-safe `view.opened` diagnostic (P1/S11), and the accessibility announcements.
//
// Faithful-port note (honesty covenant, no silent drift): the web renders the leg duration as
// `Math.round(leg.duration_s)` followed by the `common.min` label — i.e. it labels the rounded *seconds* value
// "min" and applies the `/ 60` minutes conversion ONLY to charge-stop durations
// (`Math.round(stops[idx].charge_duration_s / 60)`). Both are reproduced verbatim below rather than "corrected".
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/TripLegList — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tripleglist

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.formatEnergy
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.math.BigDecimal
import java.math.RoundingMode
import java.util.Locale
import kotlin.math.roundToLong

/** Web `formatEnergy(value, { precision: 1 })` — both the leg and charge-stop energy figures render at 1 decimal. */
private const val ENERGY_PRECISION = 1

/** Web leg distance `convertDistanceFromSI(...).toFixed(1)` — fixed 1 decimal, no grouping. */
private const val DISTANCE_DECIMALS = 1

/** Web coordinate fallback `lat.toFixed(2)` / `lng.toFixed(2)` — fixed 2 decimals, signed, no grouping. */
private const val COORDINATE_DECIMALS = 2

/** Web charge-stop minutes conversion `Math.round(charge_duration_s / 60)`. */
private const val SECONDS_PER_MINUTE = 60.0

/** Web arrival-SOC danger threshold `leg.arrival_soc < 20` (compared on the raw, un-rounded value). */
private const val LOW_ARRIVAL_SOC = 20.0

/** Web `%` suffix on every SOC percentage. */
private const val PERCENT = "%"

/** Web SOC / route connector `→` (U+2192). */
private const val ARROW = "\u2192"

/** Web coordinate join `"{lat}, {lng}"`. */
private const val COORDINATE_SEPARATOR = ", "

/** Accessible label connector between a field's label and its value ("label, value"). */
private const val LABEL_VALUE_SEPARATOR = ", "

/** Web `useFormatting` `currency_symbol` settings key (blank/whitespace falls back to `$`). */
private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

/** Web `useFormatting` currency fallback when `currency_symbol` is blank/whitespace. */
private const val DEFAULT_CURRENCY = "$"

/** Web `useFormatting` `userPrecision` fallback (2 decimals) when no decimal precision is set. */
private const val DEFAULT_PRECISION = 2

/** Number-grouping locale fallback (web `fmtNumber` global locale default). */
private const val DEFAULT_LOCALE_TAG = "en-US"

/**
 * One route endpoint — the native analogue of the web `TripLocation`. A blank [name] falls through to a
 * formatted coordinate pair, matching the web `name || "{lat}, {lng}"` truthiness.
 *
 * @property name the human-readable place name, or blank when only coordinates are known.
 * @property lat latitude in degrees.
 * @property lng longitude in degrees.
 */
data class TripWaypoint(
    val name: String,
    val lat: Double,
    val lng: Double,
)

/**
 * The SI-canonical slice of one route leg the web component reads (web `TripLeg`). Distance is metres, duration
 * seconds, energy watt-hours; the two SOC figures are whole-percent values.
 *
 * @property from the leg origin.
 * @property to the leg destination.
 * @property distanceM leg distance, SI metres (web `leg.distance_m`).
 * @property durationS leg duration, SI seconds (web `leg.duration_s`).
 * @property energyWh leg energy, SI watt-hours (web `leg.energy_wh`).
 * @property startSoc battery percent at the start of the leg (web `leg.start_soc`).
 * @property arrivalSoc battery percent on arrival (web `leg.arrival_soc`).
 */
data class TripLeg(
    val from: TripWaypoint,
    val to: TripWaypoint,
    val distanceM: Double,
    val durationS: Double,
    val energyWh: Double,
    val startSoc: Double,
    val arrivalSoc: Double,
)

/**
 * The SI-canonical slice of one charging stop the web component reads (web `TripChargeStop`).
 *
 * @property name the charger name (web `stop.name`).
 * @property chargeFromSoc battery percent when charging starts (web `stop.charge_from_soc`).
 * @property chargeToSoc battery percent when charging ends (web `stop.charge_to_soc`).
 * @property chargeDurationS charge time, SI seconds (web `stop.charge_duration_s`).
 * @property energyWh energy added, SI watt-hours (web `stop.energy_wh`).
 * @property cost charge cost in the user's currency (web `stop.cost`).
 * @property isRecommended whether this is a recommended (not exact) stop (web `stop.is_recommended`).
 */
data class TripChargeStop(
    val name: String,
    val chargeFromSoc: Double,
    val chargeToSoc: Double,
    val chargeDurationS: Double,
    val energyWh: Double,
    val cost: Double,
    val isRecommended: Boolean,
)

/**
 * The surface's full input — the native analogue of the web `{ legs, chargeStops }` props. The owning page
 * threads it through the shared [UiState]; an empty [legs] list projects onto [UiPhase.Empty] (web
 * `legItems.length === 0`).
 *
 * @property legs the ordered route legs.
 * @property chargeStops the charging stops; stop `idx` is rendered after leg `idx` (web `idx < stops.length`).
 */
data class TripRouteBreakdown(
    val legs: List<TripLeg>,
    val chargeStops: List<TripChargeStop>,
)

/**
 * The display preferences this surface resolves from the live `/settings` document — the native union of the web
 * `useUnits` (distance unit + `formatEnergy`) and `useFormatting` (currency symbol + precision) reads. Resolved
 * once at the Compose boundary and threaded into the pure projection.
 *
 * @property units the SI -> display unit preferences (distance label + energy unit + locale + precision).
 * @property currencySymbol the resolved currency symbol with the web blank/whitespace to `$` fallback applied.
 * @property precision the default fraction digits the currency uses (web `useFormatting` `userPrecision`).
 * @property locale the BCP-47 locale driving number grouping/separators (web `fmtNumber` global locale).
 */
data class TripLegDisplayPrefs(
    val units: UnitPref,
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    companion object {
        /** The `$`/2-dp/en-US metric defaults applied before settings load (web cold-start defaults). */
        val DEFAULT: TripLegDisplayPrefs = from(null)

        /** Resolves the unit + currency + precision + locale preferences from one `/settings` document. */
        fun from(settings: JsonElement?): TripLegDisplayPrefs {
            val units = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject).stringOrNull(KEY_CURRENCY_SYMBOL)
            return TripLegDisplayPrefs(
                units = units,
                currencySymbol = if (!rawSymbol.isNullOrBlank()) rawSymbol else DEFAULT_CURRENCY,
                precision = units.precision ?: DEFAULT_PRECISION,
                locale = localeFor(units.locale),
            )
        }
    }
}

/**
 * The localized strings the composable resolves once (P1/S10) and threads into the projection so the
 * render-ready rows carry no English literal. Keys map 1:1 to the web `t('tripPlanner.legs.*')` / `t('common.*')`
 * calls; [title] + [empty] back the panel chrome and the empty state, the four metric labels + [recommended]
 * compose the accessibility announcements, and [min] is the duration unit suffix.
 */
data class TripLegListStrings(
    val title: String,
    val empty: String,
    val distance: String,
    val duration: String,
    val energy: String,
    val battery: String,
    val recommended: String,
    val min: String,
)

/**
 * One fully resolved charging stop — the render-ready values for a single web charge-stop block. Pure data (no
 * Compose types) so the whole projection is asserted off-device. All strings are already localized/formatted.
 *
 * @property name the charger name (rendered in the info accent).
 * @property durationText the charge time, e.g. "25 min" (web `Math.round(charge_duration_s / 60)` + unit).
 * @property socText the SOC delta, e.g. "30% → 80%".
 * @property energyText the energy added, e.g. "30.0 kWh".
 * @property costText the charge cost, e.g. "$12.50".
 * @property isRecommended whether to render the "recommended stop" note.
 * @property announce the TalkBack label summarising the stop.
 */
data class TripChargeStopRow(
    val name: String,
    val durationText: String,
    val socText: String,
    val energyText: String,
    val costText: String,
    val isRecommended: Boolean,
    val announce: String,
)

/**
 * One fully resolved route leg — the native analogue of a single web leg block, plus its optional trailing
 * charging stop. Pure data so it is asserted directly in the unit gate; the composable only paints these strings
 * and resolves the per-field accent colors.
 *
 * @property index the 1-based leg number (web `idx + 1`).
 * @property fromText the origin name or coordinate pair.
 * @property toText the destination name or coordinate pair.
 * @property distanceText the distance, e.g. "12.0 km" (web `convertDistanceFromSI(...).toFixed(1)` + unit).
 * @property durationText the duration, e.g. "1800 min" (web `Math.round(leg.duration_s)` + unit — see file note).
 * @property energyText the energy, e.g. "9.0 kWh".
 * @property startSocText the start SOC, e.g. "80%".
 * @property arrivalSocText the arrival SOC, e.g. "60%".
 * @property arrivalLow whether the arrival SOC is below the danger threshold (web `arrival_soc < 20`).
 * @property chargeStop the charging stop rendered after this leg, or null when there is none.
 * @property announce the TalkBack label summarising the leg.
 */
data class TripLegRow(
    val index: Int,
    val fromText: String,
    val toText: String,
    val distanceText: String,
    val durationText: String,
    val energyText: String,
    val startSocText: String,
    val arrivalSocText: String,
    val arrivalLow: Boolean,
    val chargeStop: TripChargeStopRow?,
    val announce: String,
)

/**
 * Pure projection from the surface's inputs to its render state — a 1:1 port of the web component's per-leg /
 * per-stop branches, conversions, and formats. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate; the composable only resolves localized strings + accent colors and draws what these
 * return.
 */
object TripLegListProjection {
    /**
     * Maps the surface's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins outright (skeleton chrome), a snapshot with at least one leg renders [UiPhase.Content], and an absent
     * snapshot or an empty leg list renders [UiPhase.Empty] (web `legItems.length === 0`). The host's stateful
     * binding can additionally carry refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        snapshot: TripRouteBreakdown?,
        isLoading: Boolean,
    ): UiState<TripRouteBreakdown> =
        when {
            isLoading -> UiState.loading()
            snapshot != null && snapshot.legs.isNotEmpty() -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty, data = snapshot)
        }

    /**
     * The render-ready leg rows in web source order. Each leg's metrics are formatted for [prefs] (distance and
     * energy convert SI -> display here; duration/SOC mirror the matching web `Math.round` calls), and the charge
     * stop at the same ordinal is attached only when it exists (web `idx < stops.length`).
     */
    fun rows(
        snapshot: TripRouteBreakdown,
        prefs: TripLegDisplayPrefs,
        strings: TripLegListStrings,
    ): List<TripLegRow> {
        val stops = snapshot.chargeStops
        return snapshot.legs.mapIndexed { idx, leg ->
            val stop = if (idx < stops.size) chargeStopRow(stops[idx], prefs, strings) else null
            legRow(idx, leg, stop, prefs, strings)
        }
    }

    private fun legRow(
        idx: Int,
        leg: TripLeg,
        stop: TripChargeStopRow?,
        prefs: TripLegDisplayPrefs,
        strings: TripLegListStrings,
    ): TripLegRow {
        val fromText = locationText(leg.from)
        val toText = locationText(leg.to)
        val distanceText = distanceText(leg.distanceM, prefs)
        val durationText = "${roundHalfUp(leg.durationS)} ${strings.min}"
        val energyText = energyText(leg.energyWh, prefs)
        val startSocText = pct(leg.startSoc)
        val arrivalSocText = pct(leg.arrivalSoc)
        return TripLegRow(
            index = idx + 1,
            fromText = fromText,
            toText = toText,
            distanceText = distanceText,
            durationText = durationText,
            energyText = energyText,
            startSocText = startSocText,
            arrivalSocText = arrivalSocText,
            arrivalLow = safe(leg.arrivalSoc) < LOW_ARRIVAL_SOC,
            chargeStop = stop,
            announce =
                listOf(
                    "${idx + 1}",
                    "$fromText $ARROW $toText",
                    "${strings.distance}$LABEL_VALUE_SEPARATOR$distanceText",
                    "${strings.duration}$LABEL_VALUE_SEPARATOR$durationText",
                    "${strings.energy}$LABEL_VALUE_SEPARATOR$energyText",
                    "${strings.battery}$LABEL_VALUE_SEPARATOR$startSocText $ARROW $arrivalSocText",
                ).joinToString(LABEL_VALUE_SEPARATOR),
        )
    }

    private fun chargeStopRow(
        stop: TripChargeStop,
        prefs: TripLegDisplayPrefs,
        strings: TripLegListStrings,
    ): TripChargeStopRow {
        val durationText = "${roundHalfUp(safe(stop.chargeDurationS) / SECONDS_PER_MINUTE)} ${strings.min}"
        val socText = "${pct(stop.chargeFromSoc)} $ARROW ${pct(stop.chargeToSoc)}"
        val energyText = energyText(stop.energyWh, prefs)
        val costText = currencyText(stop.cost, prefs)
        val announce =
            buildList {
                add(stop.name)
                add(durationText)
                add(socText)
                add(energyText)
                add(costText)
                if (stop.isRecommended) add(strings.recommended)
            }.joinToString(LABEL_VALUE_SEPARATOR)
        return TripChargeStopRow(
            name = stop.name,
            durationText = durationText,
            socText = socText,
            energyText = energyText,
            costText = costText,
            isRecommended = stop.isRecommended,
            announce = announce,
        )
    }

    /** Web `name || "{lat.toFixed(2)}, {lng.toFixed(2)}"` — a non-blank name wins, else the coordinate pair. */
    fun locationText(waypoint: TripWaypoint): String {
        if (waypoint.name.isNotBlank()) return waypoint.name
        return toFixed(waypoint.lat, COORDINATE_DECIMALS) +
            COORDINATE_SEPARATOR +
            toFixed(waypoint.lng, COORDINATE_DECIMALS)
    }

    /** Web `convertDistanceFromSI(meters, unit).toFixed(1) + " " + unit` (the unit string is the pref label). */
    fun distanceText(
        meters: Double,
        prefs: TripLegDisplayPrefs,
    ): String {
        val value = convertDistanceFromSI(safe(meters), prefs.units.distance)
        return "${toFixed(value, DISTANCE_DECIMALS)} ${prefs.units.distance.label}"
    }

    /** Web `useUnits().formatEnergy(wh, { precision: 1 })` — SI watt-hours into the kWh display unit. */
    fun energyText(
        wattHours: Double,
        prefs: TripLegDisplayPrefs,
    ): String = formatEnergy(wattHours, prefs.units, ENERGY_PRECISION)

    /** Web `useFormatting().formatCurrency(amount)` = `${currencySymbol}${fmtNumber(amount, precision)}`. */
    fun currencyText(
        amount: Double,
        prefs: TripLegDisplayPrefs,
    ): String = prefs.currencySymbol + ChartFormat.number(safe(amount), prefs.precision, prefs.locale)

    /** Web ``${Math.round(value)}%`` — the rounded whole-percent value with a trailing `%`. */
    private fun pct(value: Double): String = "${roundHalfUp(value)}$PERCENT"

    /** Web `Math.round` (ties toward positive infinity) — Kotlin `roundToLong` matches it for finite input. */
    private fun roundHalfUp(value: Double): Long = safe(value).roundToLong()

    /**
     * Web `Number.prototype.toFixed(digits)` — a fixed-[digits] decimal string with NO grouping and a `.`
     * separator (locale-independent, like ECMAScript). Rounds half away from zero, matching `toFixed` for the
     * non-negative magnitudes this surface formats.
     */
    private fun toFixed(
        value: Double,
        digits: Int,
    ): String = BigDecimal(safe(value)).setScale(digits, RoundingMode.HALF_UP).toPlainString()

    /** Web `safeNumber(v)`: the value when it is a finite number, otherwise 0. */
    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a place name,
 * coordinate, distance, battery level, energy, or cost figure — so a diagnostics line can never leak a planned
 * route, its economics, or the user's whereabouts.
 */
object TripLegListDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "TripLegList"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/** Resolves a BCP-47 [tag] to a [Locale], falling back to en-US when blank/absent (web `fmtNumber` default). */
private fun localeFor(tag: String?): Locale = Locale.forLanguageTag(tag?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG)

private fun JsonObject?.stringOrNull(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull
