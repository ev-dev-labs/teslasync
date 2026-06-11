// Locally-authored 24×24 stroked icons for the TimestampTool surface — the Android stand-ins for the two web
// `lucide-react` glyphs the tool uses (`Clock` and `Hash`). Android ships no lucide equivalent without pulling
// the frozen `material-icons-extended` artifact, so the surface authors its own monochrome [ImageVector]s
// (recolored at render time by the shared `Icon`'s `tint`) — the same approach the sibling ClientUtilitiesSection
// and ReferenceLinksSection surfaces take. Authoring them here keeps the surface self-contained within its
// allowed-files directory rather than coupling it to another feature's glyph set.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TimestampTool) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.timestamptool

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The two glyphs the TimestampTool references, authored as 24×24 round-capped stroked vectors so they inherit
 * the Material 3 content color in every theme. Both are decorative (the field labels and clock text carry the
 * meaning), so each is rendered with a `null` content description at the call site.
 */
object TimestampToolGlyphs {
    /** lucide `Clock` — a clock face with hour/minute hands (the card icon + the ISO input affordance). */
    val Clock: ImageVector =
        glyph("TimestampToolClock") {
            circle(12f, 12f, 9f)
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }

    /** lucide `Hash` — the `#` glyph (the unix-timestamp input affordance). */
    val Hash: ImageVector =
        glyph("TimestampToolHash") {
            moveTo(9f, 4f)
            lineTo(7f, 20f)
            moveTo(17f, 4f)
            lineTo(15f, 20f)
            moveTo(5f, 9f)
            lineTo(19f, 9f)
            moveTo(5f, 15f)
            lineTo(19f, 15f)
        }
}

/** Builds a standard 24×24 round-capped stroked [ImageVector] from a single [PathBuilder] program. */
private fun glyph(
    name: String,
    pathBuilder: PathBuilder.() -> Unit,
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
                pathBuilder = pathBuilder,
            )
        }.build()

/** Emits a full circle of radius [r] centered at ([cx], [cy]) as two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
