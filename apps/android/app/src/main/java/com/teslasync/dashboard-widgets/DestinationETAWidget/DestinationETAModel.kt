// Pure, framework-free model + projection for the Destination ETA dashboard widget — the native
// analogue of the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/DestinationETAWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The latest location snapshot arrives SI from the API; the distance
// to arrival is converted at this display boundary exactly as the web does
// (`convertDistanceFromSI(miles_to_arrival, unitPrefs.distance)`), while the arrival countdown is read
// verbatim in minutes the way the web reads it.
//
// The proto-identifier paradox applies to the distance field: the wire key is `miles_to_arrival`, but
// its content is SI metres (Phase-48 SI-canonical) — the web treats it as metres and converts from SI,
// so the native parse stores it as [LocationSnapshotData.distanceToArrivalMeters] and reproduces the
// web's observable output exactly.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/DestinationETAWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.destinationeta

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToInt

private const val EM_DASH = "\u2014"

/**
 * One decoded `GET /location-snapshots/latest?vehicle_id=` reading — the native mirror of the web
 * `LocationSnapshot` type (web/src/api/types.ts), narrowed to the fields the widget renders. Field
 * names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial body never
 * throws.
 *
 * @property destinationName the active route's destination, or `null`/empty when not navigating.
 * @property distanceToArrivalMeters distance remaining in SI metres. The wire key is the legacy
 *   `miles_to_arrival`, but its content is metres — the web converts it from SI, so the semantic truth
 *   is captured by this name (see the proto-identifier paradox note above).
 * @property minutesToArrival arrival countdown in minutes, read verbatim from `minutes_to_arrival`.
 * @property locatedAtHome / [locatedAtWork] / [locatedAtFavorite] presence flags driving the idle
 *   location badge.
 */
data class LocationSnapshotData(
    val destinationName: String?,
    val distanceToArrivalMeters: Double,
    val minutesToArrival: Double,
    val locatedAtHome: Boolean,
    val locatedAtWork: Boolean,
    val locatedAtFavorite: Boolean,
) {
    /**
     * True only when a route is active (web `snapshot != null && destination_name != null &&
     * destination_name !== ''`). The snapshot being non-null is already established by [fromJson]
     * returning a value, so here we only re-check the destination is a non-empty string.
     */
    val isNavigating: Boolean get() = !destinationName.isNullOrEmpty()

    companion object {
        /**
         * Project a `GET /location-snapshots/latest` body into a tolerant snapshot, or `null` when the
         * body is absent / not an object (web parity: the outer `!snapshot` gate → the "No location
         * data" empty state). Numeric fields default to `0` and presence flags to `false`, mirroring
         * the web `?? 0` / falsy reads.
         */
        fun fromJson(element: JsonElement): LocationSnapshotData? {
            val obj = element as? JsonObject ?: return null
            return LocationSnapshotData(
                destinationName = obj.stringOrNull("destination_name"),
                distanceToArrivalMeters = obj.numberOrNull("miles_to_arrival") ?: 0.0,
                minutesToArrival = obj.numberOrNull("minutes_to_arrival") ?: 0.0,
                locatedAtHome = obj.boolOrNull("located_at_home") ?: false,
                locatedAtWork = obj.boolOrNull("located_at_work") ?: false,
                locatedAtFavorite = obj.boolOrNull("located_at_favorite") ?: false,
            )
        }
    }
}

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact` branch in the web source: a single column renders the compact body (the ETA hero or the
 * bare location badge), otherwise the full titled view.
 */
data class DestinationETASize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): render the compact body. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    companion object {
        private const val COMPACT_MAX_COLS = 1

        /** Registry default footprint (2×2). */
        val Default: DestinationETASize = DestinationETASize(cols = 2, rows = 2)

        /** Registry minimum footprint (1×2). */
        val MinSize: DestinationETASize = DestinationETASize(cols = 1, rows = 2)

        /** Registry maximum footprint (3×40). */
        val MaxSize: DestinationETASize = DestinationETASize(cols = 3, rows = 40)

        /** True when [size] falls within the inclusive min/max footprint constraints. */
        fun withinBounds(size: DestinationETASize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: DestinationETASize): DestinationETASize =
            DestinationETASize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/maps.ts (`destination-eta`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object DestinationETARegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "destination-eta"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "maps"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DestinationETAWidget"

    /** Default footprint: 2 columns × 2 rows. */
    val defaultSize: DestinationETASize get() = DestinationETASize.Default

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize: DestinationETASize get() = DestinationETASize.MinSize

    /** Maximum footprint: 3 columns × 40 rows. */
    val maxSize: DestinationETASize get() = DestinationETASize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: DestinationETASize): Boolean = DestinationETASize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: DestinationETASize): DestinationETASize = DestinationETASize.clamp(size)
}

/**
 * The location family the idle (not-navigating) body badges — the native analogue of the web
 * `locationBadge` helper. [emoji] is the on-wire-free display glyph the web hard-codes (rendered as an
 * accessible image with the localized label as its name); the badge tone is resolved at the render
 * boundary (Home → success, Other → warning, else neutral — exactly the web variant map).
 */
enum class DestinationLocationKind(
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
 * The localized labels the projection folds into its output, resolved from the P1/S10 i18n catalog at
 * the Compose boundary (`stringResource`) and passed in so [DestinationETAProjection.project] stays
 * pure and JVM-testable. Keys mirror the web `t('widget.destinationETA.*')` calls verbatim. The header
 * refresh/refreshing/offline microcopy + the relative-time formatter are render-only chrome shared with
 * the freshness chip.
 */
data class DestinationETAStrings(
    val title: String,
    val home: String,
    val work: String,
    val favorite: String,
    val other: String,
    val noData: String,
    val min: String,
    val eta: String,
    val noNav: String,
    val remaining: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatRelative: (FreshnessAge) -> String,
) {
    /** The localized label for a [kind] (web `locationBadge` label). */
    fun labelFor(kind: DestinationLocationKind): String =
        when (kind) {
            DestinationLocationKind.Home -> home
            DestinationLocationKind.Work -> work
            DestinationLocationKind.Favorite -> favorite
            DestinationLocationKind.Other -> other
        }
}

/**
 * The fully projected, render-ready view of one location snapshot for one footprint + unit preference —
 * the native analogue of everything the web component computes before returning JSX (the
 * `isNavigating` / `displayDistance` / `progressPercent` / `etaDisplay` / `locationBadge` derivations).
 * Pure data so the projection is unit-tested without a UI host.
 *
 * @property hasSnapshot whether a location record resolved at all (web `snapshot != null`); `false`
 *   surfaces the "No location data" empty body.
 * @property minutesToArrivalRounded the arrival countdown in whole minutes (web
 *   `Math.round(minutesToArrival)`), used for the compact hero's accessible name.
 * @property minutesToArrivalValue the same whole-minutes value as a [Double] — the count-up target the
 *   ETA number animates to (web passes `Math.round(minutesToArrival)` to `AnimatedNumber`).
 * @property etaCountdownText the compact "Hh Mm" countdown (web `etaDisplay`), the hour dropped when 0.
 * @property distanceText the unit-converted remaining distance (web `fmtNumber(displayDistance, 1)`).
 * @property distanceUnitLabel the user's distance unit label (web `distanceUnit`).
 * @property progressPercent the route-completion bar width 0..100 (web `progressPercent`).
 */
data class DestinationETADisplay(
    val isCompact: Boolean,
    val hasSnapshot: Boolean,
    val isNavigating: Boolean,
    val locationKind: DestinationLocationKind,
    val locationLabel: String,
    val locationEmoji: String,
    val destinationName: String,
    val minutesToArrivalRounded: Int,
    val minutesToArrivalValue: Double,
    val minLabel: String,
    val etaLabel: String,
    val etaCountdownText: String,
    val distanceText: String,
    val distanceUnitLabel: String,
    val progressPercent: Double,
    val remainingLabel: String,
    val noNavText: String,
    val noDataText: String,
    val compactEtaContentDescription: String,
    val remainingContentDescription: String,
)

/**
 * Pure projection from a decoded [LocationSnapshotData] (+ footprint + unit preference) to the
 * [DestinationETADisplay] — the native port of the web component's `isNavigating` / `displayDistance` /
 * `progressPercent` / `etaDisplay` / `locationBadge` derivations. Distance is converted from SI metres
 * to the user's distance unit (web `convertDistanceFromSI(miles_to_arrival, unitPrefs.distance)`); the
 * arrival countdown is read verbatim in minutes; the progress bar uses the raw SI metres exactly as the
 * web does (`100 - (m / (m + 1)) * 100`).
 */
object DestinationETAProjection {
    /** Remaining-distance fraction digits (web `fmtNumber(displayDistance, 1)`). */
    const val DISTANCE_PRECISION: Int = 1

    private const val PERCENT = 100.0
    private const val MINUTES_PER_HOUR = 60.0

    /**
     * Project [snapshot] for [size] + [units] using [strings] for every localized string. A `null`
     * [snapshot] is the web "No location data" empty body (still carrying the localized chrome).
     */
    fun project(
        snapshot: LocationSnapshotData?,
        size: DestinationETASize,
        units: UnitPref,
        strings: DestinationETAStrings,
    ): DestinationETADisplay {
        val kind = locationKindFor(snapshot)
        val navigating = snapshot?.isNavigating == true
        val rawMeters = snapshot?.distanceToArrivalMeters ?: 0.0
        val minutes = safe(snapshot?.minutesToArrival ?: 0.0)
        val destinationName = snapshot?.destinationName?.takeIf { it.isNotEmpty() } ?: EM_DASH
        val displayDistance = convertDistanceFromSI(safe(rawMeters), units.distance)
        val distanceText = formatNumber(displayDistance, DISTANCE_PRECISION)
        val unitLabel = units.distance.label
        val roundedMinutes = minutes.roundToInt()
        val etaCountdown = formatEtaCountdown(minutes)

        return DestinationETADisplay(
            isCompact = size.isCompact,
            hasSnapshot = snapshot != null,
            isNavigating = navigating,
            locationKind = kind,
            locationLabel = strings.labelFor(kind),
            locationEmoji = kind.emoji,
            destinationName = destinationName,
            minutesToArrivalRounded = roundedMinutes,
            minutesToArrivalValue = roundedMinutes * 1.0,
            minLabel = strings.min,
            etaLabel = strings.eta,
            etaCountdownText = etaCountdown,
            distanceText = distanceText,
            distanceUnitLabel = unitLabel,
            progressPercent = progressPercent(navigating, rawMeters),
            remainingLabel = strings.remaining,
            noNavText = strings.noNav,
            noDataText = strings.noData,
            compactEtaContentDescription = "$roundedMinutes ${strings.min}, ${strings.eta}",
            remainingContentDescription = "${strings.remaining} $distanceText $unitLabel",
        )
    }

    /**
     * The idle-body location family (web `locationBadge`): home wins, then work, then favorite,
     * otherwise other. A `null` snapshot resolves to [DestinationLocationKind.Other] (the web fallthrough).
     */
    fun locationKindFor(snapshot: LocationSnapshotData?): DestinationLocationKind =
        when {
            snapshot?.locatedAtHome == true -> DestinationLocationKind.Home
            snapshot?.locatedAtWork == true -> DestinationLocationKind.Work
            snapshot?.locatedAtFavorite == true -> DestinationLocationKind.Favorite
            else -> DestinationLocationKind.Other
        }

    /**
     * The route-completion bar width 0..100 (web `progressPercent`): `0` unless navigating with a
     * positive remaining distance, otherwise `100 - (m / (m + 1)) * 100` clamped to `[0, 100]`, using
     * the raw SI metres exactly as the web computes it.
     */
    fun progressPercent(
        isNavigating: Boolean,
        meters: Double,
    ): Double =
        if (isNavigating && meters > 0.0) {
            (PERCENT - (meters / (meters + 1.0)) * PERCENT).coerceIn(0.0, PERCENT)
        } else {
            0.0
        }

    /**
     * Format an arrival countdown in minutes exactly as the web `etaDisplay`: split into whole hours
     * (`floor(minutes / 60)`) and rounded remainder minutes (`Math.round(minutes % 60)`), rendering
     * "Hh Mm" when an hour is present and "Mm" otherwise. The remainder is rounded independently of the
     * hour, reproducing the web's no-carry edge verbatim (e.g. 119.7 → "1h 60m").
     */
    fun formatEtaCountdown(minutes: Double): String {
        val safeMinutes = safe(minutes)
        val hours = floor(safeMinutes / MINUTES_PER_HOUR).toInt()
        val mins = (safeMinutes % MINUTES_PER_HOUR).roundToInt()
        return if (hours > 0) "${formatInt(hours)}h ${formatInt(mins)}m" else "${formatInt(mins)}m"
    }

    /**
     * Locale-stable decimal formatter matching the web `fmtNumber`: coerce a non-finite value to 0,
     * then render with grouped thousands and a fixed number of fraction digits using [Locale.US]
     * symbols so the output is deterministic and matches the web default locale.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
    ): String = groupedFormat(decimals).format(safe(value))

    /** Locale-stable integer formatter (web `fmtInt` = `fmtNumber(v, 0)`). */
    fun formatInt(value: Int): String = groupedFormat(decimals = 0).format(value.toLong())

    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0

    private fun groupedFormat(decimals: Int): DecimalFormat {
        val pattern = if (decimals > 0) "#,##0." + "0".repeat(decimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(Locale.US))
    }
}

/** Reads a numeric (or numeric-string) property, or `null` when absent / non-numeric. */
private fun JsonObject.numberOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Reads a boolean property, or `null` when absent / not a JSON boolean. */
private fun JsonObject.boolOrNull(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

/** Reads a string property, or `null` when absent / not a JSON string (incl. JSON null). */
private fun JsonObject.stringOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
