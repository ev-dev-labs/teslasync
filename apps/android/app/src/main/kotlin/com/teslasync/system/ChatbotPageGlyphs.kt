// Self-contained line-style icon set for the ChatbotPage surface, drawn as Material [ImageVector]s.
//
// The web page uses three `lucide-react` glyphs the shared TeslaGlyphs set does not ship: `Send` (the input's
// send affordance), `Square` (the stop-streaming affordance), and `History` (the sidebar toggle). Android ships
// no lucide-equivalent set without the frozen `material-icons-extended` artifact, so — exactly as the sibling
// SuggestedPrompts surface authors its `Sparkles` glyph — the three glyphs this page needs are authored here as
// 24×24 stroked vectors. Each is monochrome (drawn in opaque black) and recolored at render time by the shared
// [io.teslasync.android.components.ui.Icon] / [Button] `tint`, so it inherits its container's content color in
// every theme/state automatically.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) cannot form
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyphs the ChatbotPage surface renders. */
internal object ChatbotPageGlyphs {
    /**
     * lucide `send` — the input's send affordance: a paper-plane (the outline polygon plus the inner fold
     * line), pointing up-right.
     */
    val Send: ImageVector =
        stroked("Send") {
            // Outline polygon: tip (22,2) -> bottom (15,22) -> waist (11,13) -> tail (2,9) -> close.
            moveTo(22f, 2f)
            lineTo(15f, 22f)
            lineTo(11f, 13f)
            lineTo(2f, 9f)
            close()
            // Inner fold line from the tip to the waist.
            moveTo(22f, 2f)
            lineTo(11f, 13f)
        }

    /** lucide `square` — the stop-streaming affordance: a centered square. */
    val Stop: ImageVector =
        stroked("Stop") {
            moveTo(5f, 5f)
            lineTo(19f, 5f)
            lineTo(19f, 19f)
            lineTo(5f, 19f)
            close()
        }

    /**
     * lucide `history` — the sidebar toggle: a clock face (circle + hour/minute hands) with a small
     * counter-clockwise rewind arrowhead at the upper-left, suggesting "recent / history".
     */
    val History: ImageVector =
        stroked("History") {
            circle(cx = 12f, cy = 12.5f, r = 7f)
            // Hands: 12 o'clock (up) and ~3 o'clock (right).
            moveTo(12f, 12.5f)
            lineTo(12f, 8.5f)
            moveTo(12f, 12.5f)
            lineTo(15.5f, 12.5f)
            // Counter-clockwise rewind arrowhead at the upper-left of the dial.
            moveTo(5.4f, 8.2f)
            lineTo(5.0f, 5.4f)
            moveTo(5.4f, 8.2f)
            lineTo(8.2f, 7.8f)
        }
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

/**
 * Traces a full circle of radius [r] centered at ([cx], [cy]) as two relative half-arcs from the leftmost
 * point — the dependency-free way to draw a clock face without bespoke trigonometry.
 */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcToRelative(r, r, 0f, isMoreThanHalf = true, isPositiveArc = true, 2 * r, 0f)
    arcToRelative(r, r, 0f, isMoreThanHalf = true, isPositiveArc = true, -2 * r, 0f)
    close()
}
