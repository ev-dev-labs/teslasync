// Pure, framework-free model + projection for the PatternsSlide review feature view — the native analogue
// of everything the web component derives before it returns JSX
// (web/src/features/analytics/components/review/PatternsSlide.tsx). No Compose, no Android, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable
// stays a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the Year in Review carousel) fetches the
// `YearReview` document and passes it down as `data`. From `data` it reads five "patterns" fields and
// renders the two icon cards (favorite driving day, peak driving hour) plus the three-up stat row
// (drives/week, distance/drive, efficiency). Distances/efficiencies arrive SI (km, Wh/km) and are converted
// to the user's display unit (web `useUnits`) at this boundary (Phase-48 SI-canonical rule).
//
// This file owns the parts the web component expresses from its props: the native slice of the year-review
// payload it consumes (decoded snake_case with camelCase dual-shape tolerance, the `camelCaseKeys` concern),
// the lifecycle projection of (snapshot, isLoading) onto the shared cache-then-network [UiState] (so the
// surface renders every state the P1/S8 layer can carry), the render-ready display projection with the web
// `convertDistanceFromSI` distance conversion, the `KM_PER_MILE` efficiency conversion, the `fmtNumber` /
// `Math.round` formatting, and the locale-aware 12-hour clock label, plus the PII-safe `view.opened`
// diagnostic (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/PatternsSlide — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.patternsslide

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.text.DateFormatSymbols
import java.util.Locale
import kotlin.math.floor

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, location, or
 * actor, so a diagnostics line can never leak vehicle identity or owner movement from this recap panel.
 */
const val PATTERNS_SLIDE_SLUG: String = "PatternsSlide"

/** Em dash shown for an absent favorite day — mirrors the web `data.most_active_day_of_week || '—'`. */
private const val EM_DASH = "\u2014"

/** 1 mile = 1.609344 km — the web `KM_PER_MILE` factor used for the Wh/km → Wh/mi efficiency conversion. */
private const val KM_PER_MILE = 1.609344

/** 1 km = 1000 m — the SI bridge the distance conversion floors on (backend km → metres → display unit). */
private const val METERS_PER_KM = 1000.0

/** Web `fmtNumber(data.avg_drives_per_week, 1)` precision for the drives/week tile. */
private const val DRIVES_PER_WEEK_DECIMALS = 1

/**
 * Efficiency unit-symbol prefix the web reads as a literal (`'Wh/mi'` / `'Wh/km'`), never i18n — the
 * display distance label is appended to it. Unit symbols are hard-coded just like the sibling surfaces.
 */
private const val EFFICIENCY_UNIT_PREFIX = "Wh/"

/** Noon / midnight pivot of the 12-hour clock (web `most_active_hour >= 12`). */
private const val HOURS_IN_HALF_DAY = 12

/** Index of the AM marker in [DateFormatSymbols.getAmPmStrings]. */
private const val AM_INDEX = 0

/** Index of the PM marker in [DateFormatSymbols.getAmPmStrings]. */
private const val PM_INDEX = 1

/** Rounding bias for the JS `Math.round` parity helper. */
private const val ROUND_HALF = 0.5

/**
 * The native slice of `YearReview` the PatternsSlide consumes — the five "patterns" fields the web component
 * reads off its `data` prop. Distances/efficiencies are SI on the wire (km, Wh/km); the conversion to the
 * user's display unit happens in [PatternsSlideProjection]. A missing/JSON-null numeric collapses to zero
 * and a missing day to an empty string, reproducing the web defensive reads.
 */
data class PatternsSnapshot(
    val mostActiveDayOfWeek: String,
    val mostActiveHour: Int,
    val avgDrivesPerWeek: Double,
    val avgDistancePerDriveKm: Double,
    val avgEfficiencyWhKm: Double,
)

/**
 * The fully projected, render-ready view of the slide — the native analogue of everything the web component
 * formats inline before returning JSX. Pure strings (no Compose types) so the projection is unit-tested
 * without a UI host; the composable resolves the localized captions around these values.
 *
 * @property favoriteDay the busiest weekday, or an em dash when absent (web `|| '—'`).
 * @property hourLabel the peak hour as a locale-aware 12-hour clock label, e.g. `"3 PM"` (web `hourLabel`).
 * @property drivesPerWeekValue drives/week formatted at one decimal (web `fmtNumber(_, 1)`).
 * @property distancePerDriveValue avg distance/drive in the display unit, rounded to a whole number
 *   (web `Math.round(convertDistanceFromSI(... ))`), rendered without grouping like the web template.
 * @property distanceUnitLabel the display distance unit (`"km"`/`"mi"`) used to build the `{{unit}}/drive`
 *   caption at the i18n boundary.
 * @property efficiencyValue avg efficiency in the display unit, rounded to a whole number
 *   (web `Math.round(avgEffDisplay)`).
 * @property efficiencyUnit the efficiency unit symbol (`"Wh/km"`/`"Wh/mi"`, web `efficiencyUnit`).
 */
data class PatternsDisplay(
    val favoriteDay: String,
    val hourLabel: String,
    val drivesPerWeekValue: String,
    val distancePerDriveValue: String,
    val distanceUnitLabel: String,
    val efficiencyValue: String,
    val efficiencyUnit: String,
)

/**
 * Decodes the raw `YearReview` [json] (SI, snake_case on the wire) into a [PatternsSnapshot], or `null` when
 * the payload is absent. A non-object input or an empty object resolves to `null`, reproducing the web
 * `data ?` truthiness gate (a disabled query / null response renders the empty surface, while any populated
 * payload renders the slide). Each field tolerates the snake_case wire name and its `camelCaseKeys`
 * camelCase alias, reproducing the dual-shape the web client carries; a missing field collapses to zero / an
 * empty day, reproducing the web defensive reads.
 */
object PatternsSlideData {
    fun parse(json: JsonElement?): PatternsSnapshot? {
        val obj = (json as? JsonObject)?.takeIf { it.isNotEmpty() } ?: return null
        return PatternsSnapshot(
            mostActiveDayOfWeek = obj.string("most_active_day_of_week", "mostActiveDayOfWeek"),
            mostActiveHour = obj.double("most_active_hour", "mostActiveHour").toInt(),
            avgDrivesPerWeek = obj.double("avg_drives_per_week", "avgDrivesPerWeek"),
            avgDistancePerDriveKm = obj.double("avg_distance_per_drive_km", "avgDistancePerDriveKm"),
            avgEfficiencyWhKm = obj.double("avg_efficiency_wh_km", "avgEfficiencyWhKm"),
        )
    }

    /** First non-null primitive string content across [keys] (snake_case then camelCase), else empty. */
    private fun JsonObject.string(vararg keys: String): String {
        for (key in keys) {
            val value = (this[key] as? JsonPrimitive)?.contentOrNull
            if (value != null) return value
        }
        return ""
    }

    /** First finite primitive double across [keys] (snake_case then camelCase), else zero (web `?? 0`). */
    private fun JsonObject.double(vararg keys: String): Double {
        for (key in keys) {
            val value = (this[key] as? JsonPrimitive)?.doubleOrNull
            if (value != null) return value
        }
        return 0.0
    }
}

/** The mutually-exclusive surface the composable renders for a given [UiState] — one branch per state. */
enum class PatternsSlideSurface { Loading, Error, Empty, Content }

/**
 * Pure projection from the slide's inputs to its render state — a 1:1 port of the web component's inline
 * derivations. Stateless and side-effect-free so it is fully covered by the off-device unit gate; the
 * composable only resolves localized strings, glyphs, and accents and draws what these return.
 */
object PatternsSlideProjection {
    /**
     * Maps the panel's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins outright (skeleton chrome), a present snapshot renders [UiPhase.Content], and an absent snapshot
     * renders [UiPhase.Empty] (a friendly no-data state). The host's stateful binding can additionally carry
     * refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        snapshot: PatternsSnapshot?,
        isLoading: Boolean,
    ): UiState<PatternsSnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The render-ready [PatternsDisplay] for the user's [prefs] and [locale]. Distance converts SI km →
     * metres → display unit (web `convertDistanceFromSI(avg_distance_per_drive_km * 1000, distanceUnit)`),
     * rounded to a whole number (web `Math.round`). Efficiency is Wh/km, scaled by [KM_PER_MILE] when the
     * user reads miles (web `avg_efficiency_wh_km * KM_PER_MILE`), else left as Wh/km, then rounded. The
     * drives/week tile uses one-decimal grouped formatting (web `fmtNumber(_, 1)`). The favorite day falls
     * back to an em dash when blank (web `|| '—'`).
     */
    fun project(
        snapshot: PatternsSnapshot,
        prefs: UnitPref,
        locale: Locale,
    ): PatternsDisplay {
        val miles = prefs.distance == DistanceUnitPref.MI
        val avgDistMeters = safe(snapshot.avgDistancePerDriveKm) * METERS_PER_KM
        val avgDistDisplay = convertDistanceFromSI(avgDistMeters, prefs.distance)
        val avgEff = safe(snapshot.avgEfficiencyWhKm)
        val avgEffDisplay = if (miles) avgEff * KM_PER_MILE else avgEff
        return PatternsDisplay(
            favoriteDay = snapshot.mostActiveDayOfWeek.ifBlank { EM_DASH },
            hourLabel = hourLabel(snapshot.mostActiveHour, locale),
            drivesPerWeekValue = ChartFormat.number(safe(snapshot.avgDrivesPerWeek), DRIVES_PER_WEEK_DECIMALS, locale),
            distancePerDriveValue = jsRound(avgDistDisplay).toString(),
            distanceUnitLabel = prefs.distance.label,
            efficiencyValue = jsRound(avgEffDisplay).toString(),
            efficiencyUnit = EFFICIENCY_UNIT_PREFIX + if (miles) DistanceUnitPref.MI.label else DistanceUnitPref.KM.label,
        )
    }

    /**
     * The peak [hour] (0–23) as a locale-aware 12-hour clock label, e.g. `"12 AM"`, `"9 AM"`, `"12 PM"`,
     * `"3 PM"` — the native port of the web `hourLabel` ternary. The AM/PM marker is sourced from the
     * platform [DateFormatSymbols] for [locale] (so it localizes, and the native code carries no hardcoded
     * "AM"/"PM" literal); a locale with blank markers falls back to the platform en-US markers.
     */
    fun hourLabel(
        hour: Int,
        locale: Locale,
    ): String {
        val isPm = hour >= HOURS_IN_HALF_DAY
        val twelve =
            if (isPm) {
                if (hour == HOURS_IN_HALF_DAY) HOURS_IN_HALF_DAY else hour - HOURS_IN_HALF_DAY
            } else {
                if (hour == 0) HOURS_IN_HALF_DAY else hour
            }
        val marker = amPmMarkers(locale)[if (isPm) PM_INDEX else AM_INDEX]
        return "$twelve $marker"
    }

    /** The locale's AM/PM markers, falling back to the platform en-US markers when [locale]'s are blank. */
    private fun amPmMarkers(locale: Locale): Array<String> {
        val markers = DateFormatSymbols.getInstance(locale).amPmStrings
        val usable = markers.size >= 2 && markers[AM_INDEX].isNotBlank() && markers[PM_INDEX].isNotBlank()
        return if (usable) markers else DateFormatSymbols.getInstance(Locale.US).amPmStrings
    }

    /** JS `Math.round` parity for a non-negative finite value: round half away from zero toward +∞. */
    private fun jsRound(value: Double): Long = floor(value + ROUND_HALF).toLong()

    /** Web `safe()`: the value when it is a finite number, otherwise 0. */
    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0
}

/**
 * Classifies a [state] into the mutually-exclusive [PatternsSlideSurface] the composable switches on — the
 * pure mirror of that `when`, so per-state coverage is asserted off-device. A stale/offline state still
 * carries data, so it classifies as [PatternsSlideSurface.Content] (the composable layers the freshness
 * chip over it) rather than collapsing the slide.
 */
fun patternsSlideSurface(state: UiState<PatternsSnapshot>): PatternsSlideSurface =
    when {
        state.isLoading -> PatternsSlideSurface.Loading
        state.isError -> PatternsSlideSurface.Error
        state.isEmpty || state.data == null -> PatternsSlideSurface.Empty
        else -> PatternsSlideSurface.Content
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [PATTERNS_SLIDE_SLUG] (P1/S11). Kept free
 * of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordPatternsSlideOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to PATTERNS_SLIDE_SLUG))
}
