// Pure, framework-free model + projection for the Favorite Locations dashboard widget — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/LocationFavoritesWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The widget composes two reads — the visited-location list (web `useLocations`) and the latest
// location snapshot (web `useLocationSnapshotLatest`). The list values (`visit_count`) are
// dimensionless counts and the snapshot drives only the home/work/favorite/other badge, so NO SI unit
// conversion applies anywhere in this surface; the only display derivation is the visit-count integer
// formatting and the "last visited" relative-time label (web `fmtInt` + `formatRelative`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/LocationFavoritesWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.locationfavorites

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.presentation.locations.VisitedLocation
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

private const val EM_DASH = "\u2014"

/** Multiplication sign separating the visit count from its unit (web ``${count}×``). */
private const val MULTIPLY_SIGN = "\u00D7"

/** Middle dot separating the visit count from the relative "last visited" label (web `·`). */
private const val MIDDLE_DOT = "\u00B7"

/**
 * The slice of one `GET /location-snapshots/latest?vehicle_id=` reading the widget renders — the
 * native mirror of the fields the web `LocationSnapshot` exposes to this surface (web/src/api/types.ts),
 * narrowed to the location badge + the active-route hint. Field names mirror the Go API's snake_case
 * JSON tags; parsing is null-tolerant so a partial body never throws.
 *
 * @property destinationName the active route's destination, shown as a `→ name` hint; `null`/empty when
 *   not navigating.
 * @property locatedAtHome / [locatedAtWork] / [locatedAtFavorite] presence flags driving the location
 *   badge (web `located_at_home` / `located_at_work` / `located_at_favorite`).
 */
data class LocationStatusSnapshot(
    val destinationName: String?,
    val locatedAtHome: Boolean,
    val locatedAtWork: Boolean,
    val locatedAtFavorite: Boolean,
) {
    companion object {
        /**
         * Project a `GET /location-snapshots/latest` body into a tolerant snapshot, or `null` when the
         * body is absent / not an object (web parity: the `snapshot?.…` optional reads collapse to the
         * fallthrough "Other" badge). Presence flags default to `false`, mirroring the web falsy reads.
         */
        fun fromJson(element: JsonElement?): LocationStatusSnapshot? {
            val obj = element as? JsonObject ?: return null
            return LocationStatusSnapshot(
                destinationName = obj.stringOrNull("destination_name"),
                locatedAtHome = obj.boolOrNull("located_at_home") ?: false,
                locatedAtWork = obj.boolOrNull("located_at_work") ?: false,
                locatedAtFavorite = obj.boolOrNull("located_at_favorite") ?: false,
            )
        }
    }
}

/**
 * The combined cache-then-network payload backing the surface — the visited-location list (web
 * `useLocations`) plus the latest location snapshot (web `useLocationSnapshotLatest`). A single value
 * the view-model exposes so the Composable stays a thin renderer.
 *
 * @property locations the visited-location rows (already `safeArray`-guarded by the shared store).
 * @property snapshot the latest location reading for the badge + route hint, or `null` when none.
 */
data class LocationFavoritesData(
    val locations: List<VisitedLocation>,
    val snapshot: LocationStatusSnapshot?,
) {
    /** True only when there is genuinely nothing to show — no rows AND no snapshot (no badge data). */
    val isEmpty: Boolean get() = locations.isEmpty() && snapshot == null

    companion object {
        /** The resolved-but-empty payload (no vehicle / no rows / no snapshot). */
        val EMPTY: LocationFavoritesData = LocationFavoritesData(emptyList(), null)
    }
}

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact = size.cols <= 1` branch: a single column renders the bare location badge, otherwise the
 * full titled list view.
 */
data class LocationFavoritesSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact`): render the compact location badge only. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    companion object {
        private const val COMPACT_MAX_COLS = 1

        /** Registry default footprint (2×4). */
        val Default: LocationFavoritesSize = LocationFavoritesSize(cols = 2, rows = 4)

        /** Registry minimum footprint (1×2). */
        val MinSize: LocationFavoritesSize = LocationFavoritesSize(cols = 1, rows = 2)

        /** Registry maximum footprint (4×40). */
        val MaxSize: LocationFavoritesSize = LocationFavoritesSize(cols = 4, rows = 40)

        /** True when [size] falls within the inclusive min/max footprint constraints. */
        fun withinBounds(size: LocationFavoritesSize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: LocationFavoritesSize): LocationFavoritesSize =
            LocationFavoritesSize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/maps.ts (`location-favorites`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object LocationFavoritesRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "location-favorites"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "maps"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LocationFavoritesWidget"

    /** The maximum number of ranked rows the standard layout shows (web `WidgetRankedList` default). */
    const val MAX_RANKED_ITEMS: Int = 5

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize: LocationFavoritesSize get() = LocationFavoritesSize.Default

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize: LocationFavoritesSize get() = LocationFavoritesSize.MinSize

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: LocationFavoritesSize get() = LocationFavoritesSize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: LocationFavoritesSize): Boolean = LocationFavoritesSize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: LocationFavoritesSize): LocationFavoritesSize = LocationFavoritesSize.clamp(size)
}

/**
 * The location family the badge renders — the native analogue of the web `locationBadge` helper.
 * [emoji] is the display glyph the web hard-codes (rendered as an accessible image with the localized
 * label as its name); the badge tone is resolved at the render boundary (Home → success, Other →
 * warning, Work/Favorite → neutral — exactly the web variant map).
 */
enum class LocationBadgeKind(
    val emoji: String,
) {
    /** Parked at a home geofence (web 🏠, success tone). */
    Home("\uD83C\uDFE0"),

    /** Parked at a work geofence (web 🏢, neutral tone). */
    Work("\uD83C\uDFE2"),

    /** Parked at a favorite geofence (web ⭐, neutral tone). */
    Favorite("\u2B50"),

    /** Anywhere else (web 📍, warning tone). */
    Other("\uD83D\uDCCD"),
}

/**
 * The localized strings + format patterns the projection folds into its output, resolved from the
 * P1/S10 i18n catalog at the Compose boundary (`stringResource`) and passed in so
 * [LocationFavoritesProjection.project] stays pure and JVM-testable. The `widget.locationFavorites.*`
 * fields mirror the web `t(...)` calls verbatim; the relative-time patterns reuse the shared
 * `freshness.*` catalog (the web `formatRelative` produces ungoverned English literals that have no
 * catalog entry, so the i18n-compliant native relative formatter reuses the freshness microcopy);
 * [formatFreshnessAge] is the header chip's relative formatter shared with `DataFreshness`.
 */
@Suppress("LongParameterList")
data class LocationFavoritesStrings(
    val title: String,
    val home: String,
    val work: String,
    val favorite: String,
    val other: String,
    val noData: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val relativeJustNow: String,
    val relativeMinutesFmt: String,
    val relativeHoursFmt: String,
    val relativeDaysFmt: String,
    val formatFreshnessAge: (FreshnessAge) -> String,
) {
    /** The localized label for a [kind] (web `locationBadge` label). */
    fun labelFor(kind: LocationBadgeKind): String =
        when (kind) {
            LocationBadgeKind.Home -> home
            LocationBadgeKind.Work -> work
            LocationBadgeKind.Favorite -> favorite
            LocationBadgeKind.Other -> other
        }
}

/**
 * One projected, render-ready ranked row — the native analogue of a web `RankedItem`. Holds the
 * truncatable [label] (web `addressName`), the already-formatted [formattedValue] (web ``${visits}× ·
 * ${relative}``), the raw [value] (visit count, the sort key), the background-bar [barFraction] (0..1,
 * value ÷ visible-max — web `value / maxValue`), and a merged [contentDescription] for screen readers.
 */
data class RankedLocationRow(
    val id: Long,
    val label: String,
    val formattedValue: String,
    val value: Long,
    val barFraction: Float,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the surface for one footprint — the native analogue of
 * everything the web component computes before returning JSX (the `isCompact` branch, the
 * `locationBadge` derivation, the `items` map, and the `WidgetRankedList` sort/slice/bar math). Pure
 * data so the projection is unit-tested without a Compose host.
 *
 * @property isCompact whether to render only the location badge (web `size.cols <= 1`).
 * @property badgeKind / [badgeLabel] / [badgeEmoji] the resolved location badge (web `locationBadge`).
 * @property destinationName the active-route `→ name` hint, or `null` when not navigating (web
 *   `snapshot?.destination_name`).
 * @property hasItems whether any visited-location rows resolved (web `locations.length > 0`).
 * @property rows the up-to-five ranked rows (web `WidgetRankedList` visible slice).
 * @property emptyMessage the "No favorite locations" message shown when [hasItems] is false.
 * @property title the panel title (web `t('widget.locationFavorites.title')`).
 */
data class LocationFavoritesDisplay(
    val isCompact: Boolean,
    val badgeKind: LocationBadgeKind,
    val badgeLabel: String,
    val badgeEmoji: String,
    val destinationName: String?,
    val hasItems: Boolean,
    val rows: List<RankedLocationRow>,
    val emptyMessage: String,
    val title: String,
)

/**
 * Pure projection from a decoded [LocationFavoritesData] (+ footprint + clock + locale) to the
 * [LocationFavoritesDisplay] — the native port of the web component's `locationBadge` / `items`
 * derivations and the `WidgetRankedList` sort/slice/bar math. Counts are dimensionless (no SI
 * conversion); every label is supplied already-localized via [LocationFavoritesStrings].
 */
object LocationFavoritesProjection {
    /** Visit-count fraction digits (web `fmtInt` = integer). */
    private const val COUNT_DECIMALS = 0

    /**
     * Project [data] for [size] at [nowMillis], formatting counts/relatives with [locale] and
     * labelling via [strings]. A `null` [data] is treated as the resolved-empty payload.
     */
    fun project(
        data: LocationFavoritesData?,
        size: LocationFavoritesSize,
        nowMillis: Long,
        strings: LocationFavoritesStrings,
        locale: Locale = Locale.getDefault(),
    ): LocationFavoritesDisplay {
        val resolved = data ?: LocationFavoritesData.EMPTY
        val kind = badgeKindFor(resolved.snapshot)
        val rows = rankedRows(resolved.locations, nowMillis, strings, locale)
        return LocationFavoritesDisplay(
            isCompact = size.isCompact,
            badgeKind = kind,
            badgeLabel = strings.labelFor(kind),
            badgeEmoji = kind.emoji,
            destinationName = resolved.snapshot?.destinationName?.takeIf { it.isNotBlank() },
            hasItems = rows.isNotEmpty(),
            rows = rows,
            emptyMessage = strings.noData,
            title = strings.title,
        )
    }

    /**
     * The badge family (web `locationBadge`): home wins, then work, then favorite, otherwise other. A
     * `null` snapshot resolves to [LocationBadgeKind.Other] (the web fallthrough).
     */
    fun badgeKindFor(snapshot: LocationStatusSnapshot?): LocationBadgeKind =
        when {
            snapshot?.locatedAtHome == true -> LocationBadgeKind.Home
            snapshot?.locatedAtWork == true -> LocationBadgeKind.Work
            snapshot?.locatedAtFavorite == true -> LocationBadgeKind.Favorite
            else -> LocationBadgeKind.Other
        }

    /**
     * Map the visited locations to the visible ranked rows — the native port of the web `items` map fed
     * through `WidgetRankedList`: sort by visit count descending, take the first
     * [LocationFavoritesRegistration.MAX_RANKED_ITEMS], then size each row's background bar against the
     * visible maximum (web `value / maxValue`). The formatted value is ``${fmtInt(visits)}× ·
     * ${lastVisited ? relative : '—'}`` exactly as the web composes it.
     */
    private fun rankedRows(
        locations: List<VisitedLocation>,
        nowMillis: Long,
        strings: LocationFavoritesStrings,
        locale: Locale,
    ): List<RankedLocationRow> {
        val visible =
            locations
                .sortedByDescending { it.visitCount }
                .take(LocationFavoritesRegistration.MAX_RANKED_ITEMS)
        val maxValue = visible.maxOfOrNull { it.visitCount } ?: 0L
        return visible.mapIndexed { index, loc ->
            val label = loc.addressName.ifBlank { EM_DASH }
            val formatted = formattedValue(loc, nowMillis, strings, locale)
            RankedLocationRow(
                id = loc.id,
                label = label,
                formattedValue = formatted,
                value = loc.visitCount,
                barFraction = if (maxValue > 0L) loc.visitCount.toFloat() / maxValue.toFloat() else 0f,
                contentDescription = "${index + 1}. $label, $formatted",
            )
        }
    }

    /** ``${fmtInt(visit_count)}× · ${last_visited ? formatRelative : '—'}`` (web `formattedValue`). */
    private fun formattedValue(
        loc: VisitedLocation,
        nowMillis: Long,
        strings: LocationFavoritesStrings,
        locale: Locale,
    ): String {
        val count = ChartFormat.number(loc.visitCount * 1.0, COUNT_DECIMALS, locale)
        val relative = LocationRelativeTime.format(loc.lastVisited, nowMillis, strings, locale)
        return "$count$MULTIPLY_SIGN $MIDDLE_DOT $relative"
    }
}

/**
 * Pure relative-time formatter for the "last visited" label — the native port of the web
 * `formatRelative` (web/src/lib/dateFormat.ts), reproducing its cutoffs verbatim: a null/unparseable
 * timestamp renders the "—" em-dash marker; under a minute is "just now"; under an hour / day / week is
 * a localized minutes / hours / days "ago" phrase; seven days or older falls back to a localized
 * absolute date (web `formatDate`, "MMM d, yyyy"). The relative microcopy reuses the shared `freshness.*`
 * catalog so no English literal ships in native code. java.time is available on the API 26+ floor and
 * in the JVM unit-test gate, so the parse + format run deterministically given [nowMillis].
 */
object LocationRelativeTime {
    private const val SECONDS_PER_MINUTE = 60L
    private const val SECONDS_PER_HOUR = 3_600L
    private const val SECONDS_PER_DAY = 86_400L
    private const val SECONDS_PER_WEEK = 604_800L
    private const val MILLIS_PER_SECOND = 1_000L
    private const val ABSOLUTE_DATE_PATTERN = "MMM d, yyyy"

    /** Format [iso] relative to [nowMillis] (web `formatRelative`), or "—" when null/unparseable. */
    fun format(
        iso: String?,
        nowMillis: Long,
        strings: LocationFavoritesStrings,
        locale: Locale,
    ): String {
        val millis = iso?.takeIf { it.isNotBlank() }?.let { parseIsoMillis(it) } ?: return EM_DASH
        val seconds = ((nowMillis - millis).coerceAtLeast(0L)) / MILLIS_PER_SECOND
        return when {
            seconds < SECONDS_PER_MINUTE -> strings.relativeJustNow
            seconds < SECONDS_PER_HOUR -> String.format(locale, strings.relativeMinutesFmt, seconds / SECONDS_PER_MINUTE)
            seconds < SECONDS_PER_DAY -> String.format(locale, strings.relativeHoursFmt, seconds / SECONDS_PER_HOUR)
            seconds < SECONDS_PER_WEEK -> String.format(locale, strings.relativeDaysFmt, seconds / SECONDS_PER_DAY)
            else -> formatAbsoluteDate(millis, locale)
        }
    }

    /**
     * Parse an ISO-8601 timestamp to epoch millis, tolerating the three shapes the backend can emit: a
     * UTC instant ("…Z"), an offset date-time ("…+01:00"), or a bare local date-time (assumed UTC).
     * Returns `null` on any failure (web `new Date(iso)` → `isNaN` → "—").
     */
    fun parseIsoMillis(iso: String): Long? =
        runCatching { Instant.parse(iso).toEpochMilli() }
            .recoverCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
            .recoverCatching { LocalDateTime.parse(iso).toInstant(ZoneOffset.UTC).toEpochMilli() }
            .getOrNull()

    private fun formatAbsoluteDate(
        millis: Long,
        locale: Locale,
    ): String =
        Instant
            .ofEpochMilli(millis)
            .atZone(ZoneId.systemDefault())
            .toLocalDate()
            .format(DateTimeFormatter.ofPattern(ABSOLUTE_DATE_PATTERN, locale))
}

/** Reads a boolean property, or `null` when absent / not a JSON boolean. */
private fun JsonObject.boolOrNull(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

/** Reads a string property, or `null` when absent / not a JSON string (incl. JSON null). */
private fun JsonObject.stringOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
