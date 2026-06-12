// Locally-authored 24×24 stroked icons for the Reset-to-defaults surface, drawn as Material [ImageVector]s.
// The web component (web/src/features/settings/components/ResetSection.tsx) uses eleven `lucide-react` glyphs:
// the per-section row icons (`Cog`, `Palette`, `Bell`, `MapPin`, `LayoutDashboard`, `Workflow`, `Calendar`),
// the panel headers (`RotateCcw`, `Shield`, `AlertOctagon`), and the deny-row marker (`AlertTriangle`).
// Android ships no lucide set and feature views may not expand the shared icon library from a surface prompt
// (allowed-files), so each is authored here as a monochrome round-capped stroked vector in the same style as
// the sibling surfaces — recolored at render time by `Icon`'s `tint`. All are decorative (the surrounding
// title / button label carries the meaning), so each is rendered with a `null` content description.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ResetSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.resetsection

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The eleven icons the surface renders, ported in the lucide style. Each is a 24×24 round-capped stroked
 * vector so it inherits the Material 3 content color in every theme; each is decorative and rendered with a
 * `null` content description at its call site.
 */
object ResetSectionGlyphs {
    /** lucide `RotateCcw` — a counter-clockwise circular arrow (the "Reset" affordances + the by-section header). */
    val RotateCcw: ImageVector =
        stroked("RotateCcw") {
            moveTo(3f, 12f)
            arcTo(9f, 9f, 0f, true, false, 12f, 3f)
            arcTo(9.75f, 9.75f, 0f, false, false, 5.26f, 5.74f)
            lineTo(3f, 8f)
            moveTo(3f, 3f)
            lineTo(3f, 8f)
            lineTo(8f, 8f)
        }

    /** lucide `Shield` — a shield silhouette (the deny-list panel header). */
    val Shield: ImageVector =
        stroked("Shield") {
            moveTo(20f, 13f)
            curveTo(20f, 18f, 16.5f, 20.5f, 12.34f, 21.95f)
            arcTo(1f, 1f, 0f, false, true, 11.67f, 21.94f)
            curveTo(7.5f, 20.5f, 4f, 18f, 4f, 13f)
            lineTo(4f, 6f)
            arcTo(1f, 1f, 0f, false, true, 5f, 5f)
            curveTo(7f, 5f, 9.5f, 3.8f, 11.24f, 2.28f)
            arcTo(1.17f, 1.17f, 0f, false, true, 12.76f, 2.28f)
            curveTo(14.51f, 3.81f, 17f, 5f, 19f, 5f)
            arcTo(1f, 1f, 0f, false, true, 20f, 6f)
            close()
        }

    /** lucide `AlertOctagon` — an octagon enclosing an exclamation (the Danger-zone header). */
    val AlertOctagon: ImageVector =
        stroked("AlertOctagon") {
            moveTo(7.86f, 2f)
            lineTo(16.14f, 2f)
            lineTo(22f, 7.86f)
            lineTo(22f, 16.14f)
            lineTo(16.14f, 22f)
            lineTo(7.86f, 22f)
            lineTo(2f, 16.14f)
            lineTo(2f, 7.86f)
            close()
            moveTo(12f, 8f)
            lineTo(12f, 12f)
            moveTo(12f, 16f)
            lineTo(12.01f, 16f)
        }

    /** lucide `AlertTriangle` — a triangle enclosing an exclamation (the deny-row marker). */
    val AlertTriangle: ImageVector =
        stroked("AlertTriangle") {
            moveTo(12f, 3f)
            lineTo(22f, 20f)
            lineTo(2f, 20f)
            close()
            moveTo(12f, 9f)
            lineTo(12f, 13f)
            moveTo(12f, 17f)
            lineTo(12.01f, 17f)
        }

    /** lucide `Cog` — a gear (the "General preferences" row). Authored as a hub + eight radial teeth. */
    val Cog: ImageVector =
        stroked("Cog") {
            moveTo(15f, 12f)
            arcTo(3f, 3f, 0f, false, true, 9f, 12f)
            arcTo(3f, 3f, 0f, false, true, 15f, 12f)
            close()
            tooth(18f, 12f, 21.5f, 12f)
            tooth(16.24f, 16.24f, 18.72f, 18.72f)
            tooth(12f, 18f, 12f, 21.5f)
            tooth(7.76f, 16.24f, 5.28f, 18.72f)
            tooth(6f, 12f, 2.5f, 12f)
            tooth(7.76f, 7.76f, 5.28f, 5.28f)
            tooth(12f, 6f, 12f, 2.5f)
            tooth(16.24f, 7.76f, 18.72f, 5.28f)
        }

    /** lucide `Palette` — a paint palette (the "Appearance" row). Authored as a disc with four paint wells. */
    val Palette: ImageVector =
        stroked("Palette") {
            moveTo(22f, 12f)
            arcTo(10f, 10f, 0f, true, true, 2f, 12f)
            arcTo(10f, 10f, 0f, true, true, 22f, 12f)
            close()
            dot(8.5f, 8f)
            dot(15.5f, 8f)
            dot(6.5f, 12.5f)
            dot(17.5f, 12.5f)
        }

    /** lucide `Bell` — a notification bell (the "Alert rules" + "Notification channels" rows). */
    val Bell: ImageVector =
        stroked("Bell") {
            moveTo(6f, 8f)
            arcTo(6f, 6f, 0f, false, true, 18f, 8f)
            curveTo(18f, 15f, 21f, 17f, 21f, 17f)
            lineTo(3f, 17f)
            curveTo(3f, 17f, 6f, 15f, 6f, 8f)
            close()
            moveTo(10.3f, 21f)
            arcTo(1.94f, 1.94f, 0f, false, false, 13.7f, 21f)
        }

    /** lucide `MapPin` — a location teardrop (the "Geofences" row). */
    val MapPin: ImageVector =
        stroked("MapPin") {
            moveTo(20f, 10f)
            curveTo(20f, 16f, 12f, 22f, 12f, 22f)
            curveTo(12f, 16f, 4f, 16f, 4f, 10f)
            arcTo(8f, 8f, 0f, false, true, 20f, 10f)
            close()
            moveTo(15f, 10f)
            arcTo(3f, 3f, 0f, false, true, 9f, 10f)
            arcTo(3f, 3f, 0f, false, true, 15f, 10f)
            close()
        }

    /** lucide `LayoutDashboard` — four panes (the "Dashboard layouts" row). */
    val LayoutDashboard: ImageVector =
        stroked("LayoutDashboard") {
            box(3f, 3f, 10f, 12f)
            box(14f, 3f, 21f, 8f)
            box(14f, 12f, 21f, 21f)
            box(3f, 16f, 10f, 21f)
        }

    /** lucide `Workflow` — two linked nodes (the "Automations" row). */
    val Workflow: ImageVector =
        stroked("Workflow") {
            box(3f, 3f, 11f, 11f)
            moveTo(7f, 11f)
            lineTo(7f, 15f)
            arcTo(2f, 2f, 0f, false, false, 9f, 17f)
            lineTo(13f, 17f)
            box(13f, 13f, 21f, 21f)
        }

    /** lucide `Calendar` — a calendar grid (the "Quiet hours" row). */
    val Calendar: ImageVector =
        stroked("Calendar") {
            moveTo(8f, 2f)
            lineTo(8f, 6f)
            moveTo(16f, 2f)
            lineTo(16f, 6f)
            box(3f, 4f, 21f, 22f)
            moveTo(3f, 10f)
            lineTo(21f, 10f)
        }

    /** A round-capped near-zero-length segment that renders as a dot at ([x], [y]) (exclamation / paint well). */
    private fun PathBuilder.dot(
        x: Float,
        y: Float,
    ) {
        moveTo(x, y)
        lineTo(x + 0.1f, y)
    }

    /** A straight tooth/spoke segment from ([x1], [y1]) to ([x2], [y2]) (the gear teeth). */
    private fun PathBuilder.tooth(
        x1: Float,
        y1: Float,
        x2: Float,
        y2: Float,
    ) {
        moveTo(x1, y1)
        lineTo(x2, y2)
    }

    /** A rectangle from the top-left ([left], [top]) to the bottom-right ([right], [bottom]) as four lines. */
    private fun PathBuilder.box(
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

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = GLYPH_SIZE,
                defaultHeight = GLYPH_SIZE,
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
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
