// Pure, framework-free model + projection for the TripReplayMap feature view — the native analogue of
// everything the web component derives before it returns JSX (web/src/features/trips/components/TripReplayMap.tsx
// + the @/lib/geo helpers it imports). No Compose, no Android, no HTTP: every declaration here is exercised
// off-device by the :android:testReleaseUnitTest gate, so the composable stays a thin render layer over these
// pure functions.
//
// TripReplayMap is a purely presentational component. Its parent (the web TripReplayPage) owns the drive query +
// the `useTripReplay` scrubber and passes `positions`, `currentIndex`, `onSeekToIndex`, and `reduceMotion` down;
// the component's only hooks are `useTranslation` (the i18n catalog, P1/S10) and `useMap` (the Leaflet handle the
// inline FitBounds reads — reproduced here as the pure camera intent the composable applies through
// rememberMapCameraState + a bounds fit). This file owns every derivation the web component performs: the
// `(0,0)`-rejecting coordinate validity + stationary-GPS detection (web `@/lib/geo`), the speed-coloured polyline
// segments, the start/end/anchor markers, the centre, the heading-aware playhead position, the nearest-sample
// seek scan, and the screen-reader summary. As in the sibling RouteMapSection port, the cache-then-network
// lifecycle (loading / content / empty / stale / offline / error) is projected onto the shared [UiState] (P1/S8)
// so the owning page can thread every state through and the surface renders them all without ever fetching.
//
// Values stay SI/raw on the wire: coordinates are WGS-84 degrees and are never converted. The speed colour bands
// are a VERBATIM reproduction of the web `speedColor` (web/src/features/trips/components/TripReplayMap.tsx L53):
// the web compares the raw `DrivePosition.speed` — which is SI metres-per-second post Phase-42/48 — against the
// literal thresholds 30 / 60 / 100 with NO unit conversion (the web `speedColor` parameter is misleadingly named
// `kmh` but is fed `curr.speed` directly). Reproducing those literal thresholds here keeps the rendered band
// colours byte-identical to the web; this is a deliberate parity reproduction, NOT a unit bug to "fix" (the
// sibling RouteMapSection deliberately diverges because its OWN web source converts via `SPEED_SEGMENT_*_MPS`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TripReplayMap — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tripreplaymap

import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

/** Em dash shown wherever a coordinate cannot be described. */
internal const val TRIP_REPLAY_EM_DASH: String = "\u2014"

/** Separator between a marker label and its detail in a screen-reader summary line. */
private const val SUMMARY_SEPARATOR: String = " \u2014 "

/** Web `speedColor` `< 30` boundary — slow (emerald) below it. Compared against the raw SI speed (see header). */
internal const val SPEED_BAND_LOW: Double = 30.0

/** Web `speedColor` `< 60` boundary — moderate (cyan) below it. */
internal const val SPEED_BAND_MED: Double = 60.0

/** Web `speedColor` `< 100` boundary — fast (amber) below it, fastest (red) at or above it. */
internal const val SPEED_BAND_HIGH: Double = 100.0

/** Earth radius in metres — the web `@/lib/geo` haversine constant. */
private const val EARTH_RADIUS_M: Double = 6_371_000.0

/** Web `@/lib/geo` `MIN_MEANINGFUL_ROUTE_METERS`: the spread below which a trail is a single GPS cluster. */
internal const val MIN_MEANINGFUL_ROUTE_METERS: Double = 10.0

/** Web `<MapContainer zoom={13}>` initial zoom (the FitBounds pass refines it once the map loads). */
internal const val REPLAY_INITIAL_ZOOM: Float = 13f

/** Web FitBounds `map.setView(point, 15)` close-up zoom for a single / stationary coordinate. */
internal const val REPLAY_FIT_ZOOM: Float = 15f

/** Web `centerPos` empty fallback latitude (`[47.6, -122.3]`). */
internal const val FALLBACK_CENTER_LAT: Double = 47.6

/** Web `centerPos` empty fallback longitude (`[47.6, -122.3]`). */
internal const val FALLBACK_CENTER_LNG: Double = -122.3

/** A polyline needs at least this many points to render — the web `hasRoute && speedSegments` guard. */
internal const val MIN_POLYLINE_POINTS: Int = 2

/** Full circle, for normalising a bearing into `[0, 360)`. */
private const val FULL_CIRCLE_DEG: Double = 360.0

/** Coordinate rounding scale for the accessible summary (4 dp — the maps-layer `formatLatLng` precision). */
private const val COORD_SCALE: Double = 10_000.0

/**
 * One sampled GPS point the replay map reads — the native mirror of the web `DrivePosition`
 * (web/src/types/driving.ts), narrowed to the three fields `TripReplayMap` actually touches: the WGS-84
 * coordinate ([lat]/[lng]) and the raw SI speed ([speedMps], metres-per-second; `null` when the sample carried
 * no speed, the web `curr.speed ?? 0`). The page threads these in unconverted (ADR-004).
 */
data class ReplayPosition(
    val lat: Double,
    val lng: Double,
    val speedMps: Double? = null,
)

/**
 * The SI/raw slice of the drive this surface renders — the native union of the web `TripReplayMap` data prop
 * (`positions`). The host (the web TripReplayPage) owns the drive query + scrubber and threads the ordered,
 * `(0,0)`-filtered samples in; nothing is pre-converted.
 *
 * @property positions the ordered GPS samples driving the trail / segments / playhead (web `positions`).
 */
data class TripReplayMapSnapshot(
    val positions: List<ReplayPosition> = emptyList(),
)

/**
 * The localized strings this surface renders — resolved through the P1/S10 i18n facade at the Compose boundary
 * and passed in so the projection stays pure and JVM-testable.
 *
 * @property routeLabel web `replay.title` ("Trip Replay") — the map accessible name + summary label.
 * @property start web `replay.markers.start` ("Start") — the start marker / summary label.
 * @property end web `replay.markers.stop` ("End") — the end marker / summary label.
 * @property stationaryTitle web `replay.map.stationaryRouteTitle` ("Route can't be plotted") — the banner head.
 * @property stationaryBody web `replay.map.stationaryRouteBody` — the stationary-route explanation banner body.
 * @property noPositions web `replay.map.noPositions` ("No position data available for this drive") — empty state.
 */
data class TripReplayMapStrings(
    val routeLabel: String,
    val start: String,
    val end: String,
    val stationaryTitle: String,
    val stationaryBody: String,
    val noPositions: String,
)

/**
 * The four speed-colour bands the web `speedColor` paints the route with, slowest → fastest. The web uses literal
 * hex (`#10b981` / `#22d3ee` / `#f59e0b` / `#ef4444`); this enum stays colour-free so the projection is theme-
 * and Android-free, and the composable resolves each band to the matching `TeslaTokens.status` token. [Low] is
 * the default band for any speed under the low threshold.
 */
enum class SpeedBand { Low, Moderate, Fast, VeryFast }

/**
 * One render-ready polyline run — a maximal sequence of consecutive samples sharing one [band]. The web emits one
 * two-point segment per pair coloured by the LATER point's band; merging equal-band neighbours into a single
 * [points] run is visually identical (same vertices, same colour) and far cheaper to draw.
 */
data class ReplaySpeedSegment(
    val band: SpeedBand,
    val points: List<GeoPoint>,
)

/**
 * The fully projected, render-ready view of one drive's replay route — the native analogue of everything the web
 * component derives before returning JSX (the trail, the centre/zoom, the speed-coloured segments, the
 * start/end/anchor markers, and the stationary-route branch). Pure data (no Compose types) so the projection is
 * unit-tested without a UI host; the moving playhead position + heading are computed separately because they
 * depend on the interactive `currentIndex` the page owns.
 *
 * @property hasPositions whether any sample exists; `false` is the empty "no position data" surface.
 * @property hasRoute whether the samples form a meaningful route (≥10 m spread); `false` is stationary.
 * @property center the initial map centre (web `centerPos`).
 * @property zoom the initial map zoom (web `<MapContainer zoom={13}>`).
 * @property trail the ordered route coordinates, empty for a stationary capture (web `trail`).
 * @property segments the speed-coloured polyline runs, present only for a meaningful route.
 * @property startPos the green start-dot coordinate (web `startPos`), present only for a meaningful route.
 * @property endPos the red end-dot coordinate (web `endPos`), present only for a meaningful multi-point route.
 * @property anchorPoint the stationary anchor coordinate (web `anchorPoint`), present only when not a route.
 * @property summaryLines the screen-reader list alternative for the opaque map.
 */
data class TripReplayMapDisplay(
    val hasPositions: Boolean,
    val hasRoute: Boolean,
    val center: GeoPoint,
    val zoom: Float,
    val trail: List<GeoPoint>,
    val segments: List<ReplaySpeedSegment>,
    val startPos: GeoPoint?,
    val endPos: GeoPoint?,
    val anchorPoint: GeoPoint?,
    val summaryLines: List<String>,
)

/**
 * Pure projection from a [TripReplayMapSnapshot] (+ localized strings) to its render-ready [TripReplayMapDisplay]
 * — a 1:1 port of the web component's `useMemo` derivations and its `@/lib/geo` helpers. Stateless and
 * side-effect-free so it is fully covered by the off-device unit gate; the composable only resolves localized
 * strings, maps each [SpeedBand] to a token colour, builds the markers/polylines, and draws what these return.
 */
object TripReplayMapProjection {
    /**
     * Maps the surface's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins (skeleton chrome), a snapshot with at least one sample renders [UiPhase.Content], and anything else
     * renders [UiPhase.Empty] (web `positions.length > 0 ? map : empty`). The host's stateful binding can
     * additionally carry refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        snapshot: TripReplayMapSnapshot?,
        isLoading: Boolean,
    ): UiState<TripReplayMapSnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null && snapshot.positions.isNotEmpty() -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * Project [snapshot] using [strings] — the native analogue of everything the web component derives before
     * returning JSX. A meaningful route yields the speed-coloured trail + start/end dots; a stationary capture
     * yields a single anchor marker + the explanatory banner; the accessible summary mirrors whichever renders.
     */
    fun project(
        snapshot: TripReplayMapSnapshot,
        strings: TripReplayMapStrings,
    ): TripReplayMapDisplay {
        val positions = snapshot.positions
        val hasPositions = positions.isNotEmpty()
        val hasRoute = hasMeaningfulRoute(positions)
        val anchorPoint = anchorPointOf(positions)
        val trail = if (hasRoute) positions.map { GeoPoint(it.lat, it.lng) } else emptyList()
        val startPos = trail.firstOrNull()
        val endPos = if (trail.size > 1) trail.last() else null
        return TripReplayMapDisplay(
            hasPositions = hasPositions,
            hasRoute = hasRoute,
            center = centerOf(startPos, anchorPoint),
            zoom = REPLAY_INITIAL_ZOOM,
            trail = trail,
            segments = if (hasRoute) speedSegments(positions) else emptyList(),
            startPos = startPos,
            endPos = endPos,
            anchorPoint = if (!hasRoute) anchorPoint else null,
            summaryLines =
                if (hasPositions) summaryLines(strings, hasRoute, startPos, endPos, anchorPoint) else emptyList(),
        )
    }

    /**
     * The speed band for a raw SI [speedMps] — the VERBATIM web `speedColor` ladder (a `null` speed coerces to 0,
     * the web `curr.speed ?? 0`): under [SPEED_BAND_LOW] is the slow (emerald) band, then the moderate (cyan)
     * band, then the fast (amber) band, otherwise the fastest (red) band. See the file header for why the raw SI
     * value is compared against these literal thresholds.
     */
    fun bandFor(speedMps: Double?): SpeedBand {
        val v = speedMps ?: 0.0
        return when {
            v < SPEED_BAND_LOW -> SpeedBand.Low
            v < SPEED_BAND_MED -> SpeedBand.Moderate
            v < SPEED_BAND_HIGH -> SpeedBand.Fast
            else -> SpeedBand.VeryFast
        }
    }

    /**
     * The speed-coloured polyline runs — the native port of the web `speedSegments` memo, merging consecutive
     * equal-band two-point segments into one run. Each pair (i-1, i) is coloured by point i's band (web `curr`);
     * a run extends while the band is unchanged, otherwise a new run starts at the previous point.
     */
    fun speedSegments(positions: List<ReplayPosition>): List<ReplaySpeedSegment> {
        if (positions.size < MIN_POLYLINE_POINTS) return emptyList()
        val runs = mutableListOf<MutableSpeedRun>()
        for (i in 1 until positions.size) {
            val band = bandFor(positions[i].speedMps)
            val current = runs.lastOrNull()
            if (current != null && current.band == band) {
                current.points.add(GeoPoint(positions[i].lat, positions[i].lng))
            } else {
                runs.add(
                    MutableSpeedRun(
                        band,
                        mutableListOf(
                            GeoPoint(positions[i - 1].lat, positions[i - 1].lng),
                            GeoPoint(positions[i].lat, positions[i].lng),
                        ),
                    ),
                )
            }
        }
        return runs.map { ReplaySpeedSegment(it.band, it.points.toList()) }
    }

    /**
     * The playhead coordinate at [currentIndex] — the web `currentPosition = hasRoute ? positions[currentIndex]
     * ?? null : null`. Null for a stationary capture or an out-of-range index, so the composable draws no
     * playhead.
     */
    fun currentPoint(
        positions: List<ReplayPosition>,
        currentIndex: Int,
        hasRoute: Boolean,
    ): GeoPoint? {
        if (!hasRoute) return null
        return positions.getOrNull(currentIndex)?.let { GeoPoint(it.lat, it.lng) }
    }

    /**
     * The playhead heading (0 = north, clockwise) at [currentIndex] — the verbatim web `heading` memo: 0 when not
     * a route or fewer than two samples; otherwise the bearing of the segment ending at the sample after the
     * cursor (`next = currentIndex < len-1 ? currentIndex+1 : currentIndex`, `prev = next>0 ? next-1 : 0`). Guards
     * an out-of-range index so it never returns NaN.
     */
    fun headingForIndex(
        positions: List<ReplayPosition>,
        currentIndex: Int,
        hasRoute: Boolean,
    ): Double {
        if (!hasRoute || positions.size < MIN_POLYLINE_POINTS) return 0.0
        val next = if (currentIndex < positions.size - 1) currentIndex + 1 else currentIndex
        val prev = if (next > 0) next - 1 else 0
        val a = positions.getOrNull(prev)
        val b = positions.getOrNull(next)
        return if (a != null && b != null) computeHeading(a, b) else 0.0
    }

    /**
     * Initial compass bearing from [p1] to [p2] in degrees (0 = north, clockwise) — the verbatim web
     * `computeHeading`. Rotates the playhead arrow glyph.
     */
    fun computeHeading(
        p1: ReplayPosition,
        p2: ReplayPosition,
    ): Double {
        val dLon = Math.toRadians(p2.lng - p1.lng)
        val y = sin(dLon) * cos(Math.toRadians(p2.lat))
        val x =
            cos(Math.toRadians(p1.lat)) * sin(Math.toRadians(p2.lat)) -
                sin(Math.toRadians(p1.lat)) * cos(Math.toRadians(p2.lat)) * cos(dLon)
        return (Math.toDegrees(atan2(y, x)) + FULL_CIRCLE_DEG) % FULL_CIRCLE_DEG
    }

    /**
     * The index of the sample nearest (by haversine) to a tapped ([lat], [lng]) — the verbatim web
     * `nearestSampleIndex` linear scan, wired to the map tap so a tap near the route seeks the scrubber. Returns 0
     * for an empty list (web parity).
     */
    fun nearestSampleIndex(
        positions: List<ReplayPosition>,
        lat: Double,
        lng: Double,
    ): Int {
        if (positions.isEmpty()) return 0
        var bestIdx = 0
        var bestDist = Double.POSITIVE_INFINITY
        for (i in positions.indices) {
            val d = haversineMeters(positions[i].lat, positions[i].lng, lat, lng)
            if (d < bestDist) {
                bestDist = d
                bestIdx = i
            }
        }
        return bestIdx
    }

    /**
     * The map centre — the web `centerPos`: the first trail point when present (a meaningful route), else the
     * stationary anchor, else the `[47.6, -122.3]` fallback.
     */
    fun centerOf(
        startPos: GeoPoint?,
        anchorPoint: GeoPoint?,
    ): GeoPoint = startPos ?: anchorPoint ?: GeoPoint(FALLBACK_CENTER_LAT, FALLBACK_CENTER_LNG)

    /**
     * Whether [positions] contains at least two valid coordinates separated by ≥ [MIN_MEANINGFUL_ROUTE_METERS] —
     * the verbatim web `@/lib/geo` `hasMeaningfulRoute`, short-circuiting on the first sample beyond the
     * threshold. `false` ⇒ a single GPS cluster (stationary), so the composable draws the anchor + banner instead
     * of a polyline.
     */
    fun hasMeaningfulRoute(positions: List<ReplayPosition>): Boolean {
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
    fun firstValidIndex(positions: List<ReplayPosition>): Int {
        for (i in positions.indices) {
            if (isValidLatLng(positions[i].lat, positions[i].lng)) return i
        }
        return -1
    }

    /** The first valid coordinate as a [GeoPoint], or null — the web `anchorPoint` memo. */
    fun anchorPointOf(positions: List<ReplayPosition>): GeoPoint? {
        val idx = firstValidIndex(positions)
        if (idx < 0) return null
        val p = positions[idx]
        return GeoPoint(p.lat, p.lng)
    }

    /**
     * True iff `(lat, lng)` is finite, non-`(0,0)`, and within valid global bounds — the verbatim web `@/lib/geo`
     * `isValidLatLng`. `(0,0)` is rejected: it is the canonical Tesla "GPS not yet fixed" sentinel and would
     * otherwise drag the map to the Gulf of Guinea.
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
     * The screen-reader list alternative for the opaque map. A meaningful route lists the start + end markers and
     * their coordinates; a stationary capture lists the single recorded location + the explanatory banner. The
     * empty-positions case is handled by [project] (the composable shows the empty state instead).
     */
    private fun summaryLines(
        strings: TripReplayMapStrings,
        hasRoute: Boolean,
        startPos: GeoPoint?,
        endPos: GeoPoint?,
        anchorPoint: GeoPoint?,
    ): List<String> =
        if (hasRoute) {
            buildList {
                startPos?.let { add(strings.start + SUMMARY_SEPARATOR + formatLatLng(it)) }
                endPos?.let { add(strings.end + SUMMARY_SEPARATOR + formatLatLng(it)) }
            }
        } else {
            buildList {
                anchorPoint?.let { add(strings.routeLabel + SUMMARY_SEPARATOR + formatLatLng(it)) }
                add(strings.stationaryTitle + SUMMARY_SEPARATOR + strings.stationaryBody)
            }
        }

    /** "lat, lng" rounded to 4 dp for the accessible summary (the maps-layer `formatLatLng` precision). */
    private fun formatLatLng(point: GeoPoint): String = "${roundCoord(point.lat)}, ${roundCoord(point.lng)}"

    private fun roundCoord(value: Double): Double = if (value.isFinite()) (value * COORD_SCALE).roundToLong() / COORD_SCALE else 0.0

    /** Mutable accumulator used only while [speedSegments] groups equal-band runs. */
    private class MutableSpeedRun(
        val band: SpeedBand,
        val points: MutableList<GeoPoint>,
    )
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a coordinate,
 * speed, or drive index — so a diagnostics line can never leak where a user drove.
 */
object TripReplayMapDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "TripReplayMap"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
