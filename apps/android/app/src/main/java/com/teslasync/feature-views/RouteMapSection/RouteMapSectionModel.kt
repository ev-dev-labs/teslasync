// Pure, framework-free model + projection for the RouteMapSection feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/driving/components/drive-detail/RouteMapSection.tsx + the @/lib/geo helpers and the
// useDriveDetailData route/segment derivations the parent threads in). No Compose, no Android, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays a
// thin render layer over these pure functions.
//
// RouteMapSection is a purely presentational drive-detail section. Its parent (the drive-detail page, via
// useDriveDetailData) owns the TanStack drive query, computes the route source (telemetry-or-positions), the
// trail, the start/end/centre coordinates, and the speed-coloured segments, and passes them down. This surface
// therefore binds NO data hook of its own; its web hooks are `useTranslation` (the i18n catalog, P1/S10),
// `useUnits` (the SI -> display speed unit, applied to the legend thresholds at this boundary), and `useMap`
// (the Leaflet map handle the inline FitBounds helper reads — reproduced here as the pure camera intent the
// composable applies through rememberMapCameraState). As in the sibling DriveStatCards port, the
// cache-then-network lifecycle (loading / content / empty / stale / offline / error) is projected onto the
// shared [UiState] so the owning page can thread every state through and the surface renders them all without
// ever fetching.
//
// Values stay SI on the wire: [RouteMapPoint.speedMps] is metres-per-second (raw VehicleSpeed), so the four
// speed-colour bands are compared against the SI thresholds [SPEED_SEGMENT_LOW_MPS] / [SPEED_SEGMENT_MED_MPS] /
// [SPEED_SEGMENT_HIGH_MPS] directly (the web ./constants), and the legend converts the SAME thresholds to the
// user's display unit through `convertSpeedFromSI`, keeping labels and colours in lock-step (the Phase-48
// SI-canonical rule — no value is ever pre-converted into the snapshot). Coordinates are WGS-84 degrees and are
// never converted. The (0,0) coordinate is rejected as the canonical Tesla "GPS not yet fixed" sentinel (web
// `isValidLatLng`) so it never drags the map to the Gulf of Guinea.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/RouteMapSection — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.routemapsection

import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.convertSpeedFromSI
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** Em dash shown wherever a timestamp is absent or unparseable — the web `formatTime`/`formatDateTime` fallback. */
internal const val ROUTE_MAP_EM_DASH: String = "\u2014"

/** Metres-per-second per mph — the web `1 mph = 0.44704 m/s` factor anchoring the SI colour thresholds. */
internal const val MPH_TO_MPS: Double = 0.44704

/** Web `SPEED_SEGMENT_LOW_MPS = 30 * 0.44704` — the emerald/cyan boundary, expressed in SI m/s. */
internal const val SPEED_SEGMENT_LOW_MPS: Double = 30 * MPH_TO_MPS

/** Web `SPEED_SEGMENT_MED_MPS = 60 * 0.44704` — the cyan/amber boundary, expressed in SI m/s. */
internal const val SPEED_SEGMENT_MED_MPS: Double = 60 * MPH_TO_MPS

/** Web `SPEED_SEGMENT_HIGH_MPS = 100 * 0.44704` — the amber/red boundary, expressed in SI m/s. */
internal const val SPEED_SEGMENT_HIGH_MPS: Double = 100 * MPH_TO_MPS

/** Earth radius in metres — the web `@/lib/geo` haversine constant. */
private const val EARTH_RADIUS_M: Double = 6_371_000.0

/** Web `@/lib/geo` `MIN_MEANINGFUL_ROUTE_METERS`: the spread below which a trail is a single GPS cluster. */
internal const val MIN_MEANINGFUL_ROUTE_METERS: Double = 10.0

/** Web `<MapContainer zoom={13}>` for a multi-point trail. */
internal const val ROUTE_TRAIL_ZOOM: Float = 13f

/** Web `<MapContainer zoom={3}>` for a degenerate (≤1 point) trail. */
internal const val ROUTE_WORLD_ZOOM: Float = 3f

/** Web FitBounds `map.setView(anchor, 15)` close-up zoom for a single coordinate / stationary anchor. */
internal const val ROUTE_ANCHOR_ZOOM: Float = 15f

/** Web `centerPos` empty fallback latitude (`[47.6, -122.3]`). */
internal const val FALLBACK_CENTER_LAT: Double = 47.6

/** Web `centerPos` empty fallback longitude (`[47.6, -122.3]`). */
internal const val FALLBACK_CENTER_LNG: Double = -122.3

/** Accessible-summary connector between a label and its value (mirrors the sibling map summary). */
private const val SUMMARY_SEPARATOR: String = " \u2014 "

/**
 * One sampled point of the route source — the native mirror of a web `RoutePoint`
 * (web/src/features/driving/components/drive-detail/types.ts). [lat]/[lng] are WGS-84 degrees and
 * [speedMps] is the raw SI VehicleSpeed (metres-per-second) the parent fed unconverted (ADR-004). The parent
 * builds these from the drive's telemetry, falling back to positions, dropping `(0,0)` rows — exactly the web
 * `useDriveDetailData` `routeSource` memo.
 */
data class RouteMapPoint(
    val lat: Double,
    val lng: Double,
    val speedMps: Double,
)

/**
 * A bare coordinate off `drive.positions` — the native mirror of the web `positionLatLngs` the component reads
 * for the [RouteMapProjection.hasMeaningfulRoute]/[RouteMapProjection.firstValidIndex] stationary-GPS detection
 * (which the web runs against the raw positions, not the telemetry-derived route source).
 */
data class RouteMapLatLng(
    val lat: Double,
    val lng: Double,
)

/**
 * The SI-canonical slice of the drive + computed route this surface renders — the native union of the web
 * `RouteMapSection` props (`drive`, `trail`, `startPos`, `endPos`, `centerPos`, `speedSegments`). The parent
 * computes [routePoints] (the route source) + [positions] (the raw GPS) once and threads them in; nothing is
 * pre-converted, so the speed colours/legend apply the display unit at the projection boundary.
 *
 * @property routePoints the telemetry-or-positions route source (web `routeSource`), driving the trail/segments.
 * @property positions the raw `drive.positions` coordinates (web `positionLatLngs`) for stationary detection.
 * @property startTs the ISO-8601 UTC drive-start instant (web `drive.startTs`).
 * @property endTs the ISO-8601 UTC drive-end instant, or null while the drive is in progress (web `drive.endTs`).
 * @property startLat the drive's recorded start latitude (web `drive.startLat`) — the centre fallback.
 * @property startLon the drive's recorded start longitude (web `drive.startLon`) — the centre fallback.
 */
data class RouteMapSnapshot(
    val routePoints: List<RouteMapPoint>,
    val positions: List<RouteMapLatLng>,
    val startTs: String,
    val endTs: String? = null,
    val startLat: Double? = null,
    val startLon: Double? = null,
)

/**
 * The user's speed display preference this surface needs — the native port of the web `useUnits` read. Only the
 * [speed] unit (plus the [locale]/[precision] feeding the legend number formatting) is relevant here; the
 * thresholds convert through `convertSpeedFromSI(threshold, speed)`, and the legend number formats at the user's
 * decimal precision (web `fmtNumber` with no explicit decimals → the global precision).
 */
data class RouteMapDisplayPrefs(
    val speed: SpeedUnitPref,
    val precision: Int,
    val locale: Locale,
) {
    companion object {
        private const val DEFAULT_PRECISION = 2

        /** The metric/2-dp/en-US defaults applied before settings load (web cold-start defaults). */
        val DEFAULT: RouteMapDisplayPrefs = RouteMapDisplayPrefs(SpeedUnitPref.KMH, DEFAULT_PRECISION, Locale.US)
    }
}

/**
 * The four speed-colour bands the web component paints the route with, slowest → fastest. The web uses literal
 * hex (`#10b981`/`#00f0ff`/`#f59e0b`/`#ef4444`); this enum stays colour-free so the projection is theme- and
 * Android-free, and the composable resolves each band to the matching `TeslaTokens.status` token (whose dark
 * values are byte-identical to those web hex). [Low] is the default band for any speed under the low threshold.
 */
enum class SpeedBand { Low, Moderate, Fast, VeryFast }

/**
 * One render-ready polyline run — a maximal sequence of consecutive route points sharing one [band]. The web
 * emits one two-point segment per pair coloured by the later point's band; merging equal-band neighbours into a
 * single [points] run is visually identical (same vertices, same colour) and far cheaper to draw.
 */
data class RouteSpeedSegment(
    val band: SpeedBand,
    val points: List<GeoPoint>,
)

/**
 * One entry of the speed legend (web's four `<span>`s): the [band] (→ swatch colour) and its already-formatted
 * [range] label ("<30", "30–60", "60–100", ">100" in the user's unit).
 */
data class SpeedLegendItem(
    val band: SpeedBand,
    val range: String,
)

/**
 * The localized strings this surface renders — resolved through the P1/S10 i18n facade at the Compose boundary
 * and passed in so the projection stays pure and JVM-testable. Keys map 1:1 to the web `t('driveDetail.*')`
 * calls.
 *
 * @property route web `driveDetail.route` ("Route") — the panel title + accessible-summary label.
 * @property start web `driveDetail.start` ("Start") — the start marker/legend label.
 * @property end web `driveDetail.end` ("End") — the end marker/legend label.
 * @property inProgress web `driveDetail.inProgress` ("In progress") — the end label while the drive is live.
 * @property lastKnown web `driveDetail.lastKnown` ("Last known location") — the stationary anchor popup.
 * @property stationaryTitle web `driveDetail.stationaryRouteTitle` ("Route can't be plotted") — the banner head.
 * @property stationaryBody web `driveDetail.stationaryRouteBody` — the stationary-route explanation banner body.
 * @property noRouteData web `driveDetail.noRouteData` ("No route data available for this drive") — empty state.
 */
data class RouteMapStrings(
    val route: String,
    val start: String,
    val end: String,
    val inProgress: String,
    val lastKnown: String,
    val stationaryTitle: String,
    val stationaryBody: String,
    val noRouteData: String,
)

/**
 * The fully projected, render-ready view of one drive's route — the native analogue of everything the web
 * component derives before returning JSX (the trail, the centre/zoom, the speed-coloured segments, the
 * start/end/anchor markers + their popup copy, the legend, the bottom start/end times, and the
 * stationary-route branch). Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property hasTrail whether any route point exists; `false` is the empty "no route data" surface.
 * @property hasRoute whether the raw positions form a meaningful route (≥10 m spread); `false` is stationary.
 * @property inProgress whether the drive has no end timestamp (web `drive.endTs ? … : inProgress`).
 * @property center the initial map centre (web `centerPos`).
 * @property zoom the initial map zoom (web `trail.length > 1 ? 13 : 3`).
 * @property trail the ordered route coordinates (web `trail`).
 * @property segments the speed-coloured polyline runs, present only for a meaningful multi-point route.
 * @property startPos the start marker coordinate (web `startPos`), present only for a meaningful route.
 * @property endPos the end marker coordinate (web `endPos`), present only for a meaningful multi-point route.
 * @property anchorPoint the stationary anchor coordinate (web `anchorPoint`), present only when not a route.
 * @property startPopupText the start marker info-window line (web `formatDateTime(drive.startTs)`).
 * @property endPopupText the end marker info-window line (web end date, or the "In progress" copy).
 * @property startTimeText the bottom-row start time (web `formatTime(drive.startTs)`).
 * @property endTimeText the bottom-row end time (web `formatTime(drive.endTs)`), null while in progress.
 * @property showLegend whether the speed legend renders (web `hasRoute && trail.length > 1`).
 * @property legend the four legend entries (web's coloured spans).
 * @property speedUnitLabel the unit shown after the legend (web `{speedUnit}`).
 * @property summaryLines the screen-reader list alternative for the opaque map.
 */
data class RouteMapDisplay(
    val hasTrail: Boolean,
    val hasRoute: Boolean,
    val inProgress: Boolean,
    val center: GeoPoint,
    val zoom: Float,
    val trail: List<GeoPoint>,
    val segments: List<RouteSpeedSegment>,
    val startPos: GeoPoint?,
    val endPos: GeoPoint?,
    val anchorPoint: GeoPoint?,
    val startPopupText: String,
    val endPopupText: String,
    val startTimeText: String,
    val endTimeText: String?,
    val showLegend: Boolean,
    val legend: List<SpeedLegendItem>,
    val speedUnitLabel: String,
    val summaryLines: List<String>,
)

/**
 * Pure projection from a [RouteMapSnapshot] (+ display prefs + localized strings) to its render-ready
 * [RouteMapDisplay] — a 1:1 port of the web component's derivations and the `useDriveDetailData` route maths.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate; the composable only
 * resolves localized strings, maps each [SpeedBand] to a token colour, builds the map markers/polylines, and
 * draws what these return.
 */
object RouteMapProjection {
    /**
     * Maps the surface's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins (skeleton chrome), a snapshot with at least one route point renders [UiPhase.Content], and anything
     * else renders [UiPhase.Empty] (web `trail.length > 0 ? map : noRouteData`). The host's stateful binding can
     * additionally carry refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        snapshot: RouteMapSnapshot?,
        isLoading: Boolean,
    ): UiState<RouteMapSnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null && snapshot.routePoints.isNotEmpty() -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * Project [snapshot] for [prefs] using [strings] — the native analogue of everything the web component
     * derives before returning JSX. The map is centred on the web `centerPos`, carries the speed-coloured trail
     * (or, for a stationary drive, a single anchor marker + the explanatory banner), and announces the route's
     * start/end/legend through the accessible summary.
     */
    fun project(
        snapshot: RouteMapSnapshot,
        prefs: RouteMapDisplayPrefs,
        strings: RouteMapStrings,
        zone: ZoneId = ZoneId.systemDefault(),
    ): RouteMapDisplay {
        val trail = snapshot.routePoints.map { GeoPoint(it.lat, it.lng) }
        val hasTrail = trail.isNotEmpty()
        val hasRoute = hasMeaningfulRoute(snapshot.positions)
        val anchorPoint = anchorPointOf(snapshot.positions)
        val startPos = trail.firstOrNull()
        val endPos = if (trail.size > 1) trail.last() else null
        val inProgress = snapshot.endTs.isNullOrBlank()
        val showLegend = hasRoute && trail.size > 1
        val startPopup = formatDateTime(snapshot.startTs, prefs.locale, zone)
        val endPopup =
            if (inProgress) strings.inProgress else formatDateTime(snapshot.endTs.orEmpty(), prefs.locale, zone)
        return RouteMapDisplay(
            hasTrail = hasTrail,
            hasRoute = hasRoute,
            inProgress = inProgress,
            center = centerOf(startPos, snapshot.startLat, snapshot.startLon),
            zoom = if (trail.size > 1) ROUTE_TRAIL_ZOOM else ROUTE_WORLD_ZOOM,
            trail = trail,
            segments = if (hasRoute) speedSegments(snapshot.routePoints) else emptyList(),
            startPos = if (hasRoute) startPos else null,
            endPos = if (hasRoute) endPos else null,
            anchorPoint = if (!hasRoute) anchorPoint else null,
            startPopupText = startPopup,
            endPopupText = endPopup,
            startTimeText = formatClockTime(snapshot.startTs, prefs.locale, zone),
            endTimeText = if (inProgress) null else formatClockTime(snapshot.endTs.orEmpty(), prefs.locale, zone),
            showLegend = showLegend,
            legend = legend(prefs),
            speedUnitLabel = prefs.speed.label,
            summaryLines = if (hasTrail) summaryLines(strings, hasRoute, startPopup, endPopup) else emptyList(),
        )
    }

    /**
     * The speed band for a raw SI [speedMps] — the verbatim web ladder: at or above the high threshold is the
     * fastest (red) band, then the fast (amber) band, then the moderate (cyan) band, otherwise the low (emerald)
     * band. The default for any speed below the low threshold is [SpeedBand.Low].
     */
    fun bandFor(speedMps: Double): SpeedBand =
        when {
            speedMps >= SPEED_SEGMENT_HIGH_MPS -> SpeedBand.VeryFast
            speedMps >= SPEED_SEGMENT_MED_MPS -> SpeedBand.Fast
            speedMps >= SPEED_SEGMENT_LOW_MPS -> SpeedBand.Moderate
            else -> SpeedBand.Low
        }

    /**
     * The speed-coloured polyline runs — the native port of the web `speedSegments` memo, merging consecutive
     * equal-band two-point segments into one run. Each pair (i-1, i) is coloured by point i's band (web `curr`);
     * a run extends while the band is unchanged, otherwise a new run starts at the previous point.
     */
    fun speedSegments(points: List<RouteMapPoint>): List<RouteSpeedSegment> {
        if (points.size < 2) return emptyList()
        val runs = mutableListOf<MutableSpeedRun>()
        for (i in 1 until points.size) {
            val band = bandFor(points[i].speedMps)
            val current = runs.lastOrNull()
            if (current != null && current.band == band) {
                current.points.add(GeoPoint(points[i].lat, points[i].lng))
            } else {
                runs.add(
                    MutableSpeedRun(
                        band,
                        mutableListOf(
                            GeoPoint(points[i - 1].lat, points[i - 1].lng),
                            GeoPoint(points[i].lat, points[i].lng),
                        ),
                    ),
                )
            }
        }
        return runs.map { RouteSpeedSegment(it.band, it.points.toList()) }
    }

    /**
     * The four legend entries, in slowest → fastest order — the web's coloured spans. Each threshold converts
     * SI → the display unit (`convertSpeedFromSI`) and formats at the user's precision (web `fmtNumber`). The
     * inner bands render as "low–med" / "med–high" ranges; the outer bands as "<low" / ">high".
     */
    fun legend(prefs: RouteMapDisplayPrefs): List<SpeedLegendItem> {
        val low = formatSpeed(SPEED_SEGMENT_LOW_MPS, prefs)
        val med = formatSpeed(SPEED_SEGMENT_MED_MPS, prefs)
        val high = formatSpeed(SPEED_SEGMENT_HIGH_MPS, prefs)
        return listOf(
            SpeedLegendItem(SpeedBand.Low, "<$low"),
            SpeedLegendItem(SpeedBand.Moderate, "$low\u2013$med"),
            SpeedLegendItem(SpeedBand.Fast, "$med\u2013$high"),
            SpeedLegendItem(SpeedBand.VeryFast, ">$high"),
        )
    }

    /** Converts an SI threshold to the display speed and formats it at the user's precision (web `fmtNumber`). */
    private fun formatSpeed(
        mps: Double,
        prefs: RouteMapDisplayPrefs,
    ): String = fmtNumber(convertSpeedFromSI(mps, prefs.speed), prefs.precision, prefs.locale)

    /**
     * The map centre — the web `centerPos`: the first trail point when present, else the drive's recorded start
     * coordinate when both components are non-null AND non-zero (the web truthiness of `drive.startLat &&
     * drive.startLon`), else the `[47.6, -122.3]` fallback.
     */
    fun centerOf(
        startPos: GeoPoint?,
        startLat: Double?,
        startLon: Double?,
    ): GeoPoint =
        when {
            startPos != null -> startPos
            startLat != null && startLon != null && startLat != 0.0 && startLon != 0.0 -> GeoPoint(startLat, startLon)
            else -> GeoPoint(FALLBACK_CENTER_LAT, FALLBACK_CENTER_LNG)
        }

    /**
     * Whether [positions] contains at least two valid coordinates separated by ≥ [MIN_MEANINGFUL_ROUTE_METERS] —
     * the verbatim web `@/lib/geo` `hasMeaningfulRoute`, short-circuiting on the first sample beyond the
     * threshold. `false` ⇒ a single GPS cluster (stationary), so the composable draws the anchor + banner
     * instead of a polyline.
     */
    fun hasMeaningfulRoute(positions: List<RouteMapLatLng>): Boolean {
        val anchorIdx = firstValidIndex(positions)
        if (anchorIdx < 0) return false
        val anchor = positions[anchorIdx]
        return (anchorIdx + 1 until positions.size).any { i ->
            val p = positions[i]
            isValidLatLng(p.lat, p.lng) &&
                haversineMeters(anchor.lat, anchor.lng, p.lat, p.lng) >= MIN_MEANINGFUL_ROUTE_METERS
        }
    }

    /** The index of the first valid coordinate in [positions], or -1 — the web `@/lib/geo` `firstValidIndex`. */
    fun firstValidIndex(positions: List<RouteMapLatLng>): Int {
        for (i in positions.indices) {
            if (isValidLatLng(positions[i].lat, positions[i].lng)) return i
        }
        return -1
    }

    /** The first valid coordinate as a [GeoPoint], or null — the web `anchorPoint` memo. */
    fun anchorPointOf(positions: List<RouteMapLatLng>): GeoPoint? {
        val idx = firstValidIndex(positions)
        if (idx < 0) return null
        val p = positions[idx]
        return GeoPoint(p.lat, p.lng)
    }

    /**
     * True iff `(lat, lng)` is finite, non-`(0,0)`, and within valid global bounds — the verbatim web `@/lib/geo`
     * `isValidLatLng`. `(0,0)` is rejected: it is the canonical Tesla "GPS not yet fixed" sentinel and would
     * otherwise anchor the map in the Gulf of Guinea.
     */
    fun isValidLatLng(
        lat: Double,
        lng: Double,
    ): Boolean =
        lat.isFinite() &&
            lng.isFinite() &&
            !(lat == 0.0 && lng == 0.0) &&
            lat in GeoPoint.MIN_LAT..GeoPoint.MAX_LAT &&
            lng in GeoPoint.MIN_LNG..GeoPoint.MAX_LNG

    /** Great-circle distance in metres (haversine) — the web `@/lib/geo` `haversineDistance`. */
    fun haversineMeters(
        lat1: Double,
        lon1: Double,
        lat2: Double,
        lon2: Double,
    ): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a =
            sin(dLat / 2) * sin(dLat / 2) +
                cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2) * sin(dLon / 2)
        return EARTH_RADIUS_M * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    /**
     * Locale-aware fixed-precision formatting — the native mirror of the web `fmtNumber(value, decimals)`
     * (`Intl.NumberFormat` with equal min/max fraction digits). Groups thousands and rounds half away from zero
     * so the output matches ECMAScript `halfExpand`, and coerces a non-finite value to 0 (web `safeNumber`).
     */
    fun fmtNumber(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String {
        val safeDecimals = decimals.coerceAtLeast(0)
        val pattern = if (safeDecimals > 0) "#,##0." + "0".repeat(safeDecimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(locale))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(if (value.isFinite()) value else 0.0)
    }

    /**
     * Localized short wall-clock time — the native mirror of the web `formatTime` (`toLocaleTimeString` with
     * `{ hour: '2-digit', minute: '2-digit' }`). A blank/unparseable [iso] yields [ROUTE_MAP_EM_DASH] (web
     * invalid-date guard), never throwing.
     */
    fun formatClockTime(
        iso: String,
        locale: Locale,
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val instant = parseInstant(iso) ?: return ROUTE_MAP_EM_DASH
        return DateTimeFormatter
            .ofLocalizedTime(FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    /**
     * Localized medium date + short time — the native mirror of the web `formatDateTime` (`toLocaleString` with
     * year/short-month/day + 2-digit hour/minute). A blank/unparseable [iso] yields [ROUTE_MAP_EM_DASH].
     */
    fun formatDateTime(
        iso: String,
        locale: Locale,
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val instant = parseInstant(iso) ?: return ROUTE_MAP_EM_DASH
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    /**
     * The screen-reader list alternative for the opaque map. For a meaningful route it lists the start + end
     * (or in-progress) instants (the already-projected [startText]/[endText]); for a stationary drive it lists
     * the last-known location + the explanatory banner. The empty-trail case is handled by [project].
     */
    private fun summaryLines(
        strings: RouteMapStrings,
        hasRoute: Boolean,
        startText: String,
        endText: String,
    ): List<String> =
        if (hasRoute) {
            listOf(strings.start + SUMMARY_SEPARATOR + startText, strings.end + SUMMARY_SEPARATOR + endText)
        } else {
            listOf(strings.lastKnown, strings.stationaryTitle + SUMMARY_SEPARATOR + strings.stationaryBody)
        }

    /** Tolerant ISO-8601 decode: an RFC-3339 instant, then an offset date-time, then a zoneless local as UTC. */
    private fun parseInstant(iso: String): Instant? {
        if (iso.isBlank()) return null
        return tryParse { Instant.parse(iso) }
            ?: tryParse { OffsetDateTime.parse(iso).toInstant() }
            ?: tryParse { LocalDateTime.parse(iso).toInstant(ZoneOffset.UTC) }
    }

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }

    /** Mutable accumulator used only while [speedSegments] groups equal-band runs. */
    private class MutableSpeedRun(
        val band: SpeedBand,
        val points: MutableList<GeoPoint>,
    )
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a coordinate,
 * drive time, or vin — so a diagnostics line can never leak where or when a user drove.
 */
object RouteMapSectionDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "RouteMapSection"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
