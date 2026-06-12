// Line-style icon set for the RecentActivity surface, drawn as Material [ImageVector]s.
//
// The web component (dashboard/RecentActivity.tsx) uses six `lucide-react` glyphs — Activity / Route / Zap /
// Clock / BatteryCharging / TrendingUp. The shared `datadisplay.DataDisplayGlyphs` set already carries Zap
// (Bolt), Clock and BatteryCharging, so only the three the shared sets lack are authored here as 24x24
// stroked vectors in the same monochrome style as the sibling glyph sets (EventTimelineGlyphs /
// AutomationActivityFeedGlyphs). Android has no bundled lucide equivalent without the frozen
// `material-icons-extended` artifact, so authoring them keeps the surface dependency-free. Each is recolored
// at render time by the `Icon` composable's `tint`, so it inherits the panel/marker accent.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/RecentActivity) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.recentactivity

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The three RecentActivity glyphs the shared sets do not carry, mapped 1:1 onto their web lucide icons. The
 * activity-feed rows reuse [Route] (drive) and the shared Bolt (charge); the panel titles use [Activity],
 * the shared BatteryCharging, and [TrendingUp].
 */
object RecentActivityGlyphs {
    /** Heartbeat pulse line — web lucide `Activity`, the activity-feed panel title icon. */
    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    /** Two waypoints joined by a path — web lucide `Route`, the drive activity-row marker. */
    val Route: ImageVector =
        stroked("Route") {
            circle(6f, 18.5f, 2.5f)
            moveTo(6f, 16f)
            curveTo(6f, 11.5f, 18f, 12.5f, 18f, 8f)
            circle(18f, 5.5f, 2.5f)
        }

    /** Up-and-to-the-right trend arrow — web lucide `TrendingUp`, the fleet-performance panel title icon. */
    val TrendingUp: ImageVector =
        stroked("TrendingUp") {
            moveTo(22f, 7f)
            lineTo(13.5f, 15.5f)
            lineTo(8.5f, 10.5f)
            lineTo(2f, 17f)
            moveTo(16f, 7f)
            lineTo(22f, 7f)
            lineTo(22f, 13f)
        }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

/** A full circle of radius [r] centred at ([cx], [cy]), drawn as two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = cx + r, y1 = cy)
    arcTo(r, r, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = cx - r, y1 = cy)
    close()
}
