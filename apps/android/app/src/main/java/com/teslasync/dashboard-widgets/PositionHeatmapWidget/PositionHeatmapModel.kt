// Pure, framework-free model + projection for the Position Heatmap dashboard widget — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/PositionHeatmapWidget.tsx): the grid-based density
// `clusterPositions`, the `centroid` map center, the `intensityColor` cool→hot ramp, and the
// per-footprint circle radius / fill-opacity. No Compose, no Android, no HTTP: every type here is
// unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render
// layer. Latitude/longitude are WGS-84 degrees and are NOT unit-converted (like the sibling
// LocationMapWidget, this surface carries no UnitPref — it is a pure spatial-density visualization).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/PositionHeatmapWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path — exactly as the sibling LocationMapWidget /
// GeofenceWidget do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.positionheatmap

import io.teslasync.android.components.maps.GeoPoint
import kotlin.math.roundToInt

/**
 * One GPS reading narrowed to the two fields the heatmap renders — the native mirror of the web
 * `Position` rows `useVehiclePositions` returns (`{ latitude, longitude, … }`). Values are WGS-84
 * degrees as they arrive from `GET /vehicles/{id}/positions`; they are never converted.
 */
data class HeatPosition(
    val latitude: Double,
    val longitude: Double,
) {
    /**
     * True when the reading is a real fix — the web clustering skip (`if (p.latitude === 0 &&
     * p.longitude === 0) continue`). A `0,0` reading is excluded from the density grid (it would smear
     * a phantom cluster off the coast of Africa) but is still counted in the badge total, exactly as
     * the web does (`totalPositions = safePositions.length`).
     */
    val isRenderable: Boolean get() = latitude != 0.0 || longitude != 0.0
}

/**
 * One density bucket after clustering — the native mirror of the web `ClusterPoint` (`{ lat, lon,
 * count, intensity }`). [latitude]/[longitude] are the running-average centroid of the bucket's
 * members; [intensity] is the bucket count normalised to the busiest bucket (`count / maxCount`), in
 * `0..1`.
 */
data class ClusterPoint(
    val latitude: Double,
    val longitude: Double,
    val count: Int,
    val intensity: Double,
)

/** The cool→hot RGB ramp value for an intensity (web `intensityColor`'s `r`/`g`/`b` channels). */
data class HeatColor(
    val red: Int,
    val green: Int,
    val blue: Int,
)

/**
 * A fully render-ready density blob for one footprint — a [ClusterPoint] folded together with the
 * web `CircleMarker` `radius` + `fillColor` + `fillOpacity` for the active layout. Framework-free
 * primitives (no Compose `Color`/`Dp`) so the colour ramp + radius + opacity math is unit-tested
 * off-device; the composable converts these to a `Color` + `Dp` marker at the render boundary.
 *
 * @property radiusDp the circle radius in dp — the web pixel radius reproduced 1:1 (Leaflet
 *   `CircleMarker` radius is screen-space pixels, constant across zoom, so dp is the faithful unit).
 * @property red the cool→hot ramp red channel (web `intensityColor`).
 * @property green the cool→hot ramp green channel.
 * @property blue the cool→hot ramp blue channel.
 * @property fillAlpha the effective fill opacity actually painted — the product of the web
 *   `intensityColor` rgba alpha (`0.35 + i*0.55`) and the `CircleMarker` `fillOpacity`, because
 *   Leaflet renders an SVG `fill` whose own alpha multiplies with `fill-opacity` in the browser.
 */
data class HeatCluster(
    val latitude: Double,
    val longitude: Double,
    val count: Int,
    val intensity: Double,
    val radiusDp: Float,
    val red: Int,
    val green: Int,
    val blue: Int,
    val fillAlpha: Float,
)

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact` / `isWide` branches in the web source: a single column uses the coarse grid + the
 * smallest circles and hides the title chrome; three+ columns use the finest circles + the highest
 * zoom and reveal the "{n} positions" count badge.
 */
data class PositionHeatmapSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): coarse grid, smallest circles, no title. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three+ columns (web `isWide = size.cols >= 3`): largest circles, highest zoom, count badge. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    companion object {
        private const val COMPACT_MAX_COLS = 1
        private const val WIDE_MIN_COLS = 3

        /** Registry default footprint (2×4). */
        val Default: PositionHeatmapSize = PositionHeatmapSize(cols = 2, rows = 4)

        /** Registry minimum footprint (2×4). */
        val MinSize: PositionHeatmapSize = PositionHeatmapSize(cols = 2, rows = 4)

        /** Registry maximum footprint (4×40). */
        val MaxSize: PositionHeatmapSize = PositionHeatmapSize(cols = 4, rows = 40)

        /** True when [size] falls within the inclusive min/max footprint constraints. */
        fun withinBounds(size: PositionHeatmapSize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: PositionHeatmapSize): PositionHeatmapSize =
            PositionHeatmapSize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/maps.ts (`position-heatmap`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object PositionHeatmapRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "position-heatmap"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "maps"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "PositionHeatmapWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize: PositionHeatmapSize get() = PositionHeatmapSize.Default

    /** Minimum footprint: 2 columns × 4 rows. */
    val minSize: PositionHeatmapSize get() = PositionHeatmapSize.MinSize

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: PositionHeatmapSize get() = PositionHeatmapSize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: PositionHeatmapSize): Boolean = PositionHeatmapSize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: PositionHeatmapSize): PositionHeatmapSize = PositionHeatmapSize.clamp(size)
}

/**
 * The localized strings the projection folds into its output, resolved from the P1/S10 i18n catalog
 * at the Compose boundary (`stringResource`) and passed in so [PositionHeatmapProjection.project]
 * stays pure and JVM-testable. The three keys mirror the web `t('widget.positionHeatmap.*')` calls
 * verbatim; [countLabel] applies the `'{{count}} positions'` interpolation (Android
 * `%1$s positions`).
 */
data class PositionHeatmapStrings(
    val title: String,
    val noData: String,
    val countLabel: (Int) -> String,
)

/**
 * The fully projected, render-ready view of one positions response for one footprint — the native
 * analogue of everything the web component computes before returning JSX (the `clusterPositions`
 * density blobs, the `centroid` map center, the `isCompact`/`isWide` zoom + circle sizing, the
 * `isEmpty` gate, and the `{n} positions` badge). Pure data so the projection is unit-tested without
 * a UI host.
 *
 * @property hasData whether any renderable density blob resolved (web `!isEmpty`, i.e.
 *   `clusters.length > 0`); `false` surfaces the "No position data" empty map.
 * @property clusters the render-ready density blobs (web `clusters.map(<CircleMarker/>)`).
 * @property center the map center (web `centroid(clusters)`).
 * @property zoom the map zoom level (web `isWide ? 12 : 11`, compact `11`).
 * @property totalPositions every parsed reading incl. `0,0` (web `safePositions.length`) — the badge count.
 * @property showTitle whether the title + icon header chrome renders (web non-compact branch).
 * @property showBadge whether the "{n} positions" badge renders (web `isWide && totalPositions > 0`).
 * @property countText the localized "{n} positions" badge label.
 * @property mapContentDescription the TalkBack name announced for the opaque map node, so a
 *   screen-reader user hears the surface + density summary the visible map conveys.
 */
data class PositionHeatmapDisplay(
    val isCompact: Boolean,
    val isWide: Boolean,
    val hasData: Boolean,
    val clusters: List<HeatCluster>,
    val center: GeoPoint,
    val zoom: Float,
    val totalPositions: Int,
    val showTitle: Boolean,
    val showBadge: Boolean,
    val title: String,
    val countText: String,
    val noDataText: String,
    val mapContentDescription: String,
)

/**
 * Pure projection from a decoded list of [HeatPosition] (+ footprint) to the [PositionHeatmapDisplay]
 * — the native port of the web component's `clusterPositions` / `centroid` / `isCompact` / `isWide`
 * derivations and the `CircleMarker` `radius` + `intensityColor` + `fillOpacity` per-blob styling.
 * Coordinates are never unit-converted; the cool→hot colour ramp and the count are reproduced exactly.
 */
object PositionHeatmapProjection {
    /** Coarse density grid for the single-column compact footprint (web `200`). */
    const val COMPACT_PRECISION: Int = 200

    /** Fine density grid for the standard / wide footprints (web `500`). */
    const val STANDARD_PRECISION: Int = 500

    /** Map zoom for the compact + standard footprints (web `11`). */
    const val STANDARD_ZOOM: Float = 11f

    /** Map zoom for the wide footprint (web `12`). */
    const val WIDE_ZOOM: Float = 12f

    /** Centroid fallback latitude when there are no clusters (web `37.7749` — San Francisco). */
    const val FALLBACK_LATITUDE: Double = 37.7749

    /** Centroid fallback longitude when there are no clusters (web `-122.4194` — San Francisco). */
    const val FALLBACK_LONGITUDE: Double = -122.4194

    // Circle radius ramp (web `radius`): base + intensity * scale, in dp (== Leaflet screen pixels).
    private const val COMPACT_RADIUS_BASE = 4f
    private const val COMPACT_RADIUS_SCALE = 6f
    private const val STANDARD_RADIUS_BASE = 6f
    private const val STANDARD_RADIUS_SCALE = 10f
    private const val WIDE_RADIUS_SCALE = 14f

    // Fill-opacity ramp (web `pathOptions.fillOpacity`): base + intensity * scale.
    private const val COMPACT_FILL_BASE = 0.4f
    private const val COMPACT_FILL_SCALE = 0.5f
    private const val STANDARD_FILL_BASE = 0.35f
    private const val STANDARD_FILL_SCALE = 0.55f

    // Cool→hot colour ramp (web `intensityColor`): channel = base + intensity * scale, rounded.
    private const val RED_BASE = 20.0
    private const val RED_SCALE = 225.0
    private const val GREEN_BASE = 184.0
    private const val GREEN_SCALE = 120.0
    private const val BLUE_BASE = 166.0
    private const val BLUE_SCALE = 60.0

    // Colour alpha baked into the web rgba string (`0.35 + i*0.55`); multiplies with fillOpacity.
    private const val COLOR_ALPHA_BASE = 0.35f
    private const val COLOR_ALPHA_SCALE = 0.55f

    /**
     * Project [positions] for [size] using [strings] for every localized string. An empty list — or a
     * list whose every reading is `0,0` — yields no clusters and surfaces the "No position data" empty
     * map (web `isEmpty = clusters.length === 0`), while the badge still counts every parsed reading.
     */
    fun project(
        positions: List<HeatPosition>,
        size: PositionHeatmapSize,
        strings: PositionHeatmapStrings,
    ): PositionHeatmapDisplay {
        val isCompact = size.isCompact
        val isWide = size.isWide
        val precision = if (isCompact) COMPACT_PRECISION else STANDARD_PRECISION
        val points = clusterPositions(positions, precision)
        val clusters = points.map { styleCluster(it, isCompact, isWide) }
        val totalPositions = positions.size
        val hasData = clusters.isNotEmpty()
        val countText = strings.countLabel(totalPositions)

        return PositionHeatmapDisplay(
            isCompact = isCompact,
            isWide = isWide,
            hasData = hasData,
            clusters = clusters,
            center = centroid(points),
            zoom = if (isWide) WIDE_ZOOM else STANDARD_ZOOM,
            totalPositions = totalPositions,
            // web: the compact `WidgetShell` passes no title; the standard / wide shell shows the title.
            showTitle = !isCompact,
            // web: `actions={isWide && totalPositions > 0 ? <Badge>…</Badge> : undefined}`.
            showBadge = isWide && totalPositions > 0,
            title = strings.title,
            countText = countText,
            noDataText = strings.noData,
            mapContentDescription = if (hasData) "${strings.title}, $countText" else strings.noData,
        )
    }

    /**
     * Grid-based density clustering — the verbatim native port of the web `clusterPositions`: bucket
     * by rounded `lat*precision` / `lon*precision` (truncated toward zero, matching JS `| 0`), keep a
     * running-average centroid + count per bucket, then normalise each count to the busiest bucket.
     * Insertion order is preserved (a [LinkedHashMap]) so the centroid + marker order match the web's
     * `Map` iteration order. `0,0` readings are skipped (web `continue`).
     */
    fun clusterPositions(
        positions: List<HeatPosition>,
        precision: Int,
    ): List<ClusterPoint> {
        val buckets = LinkedHashMap<String, MutableBucket>()
        for (p in positions) {
            if (!p.isRenderable) continue
            val key = "${(p.latitude * precision).toInt()}:${(p.longitude * precision).toInt()}"
            val existing = buckets[key]
            if (existing != null) {
                existing.latitude = (existing.latitude * existing.count + p.latitude) / (existing.count + 1)
                existing.longitude = (existing.longitude * existing.count + p.longitude) / (existing.count + 1)
                existing.count += 1
            } else {
                buckets[key] = MutableBucket(p.latitude, p.longitude, 1)
            }
        }
        var maxCount = 1
        for (b in buckets.values) {
            if (b.count > maxCount) maxCount = b.count
        }
        return buckets.values.map { b ->
            ClusterPoint(
                latitude = b.latitude,
                longitude = b.longitude,
                count = b.count,
                // web `b.count / maxCount` float division; `1.0 *` promotes to Double (avoids Int division).
                intensity = 1.0 * b.count / maxCount,
            )
        }
    }

    /**
     * The mean of the cluster centroids — the native port of the web `centroid`. Falls back to San
     * Francisco ([FALLBACK_LATITUDE] / [FALLBACK_LONGITUDE]) when there are no clusters, so the empty
     * map still has a sane camera (web `if (points.length === 0) return [37.7749, -122.4194]`).
     */
    fun centroid(points: List<ClusterPoint>): GeoPoint {
        if (points.isEmpty()) return GeoPoint(FALLBACK_LATITUDE, FALLBACK_LONGITUDE)
        var latSum = 0.0
        var lonSum = 0.0
        for (p in points) {
            latSum += p.latitude
            lonSum += p.longitude
        }
        return GeoPoint(latSum / points.size, lonSum / points.size)
    }

    /**
     * Map an intensity (`0..1`) onto the web `intensityColor` cool-cyan→hot-magenta RGB ramp, each
     * channel rounded like JS `Math.round` (ties toward positive infinity, which [roundToInt] matches).
     */
    fun intensityColor(intensity: Double): HeatColor =
        HeatColor(
            red = (RED_BASE + intensity * RED_SCALE).roundToInt(),
            green = (GREEN_BASE - intensity * GREEN_SCALE).roundToInt(),
            blue = (BLUE_BASE + intensity * BLUE_SCALE).roundToInt(),
        )

    /** Fold a [ClusterPoint] into a render-ready [HeatCluster] for the active footprint. */
    private fun styleCluster(
        point: ClusterPoint,
        isCompact: Boolean,
        isWide: Boolean,
    ): HeatCluster {
        val intensity = point.intensity
        val color = intensityColor(intensity)
        val radiusDp =
            when {
                isCompact -> COMPACT_RADIUS_BASE + intensity.toFloat() * COMPACT_RADIUS_SCALE
                isWide -> STANDARD_RADIUS_BASE + intensity.toFloat() * WIDE_RADIUS_SCALE
                else -> STANDARD_RADIUS_BASE + intensity.toFloat() * STANDARD_RADIUS_SCALE
            }
        val fillOpacity =
            if (isCompact) {
                COMPACT_FILL_BASE + intensity.toFloat() * COMPACT_FILL_SCALE
            } else {
                STANDARD_FILL_BASE + intensity.toFloat() * STANDARD_FILL_SCALE
            }
        val colorAlpha = COLOR_ALPHA_BASE + intensity.toFloat() * COLOR_ALPHA_SCALE
        return HeatCluster(
            latitude = point.latitude,
            longitude = point.longitude,
            count = point.count,
            intensity = intensity,
            radiusDp = radiusDp,
            red = color.red,
            green = color.green,
            blue = color.blue,
            // Leaflet paints an SVG `fill` (rgba alpha) AND `fill-opacity`; the browser multiplies them.
            fillAlpha = (colorAlpha * fillOpacity).coerceIn(0f, 1f),
        )
    }
}

/** Mutable running-average accumulator used only inside [PositionHeatmapProjection.clusterPositions]. */
private class MutableBucket(
    var latitude: Double,
    var longitude: Double,
    var count: Int,
)
