// Pure, framework-free model + projection for the Vehicle Location Map dashboard widget — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/LocationMapWidget.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a
// thin render layer. Coordinates and heading are NOT unit-converted (latitude/longitude are WGS-84
// degrees, heading is degrees clockwise from north), so — unlike the metric widgets — this surface
// carries no UnitPref: it reproduces the web's `lat.toFixed(4)` / `Math.round(heading)` formatting
// verbatim at this display boundary.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/LocationMapWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.locationmap

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.roundToInt

private const val DEGREE = "\u00B0"
private const val SEPARATOR = ", "

/**
 * One decoded `GET /vehicles/{id}/state` reading narrowed to the fields the map widget renders — the
 * native mirror of the web `useVehicleState` envelope (`{ state, live }`) projected onto the
 * `state.latitude` / `state.longitude` / `state.heading` + `live` the component reads. Values are SI /
 * WGS-84 as they arrive from the API; coordinates and heading are degrees and are never converted.
 *
 * @property latitude WGS-84 latitude in degrees (`state.latitude`).
 * @property longitude WGS-84 longitude in degrees (`state.longitude`).
 * @property heading travel heading in degrees clockwise from north, or `null` when unknown
 *   (`state.heading`).
 * @property isLive whether the backend flagged the reading as a live signal (`stateData.live ?? false`).
 */
data class VehicleLocationData(
    val latitude: Double,
    val longitude: Double,
    val heading: Double?,
    val isLive: Boolean,
) {
    /**
     * True only when both coordinates are non-zero — the web `hasCoords` gate
     * (`state.latitude !== 0 && state.longitude !== 0`). A `0,0` reading is treated as "no fix" and
     * surfaces the empty map state, exactly as the web does.
     */
    val hasCoords: Boolean get() = latitude != 0.0 && longitude != 0.0

    companion object {
        /**
         * Project a [VehicleStateEnvelope] into the location reading the widget renders, or `null` when
         * no state resolved (web `state = stateData?.state` being `undefined` → the empty map). The
         * `0,0`-but-present case is handled by [hasCoords], mirroring the web's combined `!hasCoords`
         * empty gate.
         */
        fun fromEnvelope(envelope: VehicleStateEnvelope?): VehicleLocationData? {
            val state = envelope?.state ?: return null
            return VehicleLocationData(
                latitude = state.latitude,
                longitude = state.longitude,
                heading = state.heading,
                isLive = envelope.live,
            )
        }
    }
}

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact` / `isExpanded` branches in the web source: a single column hides the title chrome and
 * the status overlay; three+ columns or three+ rows reveals the heading + coordinate chips.
 */
data class LocationMapSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): hide the title + status overlay. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at 3+ cols or 3+ rows (web `isExpanded = size.cols >= 3 || size.rows >= 3`). */
    val isExpanded: Boolean get() = cols >= EXPANDED_MIN_COLS || rows >= EXPANDED_MIN_ROWS

    companion object {
        private const val COMPACT_MAX_COLS = 1
        private const val EXPANDED_MIN_COLS = 3
        private const val EXPANDED_MIN_ROWS = 3

        /** Registry default footprint (2×4). */
        val Default: LocationMapSize = LocationMapSize(cols = 2, rows = 4)

        /** Registry minimum footprint (1×4). */
        val MinSize: LocationMapSize = LocationMapSize(cols = 1, rows = 4)

        /** Registry maximum footprint (4×40). */
        val MaxSize: LocationMapSize = LocationMapSize(cols = 4, rows = 40)

        /** True when [size] falls within the inclusive min/max footprint constraints. */
        fun withinBounds(size: LocationMapSize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: LocationMapSize): LocationMapSize =
            LocationMapSize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/maps.ts (`location-map`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object LocationMapRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "location-map"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "maps"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LocationMapWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize: LocationMapSize get() = LocationMapSize.Default

    /** Minimum footprint: 1 column × 4 rows. */
    val minSize: LocationMapSize get() = LocationMapSize.MinSize

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: LocationMapSize get() = LocationMapSize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: LocationMapSize): Boolean = LocationMapSize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: LocationMapSize): LocationMapSize = LocationMapSize.clamp(size)
}

/**
 * The localized labels the projection folds into its output, resolved from the P1/S10 i18n catalog at
 * the Compose boundary (`stringResource`) and passed in so [LocationMapProjection.project] stays pure
 * and JVM-testable. The four widget keys mirror the web `t('widget.locationMap.*')` calls verbatim; the
 * header refresh/refreshing/offline microcopy + the relative-time formatter are render-only chrome
 * shared with the freshness chip.
 */
data class LocationMapStrings(
    val title: String,
    val noData: String,
    val lastKnown: String,
    val heading: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatRelative: (FreshnessAge) -> String,
)

/**
 * The fully projected, render-ready view of one location reading for one footprint — the native
 * analogue of everything the web component computes before returning JSX (the `hasCoords` gate, the
 * `lat`/`lng` map center, the `isCompact` zoom, and the three status-overlay chips). Pure data so the
 * projection is unit-tested without a UI host.
 *
 * @property hasCoords whether a real fix resolved (web `hasCoords`); `false` surfaces the "No location
 *   data available" empty map.
 * @property latitude the map center + marker latitude (web `center={[lat, lng]}`).
 * @property longitude the map center + marker longitude (web `center={[lat, lng]}`).
 * @property heading the raw heading driving the marker glyph rotation, or `null` for an un-rotated dot.
 * @property headingDegrees the whole-degree heading for the chip label (web `Math.round(heading)`), or
 *   `null` when heading is absent / non-finite.
 * @property zoom the map zoom level (web `isCompact ? 13 : 14`).
 * @property showStatusOverlay whether the bottom-start overlay renders at all (web
 *   `hasCoords && !isCompact`).
 * @property showLastKnownChip whether the "Last known position" chip renders (overlay && `!isLive`).
 * @property showHeadingChip whether the "Heading: n°" chip renders (overlay && `isExpanded` && heading).
 * @property showCoordsChip whether the coordinate chip renders (overlay && `isExpanded`).
 * @property coordsText the `"{lat4}, {lng4}"` coordinate label (web `lat.toFixed(4), lng.toFixed(4)`).
 * @property headingChipText the `"Heading: {n}°"` label (web `Heading: {Math.round(heading)}°`).
 * @property mapContentDescription the TalkBack name announced for the opaque map node, carrying the
 *   position + heading + last-known status so screen-reader users get what the map conveys (essential
 *   for the compact footprint, where the visible chips are hidden).
 */
data class LocationMapDisplay(
    val isCompact: Boolean,
    val isExpanded: Boolean,
    val hasCoords: Boolean,
    val latitude: Double,
    val longitude: Double,
    val heading: Double?,
    val headingDegrees: Int?,
    val zoom: Float,
    val isLive: Boolean,
    val showStatusOverlay: Boolean,
    val showLastKnownChip: Boolean,
    val showHeadingChip: Boolean,
    val showCoordsChip: Boolean,
    val coordsText: String,
    val headingChipText: String,
    val lastKnownText: String,
    val title: String,
    val noDataText: String,
    val mapContentDescription: String,
)

/**
 * Pure projection from a decoded [VehicleLocationData] (+ footprint) to the [LocationMapDisplay] — the
 * native port of the web component's `hasCoords` / `isCompact` / `isExpanded` / center / zoom / status
 * overlay derivations. Coordinates are formatted with the web's fixed 4-fraction-digit precision and
 * the heading is rounded to whole degrees exactly as the web does; neither is unit-converted.
 */
object LocationMapProjection {
    /** Map zoom for the single-column compact footprint (web `13`). */
    const val COMPACT_ZOOM: Float = 13f

    /** Map zoom for the standard footprint (web `14`). */
    const val STANDARD_ZOOM: Float = 14f

    /** Coordinate fraction digits (web `toFixed(4)`). */
    const val COORDINATE_PRECISION: Int = 4

    /**
     * Project [data] for [size] using [strings] for every localized string. A `null` [data] (no vehicle
     * resolved) or a `0,0` reading both surface the "No location data available" empty map, carrying the
     * localized chrome — the web combined `!hasCoords` gate.
     */
    fun project(
        data: VehicleLocationData?,
        size: LocationMapSize,
        strings: LocationMapStrings,
    ): LocationMapDisplay {
        val hasCoords = data?.hasCoords == true
        val isCompact = size.isCompact
        val isExpanded = size.isExpanded
        val latitude = data?.latitude ?: 0.0
        val longitude = data?.longitude ?: 0.0
        val heading = data?.heading
        val isLive = data?.isLive ?: false
        val headingDegrees = roundHeading(heading)
        val showStatusOverlay = hasCoords && !isCompact
        val coordsText = "${formatCoordinate(latitude)}$SEPARATOR${formatCoordinate(longitude)}"
        val headingChipText = headingDegrees?.let { "${strings.heading}: $it$DEGREE" } ?: ""

        return LocationMapDisplay(
            isCompact = isCompact,
            isExpanded = isExpanded,
            hasCoords = hasCoords,
            latitude = latitude,
            longitude = longitude,
            heading = heading,
            headingDegrees = headingDegrees,
            zoom = if (isCompact) COMPACT_ZOOM else STANDARD_ZOOM,
            isLive = isLive,
            showStatusOverlay = showStatusOverlay,
            // web: `{!isLive && <span>…Last known position</span>}` inside the `hasCoords && !isCompact` overlay.
            showLastKnownChip = showStatusOverlay && !isLive,
            // web: `{isExpanded && heading != null && <span>…Heading…</span>}` — gated on a finite rounded value.
            showHeadingChip = showStatusOverlay && isExpanded && headingDegrees != null,
            // web: `{isExpanded && <span>{lat}, {lng}</span>}`.
            showCoordsChip = showStatusOverlay && isExpanded,
            coordsText = coordsText,
            headingChipText = headingChipText,
            lastKnownText = strings.lastKnown,
            title = strings.title,
            noDataText = strings.noData,
            mapContentDescription =
                buildMapContentDescription(
                    strings = strings,
                    hasCoords = hasCoords,
                    coordsText = coordsText,
                    headingChipText = headingChipText,
                    isLive = isLive,
                ),
        )
    }

    /**
     * Round a heading to whole degrees the way the web `Math.round` does (ties toward positive
     * infinity, which [Double.roundToInt] matches), or `null` when heading is absent / non-finite.
     */
    fun roundHeading(heading: Double?): Int? = heading?.takeIf { it.isFinite() }?.roundToInt()

    /**
     * Format a coordinate component with a fixed [COORDINATE_PRECISION] fraction digits and [Locale.US]
     * symbols, matching the web `Number.toFixed(4)` (no grouping, deterministic across locales). A
     * non-finite component is coerced to `0` so the label never reads "NaN".
     */
    fun formatCoordinate(value: Double): String = coordinateFormat().format(if (value.isFinite()) value else 0.0)

    /** Assemble the screen-reader description of the opaque map node (position + heading + status). */
    private fun buildMapContentDescription(
        strings: LocationMapStrings,
        hasCoords: Boolean,
        coordsText: String,
        headingChipText: String,
        isLive: Boolean,
    ): String =
        buildString {
            append(strings.title)
            if (hasCoords) {
                append(SEPARATOR)
                append(coordsText)
                if (headingChipText.isNotEmpty()) {
                    append(SEPARATOR)
                    append(headingChipText)
                }
                if (!isLive) {
                    append(SEPARATOR)
                    append(strings.lastKnown)
                }
            }
        }

    private fun coordinateFormat(): DecimalFormat {
        val pattern = "0." + "0".repeat(COORDINATE_PRECISION)
        return DecimalFormat(pattern, DecimalFormatSymbols(Locale.US))
    }
}
