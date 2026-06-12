// Self-contained line-style icon set for the AppearanceSettings surface, drawn as Material [ImageVector]s.
//
// The web component uses ten `lucide-react` glyphs — Palette, CheckCircle, Rows3, PanelBottom, Trophy, Clock,
// Eye, PlayCircle, RotateCcw, Sidebar. Android ships no lucide-equivalent set without the frozen
// `material-icons-extended` artifact, so (exactly as the sibling surfaces do for their lucide ports) each is
// authored here as a 24×24 stroked vector built through the compile-checked [PathBuilder] DSL (never a
// runtime-parsed path string), monochrome (opaque black) and recolored at render time by the `Icon` tint.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AppearanceSettings) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.appearancesettings

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The lucide-equivalent glyphs the AppearanceSettings sections render. Each is a recognizable stroked
 * approximation in lucide's 24×24 / 2px-round style, sufficient for the decorative section markers the web
 * draws (every glyph is `aria-hidden` in the web source, so it carries no standalone meaning).
 */
internal object AppearanceSettingsGlyphs {
    /** lucide `palette` — a circular palette outline with three paint wells. */
    val Palette: ImageVector =
        stroked("Palette") {
            circleAt(12f, 12f, 9f)
            dotAt(9f, 8.5f)
            dotAt(15f, 8.5f)
            dotAt(16f, 13f)
        }

    /** lucide `check-circle` — a ring enclosing a check mark. */
    val CheckCircle: ImageVector =
        stroked("CheckCircle") {
            circleAt(12f, 12f, 9f)
            moveTo(8f, 12.5f)
            lineTo(11f, 15.5f)
            lineTo(16.5f, 9f)
        }

    /** lucide `rows-3` — a rounded card split into three stacked rows. */
    val Rows3: ImageVector =
        stroked("Rows3") {
            roundedRect()
            moveTo(3f, 9f)
            lineTo(21f, 9f)
            moveTo(3f, 15f)
            lineTo(21f, 15f)
        }

    /** lucide `panel-bottom` — a rounded card with a docked bottom strip. */
    val PanelBottom: ImageVector =
        stroked("PanelBottom") {
            roundedRect()
            moveTo(3f, 15f)
            lineTo(21f, 15f)
        }

    /** lucide `sidebar` — a rounded card with a left-docked rail. */
    val Sidebar: ImageVector =
        stroked("Sidebar") {
            roundedRect()
            moveTo(9f, 3f)
            lineTo(9f, 21f)
        }

    /** lucide `clock` — a ring with hour + minute hands. */
    val Clock: ImageVector =
        stroked("Clock") {
            circleAt(12f, 12f, 9f)
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }

    /** lucide `eye` — an almond eye outline with a pupil. */
    val Eye: ImageVector =
        stroked("Eye") {
            moveTo(2.5f, 12f)
            arcToRelative(11f, 7f, 0f, false, true, 19f, 0f)
            arcToRelative(11f, 7f, 0f, false, true, -19f, 0f)
            circleAt(12f, 12f, 3f)
        }

    /** lucide `play-circle` — a ring enclosing a play triangle. */
    val PlayCircle: ImageVector =
        stroked("PlayCircle") {
            circleAt(12f, 12f, 9f)
            moveTo(10f, 8f)
            lineTo(16f, 12f)
            lineTo(10f, 16f)
            close()
        }

    /** lucide `rotate-ccw` — a counter-clockwise refresh arc with an arrowhead. */
    val RotateCcw: ImageVector =
        stroked("RotateCcw") {
            moveTo(3f, 12f)
            arcToRelative(9f, 9f, 0f, true, false, 3f, -6.7f)
            lineTo(3f, 8f)
            moveTo(3f, 3f)
            lineTo(3f, 8f)
            lineTo(8f, 8f)
        }

    /** lucide `trophy` — a cup with two handles on a pedestal. */
    val Trophy: ImageVector =
        stroked("Trophy") {
            moveTo(7f, 4f)
            lineTo(17f, 4f)
            lineTo(17f, 9f)
            arcToRelative(5f, 5f, 0f, false, true, -10f, 0f)
            close()
            moveTo(7f, 5f)
            lineTo(4.5f, 5f)
            arcToRelative(2.2f, 2.2f, 0f, false, false, 0f, 4.4f)
            lineTo(7f, 9.4f)
            moveTo(17f, 5f)
            lineTo(19.5f, 5f)
            arcToRelative(2.2f, 2.2f, 0f, false, true, 0f, 4.4f)
            lineTo(17f, 9.4f)
            moveTo(12f, 14f)
            lineTo(12f, 18f)
            moveTo(8f, 20f)
            lineTo(16f, 20f)
            moveTo(9.5f, 20f)
            arcToRelative(2.5f, 2.5f, 0f, false, true, 2.5f, -2f)
            arcToRelative(2.5f, 2.5f, 0f, false, true, 2.5f, 2f)
        }

    /** Appends a full circle subpath centered at ([cx], [cy]) with radius [r], built from two semicircle arcs. */
    private fun PathBuilder.circleAt(
        cx: Float,
        cy: Float,
        r: Float,
    ) {
        moveTo(cx - r, cy)
        arcToRelative(r, r, 0f, false, true, 2f * r, 0f)
        arcToRelative(r, r, 0f, false, true, -2f * r, 0f)
        close()
    }

    /** Appends a tiny well/dot circle (radius 1) centered at ([cx], [cy]) — the palette's paint wells. */
    private fun PathBuilder.dotAt(
        cx: Float,
        cy: Float,
    ) = circleAt(cx, cy, 1f)

    /** Appends the lucide rounded card outline (x=3,y=3,18×18, ~2 corner radius). */
    private fun PathBuilder.roundedRect() {
        moveTo(5f, 3f)
        lineTo(19f, 3f)
        arcToRelative(2f, 2f, 0f, false, true, 2f, 2f)
        lineTo(21f, 19f)
        arcToRelative(2f, 2f, 0f, false, true, -2f, 2f)
        lineTo(5f, 21f)
        arcToRelative(2f, 2f, 0f, false, true, -2f, -2f)
        lineTo(3f, 5f)
        arcToRelative(2f, 2f, 0f, false, true, 2f, -2f)
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
