// Locally authored line-style glyphs for the five lucide icons the web `TABS` constant pairs with each
// dev-tools tab (web/src/features/admin/pages/DevToolsPage.tsx: Globe / Radio / Server / Wrench / BookOpen),
// drawn as 24x24 stroked [ImageVector]s and recolored at render time by the [TabNav] chip tint. None of the
// five live in the shared glyph catalogs (the ReferenceLinksSection surface already had to author
// Globe / Radio / BookOpen locally for the same reason, and the surface's allowed-files scope forbids
// editing the shared catalogs), so they are authored here as self-contained vectors — the same approach the
// shared glyph sets and the sibling surfaces take.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DevToolsPage) cannot form a valid Kotlin package identifier.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.devtoolspage

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The five tab glyphs, drawn line-style and recolored by the chip tint. Each mirrors the web lucide icon the
 * `TABS` array assigns to its tab: [Globe] (Fleet API), [Radio] (Telemetry), [Server] (Infrastructure),
 * [Wrench] (Utilities), [BookOpen] (Reference).
 */
internal object DevToolsPageIcons {
    /** Globe glyph (lucide `globe`) — the Fleet API tab. */
    val Globe: ImageVector =
        devToolsStroked("DevToolsGlobe") {
            devToolsCircle(12f, 12f, 9f)
            moveTo(3f, 12f)
            lineTo(21f, 12f)
            moveTo(12f, 3f)
            curveTo(7.5f, 7f, 7.5f, 17f, 12f, 21f)
            moveTo(12f, 3f)
            curveTo(16.5f, 7f, 16.5f, 17f, 12f, 21f)
        }

    /** Broadcast glyph (lucide `radio`) — the Telemetry tab. */
    val Radio: ImageVector =
        devToolsStroked("DevToolsRadio") {
            moveTo(4.9f, 19.1f)
            curveTo(1f, 15.2f, 1f, 8.8f, 4.9f, 4.9f)
            moveTo(7.8f, 16.2f)
            curveToRelative(-2.3f, -2.3f, -2.3f, -6.1f, 0f, -8.5f)
            moveTo(14f, 12f)
            arcToRelative(2f, 2f, 0f, true, true, -4f, 0f)
            arcToRelative(2f, 2f, 0f, true, true, 4f, 0f)
            close()
            moveTo(16.2f, 7.8f)
            curveToRelative(2.3f, 2.3f, 2.3f, 6.1f, 0f, 8.5f)
            moveTo(19.1f, 4.9f)
            curveTo(23f, 8.8f, 23f, 15.1f, 19.1f, 19f)
        }

    /** Stacked-server glyph (lucide `server`) — the Infrastructure tab. */
    val Server: ImageVector =
        devToolsStroked("DevToolsServer") {
            moveTo(4f, 4f)
            lineTo(20f, 4f)
            lineTo(20f, 10f)
            lineTo(4f, 10f)
            close()
            moveTo(4f, 14f)
            lineTo(20f, 14f)
            lineTo(20f, 20f)
            lineTo(4f, 20f)
            close()
            moveTo(7f, 7f)
            lineTo(7.5f, 7f)
            moveTo(7f, 17f)
            lineTo(7.5f, 17f)
        }

    /** Wrench glyph (lucide `wrench`) — the Utilities tab. */
    val Wrench: ImageVector =
        devToolsStroked("DevToolsWrench") {
            moveTo(14.7f, 6.3f)
            arcToRelative(1f, 1f, 0f, false, false, 0f, 1.4f)
            lineToRelative(1.6f, 1.6f)
            arcToRelative(1f, 1f, 0f, false, false, 1.4f, 0f)
            lineToRelative(3.77f, -3.77f)
            arcToRelative(6f, 6f, 0f, false, true, -7.94f, 7.94f)
            lineToRelative(-6.91f, 6.91f)
            arcToRelative(2.12f, 2.12f, 0f, false, true, -3f, -3f)
            lineToRelative(6.91f, -6.91f)
            arcToRelative(6f, 6f, 0f, false, true, 7.94f, -7.94f)
            close()
        }

    /** Open-book glyph (lucide `book-open`) — the Reference tab. */
    val BookOpen: ImageVector =
        devToolsStroked("DevToolsBookOpen") {
            moveTo(12f, 7f)
            lineTo(12f, 20f)
            moveTo(12f, 7f)
            curveTo(12f, 5.3f, 9f, 4.5f, 4f, 4.5f)
            lineTo(4f, 17f)
            curveTo(8.5f, 17f, 11f, 17.8f, 12f, 19f)
            moveTo(12f, 7f)
            curveTo(12f, 5.3f, 15f, 4.5f, 20f, 4.5f)
            lineTo(20f, 17f)
            curveTo(15.5f, 17f, 13f, 17.8f, 12f, 19f)
        }
}

/** Builds a 24x24 round-stroked [ImageVector] from the [build] path — recolored by the consuming tint. */
private fun devToolsStroked(
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

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.devToolsCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}
