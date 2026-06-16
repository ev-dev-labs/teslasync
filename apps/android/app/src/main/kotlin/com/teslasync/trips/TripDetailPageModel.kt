// Pure, framework-free model + projections for the TripDetailPage trips surface (P3/A7) — the native analogue of
// everything web/src/features/trips/pages/TripDetailPage.tsx derives before composing its panels. No Compose, no
// Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core SI [Trip] DTO,
// the shared SI distance converter, the framework-free ChartFormat number helper, the android UnitPreferences
// settings reader, and java.time), so the composable stays a thin render layer and all of this stays
// unit-testable off-device by the :android:testDebugUnitTest gate.
//
// The web page reads one backend source — `useTrip(id)` ▸ `GET /trips/{id}` — then renders four StatCards
// (distance, energy-used, efficiency, cost) and a GlassPanel KVList (trip id, name, started, ended, drives,
// charges). This file ports the page's value derivations: the SI→display distance + energy + efficiency + cost
// folds the web applies inside the StatCard `value` props, plus the KVList row values. The labels stay at the
// Compose boundary (they resolve from the i18n catalog), so this model produces only the formatted values.
//
// SI boundary (unit-conversion.instructions): the model stays SI end to end (meters, Wh); the only display
// conversion lives in the explicit [TripDetailDisplayPrefs] helpers used at the render boundary
// (convertDistanceFromSI + the Wh/km→Wh/mi efficiency factor the web keeps because the shared units module ships
// no energy-per-distance helper), exactly as the web page converts only inside its render expressions (Phase-48
// SI-canonical rule; ADR-013 keeps the cache itself SI).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/trips) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.trips.tripdetail

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.presentation.trips.Trip
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics — the native mirror of the web
 * `TripDetailPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `hidden("tripDetail", "/trips/:id", NavGroup.TripsDrives, listOf("id"))`, so
 * [io.teslasync.android.navigation.PageHosts] binds this surface to that destination (and its `/trips/{id}` deep
 * link) without the nav module depending on it.
 */
object TripDetailPageRegistration {
    /** The navigation destination id (Destinations.kt `hidden("tripDetail", "/trips/:id", …)`). */
    const val ROUTE_ID: String = "tripDetail"

    /** The route argument carrying the trip id (web `useParams().id`). */
    const val ARG_ID: String = "id"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/trips/:id"

    /** Diagnostics surface slug (P1/S11). Carries no trip id or user data. */
    const val SLUG: String = "TripDetailPage"
}

/* ------------------------------------------------------------------ */
/*  Boundary constants (mirror the web TripDetailPage module)         */
/* ------------------------------------------------------------------ */

/** 1 km = 1000 m exactly (web `trip.total_distance_m / 1000`). */
private const val METERS_PER_KM = 1000.0

/** 1 mile = 1.609344 km exactly (web `KM_PER_MILE`) — the Wh/km → Wh/mi factor; no SI helper exists. */
private const val KM_PER_MILE = 1.609344

/** The SI energy unit the energy card renders (web `unit="Wh"`). */
const val TRIP_ENERGY_UNIT: String = "Wh"

/** Em dash shown for a missing value (web `?? '—'`). */
const val TRIP_DETAIL_EM_DASH: String = "\u2014"

/** The un-internationalized subtitle/breadcrumb fallback (web `\`Trip #${id}\``); no i18n key exists for it. */
private const val TRIP_LABEL_PREFIX = "Trip #"

/** The maximum number of leading characters parsed as a bare ISO date (`yyyy-MM-dd`). */
private const val DATE_PREFIX_LENGTH = 10

/**
 * The un-internationalized "Trip #N" label the web uses for a trip with no name — for the page subtitle and the
 * breadcrumb override. Mirrors the web `\`Trip #${trip.id}\`` / `\`Trip #${id}\`` template literals verbatim
 * (web/src/features/trips/pages/TripDetailPage.tsx L40/L44); there is no i18n key for it on the web or in the
 * surface's required string set, so it is reproduced as the same literal here.
 */
fun tripFallbackLabel(id: Any?): String = "$TRIP_LABEL_PREFIX$id"

/* ------------------------------------------------------------------ */
/*  Display preferences (web useUnits + useFormatting)                */
/* ------------------------------------------------------------------ */

/**
 * The display-boundary helpers the page applies to the SI [Trip] — the Kotlin port of the web page's `useUnits`
 * (distance unit) + `useFormatting` (currency symbol + precision) derivation from the `/settings` document.
 * Distance is converted through the shared SI converter; the currency + numbers reproduce the web `fmtNumber`
 * (locale-grouped, fixed digits) through the framework-free [ChartFormat] number helper.
 *
 * @property distance the user's distance display unit (web `unitPrefs.distance`).
 * @property currencySymbol the configured currency symbol, never blank (web `currency_symbol` ?? "$").
 * @property precision the currency / energy fraction digits (web `decimal_precision`, floored & >= 0, else 2).
 * @property locale the BCP-47 locale used for number grouping (web global locale).
 */
data class TripDetailDisplayPrefs(
    val distance: DistanceUnitPref,
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    /** Distance unit short label (web `unitPrefs.distance`: "mi" / "km"). */
    val distanceLabel: String get() = distance.label

    /** Efficiency unit label (web `unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`). */
    val efficiencyLabel: String get() = if (distance == DistanceUnitPref.MI) EFFICIENCY_LABEL_MI else EFFICIENCY_LABEL_KM

    /** A finite number with [decimals] fraction digits + locale grouping (web `fmtNumber`; non-finite → 0). */
    fun number(
        value: Double,
        decimals: Int,
    ): String = ChartFormat.number(if (value.isFinite()) value else 0.0, decimals.coerceAtLeast(0), locale)

    /** Currency of an amount (web `formatCurrency`: symbol + grouped number at [decimals] digits). */
    fun currency(
        amount: Double,
        decimals: Int = precision,
    ): String = currencySymbol + number(amount, decimals)

    companion object {
        private const val DEFAULT_CURRENCY = "$"
        private const val DEFAULT_PRECISION = 2
        private const val DEFAULT_LOCALE_TAG = "en-US"
        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"
        private const val EFFICIENCY_LABEL_MI = "Wh/mi"
        private const val EFFICIENCY_LABEL_KM = "Wh/km"

        /** Metric + `$` + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: TripDetailDisplayPrefs =
            TripDetailDisplayPrefs(
                distance = DistanceUnitPref.KM,
                currencySymbol = DEFAULT_CURRENCY,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits` / `useFormatting`). */
        fun fromSettings(settings: JsonElement?): TripDetailDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val rawSymbol =
                (settings as? JsonObject)?.let { (it[KEY_CURRENCY_SYMBOL] as? JsonPrimitive)?.contentOrNull?.trim() }
            return TripDetailDisplayPrefs(
                distance = unit.distance,
                currencySymbol = if (!rawSymbol.isNullOrEmpty()) rawSymbol else DEFAULT_CURRENCY,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = runCatching { Locale.forLanguageTag(unit.locale ?: DEFAULT_LOCALE_TAG) }.getOrDefault(Locale.US),
            )
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Folded view (the web StatCard values + KVList row values)         */
/* ------------------------------------------------------------------ */

/**
 * The fully-formatted display strings the trip-detail panels render — the native fold of everything the web page
 * computes inside its StatCard `value` props and KVList `items`. The labels are NOT here: they resolve from the
 * i18n catalog at the Compose boundary and are zipped with these values, so this stays framework-free.
 *
 * @property subtitle the page subtitle / breadcrumb label (web `trip.name ?? \`Trip #${trip.id}\``).
 * @property distance the distance card value (web `fmtInt(convertDistanceFromSI(...))`).
 * @property distanceUnit the distance unit symbol (web `unit={unitPrefs.distance}`).
 * @property energy the energy-used card value (web `fmtNumber(trip.total_energy_wh)`).
 * @property energyUnit the energy unit symbol (web `unit="Wh"`).
 * @property efficiency the efficiency card value (web `fmtInt(efficiencyDisplay)`).
 * @property efficiencyUnit the efficiency unit symbol (web `efficiencyUnit`).
 * @property cost the cost card value (web `formatCurrency(trip.total_cost)`).
 * @property tripId the KVList trip-id row value (web `String(trip.id)`).
 * @property name the KVList name row value (web `trip.name ?? '—'`).
 * @property started the KVList started row value (web `formatDate(trip.start_date)`).
 * @property ended the KVList ended row value (web `trip.end_date ? formatDate(...) : '—'`).
 * @property drives the KVList drives row value (web `String(trip.drive_count)`).
 * @property charges the KVList charges row value (web `String(trip.charge_count)`).
 */
data class TripDetailView(
    val subtitle: String,
    val distance: String,
    val distanceUnit: String,
    val energy: String,
    val energyUnit: String,
    val efficiency: String,
    val efficiencyUnit: String,
    val cost: String,
    val tripId: String,
    val name: String,
    val started: String,
    val ended: String,
    val drives: String,
    val charges: String,
)

/**
 * Folds an SI [Trip] into the display [TripDetailView] under the user's [prefs] — the verbatim port of the web
 * page's render-time derivations. Distance is SI-converted then integer-formatted; energy renders at the user's
 * precision; efficiency reproduces the web `whPerKm = total_energy_wh / (total_distance_m / 1000)` then the
 * `* KM_PER_MILE` imperial lift; cost goes through the currency formatter. Dates render via [formatTripDate].
 */
fun deriveTripDetailView(
    trip: Trip,
    prefs: TripDetailDisplayPrefs,
): TripDetailView {
    val distanceDisplay = convertDistanceFromSI(trip.totalDistanceM, prefs.distance)
    val whPerKm = if (trip.totalDistanceM > 0.0) trip.totalEnergyWh / (trip.totalDistanceM / METERS_PER_KM) else 0.0
    val efficiencyDisplay = if (prefs.distance == DistanceUnitPref.MI) whPerKm * KM_PER_MILE else whPerKm
    return TripDetailView(
        subtitle = trip.name ?: tripFallbackLabel(trip.id),
        distance = prefs.number(distanceDisplay, 0),
        distanceUnit = prefs.distanceLabel,
        energy = prefs.number(trip.totalEnergyWh, prefs.precision),
        energyUnit = TRIP_ENERGY_UNIT,
        efficiency = prefs.number(efficiencyDisplay, 0),
        efficiencyUnit = prefs.efficiencyLabel,
        cost = prefs.currency(trip.totalCost),
        tripId = trip.id.toString(),
        name = trip.name ?: TRIP_DETAIL_EM_DASH,
        started = formatTripDate(trip.startDate, prefs.locale),
        ended = trip.endDate?.let { formatTripDate(it, prefs.locale) } ?: TRIP_DETAIL_EM_DASH,
        drives = trip.driveCount.toString(),
        charges = trip.chargeCount.toString(),
    )
}

/**
 * A localized medium-style date for [raw] — the native port of the web `formatDate` (`toLocaleDateString` with
 * `{ year:'numeric', month:'short', day:'numeric' }`, e.g. "Apr 4, 2026"). Accepts an ISO date or date-time;
 * a null / blank / unparseable input renders the em-dash fallback (web `'—'`). The trailing-offset local date is
 * taken (the sibling LifetimeStats precedent), so the result never throws across the render boundary.
 */
fun formatTripDate(
    raw: String?,
    locale: Locale,
): String {
    if (raw.isNullOrBlank()) return TRIP_DETAIL_EM_DASH
    val parsed =
        runCatching { OffsetDateTime.parse(raw).toLocalDate() }
            .recoverCatching { LocalDate.parse(raw) }
            .recoverCatching { LocalDate.parse(raw.take(DATE_PREFIX_LENGTH)) }
            .getOrNull() ?: return TRIP_DETAIL_EM_DASH
    return parsed.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
}
