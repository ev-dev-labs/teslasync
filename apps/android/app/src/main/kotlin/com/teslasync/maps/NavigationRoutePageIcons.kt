// Locally-authored stroked vector glyphs for the NavigationRoutePage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/maps/pages/NavigationRoutePage.tsx imports Navigation, MapPin, Home,
// Briefcase, Satellite, Compass, Gauge, Clock, BatteryCharging, Route, Zap, AlertTriangle, RefreshCw, Activity,
// TrendingUp, TrafficCone, AlertCircle). The shared icon catalog ships only a subset of these, and editing it is outside
// this surface's allowed files, so the full set is authored here as 24×24 monochrome stroked vectors recolored at render
// via the `Icon` tint — exactly the approach the sibling A7 / feature-view ports (GlanceGlyphs, BatteryHealthPageIcons)
// document.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.maps.navigationroute

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/**
 * The glyph set this surface needs (the web NavigationRoutePage lucide icons). Each is a monochrome 24×24 stroked vector
 * recolored by the `Icon` tint at the render boundary, so it inherits every theme/state color automatically.
 */
object NavigationRouteGlyphs {
    /** Navigation paper-plane — web `Navigation` (the navigation-status panel header). */
    val Navigation: ImageVector =
        strokedGlyph("NavNavigation") {
            moveTo(3f, 11f)
            lineTo(21f, 3f)
            lineTo(13f, 21f)
            lineTo(11f, 13f)
            close()
        }

    /** Map pin — web `MapPin` (the current-location card + the destination waypoint). Teardrop + bore. */
    val MapPin: ImageVector =
        strokedGlyph("NavMapPin") {
            moveTo(20f, 10f)
            curveTo(20f, 16f, 12f, 22f, 12f, 22f)
            curveTo(12f, 22f, 4f, 16f, 4f, 10f)
            arcTo(8f, 8f, 0f, false, true, 20f, 10f)
            close()
            glyphCircle(12f, 10f, 3f)
        }

    /** House — web `Home` (the home-status card). Roof + body. */
    val Home: ImageVector =
        strokedGlyph("NavHome") {
            moveTo(3f, 11f)
            lineTo(12f, 3f)
            lineTo(21f, 11f)
            moveTo(5f, 9.5f)
            lineTo(5f, 20f)
            lineTo(19f, 20f)
            lineTo(19f, 9.5f)
        }

    /** Briefcase — web `Briefcase` (the work-status card). Body + handle. */
    val Briefcase: ImageVector =
        strokedGlyph("NavBriefcase") {
            glyphRect(3f, 8f, 21f, 20f)
            moveTo(9f, 8f)
            lineTo(9f, 5f)
            lineTo(15f, 5f)
            lineTo(15f, 8f)
        }

    /** Satellite dish — web `Satellite` (the GPS-fix-quality card). Dish + mast + feed. */
    val Satellite: ImageVector =
        strokedGlyph("NavSatellite") {
            moveTo(4f, 20f)
            arcTo(10f, 10f, 0f, false, true, 14f, 10f)
            lineTo(4f, 20f)
            close()
            moveTo(9f, 15f)
            lineTo(13f, 19f)
            moveTo(14f, 10f)
            lineTo(18f, 6f)
            glyphCircle(19f, 5f, 2f)
        }

    /** Compass — web `Compass` (the heading card + the location-history panel header). Ring + needle. */
    val Compass: ImageVector =
        strokedGlyph("NavCompass") {
            glyphCircle(12f, 12f, 9f)
            moveTo(15.5f, 8.5f)
            lineTo(11f, 11f)
            lineTo(8.5f, 15.5f)
            lineTo(13f, 13f)
            close()
        }

    /** Gauge — web `Gauge` (the avg-speed metric + the speed-profile chart header). Dial arc + needle. */
    val Gauge: ImageVector =
        strokedGlyph("NavGauge") {
            moveTo(4f, 17f)
            arcTo(8f, 8f, 0f, true, true, 20f, 17f)
            moveTo(12f, 15f)
            lineTo(16f, 9f)
        }

    /** Clock — web `Clock` (the ETA metric + the recent-destinations header). Ring + hands. */
    val Clock: ImageVector =
        strokedGlyph("NavClock") {
            glyphCircle(12f, 12f, 9f)
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }

    /** Battery + bolt — web `BatteryCharging` (the traffic-delay + energy-at-arrival metrics). Body + nub + bolt. */
    val BatteryCharging: ImageVector =
        strokedGlyph("NavBatteryCharging") {
            glyphRect(3f, 8f, 18f, 16f)
            moveTo(20.5f, 11f)
            lineTo(20.5f, 13f)
            moveTo(11f, 10f)
            lineTo(8.5f, 13f)
            lineTo(11.5f, 13f)
            lineTo(9f, 16f)
        }

    /** Route — web `Route` (the distance metric + a waypoint type). Start node, turn, end node. */
    val Route: ImageVector =
        strokedGlyph("NavRoute") {
            glyphCircle(6f, 19f, 2f)
            glyphCircle(18f, 6f, 2f)
            moveTo(6f, 17f)
            lineTo(6f, 12f)
            arcTo(3f, 3f, 0f, false, true, 9f, 9f)
            lineTo(16f, 9f)
        }

    /** Lightning bolt — web `Zap` (the route-waypoints header + the supercharger waypoint type). */
    val Zap: ImageVector =
        strokedGlyph("NavZap") {
            moveTo(13f, 2f)
            lineTo(4f, 14f)
            lineTo(11f, 14f)
            lineTo(9f, 22f)
            lineTo(20f, 10f)
            lineTo(13f, 10f)
            close()
        }

    /** Warning triangle — web `AlertTriangle` (the speed-profile empty state). Triangle + bang. */
    val AlertTriangle: ImageVector =
        strokedGlyph("NavAlertTriangle") {
            moveTo(12f, 3f)
            lineTo(22f, 20f)
            lineTo(2f, 20f)
            close()
            moveTo(12f, 9f)
            lineTo(12f, 14f)
            moveTo(12f, 17f)
            lineTo(12f, 17.01f)
        }

    /** Refresh arrows — web `RefreshCw` (the refresh action + the route-last-updated chip). Two looping arcs. */
    val RefreshCw: ImageVector =
        strokedGlyph("NavRefreshCw") {
            moveTo(20f, 12f)
            arcTo(8f, 8f, 0f, true, false, 17.5f, 17.7f)
            moveTo(20f, 7f)
            lineTo(20f, 12f)
            lineTo(15f, 12f)
        }

    /** Activity pulse — web `Activity` (the no-waypoints empty state). Heartbeat line. */
    val Activity: ImageVector =
        strokedGlyph("NavActivity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 5f)
            lineTo(14f, 19f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }

    /** Trend up — web `TrendingUp` (the presence-chart header). Rising line + arrowhead. */
    val TrendingUp: ImageVector =
        strokedGlyph("NavTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }

    /** Traffic cone — web `TrafficCone` (the route-traffic-delay header). Cone + base + stripe. */
    val TrafficCone: ImageVector =
        strokedGlyph("NavTrafficCone") {
            moveTo(9f, 20f)
            lineTo(12f, 4f)
            lineTo(15f, 20f)
            moveTo(6f, 20f)
            lineTo(18f, 20f)
            moveTo(10f, 13f)
            lineTo(14f, 13f)
        }

    /** Alert circle — web `AlertCircle` (the page-level error banner). Ring + bang. */
    val AlertCircle: ImageVector =
        strokedGlyph("NavAlertCircle") {
            glyphCircle(12f, 12f, 9f)
            moveTo(12f, 7f)
            lineTo(12f, 13f)
            moveTo(12f, 16f)
            lineTo(12f, 16.01f)
        }
}

/** Builds a 24×24 round-capped stroked [ImageVector]; the stroke color is replaced by the `Icon` tint at render. */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.glyphRect(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
) {
    moveTo(left, top)
    lineTo(right, top)
    lineTo(right, bottom)
    lineTo(left, bottom)
    close()
}

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.glyphCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}
