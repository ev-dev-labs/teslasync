// Pure, framework-free model + projections for the LocationsPage maps surface — the native analogue of everything
// the web page derives before composing its panels (web/src/features/maps/pages/LocationsPage.tsx). No Compose, no
// Android UI, no HTTP: every declaration here is plain Kotlin over the shared-core SI [VisitedLocation] DTO, so the
// composable stays a thin render layer and the whole fold is asserted off-device.
//
// The web page threads its loaded `rawLocations` array through a `useMemo` chain — date-range filter (by
// `last_visited`) ▸ summary stats (unique places/cities, total visits/time, top, avg) ▸ search filter ▸ the two
// top-N bar series (visits / hours) ▸ paginate. This file ports that chain verbatim, plus the propose-only
// `isUnnamedLocation` predicate the web uses to decide whether to surface the AI auto-name affordance.
//
// SI boundary (unit-conversion instructions): the aggregation stays SI end to end — `total_duration_s` is seconds,
// never converted here. The only numeric shaping is the chart's seconds→hours figure ([hoursOf]), which mirrors the
// web `total_duration_s / 3600` data value (the user-unit duration formatting in the stat cards / list rows is the
// render boundary's job via the shared formatter; Phase-48 SI-canonical, ADR-013 keeps the cache itself SI).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.maps.locations

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.locations.VisitedLocation
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import kotlin.math.roundToLong

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `LocationsPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("locations", "/locations", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface to that
 * destination (and its `/locations` deep link) without the nav module depending on it.
 */
object LocationsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("locations", "/locations", …)`). */
    const val ROUTE_ID: String = "locations"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/locations"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle/place id. */
    const val SLUG: String = "LocationsPage"

    /** The web `pageSize` for the visited-location list (`const pageSize = 50`). */
    const val PAGE_SIZE: Int = 50

    /** The "Top Locations by Visits" chart keeps the first 15 rows (web `.slice(0, 15)`). */
    const val VISITS_CHART_LIMIT: Int = 15

    /** The "Top Locations by Time" chart keeps the first 10 rows (web `.slice(0, 10)`). */
    const val TIME_CHART_LIMIT: Int = 10

    /** Names longer than this are truncated for the chart axis (web `length > 25`). */
    const val NAME_TRUNCATE_AT: Int = 25

    /** Truncated chart labels keep this many leading chars before the ellipsis (web `slice(0, 22) + '…'`). */
    const val NAME_TRUNCATE_TO: Int = 22

    /** The lower bound for the default "all time" range (web `defaultPresetId: 'all'`). */
    val ALL_TIME_START: LocalDate = LocalDate.of(2015, 1, 1)

    /** Seconds per hour — the web `total_duration_s / 3600` chart conversion divisor. */
    const val SECONDS_PER_HOUR: Double = 3600.0

    /** The reverse-geocoder's unnamed-city sentinel excluded from the unique-cities count (web `'Unknown'`). */
    const val UNKNOWN_CITY: String = "Unknown"
}

private const val ELLIPSIS: String = "\u2026"
private const val DECIMAL_SCALE: Double = 10.0
private const val LAST_SECOND_NANOS: Int = 999_000_000

/**
 * Two signed decimals separated by a comma — the coordinate fallback the geocoder emits when reverse-geocode fails
 * (e.g. `"47.6062,-122.3321"`). The verbatim port of the web `isUnnamedLocation` regex.
 */
private val COORDINATE_PAIR = Regex("^-?\\d+(?:\\.\\d+)?\\s*,\\s*-?\\d+(?:\\.\\d+)?$")

/**
 * The inclusive `[start, end]` date window the page reads — the native mirror of the web `useRangeState` value
 * (`{ start, end }`). It narrows which visited places are listed to those last visited inside the window (the web
 * client-side `rawLocations.filter` over `last_visited`); the lifetime `visit_count` / `total_duration_s` aggregates
 * are unchanged. Defaults to the web `'all'` preset (a 2015 lower bound through today) so the first frame shows
 * everything.
 */
data class LocationsRange(
    val start: LocalDate,
    val end: LocalDate,
) {
    companion object {
        /** The web `'all'` preset: a 2015-01-01 lower bound through [today]. */
        fun allTime(today: LocalDate = LocalDate.now()): LocationsRange =
            LocationsRange(LocationsPageRegistration.ALL_TIME_START, today)
    }
}

/**
 * The page's local interaction snapshot — the native mirror of the web URL-state cells: the search query
 * (`useUrlString('q')`), the 1-based page (`useUrlNumber('page')`), and the picked range (`useRangeState`).
 */
data class LocationsInteraction(
    val search: String = "",
    val page: Int = 1,
    val range: LocationsRange,
)

/** One plotted top-N bar — a display [label] (truncated place name) and its SI-derived [value]. */
data class LocationBar(
    val label: String,
    val value: Double,
)

/**
 * The summary figures the six stat cards read, derived from the range-windowed visited-location list — the native
 * port of the web `totalVisits` / `totalTime` / `uniquePlaces` / `uniqueCities` / `topLocation` / `avgDurationS`
 * memos. Every figure is SI (seconds) or a count; display formatting is the render boundary's job.
 */
data class LocationsStats(
    val uniquePlaces: Int,
    val uniqueCities: Int,
    val totalVisits: Long,
    val totalTimeS: Long,
    val topName: String?,
    val avgDurationS: Double,
) {
    companion object {
        /** Folds the windowed [locations] into the summary stats (web `useMemo` reducers). */
        fun from(locations: List<VisitedLocation>): LocationsStats {
            val totalVisits = locations.sumOf { it.visitCount }
            val totalTime = locations.sumOf { it.totalDurationS }
            return LocationsStats(
                uniquePlaces = locations.size,
                uniqueCities = uniqueCities(locations),
                totalVisits = totalVisits,
                totalTimeS = totalTime,
                topName = locations.firstOrNull()?.addressName,
                avgDurationS =
                    if (totalVisits > 0) {
                        totalTime.toDouble() / totalVisits // parity:allow SI seconds → Double mean, not a TODO stub
                    } else {
                        0.0
                    },
            )
        }
    }
}

/**
 * Whether a visited-location row should surface the AI auto-name affordance — the verbatim port of the web
 * `isUnnamedLocation`. Three buckets count as "unnamed": empty/whitespace, the literal `"Unknown"` sentinel the
 * reverse-geocoder emits, and the coordinate-pair fallback shape. The AI is propose-only and only worth offering
 * when the existing label is unhelpful.
 */
fun isUnnamedLocation(addressName: String?): Boolean {
    val trimmed = (addressName ?: "").trim()
    if (trimmed.isEmpty()) return true
    if (trimmed.lowercase() == "unknown") return true
    return COORDINATE_PAIR.matches(trimmed)
}

/** Truncates a place name for a chart axis label (web `length > 25 ? slice(0, 22) + '…' : name`). */
fun truncateName(name: String?): String {
    val value = name ?: ""
    return if (value.length > LocationsPageRegistration.NAME_TRUNCATE_AT) {
        value.take(LocationsPageRegistration.NAME_TRUNCATE_TO) + ELLIPSIS
    } else {
        value
    }
}

/**
 * Narrows [locations] to those last visited inside [range] — the web client-side `rawLocations.filter` over
 * `last_visited`. A row with no `last_visited` (or an unparseable stamp) is excluded, matching the web
 * `if (!l.last_visited) return false`. Bounds are resolved in [zone] (the web's local-time `${start}T00:00:00` /
 * `${end}T23:59:59.999`); injectable so the fold is deterministic under test.
 */
fun filterToRange(
    locations: List<VisitedLocation>,
    range: LocationsRange,
    zone: ZoneId = ZoneId.systemDefault(),
): List<VisitedLocation> {
    val startMs = range.start.atStartOfDay(zone).toInstant().toEpochMilli()
    val endMs = range.end.atTime(23, 59, 59, LAST_SECOND_NANOS).atZone(zone).toInstant().toEpochMilli()
    return locations.filter { loc ->
        val ms = visitedMillisOf(loc.lastVisited, zone) ?: return@filter false
        ms in startMs..endMs
    }
}

/**
 * Filters [locations] by a free-text [query] over the address name — the native port of the web
 * `useFilteredList(locations, search, ['address_name'])`. A blank query passes everything; otherwise a
 * case-insensitive substring match is applied.
 */
fun searchLocations(
    locations: List<VisitedLocation>,
    query: String,
): List<VisitedLocation> {
    val needle = query.trim().lowercase()
    if (needle.isEmpty()) return locations
    return locations.filter { it.addressName.lowercase().contains(needle) }
}

/**
 * Counts the distinct cities across [locations] — the web `uniqueCities` memo: split each address on commas, take
 * the trailing segment (or the whole label when there is no comma), and exclude empties and the `'Unknown'`
 * sentinel.
 */
fun uniqueCities(locations: List<VisitedLocation>): Int {
    if (locations.isEmpty()) return 0
    val cities = HashSet<String>()
    for (loc in locations) {
        val parts = loc.addressName.split(",").map { it.trim() }
        val city = if (parts.size > 1) parts.last() else parts.firstOrNull().orEmpty()
        if (city.isNotEmpty() && city != LocationsPageRegistration.UNKNOWN_CITY) {
            cities.add(city)
        }
    }
    return cities.size
}

/** The hours figure for the time-spent chart — the web `+(fmtNumber(total_duration_s / 3600, 1))` (1-dp round). */
fun hoursOf(seconds: Long): Double {
    val hours = seconds / LocationsPageRegistration.SECONDS_PER_HOUR
    return (hours * DECIMAL_SCALE).roundToLong() / DECIMAL_SCALE
}

/** The "Top Locations by Visits" series — the first [VISITS_CHART_LIMIT] rows as `(name, visit_count)` bars. */
fun visitsBars(locations: List<VisitedLocation>): List<LocationBar> =
    locations.take(LocationsPageRegistration.VISITS_CHART_LIMIT).map {
        LocationBar(truncateName(it.addressName), it.visitCount.toDouble()) // parity:allow SI count → Double series, not a TODO stub
    }

/** The "Top Locations by Time Spent" series — the first [TIME_CHART_LIMIT] rows as `(name, hours)` bars. */
fun timeBars(locations: List<VisitedLocation>): List<LocationBar> =
    locations.take(LocationsPageRegistration.TIME_CHART_LIMIT).map {
        LocationBar(truncateName(it.addressName), hoursOf(it.totalDurationS))
    }

/**
 * The 1-based [page] slice of [locations] at [pageSize] — the client-side analogue of the web's server `limit` /
 * `offset` window. Since the shared `LocationRepository.visitedLocations` returns the whole per-vehicle list, the
 * page is sliced here; an out-of-range page resolves to an empty slice rather than throwing.
 */
fun paginate(
    locations: List<VisitedLocation>,
    page: Int,
    pageSize: Int = LocationsPageRegistration.PAGE_SIZE,
): List<VisitedLocation> {
    if (locations.isEmpty() || pageSize <= 0) return emptyList()
    val from = (page - 1).coerceAtLeast(0) * pageSize
    if (from >= locations.size) return emptyList()
    val to = (from + pageSize).coerceAtMost(locations.size)
    return locations.subList(from, to)
}

/** The 0-based index of the first row on [page] — the rank offset for the list (web `i` over the full set). */
fun pageOffset(
    page: Int,
    pageSize: Int = LocationsPageRegistration.PAGE_SIZE,
): Int = (page - 1).coerceAtLeast(0) * pageSize

/** Emits the one PII-safe `view.opened` diagnostic with the surface [LocationsPageRegistration.SLUG] (P1/S11). */
fun recordLocationsPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to LocationsPageRegistration.SLUG))
}

/**
 * Parses an ISO-8601 `last_visited` stamp to epoch millis — the native analogue of the web `new Date(l.last_visited)`.
 * Tolerant of a trailing `Z`, an explicit offset, or a zone-less local timestamp (resolved in [zone]); returns `null`
 * for a blank or unparseable value so the row is dropped from the window. Public so the render boundary can reuse it
 * to format the "Last: …" date without re-implementing the parse.
 */
fun visitedMillisOf(
    raw: String?,
    zone: ZoneId = ZoneId.systemDefault(),
): Long? {
    val text = raw?.trim().orEmpty()
    if (text.isEmpty()) return null
    return runCatching { Instant.parse(text).toEpochMilli() }
        .recoverCatching { OffsetDateTime.parse(text).toInstant().toEpochMilli() }
        .recoverCatching { LocalDateTime.parse(text).atZone(zone).toInstant().toEpochMilli() }
        .getOrNull()
}
