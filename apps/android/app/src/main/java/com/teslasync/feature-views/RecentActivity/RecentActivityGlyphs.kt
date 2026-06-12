// Line-style icon set for the RecentActivity surface, drawn as a Material [ImageVector].
//
// The web component (vehicles/RecentActivity.tsx) uses five `lucide-react` glyphs — Route / Zap / Clock /
// BatteryCharging / ChevronRight. The shared sets already carry the other four (datadisplay carries Zap
// (Bolt), Clock and BatteryCharging; ui carries ChevronRight via TeslaGlyphs), so only Route — which both
// the drives panel title and each drive row marker use — is authored here as a 24x24 stroked vector in the
// same monochrome style as the sibling glyph sets. Android has no bundled lucide equivalent without the
// frozen `material-icons-extended` artifact, so authoring it keeps the surface dependency-free. It is
// recolored at render time by the `Icon` composable's `tint` (or the enclosing `IconBox` content color), so
// it inherits the panel/marker accent.
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
 * The single RecentActivity glyph the shared sets do not carry, mapped 1:1 onto its web lucide icon. Both
 * the drives panel title and each drive activity-row marker reuse [Route]; charges reuse the shared Bolt
 * (Zap) + BatteryCharging, and the "View all" links reuse the shared ChevronRight.
 */
object RecentActivityGlyphs {
    /** Two waypoints joined by a path — web lucide `Route`, the drive panel title + row marker. */
    val Route: ImageVector =
        stroked("Route") {
            circle(6f, 18.5f, 2.5f)
            moveTo(6f, 16f)
            curveTo(6f, 11.5f, 18f, 12.5f, 18f, 8f)
            circle(18f, 5.5f, 2.5f)
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
