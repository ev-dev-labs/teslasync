// Pure, framework-free model + projection + diagnostics for the RouteDisplay shared surface — the native
// analogue of every decision the web component makes (web/src/components/data-display/RouteDisplay.tsx)
// before it paints. No Compose, no Android framework, no HTTP: every declaration here is exercised
// off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL primitive — the generic "From → To" / "↻ round trip" / single-location /
//     "No location data" line used by every history row (Drives, Charging, Trips). The parent owns the two
//     endpoints (start / optional end) and passes them in as props; the component's only hook is
//     useTranslation. So there is no data port to bind (no P1/S8 state holder, no Source/ViewModel) —
//     modelling one would invent a fetch the web spec does not have (honesty covenant: no scope narrowing,
//     no silent drift). The sibling presentational ports Distance / BatteryDelta / RouteAnnouncer document
//     the same rationale (composable + model, no Source).
//   • endpointLabel: prefers a trimmed resolved address; else a `📍 {lat}, {lon}` coordinate string fixed to
//     two decimals (web `toFixed(2)`, locale-independent); else null so the caller renders the single
//     "No location data" fallback line. Verified by the web `endpointLabel` vectors.
//   • Round-trip detection (in web order): the caller passed only `start` (explicit single) OR the two
//     endpoint labels are identical OR the two coordinates are within `roundTripThresholdM` metres (great-
//     circle / haversine). A round trip with an explicit end renders "{start} ↻ round trip"; an explicit
//     single renders just "{start}" (no phrase); everything else renders "{start} → {end}", each side
//     falling back to "No location data" when that endpoint has no label.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface fetches nothing — it renders two endpoints the parent already holds. Its real, fully reproduced
// states are NoLocation, RoundTrip (explicit-single and matched), and PointToPoint (incl. the per-endpoint
// fallback), each reduced here and asserted in the off-device test. The two catalog strings the visible
// line interpolates (`route.noLocationData`, `route.roundTrip`) are resolved at the render boundary (P1/S10)
// and threaded in as [RouteDisplayStrings], so this projection stays pure and locale-stable.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/RouteDisplay — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.routedisplay

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** Mean Earth radius in metres — the haversine constant (web `const R = 6_371_000`). */
const val EARTH_RADIUS_M: Double = 6_371_000.0

/**
 * Threshold (metres) under which two coordinates count as the same place when only coordinates are
 * available — the web `roundTripThresholdM` default (100 m).
 */
const val DEFAULT_ROUND_TRIP_THRESHOLD_M: Double = 100.0

/** The map-pin prefix the coordinate fallback carries (web `📍`, U+1F4CD). */
const val ROUTE_COORD_PIN: String = "\uD83D\uDCCD"

/** The clockwise-arrows glyph that flags a round trip (web `↻`, U+21BB). */
const val ROUTE_ROUND_TRIP_GLYPH: String = "\u21BB"

/** The rightwards arrow joining the two endpoints (web `→`, U+2192). */
const val ROUTE_ARROW: String = "\u2192"

/**
 * A trip endpoint — the native port of the web `RouteEndpoint`. A resolved [address] is preferred; a
 * [lat]/[lon] pair is the coordinate fallback. All three are optional so a missing endpoint yields a null
 * label, exactly like the web shape (`{ address?, lat?, lon? }`).
 */
data class RouteEndpoint(
    val address: String? = null,
    val lat: Double? = null,
    val lon: Double? = null,
)

/**
 * How a start/end pair is classified for display — the native tag for the three web render branches.
 * [NoLocation] is the web `!startLabel && !endLabel` line; [RoundTrip] is the web `isRoundTrip` branch
 * (an explicit single location, or matched addresses / nearby coordinates); [PointToPoint] is the web
 * `"{start} → {end}"` branch (with per-endpoint "No location data" fallback).
 */
enum class RouteDisplayKind { NoLocation, RoundTrip, PointToPoint }

/**
 * The two localized strings the visible line interpolates — built from `stringResource` at the render
 * boundary (tests pass a deterministic instance), keeping [projectRouteDisplay] pure and locale-stable.
 * Both resolve through the P1/S10 catalog (web `route.noLocationData` / `route.roundTrip`).
 */
data class RouteDisplayStrings(
    val noLocationData: String,
    val roundTrip: String,
)

/**
 * The fully reduced, render-ready projection — everything the composable draws: the classified [kind] and
 * the single visible [text] line (which is also the surface's accessibility label, mirroring the web where
 * the line's text content is what assistive tech reads). Pure data so every branch is covered off-device.
 */
data class RouteDisplayProjection(
    val kind: RouteDisplayKind,
    val text: String,
)

/**
 * Great-circle distance between two coordinates, in metres — a 1:1 port of the web `haversineMeters`.
 * Used only as the coordinate-based round-trip tie-breaker, so its absolute accuracy is immaterial; what
 * matters is that it agrees with the web formula at the `roundTripThresholdM` boundary.
 */
fun haversineMeters(
    aLat: Double,
    aLon: Double,
    bLat: Double,
    bLon: Double,
): Double {
    val dLat = Math.toRadians(bLat - aLat)
    val dLon = Math.toRadians(bLon - aLon)
    val lat1 = Math.toRadians(aLat)
    val lat2 = Math.toRadians(bLat)
    val sinLat = sin(dLat / 2)
    val sinLon = sin(dLon / 2)
    val x = sinLat * sinLat + cos(lat1) * cos(lat2) * sinLon * sinLon
    return 2 * EARTH_RADIUS_M * asin(min(1.0, sqrt(x)))
}

/**
 * Pretty label for an endpoint — the native port of the web `endpointLabel`. Returns the trimmed [address]
 * when present; else a `📍 {lat}, {lon}` string with each coordinate fixed to two decimals (web
 * `toFixed(2)`, a locale-independent '.' decimal with no grouping — formatted with [Locale.ROOT] so the
 * separator never drifts with the device locale); else null when neither is available.
 */
fun endpointLabel(endpoint: RouteEndpoint): String? {
    val address = endpoint.address?.trim()
    val lat = endpoint.lat
    val lon = endpoint.lon
    return when {
        !address.isNullOrEmpty() -> address
        lat != null && lon != null -> "$ROUTE_COORD_PIN " + String.format(Locale.ROOT, "%.2f, %.2f", lat, lon)
        else -> null
    }
}

/** True when an endpoint carries both coordinates — the native port of the web `hasCoords` guard. */
private fun RouteEndpoint?.hasCoords(): Boolean = this != null && lat != null && lon != null

/**
 * True when [start] and [end] both carry coordinates within [roundTripThresholdM] metres — the web
 * `coordsClose` tie-breaker. A missing coordinate on either side is not close.
 */
private fun coordsWithinThreshold(
    start: RouteEndpoint,
    end: RouteEndpoint?,
    roundTripThresholdM: Double,
): Boolean {
    if (!start.hasCoords() || !end.hasCoords()) return false
    return haversineMeters(start.lat!!, start.lon!!, end!!.lat!!, end.lon!!) < roundTripThresholdM
}

/**
 * The web `isRoundTrip` predicate: a non-null start label AND either the caller passed only `start`
 * (explicit single), OR the two endpoint labels match, OR the two coordinates are within the threshold.
 */
private fun isRoundTrip(
    start: RouteEndpoint,
    end: RouteEndpoint?,
    startLabel: String?,
    endLabel: String?,
    roundTripThresholdM: Double,
): Boolean {
    if (startLabel == null) return false
    val addressesMatch = endLabel != null && startLabel == endLabel
    return end == null || addressesMatch || coordsWithinThreshold(start, end, roundTripThresholdM)
}

/** Builds the round-trip line: just the start for an explicit single, else "{start} ↻ round trip". */
private fun roundTripProjection(
    startLabel: String,
    end: RouteEndpoint?,
    strings: RouteDisplayStrings,
): RouteDisplayProjection {
    val text = if (end == null) startLabel else "$startLabel $ROUTE_ROUND_TRIP_GLYPH ${strings.roundTrip}"
    return RouteDisplayProjection(RouteDisplayKind.RoundTrip, text)
}

/**
 * Reduces the [start]/[end] endpoints and the [roundTripThresholdM] into the render-ready
 * [RouteDisplayProjection] — a faithful port of the web `RouteDisplay` body. [strings] supplies the two
 * localized catalog values the visible line interpolates so this stays a pure, locale-stable function.
 *
 * Branch order matches the web exactly: no labels at all → [RouteDisplayKind.NoLocation]; otherwise a round
 * trip (explicit single end-absent, matched address labels, or coordinates within the threshold) →
 * [RouteDisplayKind.RoundTrip] (the explicit single shows just the start; a matched/near round trip appends
 * " ↻ round trip"); everything else → [RouteDisplayKind.PointToPoint] with each side falling back to
 * "No location data".
 */
fun projectRouteDisplay(
    start: RouteEndpoint,
    end: RouteEndpoint?,
    roundTripThresholdM: Double,
    strings: RouteDisplayStrings,
): RouteDisplayProjection {
    val startLabel = endpointLabel(start)
    val endLabel = end?.let { endpointLabel(it) }
    return when {
        startLabel == null && endLabel == null ->
            RouteDisplayProjection(RouteDisplayKind.NoLocation, strings.noLocationData)
        startLabel != null && isRoundTrip(start, end, startLabel, endLabel, roundTripThresholdM) ->
            roundTripProjection(startLabel, end, strings)
        else ->
            RouteDisplayProjection(
                RouteDisplayKind.PointToPoint,
                "${startLabel ?: strings.noLocationData} $ROUTE_ARROW ${endLabel ?: strings.noLocationData}",
            )
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never an
 * address, coordinate, or distance — so a diagnostics line can never leak where a vehicle has been.
 */
object RouteDisplayDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = "RouteDisplay"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
