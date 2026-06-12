// The two line-style icons the WhyEndedPanel surface needs, drawn as Material [ImageVector]s.
//
// The web component (drive-detail/WhyEndedPanel.tsx) heads its two sections with the `lucide-react`
// `GitBranch` (FSM transitions) and `Radio` (signal window) glyphs (`<… className="h-4 w-4" />`). The shared
// `ui.TeslaGlyphs` / `datadisplay.DataDisplayGlyphs` sets carry neither, and Android has no bundled lucide
// equivalent without the frozen `material-icons-extended` artifact, so they are authored here as 24×24
// stroked vectors in the same monochrome style as the sibling surfaces' `*Glyphs` sets (e.g.
// DriveTimelineGlyphs). They are recolored at render time by the `Icon` composable's `tint`.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/WhyEndedPanel) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.whyendedpanel

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The two section-header glyphs, mapped 1:1 onto the web `lucide-react` `GitBranch` / `Radio` icons. */
object WhyEndedPanelGlyphs {
    /**
     * Branch fork — web lucide `GitBranch` (`<line x1=6 y1=3 x2=6 y2=15/>` trunk, `<circle cx=18 cy=6 r=3/>`
     * + `<circle cx=6 cy=18 r=3/>` nodes, `<path d="M18 9a9 9 0 0 1-9 9"/>` merge arc), on the 24px grid.
     */
    val GitBranch: ImageVector =
        stroked("GitBranch") {
            moveTo(6f, 3f)
            lineTo(6f, 15f)
            moveTo(18f, 9f)
            arcToRelative(9f, 9f, 0f, isMoreThanHalf = false, isPositiveArc = true, dx1 = -9f, dy1 = 9f)
            circle(18f, 6f, 3f)
            circle(6f, 18f, 3f)
        }

    /**
     * Broadcast waves around a hub — web lucide `Radio` (two cubic waves per side around `<circle cx=12
     * cy=12 r=2/>`), normalized to the 24px grid. The hub reads as the signal source; the arcs as emission.
     */
    val Radio: ImageVector =
        stroked("Radio") {
            moveTo(4.9f, 19.1f)
            curveTo(1f, 15.2f, 1f, 8.8f, 4.9f, 4.9f)
            moveTo(7.8f, 16.2f)
            curveToRelative(-2.3f, -2.3f, -2.3f, -6.1f, 0f, -8.5f)
            circle(12f, 12f, 2f)
            moveTo(16.2f, 7.8f)
            curveToRelative(2.3f, 2.3f, 2.3f, 6.1f, 0f, 8.5f)
            moveTo(19.1f, 4.9f)
            curveTo(23f, 8.8f, 23f, 15.1f, 19.1f, 19f)
        }

    /** Appends a full circle of radius [r] centered at ([cx], [cy]) as two semicircular arcs. */
    private fun PathBuilder.circle(
        cx: Float,
        cy: Float,
        r: Float,
    ) {
        moveTo(cx + r, cy)
        arcTo(r, r, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = cx - r, y1 = cy)
        arcTo(r, r, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = cx + r, y1 = cy)
        close()
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
