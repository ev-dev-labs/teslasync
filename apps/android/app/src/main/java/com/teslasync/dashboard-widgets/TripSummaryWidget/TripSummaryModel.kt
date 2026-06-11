// Pure, framework-free model + projection for the Trip Summary dashboard widget — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/TripSummaryWidget.tsx): the `lastTrip = trips[0]` /
// `recentTrips = trips.slice(0, 3)` picks, the `recentTrips.length > 1` recent-list gate that renders
// `recentTrips.slice(1)`, the per-stat distance / duration / drive-count / charge-count formatting, and
// the `name ?? 'Unnamed trip'` fallback. No Compose, no Android UI, no HTTP: every type here is
// unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin render
// layer.
//
// SI boundary (Phase-48; ADR-013): the trip's `total_distance_m` arrives as SI metres and is converted
// to the user's display unit only here, at the render boundary, via the shared [UnitFormatter]
// (web `useUnits` + `convertDistanceFromSI`). The duration is derived from the two RFC3339 timestamps
// exactly as the web `formatDurationRange(start_date, end_date)` does (round ms → whole minutes), NOT
// from the SI `total_duration_s` column — faithful to the web source. Drive/charge counts are plain
// integers (no unit). Locale-stable formatting only; no SI value is ever stored converted.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/TripSummaryWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling DrivingDynamicsWidget /
// SoftwareUpdateHistoryWidget do. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.tripsummary

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.presentation.trips.Trip
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Em dash shown for a missing date / duration — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Web `fmtNumber(displayDist, 1)` — trip distances render with one fraction digit. */
private const val DISTANCE_DECIMALS: Int = 1

/** Web `trips.slice(0, 3)` — at most the three most-recent trips feed the surface. */
private const val MAX_RECENT_TRIPS: Int = 3

private const val MILLIS_PER_MINUTE: Double = 60_000.0
private const val MINUTES_PER_HOUR: Long = 60

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * web swaps two layouts off `size.cols`: a single-column compact layout (`size.cols <= 1` → a 2-column
 * last-trip stat grid and distance-only recent rows) and the standard layout (a 4-column stat grid and
 * distance + duration + drive-count recent rows).
 */
data class TripSummarySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): the compact stat grid + distance-only rows. */
    val isCompact: Boolean get() = cols <= 1
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/driving.ts (`trip-summary`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object TripSummaryRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "trip-summary"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "driving"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TripSummaryWidget"

    /** The page size requested from the trips feed (web `useTrips({ limit: 5 })`). */
    const val FETCH_LIMIT: Int = 5

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val DEFAULT_SIZE: TripSummarySize = TripSummarySize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val MIN_SIZE: TripSummarySize = TripSummarySize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val MAX_SIZE: TripSummarySize = TripSummarySize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: TripSummarySize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: TripSummarySize): TripSummarySize =
        TripSummarySize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * Localized labels the surface folds into its output — the ten `widget.*` keys the web reads via
 * `t('widget.…', 'dashboard')` (and that the P1/S10 catalog provides as `translation_widget_*`). The
 * pure [TripSummaryProjection] reads these to assemble every visible string + TalkBack phrase; the
 * composable builds this from `stringResource`, while tests pass a deterministic instance. Keeping i18n
 * out of the projection lets it stay a pure, locale-stable function.
 */
data class TripSummaryStrings(
    val title: String,
    val noTrips: String,
    val lastTrip: String,
    val tripUnnamed: String,
    val distance: String,
    val duration: String,
    val drives: String,
    val chargeStops: String,
    val recentTrips: String,
    val drivesShort: String,
)

/**
 * One rendered last-trip stat (web `<StatCard label value icon />`). The icon is chosen by the
 * composable; the projection owns the localized [label] and the pre-formatted [value] (already
 * unit-bearing, e.g. `"12.3 km"` / `"1h 5m"` / `"3"`).
 */
data class TripStat(
    val label: String,
    val value: String,
)

/**
 * The fully projected last-trip card — the native analogue of the web "Last Trip" panel. Pure strings
 * (no Compose) so every field is unit-tested directly.
 *
 * @property badge the localized "Last Trip" chip label.
 * @property date the localized short start date (web `formatDateShort(start_date)`), or [EM_DASH].
 * @property title the trip name, or the localized "Unnamed trip" fallback (web `name ?? …`).
 * @property distance the distance stat (web Distance / `MapPin`).
 * @property duration the duration stat (web Duration / `Clock`).
 * @property drives the drive-count stat (web Drives / `Route`).
 * @property chargeStops the charge-count stat (web Charge Stops / `Zap`).
 * @property contentDescription the folded TalkBack phrase for the whole card.
 */
data class LastTripCard(
    val badge: String,
    val date: String,
    val title: String,
    val distance: TripStat,
    val duration: TripStat,
    val drives: TripStat,
    val chargeStops: TripStat,
    val contentDescription: String,
)

/**
 * One rendered recent-trip row (web `recentTrips.slice(1).map(...)`). Carries every field both layouts
 * need; the composable renders the distance + duration + `"{n} drv"` badge at standard width and the
 * distance only when compact (web `!isCompact` / `isCompact` branches).
 *
 * @property id the trip id (web React `key`).
 * @property title the trip name, or the localized "Unnamed trip" fallback.
 * @property date the localized short start date, or [EM_DASH].
 * @property distance the pre-formatted, unit-bearing distance (e.g. `"12.3 km"`).
 * @property duration the pre-formatted duration (e.g. `"1h 5m"`), or [EM_DASH].
 * @property drivesBadge the drive-count chip text (web `"{fmtInt} drv"`).
 * @property contentDescription the folded TalkBack phrase for the row.
 */
data class RecentTripRow(
    val id: Long,
    val title: String,
    val date: String,
    val distance: String,
    val duration: String,
    val drivesBadge: String,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the trip-summary surface — the native analogue of
 * everything the web component computes before returning JSX. Pure data (no Compose types) so every
 * branch is unit-tested directly.
 *
 * @property hasTrips whether any trip was returned (web `trips.length === 0 ? <EmptyState/> : …`); when
 *   false the surface renders its empty state instead of the cards.
 * @property lastTrip the last-trip card (web `lastTrip = trips[0]`), or `null` when there are no trips.
 * @property recentRows the recent-trip rows (web `recentTrips.slice(1)`), rendered only when there is
 *   more than one of the first three trips (web `recentTrips.length > 1`); otherwise empty.
 * @property recentTitle the localized "Recent Trips" section header.
 * @property emptyMessage the localized empty-state message ("No trips recorded yet").
 */
data class TripSummaryDisplay(
    val hasTrips: Boolean,
    val lastTrip: LastTripCard?,
    val recentRows: List<RecentTripRow>,
    val recentTitle: String,
    val emptyMessage: String,
) {
    companion object {
        /** The no-trips projection (web `trips.length === 0`): the surface shows its empty state. */
        fun empty(strings: TripSummaryStrings): TripSummaryDisplay =
            TripSummaryDisplay(
                hasTrips = false,
                lastTrip = null,
                recentRows = emptyList(),
                recentTitle = strings.recentTrips,
                emptyMessage = strings.noTrips,
            )
    }
}

/**
 * Pure projection from the decoded trip list to the render-ready [TripSummaryDisplay] — the native port
 * of the inline derivations + JSX formatting in the web source. [units] performs the SI-metres →
 * display-unit distance conversion at this boundary (web `convertDistanceFromSI` + `fmtNumber(_, 1)`);
 * [zone] + [locale] drive the short-date + count formatting (tests pin [ZoneOffset.UTC] + [Locale.US]);
 * the duration is computed from the two timestamps exactly as the web `formatDurationRange` does.
 */
object TripSummaryProjection {
    /**
     * Project [trips] into the render model using the localized [strings]. An empty list yields the
     * empty projection so the surface shows its "No trips recorded yet" state. Only the first three
     * trips are considered (web `trips.slice(0, 3)`); the first is the last-trip card and the remainder
     * (when there is more than one) become the recent rows.
     */
    fun project(
        trips: List<Trip>,
        strings: TripSummaryStrings,
        units: UnitFormatter,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.US,
    ): TripSummaryDisplay {
        if (trips.isEmpty()) return TripSummaryDisplay.empty(strings)

        val recent = trips.take(MAX_RECENT_TRIPS)
        val lastTrip = lastTripCard(recent.first(), strings, units, zone, locale)
        val recentRows =
            if (recent.size > 1) {
                recent.drop(1).map { row(it, strings, units, zone, locale) }
            } else {
                emptyList()
            }

        return TripSummaryDisplay(
            hasTrips = true,
            lastTrip = lastTrip,
            recentRows = recentRows,
            recentTitle = strings.recentTrips,
            emptyMessage = strings.noTrips,
        )
    }

    private fun lastTripCard(
        trip: Trip,
        strings: TripSummaryStrings,
        units: UnitFormatter,
        zone: ZoneId,
        locale: Locale,
    ): LastTripCard {
        val date = formatDateShort(trip.startDate, zone, locale)
        val title = trip.name ?: strings.tripUnnamed
        val distance = TripStat(strings.distance, formatDistance(trip.totalDistanceM, units))
        val duration = TripStat(strings.duration, formatDurationRange(trip.startDate, trip.endDate))
        val drives = TripStat(strings.drives, formatCount(trip.driveCount, locale))
        val chargeStops = TripStat(strings.chargeStops, formatCount(trip.chargeCount, locale))
        return LastTripCard(
            badge = strings.lastTrip,
            date = date,
            title = title,
            distance = distance,
            duration = duration,
            drives = drives,
            chargeStops = chargeStops,
            contentDescription =
                listOf(
                    "${strings.lastTrip}: $title",
                    date,
                    "${distance.label} ${distance.value}",
                    "${duration.label} ${duration.value}",
                    "${drives.label} ${drives.value}",
                    "${chargeStops.label} ${chargeStops.value}",
                ).joinToString(", "),
        )
    }

    private fun row(
        trip: Trip,
        strings: TripSummaryStrings,
        units: UnitFormatter,
        zone: ZoneId,
        locale: Locale,
    ): RecentTripRow {
        val title = trip.name ?: strings.tripUnnamed
        val date = formatDateShort(trip.startDate, zone, locale)
        val distance = formatDistance(trip.totalDistanceM, units)
        val duration = formatDurationRange(trip.startDate, trip.endDate)
        val drivesBadge = "${formatCount(trip.driveCount, locale)} ${strings.drivesShort}"
        return RecentTripRow(
            id = trip.id,
            title = title,
            date = date,
            distance = distance,
            duration = duration,
            drivesBadge = drivesBadge,
            contentDescription = listOf(title, date, distance, duration, drivesBadge).joinToString(", "),
        )
    }

    /** Web `${fmtNumber(convertDistanceFromSI(m, unit), 1)} ${unit}` — SI metres to a display string. */
    fun formatDistance(
        meters: Double,
        units: UnitFormatter,
    ): String = units.distance(meters, DISTANCE_DECIMALS)

    /** Web `fmtInt(count ?? 0)` — a whole number with locale grouping. */
    fun formatCount(
        count: Long,
        locale: Locale = Locale.US,
    ): String = String.format(locale, "%,d", count)

    /**
     * Web `formatDurationRange(start, end)`: the whole-minute gap between two RFC3339 timestamps,
     * rendered "Xh Ym" / "Ym". Returns [EM_DASH] when either stamp is missing/unparseable or the gap is
     * non-positive (web `if (!start || !end) … if (ms <= 0) …`).
     */
    fun formatDurationRange(
        start: String?,
        end: String?,
    ): String {
        val startMs = parseEpochMillis(start)
        val endMs = parseEpochMillis(end)
        if (startMs == null || endMs == null) return EM_DASH
        val deltaMs = endMs - startMs
        return if (deltaMs <= 0L) EM_DASH else formatDurationMinutes(Math.round(deltaMs / MILLIS_PER_MINUTE))
    }

    /** Web `formatDurationMinutes`: `${h}h ${m}m` when there are whole hours, else `${m}m`. */
    fun formatDurationMinutes(minutes: Long): String {
        if (minutes < 0L) return EM_DASH
        val hours = minutes / MINUTES_PER_HOUR
        val mins = minutes % MINUTES_PER_HOUR
        return if (hours > 0L) "${hours}h ${mins}m" else "${mins}m"
    }

    /**
     * Web `formatDateShort(iso)` — the localized "MMM d" short date (e.g. "Apr 4") in [zone], or
     * [EM_DASH] for a missing/unparseable timestamp (web `if (!iso) … if (isNaN) …`).
     */
    fun formatDateShort(
        iso: String?,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.US,
    ): String {
        val millis = parseEpochMillis(iso) ?: return EM_DASH
        return runCatching {
            DateTimeFormatter
                .ofPattern("MMM d", locale)
                .withZone(zone)
                .format(Instant.ofEpochMilli(millis))
        }.getOrDefault(EM_DASH)
    }

    /**
     * Parses an RFC3339 timestamp to epoch milliseconds, the native analogue of the web `new Date(iso)`
     * for the backend's UTC stamps. Tries an offset-bearing form first (the `Z` / `±hh:mm` the backend
     * emits), then a bare instant, then a zone-less local datetime read as UTC. A blank/unparseable
     * value yields `null` (the web `isNaN(date.getTime())` guard).
     */
    private fun parseEpochMillis(iso: String?): Long? {
        if (iso.isNullOrBlank()) return null
        return runCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
            .recoverCatching { Instant.parse(iso).toEpochMilli() }
            .recoverCatching { LocalDateTime.parse(iso).toInstant(ZoneOffset.UTC).toEpochMilli() }
            .getOrNull()
    }
}
