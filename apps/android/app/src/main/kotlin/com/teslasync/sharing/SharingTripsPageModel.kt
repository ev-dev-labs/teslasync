// The framework-free model for the SharingTripsPage sharing surface (P1/S8 support) — the native counterpart of
// the derivation logic in the web page (web/src/features/sharing/pages/SharingTripsPage.tsx). It owns the page's
// registration metadata, the display-preference resolution (web `useUnits`), the per-row display projection
// (date / duration / distance / energy), and the one-shot `view.opened` diagnostic. No Compose, no coroutines, no
// HTTP — every figure is a pure function of a [Trip] + the resolved [SharingTripsDisplayPrefs], so the whole model
// is exercised by the off-device `:app:testDebugUnitTest` gate.
//
// SI boundary (Phase-48): trips arrive SI-canonical (metres, watt-hours, RFC3339 strings). Distance is converted
// to the user's unit only here at the render boundary via the shared SI converters (web `convertDistanceFromSI` +
// `fmtInt`); energy is shown verbatim in watt-hours exactly as the web row renders `fmtNumber(total_energy_wh) Wh`.
// Nothing is ever stored or computed in a non-SI unit.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/sharing) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharing.sharingtrips

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.trips.Trip
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatDistance as formatDistanceSI
import kotlinx.serialization.json.JsonElement
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.floor

/** Em dash shown wherever a value is missing/unparseable (web `'—'`). */
internal const val SHARING_TRIPS_EM_DASH: String = "\u2014"

/**
 * Static metadata binding this surface to its navigation destination + diagnostics slug. The destination id
 * matches `Destinations.kt` `page("sharingTrips", "/sharing/trips", NavGroup.Sharing)`, so
 * [io.teslasync.android.navigation.PageHosts] binds this surface to that destination (and its `/sharing/trips`
 * deep link) without the nav module depending on it.
 */
object SharingTripsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("sharingTrips", "/sharing/trips", …)`). */
    const val ROUTE_ID: String = "sharingTrips"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/sharing/trips"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle/trip id. */
    const val SLUG: String = "SharingTripsPage"

    /** The web `useTrips({ limit: 20 })` recent-trips page size. */
    const val RECENT_LIMIT: Int = 20
}

// ── Display preferences (web `useUnits`) ────────────────────────────────────────────────────────────────────────

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` read from the
 * `/settings` document: the SI [units] bag (distance unit + locale + decimal precision) plus the resolved [locale]
 * used for number grouping. Distances render through the shared SI converter ([formatDistanceSI]); energy renders
 * verbatim in watt-hours (web `fmtNumber(total_energy_wh) Wh`).
 *
 * @property units the resolved SI/display [UnitPref] (web `unitPrefs`).
 * @property locale the BCP-47 locale used for grouped number formatting (web `_globalLocale`).
 */
data class SharingTripsDisplayPrefs(
    val units: UnitPref,
    val locale: Locale,
) {
    /** Distance unit short label (web `unitPrefs.distance`: "mi" / "km"). */
    val distanceLabel: String get() = units.distance.label

    /**
     * SI metres → the user's distance unit as an integer with grouping + unit label (web
     * `${fmtInt(convertDistanceFromSI(m, distance))} ${unitPrefs.distance}` → e.g. "1,234 mi").
     */
    fun formatDistance(meters: Double): String = formatDistanceSI(meters, units, DISTANCE_PRECISION)

    /**
     * SI watt-hours → grouped number + the literal "Wh" (web `${fmtNumber(total_energy_wh)} Wh`). The decimal
     * precision is the settings `decimal_precision` (web global precision), defaulting to two places.
     */
    fun formatEnergyWh(wattHours: Double): String =
        "${ChartFormat.number(wattHours, units.precision ?: DEFAULT_PRECISION, locale)} Wh"

    companion object {
        /** Distance shows as an integer (web `fmtInt`). */
        private const val DISTANCE_PRECISION = 0

        /** The web global decimal precision default before `/settings` loads. */
        private const val DEFAULT_PRECISION = 2

        private const val DEFAULT_LOCALE = "en-US"

        /** Metric defaults used before settings load (matches the web `useUnits` cold-start defaults). */
        fun default(): SharingTripsDisplayPrefs = fromSettings(null)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): SharingTripsDisplayPrefs {
            val units = UnitPreferences.fromSettings(settings)
            val locale = runCatching { Locale.forLanguageTag(units.locale ?: DEFAULT_LOCALE) }.getOrDefault(Locale.US)
            return SharingTripsDisplayPrefs(units, locale)
        }
    }
}

// ── Row projection (web recent-trips list item) ─────────────────────────────────────────────────────────────────

/**
 * One recent-trips row's display projection — every preformatted figure the list item renders, derived once from a
 * [Trip] + the resolved [SharingTripsDisplayPrefs]. The i18n-bearing pieces (the "Trip" name fallback and the
 * "{{count}} drives" label) are resolved at the composable via `stringResource`, so this pure model carries only
 * the raw [id]/[name]/[driveCount] plus the already-formatted [dateText]/[durationText]/[distanceText]/[energyText].
 *
 * @property id the trip id (web `trip.id`) — selection key + the name fallback suffix.
 * @property name the user-set trip name, or `null` when unset (web `trip.name`).
 * @property driveCount the trip's drive count (web `trip.drive_count`), fed to the pluralized drives label.
 * @property dateText the localized start date (web `formatDate(trip.start_date)` → "Apr 4, 2026").
 * @property durationText the start→end duration (web `formatDuration(start, end)` → "2h 5m" / "45m" / "—").
 * @property distanceText the total distance in the user's unit (web distance cell → "1,234 mi").
 * @property energyText the total energy in watt-hours (web energy cell → "12,345.00 Wh").
 */
data class SharingTripRow(
    val id: Long,
    val name: String?,
    val driveCount: Long,
    val dateText: String,
    val durationText: String,
    val distanceText: String,
    val energyText: String,
)

/** Projects a [Trip] onto its display [SharingTripRow] under the resolved [prefs] (web per-row derivation). */
fun sharingTripRow(
    trip: Trip,
    prefs: SharingTripsDisplayPrefs,
): SharingTripRow =
    SharingTripRow(
        id = trip.id,
        name = trip.name?.takeIf { it.isNotBlank() },
        driveCount = trip.driveCount,
        dateText = formatTripDate(trip.startDate, prefs.locale),
        durationText = formatTripDuration(trip.startDate, trip.endDate, prefs.locale),
        distanceText = prefs.formatDistance(trip.totalDistanceM),
        energyText = prefs.formatEnergyWh(trip.totalEnergyWh),
    )

// ── Date / duration formatting (web `formatDate` / `formatDuration`) ─────────────────────────────────────────────

/**
 * The localized "Apr 4, 2026" start-date label (web `formatDate(trip.start_date)`: year-numeric, month-short,
 * day-numeric). An unparseable timestamp degrades to the em dash rather than throwing.
 */
fun formatTripDate(
    iso: String,
    locale: Locale,
): String {
    val millis = parseEpochMillis(iso) ?: return SHARING_TRIPS_EM_DASH
    val date = Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()).toLocalDate()
    return date.format(DateTimeFormatter.ofPattern(DATE_PATTERN, locale))
}

/**
 * The start→end duration label (verbatim port of the web `formatDuration`): `"—"` when there is no end; `"45m"`
 * when under an hour; `"2h 5m"` when there are residual minutes (≥ 0.5, web rounds via `fmtInt`); `"2h"` otherwise.
 */
fun formatTripDuration(
    startIso: String,
    endIso: String?,
    locale: Locale,
): String {
    if (endIso.isNullOrBlank()) return SHARING_TRIPS_EM_DASH
    val startMs = parseEpochMillis(startIso) ?: return SHARING_TRIPS_EM_DASH
    val endMs = parseEpochMillis(endIso) ?: return SHARING_TRIPS_EM_DASH
    val deltaMs = endMs - startMs
    val hours = floor(deltaMs / MILLIS_PER_HOUR).toLong()
    val minutesRaw = (deltaMs % MILLIS_PER_HOUR) / MILLIS_PER_MINUTE
    return when {
        hours == 0L -> "${fmtInt(minutesRaw, locale)}m"
        minutesRaw >= MINUTE_ROUNDING_FLOOR -> "${hours}h ${fmtInt(minutesRaw, locale)}m"
        else -> "${hours}h"
    }
}

/** The web `fmtInt` analogue: a grouped integer rendering (0 fraction digits) of [value]. */
private fun fmtInt(
    value: Double,
    locale: Locale,
): String = ChartFormat.number(value, 0, locale)

/**
 * Parses an RFC3339 timestamp (with offset, with `Z`, or local) to epoch milliseconds, mirroring the web
 * `new Date(iso).getTime()`. Returns `null` for a blank/unparseable value so callers fall back to the em dash.
 */
private fun parseEpochMillis(iso: String): Long? {
    val trimmed = iso.trim()
    if (trimmed.isEmpty()) return null
    return runCatching { OffsetDateTime.parse(trimmed).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(trimmed).toEpochMilli() }
        .recoverCatching {
            LocalDateTime.parse(trimmed).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        }.getOrNull()
}

// ── Diagnostics (P1/S11) ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11). Carries no vehicle id, trip id,
 * or trip name. Call from the composable's first composition.
 */
fun recordSharingTripsPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SharingTripsPageRegistration.SLUG))
}

private const val DATE_PATTERN = "MMM d, yyyy"
private const val MILLIS_PER_HOUR = 3_600_000.0
private const val MILLIS_PER_MINUTE = 60_000.0
private const val MINUTE_ROUNDING_FLOOR = 0.5
