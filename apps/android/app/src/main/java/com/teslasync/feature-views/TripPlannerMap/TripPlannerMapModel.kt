// Pure, framework-free model + projection for the TripPlannerMap feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/driving/components/TripPlannerMap.tsx). No Compose, no Android, no HTTP: every declaration
// here is exercised off-device by the :app:testReleaseUnitTest gate, so the composable stays a thin render layer
// over these pure functions.
//
// TripPlannerMap is a purely presentational component. Its parent (the web TripPlannerPage) holds the form
// origin/destination and the `usePlanTrip` result and passes `origin`, `destination`, `legs`, and `chargeStops`
// down; the only hook the component itself uses is `useTranslation`. This file owns the three `useMemo`
// derivations the web component performs — the route polyline points (built from the legs, or a straight
// origin→destination line when there are no legs), the map centre, and the zoom level — plus the origin /
// destination / charge-stop markers and their popup copy, and the screen-reader summary lines. The composable
// binds the data through the shared cache-then-network [UiState] (P1/S8) so the owning page can thread every
// lifecycle state (loading / content / empty / stale / offline / error) without this view ever fetching.
//
// Values stay SI/raw on the wire: coordinates are WGS-84 degrees and are never converted; the charge-stop
// state-of-charge is a 0–100 percentage and the charge duration is seconds, converted to whole minutes only for
// display (web `Math.round(charge_duration_s / 60)`). The charge-stop detail symbols (`%`, the `→` arrow, the
// `min` abbreviation) are web display literals — not entries in the frozen P1/S10 catalog — so, exactly as the
// sibling TeslaChargingSessionsMap mirrors its `kWh` web literal, they are reproduced verbatim as documented
// constants here; the three translated strings the web component resolves through `t()` (Origin, Destination,
// and the empty message) are resolved through the i18n facade at the Compose boundary and passed in.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TripPlannerMap — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tripplannermap

import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.abs
import kotlin.math.roundToLong

/** The `→` arrow (with surrounding spaces) joining the route endpoints and the charge-stop SOC range. */
internal const val ROUTE_ARROW: String = " \u2192 "

/** Percent sign appended to each charge-stop state-of-charge value — the web literal `%`. */
internal const val PERCENT_SIGN: String = "%"

/** Minute abbreviation appended to a charge-stop duration — the web literal `min`. */
internal const val MINUTES_ABBREV: String = "min"

/** Separator folding a charge-stop's name and its detail into a single info-window line (web stacked `<p>`s). */
internal const val SNIPPET_SEPARATOR: String = " \u2022 "

/** Separator between a marker's name and its detail in a screen-reader summary line. */
internal const val SUMMARY_SEPARATOR: String = " \u2014 "

/** Seconds per minute — the web `charge_duration_s / 60` divisor. */
private const val SECONDS_PER_MINUTE: Double = 60.0

/** Map centre fallback latitude for an empty form — the web `[39.8283, -98.5795]` centre of the US. */
internal const val FALLBACK_CENTER_LAT: Double = 39.8283

/** Map centre fallback longitude for an empty form — the web `[39.8283, -98.5795]` centre of the US. */
internal const val FALLBACK_CENTER_LNG: Double = -98.5795

/** Zoom when at least one endpoint is missing — the web `if (!origin || !destination) return 5`. */
internal const val ZOOM_DEFAULT: Float = 5f

/** Continental zoom — the web `maxDiff > 20 ? 4`. */
internal const val ZOOM_CONTINENT: Float = 4f

/** Wide zoom — the web `maxDiff > 10 ? 5`. */
internal const val ZOOM_WIDE: Float = 5f

/** Region zoom — the web `maxDiff > 5 ? 6`. */
internal const val ZOOM_REGION: Float = 6f

/** Area zoom — the web `maxDiff > 2 ? 7`. */
internal const val ZOOM_AREA: Float = 7f

/** Close zoom — the web `else return 9`. */
internal const val ZOOM_CLOSE: Float = 9f

/** Coordinate span (degrees) above which the camera uses [ZOOM_CONTINENT] — the web `maxDiff > 20`. */
private const val DIFF_CONTINENT: Double = 20.0

/** Coordinate span (degrees) above which the camera uses [ZOOM_WIDE] — the web `maxDiff > 10`. */
private const val DIFF_WIDE: Double = 10.0

/** Coordinate span (degrees) above which the camera uses [ZOOM_REGION] — the web `maxDiff > 5`. */
private const val DIFF_REGION: Double = 5.0

/** Coordinate span (degrees) above which the camera uses [ZOOM_AREA] — the web `maxDiff > 2`. */
private const val DIFF_AREA: Double = 2.0

/** A polyline needs at least this many points to render — the web `polylinePoints.length >= 2`. */
internal const val MIN_POLYLINE_POINTS: Int = 2

/**
 * One trip endpoint — the native mirror of the web `TripLocation` (web/src/types/driving.ts). [lat]/[lng] are
 * WGS-84 degrees; [name] is the optional display name (a blank/`null` name falls back to the localized "Origin"
 * / "Destination" label, the web `origin.name || t(...)`).
 */
data class TripLocation(
    val lat: Double,
    val lng: Double,
    val name: String? = null,
)

/**
 * One planned leg — the native mirror of the web `TripLeg`. The map reads only the [from]/[to] coordinates to
 * build the route polyline (the web `legs` loop pushes `leg.from`/`leg.to`), so the distance/energy/SOC fields
 * the web type also carries are intentionally omitted from this map-scoped model.
 */
data class TripLeg(
    val from: TripLocation,
    val to: TripLocation,
)

/**
 * One planned charging stop — the native mirror of the web `TripChargeStop`, narrowed to the fields the map
 * popup reads. [chargeFromSoc]/[chargeToSoc] are 0–100 percentages and [chargeDurationS] is seconds; the popup
 * renders "{from}% → {to}% ({minutes} min)" (web `Math.round`).
 *
 * @property name the charger name shown as the popup header (web `stop.name`).
 * @property location the charger coordinate (web `stop.location`).
 * @property chargeFromSoc the arrival state-of-charge percentage (web `stop.charge_from_soc`).
 * @property chargeToSoc the departure state-of-charge percentage (web `stop.charge_to_soc`).
 * @property chargeDurationS the charge duration in seconds (web `stop.charge_duration_s`).
 */
data class TripChargeStop(
    val name: String,
    val location: TripLocation,
    val chargeFromSoc: Double,
    val chargeToSoc: Double,
    val chargeDurationS: Double,
)

/**
 * The SI/raw slice of the trip this surface renders — the native union of the web `TripPlannerMap` props
 * (`origin`, `destination`, `legs`, `chargeStops`). The host (the web TripPlannerPage) threads these in; nothing
 * is pre-converted.
 *
 * @property origin the starting endpoint, or `null` before the user picks one (web `origin`).
 * @property destination the ending endpoint, or `null` before the user picks one (web `destination`).
 * @property legs the planned legs whose `from`/`to` build the route polyline (web `legs`).
 * @property chargeStops the planned charging stops drawn as markers (web `chargeStops`).
 */
data class TripPlannerMapSnapshot(
    val origin: TripLocation? = null,
    val destination: TripLocation? = null,
    val legs: List<TripLeg> = emptyList(),
    val chargeStops: List<TripChargeStop> = emptyList(),
)

/**
 * The localized strings this surface renders — resolved through the P1/S10 i18n facade at the Compose boundary
 * and passed in so the projection stays pure and JVM-testable. Keys map 1:1 to the web `t('tripPlanner.map.*')`
 * calls.
 *
 * @property origin web `tripPlanner.map.origin` ("Origin") — the origin marker fallback label.
 * @property destination web `tripPlanner.map.destination` ("Destination") — the destination marker fallback.
 * @property empty web `tripPlanner.map.empty` ("Enter origin and destination to see the route") — empty state.
 */
data class TripPlannerMapStrings(
    val origin: String,
    val destination: String,
    val empty: String,
)

/**
 * One projected, render-ready marker — the native analogue of a web `<CircleMarker>` + `<Popup>`. [point] is
 * the coordinate; [title] is the single-line info-window text (the endpoint label, or the charger name folded
 * with its SOC/duration detail); [summaryLine] is the screen-reader line for the accessible-summary list.
 * [id] keys the marker (web `key`).
 */
data class TripPlannerMarker(
    val id: String,
    val point: GeoPoint,
    val title: String,
    val summaryLine: String,
)

/**
 * The fully projected, render-ready view of one trip — the native analogue of everything the web component
 * derives before returning JSX (the polyline points, the centre, the zoom, the origin/destination/charge
 * markers + their popup copy, and the empty-state gate). Pure data (no Compose types) so the projection is
 * unit-tested without a UI host.
 *
 * @property hasData whether any endpoint exists (web `origin != null || destination != null`); `false` is empty.
 * @property center the initial map centre (web `center`).
 * @property zoom the initial map zoom (web `zoom`).
 * @property routePoints the ordered polyline coordinates (web `polylinePoints`).
 * @property hasRoute whether [routePoints] has ≥2 points and should be drawn (web `polylinePoints.length >= 2`).
 * @property originMarker the origin marker, present only when an origin exists (web origin `<CircleMarker>`).
 * @property destinationMarker the destination marker, present only when a destination exists.
 * @property chargeMarkers the charge-stop markers in source order (web `chargeStops.map`).
 * @property summaryLines the screen-reader list alternative for the opaque map (origin, destination, stops).
 * @property routeLabel the "{origin} → {destination}" route name announced for the map + summary panel.
 * @property emptyText the empty-state message (web `tripPlanner.map.empty`).
 */
data class TripPlannerMapDisplay(
    val hasData: Boolean,
    val center: GeoPoint,
    val zoom: Float,
    val routePoints: List<GeoPoint>,
    val hasRoute: Boolean,
    val originMarker: TripPlannerMarker?,
    val destinationMarker: TripPlannerMarker?,
    val chargeMarkers: List<TripPlannerMarker>,
    val summaryLines: List<String>,
    val routeLabel: String,
    val emptyText: String,
)

/**
 * Pure projection from a [TripPlannerMapSnapshot] (+ localized strings) to its render-ready
 * [TripPlannerMapDisplay] — a 1:1 port of the web component's three `useMemo` derivations and its popup
 * formatting. Stateless and side-effect-free so it is fully covered by the off-device unit gate; the composable
 * only resolves localized strings, maps the markers to token colours, draws the polyline, and renders what these
 * functions return.
 */
object TripPlannerMapProjection {
    /** Whether the form has at least one endpoint — the web `hasData = origin != null || destination != null`. */
    fun hasData(
        origin: TripLocation?,
        destination: TripLocation?,
    ): Boolean = origin != null || destination != null

    /**
     * The route polyline coordinates — a verbatim port of the web `polylinePoints` memo. With no legs but both
     * endpoints present it is the straight origin→destination line; otherwise it walks the legs, seeding the
     * first leg's `from` and then appending each leg's `to`. With no legs and a missing endpoint it is empty.
     */
    fun routePoints(
        legs: List<TripLeg>,
        origin: TripLocation?,
        destination: TripLocation?,
    ): List<GeoPoint> {
        if (legs.isEmpty() && origin != null && destination != null) {
            return listOf(origin.toGeoPoint(), destination.toGeoPoint())
        }
        val points = mutableListOf<GeoPoint>()
        for (leg in legs) {
            if (points.isEmpty()) points.add(leg.from.toGeoPoint())
            points.add(leg.to.toGeoPoint())
        }
        return points
    }

    /**
     * The initial map centre — a verbatim port of the web `center` memo: the midpoint when both endpoints
     * exist, the origin alone when only it exists, otherwise the centre-of-the-US fallback (note the web only
     * uses the destination when an origin is also present, so a destination-only form falls back).
     */
    fun center(
        origin: TripLocation?,
        destination: TripLocation?,
    ): GeoPoint =
        when {
            origin != null && destination != null ->
                GeoPoint((origin.lat + destination.lat) / 2, (origin.lng + destination.lng) / 2)
            origin != null -> origin.toGeoPoint()
            else -> GeoPoint(FALLBACK_CENTER_LAT, FALLBACK_CENTER_LNG)
        }

    /**
     * The initial map zoom — a verbatim port of the web `zoom` memo: [ZOOM_DEFAULT] unless both endpoints exist,
     * then a ladder keyed on the larger of the latitude/longitude spans (wider spans zoom further out).
     */
    fun zoom(
        origin: TripLocation?,
        destination: TripLocation?,
    ): Float {
        if (origin == null || destination == null) return ZOOM_DEFAULT
        val maxDiff = maxOf(abs(origin.lat - destination.lat), abs(origin.lng - destination.lng))
        return when {
            maxDiff > DIFF_CONTINENT -> ZOOM_CONTINENT
            maxDiff > DIFF_WIDE -> ZOOM_WIDE
            maxDiff > DIFF_REGION -> ZOOM_REGION
            maxDiff > DIFF_AREA -> ZOOM_AREA
            else -> ZOOM_CLOSE
        }
    }

    /**
     * The charge-stop popup detail — the web `{Math.round(from)}% → {Math.round(to)}% ({Math.round(s/60)} min)`.
     * Each value rounds half away from zero (matching ECMAScript `Math.round` for these non-negative inputs) and
     * a non-finite value is coerced to 0 so the line never emits `NaN`.
     */
    fun chargeStopDetail(
        chargeFromSoc: Double,
        chargeToSoc: Double,
        chargeDurationS: Double,
    ): String {
        val from = roundSafe(chargeFromSoc)
        val to = roundSafe(chargeToSoc)
        val minutes = roundSafe(chargeDurationS / SECONDS_PER_MINUTE)
        return "$from$PERCENT_SIGN$ROUTE_ARROW$to$PERCENT_SIGN ($minutes $MINUTES_ABBREV)"
    }

    /**
     * Project [snapshot] using [strings] — the native analogue of everything the web component derives before
     * returning JSX. The map is centred on the web `center`, carries the route polyline + the origin /
     * destination / charge-stop markers, and announces the "{origin} → {destination}" route through the
     * accessible summary; [TripPlannerMapDisplay.hasData] gates the empty surface.
     */
    fun project(
        snapshot: TripPlannerMapSnapshot,
        strings: TripPlannerMapStrings,
    ): TripPlannerMapDisplay {
        val originLabel = labelFor(snapshot.origin, strings.origin)
        val destinationLabel = labelFor(snapshot.destination, strings.destination)
        val originMarker =
            snapshot.origin?.let {
                TripPlannerMarker(
                    id = "origin",
                    point = it.toGeoPoint(),
                    title = originLabel,
                    summaryLine = originLabel,
                )
            }
        val destinationMarker =
            snapshot.destination?.let {
                TripPlannerMarker(
                    id = "destination",
                    point = it.toGeoPoint(),
                    title = destinationLabel,
                    summaryLine = destinationLabel,
                )
            }
        val chargeMarkers = snapshot.chargeStops.mapIndexed { idx, stop -> chargeMarker(idx, stop) }
        val points = routePoints(snapshot.legs, snapshot.origin, snapshot.destination)
        return TripPlannerMapDisplay(
            hasData = hasData(snapshot.origin, snapshot.destination),
            center = center(snapshot.origin, snapshot.destination),
            zoom = zoom(snapshot.origin, snapshot.destination),
            routePoints = points,
            hasRoute = points.size >= MIN_POLYLINE_POINTS,
            originMarker = originMarker,
            destinationMarker = destinationMarker,
            chargeMarkers = chargeMarkers,
            summaryLines =
                buildList {
                    originMarker?.let { add(it.summaryLine) }
                    destinationMarker?.let { add(it.summaryLine) }
                    chargeMarkers.forEach { add(it.summaryLine) }
                },
            routeLabel = "$originLabel$ROUTE_ARROW$destinationLabel",
            emptyText = strings.empty,
        )
    }

    /**
     * Maps the surface's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins (skeleton chrome), a snapshot with at least one endpoint renders [UiPhase.Content], and anything else
     * renders [UiPhase.Empty] (web `hasData ? map : empty`). The host's stateful binding can additionally carry
     * refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        snapshot: TripPlannerMapSnapshot?,
        isLoading: Boolean,
    ): UiState<TripPlannerMapSnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null && hasData(snapshot.origin, snapshot.destination) ->
                UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    private fun chargeMarker(
        index: Int,
        stop: TripChargeStop,
    ): TripPlannerMarker {
        val detail = chargeStopDetail(stop.chargeFromSoc, stop.chargeToSoc, stop.chargeDurationS)
        return TripPlannerMarker(
            id = "stop-$index",
            point = stop.location.toGeoPoint(),
            title = stop.name + SNIPPET_SEPARATOR + detail,
            summaryLine = stop.name + SUMMARY_SEPARATOR + detail,
        )
    }

    /** The endpoint's name, or the localized fallback when it is blank/absent (web `loc.name || t(...)`). */
    private fun labelFor(
        location: TripLocation?,
        fallback: String,
    ): String = location?.name?.takeIf { it.isNotBlank() } ?: fallback

    /** Rounds half away from zero (web `Math.round` for non-negative inputs); a non-finite value yields 0. */
    private fun roundSafe(value: Double): Long = if (value.isFinite()) value.roundToLong() else 0L
}

/** WGS-84 [GeoPoint] for this endpoint. */
private fun TripLocation.toGeoPoint(): GeoPoint = GeoPoint(lat, lng)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a coordinate,
 * endpoint name, or charge detail — so a diagnostics line can never leak where a user is planning to drive.
 */
object TripPlannerMapDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "TripPlannerMap"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
