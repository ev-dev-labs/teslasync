// Pure, framework-free model + projections for the TripListPage trips surface (P3/A7) — the native analogue of
// everything web/src/features/trips/pages/TripListPage.tsx derives before composing its panels. No Compose, no
// Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core SI [Trip] DTO,
// the shared SI distance converter + energy formatter, the framework-free ChartFormat number helper, the android
// UnitPreferences settings reader, and java.time), so the composable stays a thin render layer and all of this
// stays unit-testable off-device by the :android:testDebugUnitTest gate.
//
// The web page reads one backend source — `useTrips({ vehicle_id, limit, offset, start, end })` ▸ `GET /trips`
// — then renders four summary MetricCards (total distance, energy used, total cost, total trips), a
// top-trips-by-distance bar chart inside a ChartContainer (with CSV/JSON export), and a paginated GlassPanel list
// of TripRows. This file ports the page's value derivations: the SI→display distance + energy + cost folds the
// web applies inside the MetricCard `value` props, the cost-per-100-unit subtitle, the top-10 chart series, and
// every TripRow value (distance, energy, the whPerKm efficiency + Wh/km→Wh/mi imperial lift, cost, the
// formatDate + formatDuration labels). The labels stay at the Compose boundary (they resolve from the i18n
// catalog), so this model produces only the formatted values + the count slices the labels are zipped with.
//
// SI boundary (unit-conversion.instructions): the model stays SI end to end (meters, Wh); the only display
// conversion lives in the explicit [TripListDisplayPrefs] helpers used at the render boundary
// (convertDistanceFromSI + the shared formatEnergy + the Wh/km→Wh/mi efficiency factor the web keeps because the
// shared units module ships no energy-per-distance helper), exactly as the web page converts only inside its
// render expressions (Phase-48 SI-canonical rule; ADR-013 keeps the cache itself SI).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/trips) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.trips.triplist

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.presentation.trips.Trip
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.formatEnergy
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `TripListPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("trips", "/trips", NavGroup.TripsDrives)`, so [io.teslasync.android.navigation.PageHosts] binds this
 * surface to that destination (and its `/trips` deep link) without the nav module depending on it.
 */
object TripListPageRegistration {
    /** The navigation destination id (Destinations.kt `page("trips", "/trips", …)`). */
    const val ROUTE_ID: String = "trips"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/trips"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle/trip id. */
    const val SLUG: String = "TripListPage"

    /** The web `useUrlNumber('size', 50)` default page size. */
    const val PAGE_SIZE: Int = 50

    /** The web default range: `now()` minus this many days (`d.setDate(d.getDate() - 365)`). */
    const val DEFAULT_RANGE_DAYS: Long = 365

    /** The web bar chart shows the top this-many trips by distance (`.slice(0, 10)`). */
    const val CHART_TOP_N: Int = 10
}

/**
 * The page's local interaction snapshot — the 1-based pagination cursor (web `useUrlNumber('page', 1)`). The
 * other web URL cells (range, size, saved view) are not part of this surface's required parity set, so the
 * snapshot carries only the page the bound feed re-collects on.
 *
 * @property page the 1-based current page (web `page`).
 */
data class TripListInteraction(
    val page: Int = 1,
)

/* ------------------------------------------------------------------ */
/*  Boundary constants (mirror the web TripListPage module)           */
/* ------------------------------------------------------------------ */

/** 1 km = 1000 m exactly (web `trip.total_distance_m / 1000`). */
private const val METERS_PER_KM = 1000.0

/** 1 mile = 1.609344 km exactly (web `KM_PER_MILE`) — the Wh/km → Wh/mi factor; no SI helper exists. */
private const val KM_PER_MILE = 1.609344

/** The per-100-units divisor used by the cost-efficiency subtitle (web `* 100 / … /100`). */
private const val PER_HUNDRED = 100.0

/** Milliseconds in an hour (web `ms / 3600000`). */
private const val MS_PER_HOUR = 3_600_000L

/** Milliseconds in a minute (web `/ 60000`). */
private const val MS_PER_MINUTE = 60_000.0

/** Minutes rounding threshold below which a whole-hour duration drops its trailing `0m` (web `minsRaw >= 0.5`). */
private const val MINUTES_ROUND_THRESHOLD = 0.5

/** The maximum number of leading characters parsed as a bare ISO date (`yyyy-MM-dd`). */
private const val DATE_PREFIX_LENGTH = 10

/** Em dash shown for a missing / unparseable value (web `?? '—'`). */
const val TRIP_LIST_EM_DASH: String = "\u2014"

/**
 * The un-internationalized "in progress" duration label the web shows for a trip with no end date. Mirrors the
 * web `formatDuration`'s `if (!endDate) return 'In progress'` verbatim
 * (web/src/features/trips/pages/TripListPage.tsx L34); there is no i18n key for it on the web or in this surface's
 * required string set, so it is reproduced as the same literal here — the same precedent as the TripDetail port's
 * "Trip #id" fallback.
 */
const val TRIP_IN_PROGRESS: String = "In progress"

/* ------------------------------------------------------------------ */
/*  Display preferences (web useUnits + useFormatting)                */
/* ------------------------------------------------------------------ */

/**
 * The display-boundary helpers the page applies to the SI [Trip]s — the Kotlin port of the web page's `useUnits`
 * (distance unit + `formatEnergy`) + `useFormatting` (currency symbol + precision) derivation from the
 * `/settings` document. Distance is converted through the shared SI converter; energy through the shared
 * `formatEnergy`; the currency + numbers reproduce the web `fmtNumber`/`fmtInt`/`formatCurrency` (locale-grouped,
 * fixed digits) through the framework-free [ChartFormat] number helper.
 *
 * @property unit the resolved SI display unit set (web `unitPrefs` + the energy formatter source).
 * @property currencySymbol the configured currency symbol, never blank (web `currency_symbol` ?? "$").
 * @property precision the currency fraction digits (web `decimal_precision`, floored & >= 0, else 2).
 * @property locale the BCP-47 locale used for number grouping (web global locale).
 */
data class TripListDisplayPrefs(
    val unit: UnitPref,
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    /** The user's distance display unit (web `unitPrefs.distance`). */
    val distanceUnit: DistanceUnitPref get() = unit.distance

    /** Distance unit short label (web `unitPrefs.distance`: "mi" / "km"). */
    val distanceLabel: String get() = unit.distance.label

    /** Efficiency unit label (web `unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`). */
    val efficiencyLabel: String get() = if (unit.distance == DistanceUnitPref.MI) EFFICIENCY_LABEL_MI else EFFICIENCY_LABEL_KM

    /** SI metres → the user's distance unit (web `convertDistanceFromSI`). */
    fun toDistance(meters: Double): Double = convertDistanceFromSI(meters, unit.distance)

    /** A finite number with [decimals] fraction digits + locale grouping (web `fmtNumber`/`fmtInt`; non-finite → 0). */
    fun number(
        value: Double,
        decimals: Int,
    ): String = ChartFormat.number(if (value.isFinite()) value else 0.0, decimals.coerceAtLeast(0), locale)

    /** Currency of an amount (web `formatCurrency`: symbol + grouped number at [decimals] digits). */
    fun currency(
        amount: Double,
        decimals: Int = precision,
    ): String = currencySymbol + number(amount, decimals)

    /** SI watt-hours formatted in the user's energy unit (web `formatEnergy`, e.g. "12.3 kWh"). */
    fun energy(wattHours: Double): String = formatEnergy(wattHours, unit)

    companion object {
        private const val DEFAULT_CURRENCY = "$"
        private const val DEFAULT_PRECISION = 2
        private const val DEFAULT_LOCALE_TAG = "en-US"
        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"
        private const val EFFICIENCY_LABEL_MI = "Wh/mi"
        private const val EFFICIENCY_LABEL_KM = "Wh/km"

        /** Metric + `$` + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: TripListDisplayPrefs =
            TripListDisplayPrefs(
                unit = UnitPreferences.fromSettings(null),
                currencySymbol = DEFAULT_CURRENCY,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits` / `useFormatting`). */
        fun fromSettings(settings: JsonElement?): TripListDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val rawSymbol =
                (settings as? JsonObject)?.let { (it[KEY_CURRENCY_SYMBOL] as? JsonPrimitive)?.contentOrNull?.trim() }
            return TripListDisplayPrefs(
                unit = unit,
                currencySymbol = if (!rawSymbol.isNullOrEmpty()) rawSymbol else DEFAULT_CURRENCY,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = runCatching { Locale.forLanguageTag(unit.locale ?: DEFAULT_LOCALE_TAG) }.getOrDefault(Locale.US),
            )
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Folded view (the web MetricCard / chart / TripRow values)         */
/* ------------------------------------------------------------------ */

/**
 * The fully-formatted display values the trip-list panels render — the native fold of everything the web page
 * computes for its four summary cards, the top-trips chart, and the trip rows. The labels are NOT here: they
 * resolve from the i18n catalog at the Compose boundary and are zipped with these values, so this stays
 * framework-free.
 *
 * @property distanceValue the total-distance card value (web `${fmtInt(totalDistDisplay)} ${unit}`).
 * @property energyValue the energy-used card value (web `formatEnergy(totalEnergy)`).
 * @property costValue the total-cost card value (web `formatCurrency(totalCost)`).
 * @property costSubtitle the total-cost card subtitle (web `${formatCurrency(cost/dist*100)}/100${unit}` or `$0`).
 * @property tripCount the number of trips (web `allTrips.length`) — the total-trips card value + distance subtitle count.
 * @property driveCount the summed drive count (web `totalDrives`) — the energy + total-trips card subtitle counts.
 * @property chart the top-trips-by-distance bar-chart slice.
 * @property rows the per-trip row values, in the backend order (web `allTrips.map`).
 */
data class TripListData(
    val distanceValue: String,
    val energyValue: String,
    val costValue: String,
    val costSubtitle: String,
    val tripCount: Int,
    val driveCount: Long,
    val chart: TripChart,
    val rows: List<TripRowView>,
)

/**
 * The top-trips-by-distance bar chart slice (web `chartData`: the 10 longest trips). [values] are in the user's
 * display distance unit; [tableRows] back the ChartContainer's accessible data table (the screen-reader fallback).
 *
 * @property labels the x-axis trip names (web `trip.name ?? \`Trip ${trip.id}\``).
 * @property values the bar heights in display distance units (web `convertDistanceFromSI(...)`).
 * @property tableRows the accessible data table rows (`[name, distance]`).
 * @property unitLabel the distance unit symbol for the series/column header (web `unitPrefs.distance`).
 * @property hasData whether any trip exists to chart (web `chartData.length > 0`).
 */
data class TripChart(
    val labels: List<String>,
    val values: List<Double?>,
    val tableRows: List<List<String>>,
    val unitLabel: String,
    val hasData: Boolean,
)

/**
 * One trip row's formatted values — the native fold of everything the web `TripRow` computes inside its render
 * expressions. [name] stays raw (nullable): the Compose boundary builds the `"Trip #id"` fallback from the
 * i18n `trips.row.trip` word, so the un-internationalized template literal is not reproduced as English here.
 *
 * @property id the trip id (web `trip.id`) — drives the name fallback at the render boundary.
 * @property name the raw trip name, or null (web `trip.name`).
 * @property dateLabel the start date (web `formatDate(trip.start_date)`).
 * @property durationLabel the trip duration (web `formatDuration(start_date, end_date)`), or [TRIP_IN_PROGRESS].
 * @property drives the trip's drive count (web `trip.drive_count`).
 * @property charges the trip's charge count (web `trip.charge_count`).
 * @property showCharges whether the charge chip renders (web `trip.charge_count > 0`).
 * @property distanceValue the distance value (web `${fmtInt(distanceDisplay)} ${distancePref}`).
 * @property energyValue the energy value (web `formatEnergy(trip.total_energy_wh)`).
 * @property efficiencyValue the efficiency value (web `${fmtInt(efficiencyDisplay)} ${efficiencyUnit}`).
 * @property costValue the cost value, or null when the trip has no cost (web `trip.total_cost > 0 && …`).
 */
data class TripRowView(
    val id: Long,
    val name: String?,
    val dateLabel: String,
    val durationLabel: String,
    val drives: Long,
    val charges: Long,
    val showCharges: Boolean,
    val distanceValue: String,
    val energyValue: String,
    val efficiencyValue: String,
    val costValue: String?,
)

/**
 * Folds the loaded SI [trips] into the display [TripListData] under the user's [prefs] — the verbatim port of the
 * web page's render-time derivations (the four `reduce` summary totals, the cost-per-100-units subtitle, the
 * top-10 `chartData`, and the per-row `TripRow` values). [tripWord] is the resolved `trips.row.trip` label the
 * name fallbacks are built from; [zone] is unused for the medium-style dates but is kept for symmetry with the
 * sibling list ports. All distance/energy/cost conversion happens through the [prefs] helpers (the display
 * boundary); the [trips] stay SI.
 */
fun deriveTripListData(
    trips: List<Trip>,
    prefs: TripListDisplayPrefs,
    tripWord: String,
): TripListData {
    val totalDistanceM = trips.sumOf { it.totalDistanceM }
    val totalEnergyWh = trips.sumOf { it.totalEnergyWh }
    val totalCost = trips.sumOf { it.totalCost }
    val totalDrives = trips.sumOf { it.driveCount }
    val totalDistanceDisplay = prefs.toDistance(totalDistanceM)

    val costSubtitle =
        if (totalDistanceDisplay > 0.0) {
            "${prefs.currency((totalCost / totalDistanceDisplay) * PER_HUNDRED)}/${PER_HUNDRED.toInt()}${prefs.distanceLabel}"
        } else {
            prefs.currency(0.0)
        }

    val top = trips.sortedByDescending { it.totalDistanceM }.take(TripListPageRegistration.CHART_TOP_N)
    val chart =
        TripChart(
            labels = top.map { tripChartLabel(it, tripWord) },
            values = top.map { prefs.toDistance(it.totalDistanceM) },
            tableRows = top.map { listOf(tripChartLabel(it, tripWord), prefs.number(prefs.toDistance(it.totalDistanceM), 0)) },
            unitLabel = prefs.distanceLabel,
            hasData = top.isNotEmpty(),
        )

    return TripListData(
        distanceValue = "${prefs.number(totalDistanceDisplay, 0)} ${prefs.distanceLabel}",
        energyValue = prefs.energy(totalEnergyWh),
        costValue = prefs.currency(totalCost),
        costSubtitle = costSubtitle,
        tripCount = trips.size,
        driveCount = totalDrives,
        chart = chart,
        rows = trips.map { deriveTripRow(it, prefs) },
    )
}

/** The chart x-axis label for a trip — the web `trip.name ?? \`Trip ${trip.id}\`` (literal "Trip", no `#`). */
private fun tripChartLabel(
    trip: Trip,
    tripWord: String,
): String = trip.name ?: "$tripWord ${trip.id}"

/** Folds one SI [trip] into its display [TripRowView] under [prefs] (web `TripRow` render expressions). */
private fun deriveTripRow(
    trip: Trip,
    prefs: TripListDisplayPrefs,
): TripRowView {
    val whPerKm = if (trip.totalDistanceM > 0.0) trip.totalEnergyWh / (trip.totalDistanceM / METERS_PER_KM) else 0.0
    val efficiencyDisplay = if (prefs.distanceUnit == DistanceUnitPref.MI) whPerKm * KM_PER_MILE else whPerKm
    val distanceDisplay = prefs.toDistance(trip.totalDistanceM)
    return TripRowView(
        id = trip.id,
        name = trip.name,
        dateLabel = formatTripDate(trip.startDate, prefs.locale),
        durationLabel = formatTripDuration(trip.startDate, trip.endDate, prefs.locale),
        drives = trip.driveCount,
        charges = trip.chargeCount,
        showCharges = trip.chargeCount > 0L,
        distanceValue = "${prefs.number(distanceDisplay, 0)} ${prefs.distanceLabel}",
        energyValue = prefs.energy(trip.totalEnergyWh),
        efficiencyValue = "${prefs.number(efficiencyDisplay, 0)} ${prefs.efficiencyLabel}",
        costValue = if (trip.totalCost > 0.0) prefs.currency(trip.totalCost) else null,
    )
}

/* ------------------------------------------------------------------ */
/*  Date / duration formatting (web formatDate / formatDuration)      */
/* ------------------------------------------------------------------ */

/**
 * A localized medium-style date for [raw] — the native port of the web `formatDate` (`toLocaleDateString` with
 * `{ year:'numeric', month:'short', day:'numeric' }`, e.g. "Apr 4, 2026"). Accepts an ISO date or date-time;
 * a null / blank / unparseable input renders the em-dash fallback. The trailing-offset local date is taken (the
 * sibling TripDetail precedent), so the result never throws across the render boundary.
 */
fun formatTripDate(
    raw: String?,
    locale: Locale,
): String {
    if (raw.isNullOrBlank()) return TRIP_LIST_EM_DASH
    val parsed =
        runCatching { OffsetDateTime.parse(raw).toLocalDate() }
            .recoverCatching { LocalDate.parse(raw) }
            .recoverCatching { LocalDate.parse(raw.take(DATE_PREFIX_LENGTH)) }
            .getOrNull() ?: return TRIP_LIST_EM_DASH
    return parsed.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
}

/**
 * The trip duration label — the verbatim port of the web `formatDuration(startDate, endDate)`: a null end is
 * still-running ([TRIP_IN_PROGRESS], the web literal); otherwise the `end - start` span renders as `${m}m`,
 * `${h}h ${m}m`, or a bare `${h}h` when the trailing minutes round below 0.5 (web `minsRaw >= 0.5`). Minutes use
 * the locale-grouped integer formatter (web `fmtInt`). An unparseable pair renders the em-dash fallback.
 */
fun formatTripDuration(
    startDate: String,
    endDate: String?,
    locale: Locale,
): String {
    if (endDate == null) return TRIP_IN_PROGRESS
    val start = parseInstant(startDate) ?: return TRIP_LIST_EM_DASH
    val end = parseInstant(endDate) ?: return TRIP_LIST_EM_DASH
    val ms = Duration.between(start, end).toMillis()
    val hours = ms / MS_PER_HOUR
    val minutesRaw = (ms % MS_PER_HOUR) / MS_PER_MINUTE
    val minutes = ChartFormat.number(minutesRaw, 0, locale)
    return when {
        hours == 0L -> "${minutes}m"
        minutesRaw >= MINUTES_ROUND_THRESHOLD -> "${hours}h ${minutes}m"
        else -> "${hours}h"
    }
}

/** Parses an RFC3339 date-time (or a bare ISO date at start of day) to an [Instant] (web `new Date(...)`). */
private fun parseInstant(raw: String): Instant? =
    runCatching { OffsetDateTime.parse(raw).toInstant() }
        .recoverCatching { LocalDate.parse(raw).atStartOfDay(ZoneId.of("UTC")).toInstant() }
        .recoverCatching { LocalDate.parse(raw.take(DATE_PREFIX_LENGTH)).atStartOfDay(ZoneId.of("UTC")).toInstant() }
        .getOrNull()
