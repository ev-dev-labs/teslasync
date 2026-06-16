// Locally-authored stroked vector glyphs for the RoadmapPage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/system/pages/RoadmapPage.tsx imports Rocket, CheckCircle, Clock, Star,
// Zap, Bell, Smartphone, Cloud, Brain, Plug, Shield, Map, BarChart3, Leaf, Globe, Wrench, Users). The shared icon
// catalog (TeslaGlyphs) ships none of these page glyphs and editing it is outside this surface's allowed files, so
// they are authored here as 24×24 monochrome stroked vectors and recolored at render via the `Icon` tint — exactly
// the approach the sibling A7 page surfaces document (CommandsPageIcons, GlancePageIcons, BatteryHealthPageIcons).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.roadmap

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
 * The glyph set this surface needs (the web RoadmapPage lucide icons). Each is a monochrome 24×24 stroked vector
 * recolored by the `Icon` tint at the render boundary, so it inherits every theme/state color automatically. The
 * per-item icons, the four phase header glyphs, and the three feature-bullet glyphs the web page uses are all here.
 */
object RoadmapGlyphs {
    /** Rocket — web `Rocket` (Core Platform card + the "Future" phase header). Pointed body, window, fins, flame. */
    val Rocket: ImageVector =
        strokedGlyph("RoadmapRocket") {
            moveTo(9f, 15f)
            lineTo(9f, 10f)
            curveTo(9f, 6f, 12f, 2.5f, 12f, 2.5f)
            curveTo(12f, 2.5f, 15f, 6f, 15f, 10f)
            lineTo(15f, 15f)
            close()
            glyphCircle(12f, 9.5f, 1.5f)
            moveTo(9f, 13f)
            lineTo(6.5f, 15.5f)
            lineTo(9f, 15.5f)
            moveTo(15f, 13f)
            lineTo(17.5f, 15.5f)
            lineTo(15f, 15.5f)
            moveTo(10.5f, 16f)
            lineTo(12f, 19f)
            lineTo(13.5f, 16f)
        }

    /** Check-in-circle — web `CheckCircle` (the "done" feature bullet + the "Completed" phase header). */
    val CheckCircle: ImageVector =
        strokedGlyph("RoadmapCheckCircle") {
            glyphCircle(12f, 12f, 9f)
            moveTo(8f, 12f)
            lineTo(11f, 15f)
            lineTo(16f, 9f)
        }

    /** Clock — web `Clock` (the default feature bullet for not-yet-shipped phases). Clock face + hands. */
    val Clock: ImageVector =
        strokedGlyph("RoadmapClock") {
            glyphCircle(12f, 12f, 9f)
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(15.5f, 13.5f)
        }

    /** Star — web `Star` (Premium UI + Enhanced Visualization cards, and the "Up Next" phase header). */
    val Star: ImageVector =
        strokedGlyph("RoadmapStar") {
            moveTo(12f, 3f)
            lineTo(14.3f, 9.2f)
            lineTo(20.8f, 9.4f)
            lineTo(15.6f, 13.4f)
            lineTo(17.5f, 19.7f)
            lineTo(12f, 15.9f)
            lineTo(6.5f, 19.7f)
            lineTo(8.4f, 13.4f)
            lineTo(3.2f, 9.4f)
            lineTo(9.7f, 9.2f)
            close()
        }

    /** Lightning bolt — web `Zap` (Fleet Telemetry card, the "current" feature bullet, and "In Progress" header). */
    val Zap: ImageVector =
        strokedGlyph("RoadmapZap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** Bell — web `Bell` (Smart Notifications card). Dome body, clapper rim, and the swing tongue. */
    val Bell: ImageVector =
        strokedGlyph("RoadmapBell") {
            moveTo(6f, 16f)
            lineTo(6f, 11f)
            curveTo(6f, 7.7f, 8.7f, 5f, 12f, 5f)
            curveTo(15.3f, 5f, 18f, 7.7f, 18f, 11f)
            lineTo(18f, 16f)
            lineTo(20f, 18f)
            lineTo(4f, 18f)
            close()
            moveTo(10f, 18f)
            curveTo(10f, 19.1f, 10.9f, 20f, 12f, 20f)
            curveTo(13.1f, 20f, 14f, 19.1f, 14f, 18f)
        }

    /** Smartphone — web `Smartphone` (Mobile App card). Handset body with a home indicator. */
    val Smartphone: ImageVector =
        strokedGlyph("RoadmapSmartphone") {
            moveTo(7.5f, 2.5f)
            lineTo(16.5f, 2.5f)
            lineTo(16.5f, 21.5f)
            lineTo(7.5f, 21.5f)
            close()
            moveTo(10.5f, 18.5f)
            lineTo(13.5f, 18.5f)
        }

    /** Cloud — web `Cloud` (Enterprise & Scale card). A single rounded cumulus outline. */
    val Cloud: ImageVector =
        strokedGlyph("RoadmapCloud") {
            moveTo(7.5f, 18f)
            lineTo(16.5f, 18f)
            curveTo(19f, 18f, 20f, 14.5f, 17.5f, 13.2f)
            curveTo(17.7f, 9.5f, 12.5f, 8f, 10.5f, 11f)
            curveTo(7.5f, 9.5f, 4.5f, 12f, 6f, 15f)
            curveTo(4.5f, 15.8f, 5.2f, 18f, 7.5f, 18f)
            close()
        }

    /** Brain — web `Brain` (Intelligence + Helix cards). Two mirrored lobes meeting at a central seam. */
    val Brain: ImageVector =
        strokedGlyph("RoadmapBrain") {
            moveTo(12f, 6f)
            curveTo(12f, 4.5f, 10f, 3.5f, 8.5f, 4.5f)
            curveTo(6.5f, 4.2f, 5f, 6f, 5.8f, 7.8f)
            curveTo(4f, 8.8f, 4.2f, 11.5f, 6f, 12.2f)
            curveTo(5.2f, 14f, 6.5f, 16f, 8.5f, 15.8f)
            curveTo(9.2f, 17.5f, 12f, 17.2f, 12f, 15.5f)
            lineTo(12f, 6f)
            moveTo(12f, 6f)
            curveTo(12f, 4.5f, 14f, 3.5f, 15.5f, 4.5f)
            curveTo(17.5f, 4.2f, 19f, 6f, 18.2f, 7.8f)
            curveTo(20f, 8.8f, 19.8f, 11.5f, 18f, 12.2f)
            curveTo(18.8f, 14f, 17.5f, 16f, 15.5f, 15.8f)
            curveTo(14.8f, 17.5f, 12f, 17.2f, 12f, 15.5f)
        }

    /** Plug — web `Plug` (External Integrations card). Two prongs, a rounded body, and a cord. */
    val Plug: ImageVector =
        strokedGlyph("RoadmapPlug") {
            moveTo(9f, 7f)
            lineTo(9f, 2.5f)
            moveTo(15f, 7f)
            lineTo(15f, 2.5f)
            moveTo(7f, 7f)
            lineTo(17f, 7f)
            lineTo(17f, 12f)
            arcTo(5f, 5f, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = 7f, y1 = 12f)
            close()
            moveTo(12f, 17f)
            lineTo(12f, 21.5f)
        }

    /** Shield — web `Shield` (Security & Privacy card). Crested shield outline. */
    val Shield: ImageVector =
        strokedGlyph("RoadmapShield") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 12f)
            curveTo(19f, 16f, 16f, 19.5f, 12f, 21f)
            curveTo(8f, 19.5f, 5f, 16f, 5f, 12f)
            lineTo(5f, 6f)
            close()
        }

    /** Folded map — web `Map` (Smart Routing & Navigation card). Three panels with two fold creases. */
    val Map: ImageVector =
        strokedGlyph("RoadmapMap") {
            moveTo(3f, 6f)
            lineTo(9f, 4f)
            lineTo(15f, 6f)
            lineTo(21f, 4f)
            lineTo(21f, 18f)
            lineTo(15f, 20f)
            lineTo(9f, 18f)
            lineTo(3f, 20f)
            close()
            moveTo(9f, 4f)
            lineTo(9f, 18f)
            moveTo(15f, 6f)
            lineTo(15f, 20f)
        }

    /** Bar chart — web `BarChart3` (Advanced Fleet Intelligence card). Axes plus three columns. */
    val BarChart3: ImageVector =
        strokedGlyph("RoadmapBarChart3") {
            moveTo(3f, 3f)
            lineTo(3f, 21f)
            lineTo(21f, 21f)
            moveTo(8f, 17f)
            lineTo(8f, 13f)
            moveTo(13f, 17f)
            lineTo(13f, 5f)
            moveTo(18f, 17f)
            lineTo(18f, 9f)
        }

    /** Leaf — web `Leaf` (Smart Home & EV Ecosystem card). A leaf blade with a midrib. */
    val Leaf: ImageVector =
        strokedGlyph("RoadmapLeaf") {
            moveTo(4f, 20f)
            curveTo(4f, 11f, 11f, 4f, 20f, 4f)
            curveTo(20f, 13f, 13f, 20f, 4f, 20f)
            close()
            moveTo(4f, 20f)
            lineTo(14.5f, 9.5f)
        }

    /** Globe — web `Globe` (Global & Multi-Brand card). Sphere with an equator and a meridian. */
    val Globe: ImageVector =
        strokedGlyph("RoadmapGlobe") {
            moveTo(12f, 3f)
            arcTo(9f, 9f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 12f, y1 = 21f)
            arcTo(9f, 9f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 12f, y1 = 3f)
            moveTo(3f, 12f)
            lineTo(21f, 12f)
            moveTo(12f, 3f)
            arcTo(5f, 9f, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = 12f, y1 = 21f)
            arcTo(5f, 9f, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = 12f, y1 = 3f)
        }

    /** Wrench — web `Wrench` (Developer Platform card). Open-end spanner with a V-notch jaw. */
    val Wrench: ImageVector =
        strokedGlyph("RoadmapWrench") {
            moveTo(14.5f, 4f)
            curveTo(12f, 4f, 10f, 6f, 10f, 8.5f)
            curveTo(10f, 9.2f, 10.2f, 9.9f, 10.5f, 10.5f)
            lineTo(4f, 17f)
            curveTo(3.2f, 17.8f, 3.2f, 19.2f, 4f, 20f)
            curveTo(4.8f, 20.8f, 6.2f, 20.8f, 7f, 20f)
            lineTo(13.5f, 13.5f)
            curveTo(14.1f, 13.8f, 14.8f, 14f, 15.5f, 14f)
            curveTo(18f, 14f, 20f, 12f, 20f, 9.5f)
            curveTo(20f, 8.8f, 19.8f, 8.1f, 19.5f, 7.5f)
            lineTo(16.5f, 10.5f)
            lineTo(13.5f, 7.5f)
            lineTo(16.5f, 4.5f)
            curveTo(15.9f, 4.2f, 15.2f, 4f, 14.5f, 4f)
            close()
        }

    /** Users — web `Users` (Community & Social card). A foreground figure beside a partial second figure. */
    val Users: ImageVector =
        strokedGlyph("RoadmapUsers") {
            glyphCircle(9f, 7f, 3f)
            moveTo(3.5f, 20f)
            curveTo(3.5f, 16f, 6f, 14f, 9f, 14f)
            curveTo(12f, 14f, 14.5f, 16f, 14.5f, 20f)
            moveTo(15f, 4.2f)
            curveTo(16.8f, 4.6f, 18f, 6.2f, 18f, 8f)
            curveTo(18f, 9.8f, 16.8f, 11.4f, 15f, 11.8f)
            moveTo(17f, 14.2f)
            curveTo(19.2f, 14.8f, 20.5f, 16.8f, 20.5f, 20f)
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
