// Pure, framework-free model + projection + diagnostics for the MarkerCluster shared surface — the native
// analogue of every decision the web component makes (web/src/components/maps/MarkerCluster.tsx) before it
// paints. No Compose, no Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A HEADLESS leaflet primitive — it takes a `points` array as a prop, registers a `leaflet.markercluster`
//     group on the parent map via `useMap()`, and returns `null`. Its only "data source" is the leaflet map
//     context (the web `useMap` hook), NOT a network query — so there is no data port to bind (no P1/S8 state
//     holder, no Source/ViewModel). Modelling one would invent a fetch the web spec does not have (honesty
//     covenant: no scope narrowing, no silent drift); the sibling presentational port RouteDisplay documents
//     the same rationale. The parent owns the points exactly as the web parent does.
//   • Its concrete, fully reproduced behaviours (the web `MarkerCluster.test.tsx` vectors are the spec):
//       1. Caps the rendered set at 5000 to avoid the leaflet perf cliff (web `points.slice(0, 5000)`) — the
//          cap is applied to the RAW list first, before any coordinate filtering, so an over-cap input keeps
//          the first 5000 in order.
//       2. Skips points whose coordinates are not finite numbers (web `typeof !== 'number' || Number.isNaN`).
//          The render layer additionally enforces the WGS-84 envelope, so the projection filters with the same
//          [GeoPoint.isValid] predicate the layer applies — the projected count is exactly what renders.
//       3. Density-graded cluster bubbles (web `defaultIconCreate` thresholds: ≥100 / ≥25 / ≥10 / else) — the
//          shared [io.teslasync.android.components.maps.clusterColor] is byte-identical to those thresholds.
//       4. A per-point dot marker whose colour defaults to the surface's `defaultColor` (web `defaultColor`,
//          mapped to the token [MapMarkerSeverity] palette so light / dark / high-contrast stay correct) and
//          can be overridden per point; an optional bound popup (web `popupHtml`); a click that forwards the
//          ORIGINAL point (web `onMarkerClick`); and an accessibility label (web `ariaLabel`).
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface fetches nothing — it renders the points the parent already holds. Its real, fully reproduced states
// are Empty (no finite points → a friendly map empty state, never a blank box) and Populated (clustered
// bubbles + singleton dots). Both are reduced here and asserted off-device.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/MarkerCluster — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.markercluster

import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.MapMarker
import io.teslasync.android.components.maps.MapMarkerSeverity
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** The leaflet perf-cliff cap — web `points.slice(0, 5000)`. */
const val MAX_RENDERED_POINTS: Int = 5000

/** Cluster pixel radius default — web `maxClusterRadius = 50`. */
const val DEFAULT_MAX_CLUSTER_RADIUS_PX: Int = 50

/** Zoom at/above which clustering is disabled — web `disableClusteringAtZoom = 18`. */
const val DEFAULT_DISABLE_CLUSTERING_AT_ZOOM: Double = 18.0

/**
 * Upper bound on the accessible-summary rows. The opaque map conveys every marker visually; the screen-reader
 * list alternative needs only a representative, scrollable digest, so it is bounded for layout performance at
 * the adopter scale (charging-session / location maps). The full count is still implied by the surface label.
 */
const val MAX_SUMMARY_LINES: Int = 100

/** Decimal places used when an accessible line falls back to a raw coordinate (locale-stable). */
private const val COORD_DECIMALS: Int = 4

/**
 * One point of interest to cluster — the native port of the web `ClusterPoint`. [id] is the stable identifier
 * the web uses for reconciliation and that the surface uses to recover the original point on a marker tap.
 * [popupText] is the web `popupHtml` (plain text in the native info window — no HTML is rendered). [ariaLabel]
 * is the web accessibility label (the marker's name + the accessible-summary line). [severity] overrides the
 * surface default colour for this one point (web per-point `color`), resolved to the token palette at render.
 */
data class ClusterPoint(
    val id: String,
    val lat: Double,
    val lng: Double,
    val popupText: String? = null,
    val ariaLabel: String? = null,
    val severity: MapMarkerSeverity? = null,
)

/**
 * The fully reduced, render-ready projection — everything the composable needs: the capped + coordinate-valid
 * [markers] (ready for the shared cluster grid), the [pointsById] reverse index a marker tap uses to forward
 * the ORIGINAL [ClusterPoint] (web `onMarkerClick(point)`), and the diagnostic counts. Pure data so every
 * branch (empty / populated / capped / skipped) is covered off-device.
 */
data class MarkerClusterProjection(
    val markers: List<MapMarker>,
    val pointsById: Map<String, ClusterPoint>,
    val suppliedCount: Int,
    val skippedInvalidCount: Int,
    val cappedOverflowCount: Int,
) {
    /** Markers actually rendered (after the cap + the finite-coordinate filter). */
    val renderedCount: Int get() = markers.size

    /** True when no finite point survived — the surface renders its friendly empty state. */
    val isEmpty: Boolean get() = markers.isEmpty()
}

/**
 * Reduces the raw [points] into the render-ready [MarkerClusterProjection] — a faithful port of the web
 * `MarkerCluster` body. Branch order matches the web exactly: take the first [MAX_RENDERED_POINTS] (web
 * `slice(0, 5000)`), then drop any whose coordinates are not finite + in-envelope (web NaN/number guard +
 * the render layer's WGS-84 envelope), mapping each survivor to a token-coloured [MapMarker]. [defaultSeverity]
 * is the surface's default marker colour (web `defaultColor`); a point's own [ClusterPoint.severity] overrides
 * it. The [ClusterPoint.ariaLabel] becomes the marker title (its accessible name + info-window header) and the
 * [ClusterPoint.popupText] becomes the info-window body.
 */
fun projectMarkerCluster(
    points: List<ClusterPoint>,
    defaultSeverity: MapMarkerSeverity = MapMarkerSeverity.Active,
): MarkerClusterProjection {
    val capped = points.take(MAX_RENDERED_POINTS)
    val cappedOverflow = (points.size - capped.size).coerceAtLeast(0)
    val markers = ArrayList<MapMarker>(capped.size)
    val byId = LinkedHashMap<String, ClusterPoint>(capped.size)
    var skipped = 0
    for (point in capped) {
        val geo = GeoPoint(point.lat, point.lng)
        if (!geo.isValid()) {
            skipped++
            continue
        }
        markers +=
            MapMarker(
                id = point.id,
                point = geo,
                title = point.ariaLabel?.trim()?.ifBlank { null },
                snippet = point.popupText?.trim()?.ifBlank { null },
                severity = point.severity ?: defaultSeverity,
                headingDegrees = null,
            )
        byId[point.id] = point
    }
    return MarkerClusterProjection(
        markers = markers,
        pointsById = byId,
        suppliedCount = points.size,
        skippedInvalidCount = skipped,
        cappedOverflowCount = cappedOverflow,
    )
}

/**
 * The screen-reader list alternative for the opaque map: one line per rendered marker — its [MapMarker.title]
 * (the web `ariaLabel`) when present, else its rounded coordinate — bounded to [MAX_SUMMARY_LINES]. Pure +
 * locale-stable (coordinates use [Locale.ROOT]) so the digest is covered off-device.
 */
fun markerClusterSummaryLines(projection: MarkerClusterProjection): List<String> =
    projection.markers
        .asSequence()
        .take(MAX_SUMMARY_LINES)
        .map { marker -> marker.title?.trim()?.ifBlank { null } ?: formatGeoLabel(marker.point) }
        .toList()

/** `lat, lng` fixed to [COORD_DECIMALS] places with a '.' decimal regardless of the device locale. */
private fun formatGeoLabel(point: GeoPoint): String =
    String.format(Locale.ROOT, "%.${COORD_DECIMALS}f, %.${COORD_DECIMALS}f", point.lat, point.lng)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a
 * coordinate, label, or count — so a diagnostics line can never leak where a vehicle has been.
 */
object MarkerClusterDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = "MarkerCluster"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
