// Locally-authored 24×24 star glyphs for the InputCommandTile surface — the Android stand-in for the web
// `lucide-react` `Star` the favorite toggle renders (outline normally, `fill-current` when favorited). Android
// ships no lucide equivalent without pulling the frozen `material-icons-extended` artifact, and the shared
// io.teslasync.android.components.ui.TeslaGlyphs catalog (which is outside this surface's allowed-files scope)
// carries no star — so, exactly as the sibling AddWidgetButton / AIRestorePanel surfaces author their own
// lucide ports, this surface authors its own monochrome [ImageVector]s (recolored at render time by the shared
// `Icon` / `IconButton` tint). Keeping them here makes the surface self-contained within its directory.
//
// Both glyphs trace the same five-point star; [Star] is stroked (the unselected outline) and [StarFilled] is
// filled (the web `fill-current` selected state). The path winds clockwise from the top point, alternating
// outer (radius 9) and inner (radius ~3.8) vertices about the 12,12 center.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/InputCommandTile) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.inputcommandtile

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The two star glyphs the favorite toggle references: the unselected [Star] outline and selected [StarFilled]. */
object InputCommandTileGlyphs {
    /** lucide `Star` outline — the unselected favorite affordance (stroked, transparent interior). */
    val Star: ImageVector = star(name = "InputCommandTileStar", filled = false)

    /** lucide `Star` filled — the selected favorite affordance (web `fill-current`). */
    val StarFilled: ImageVector = star(name = "InputCommandTileStarFilled", filled = true)
}

/** Traces the shared five-point star outline (clockwise from the top point) into [this] path builder. */
private fun PathBuilder.starOutline() {
    moveTo(12f, 3f)
    lineTo(14.23f, 8.93f)
    lineTo(20.56f, 9.22f)
    lineTo(15.61f, 13.17f)
    lineTo(17.29f, 19.28f)
    lineTo(12f, 15.8f)
    lineTo(6.71f, 19.28f)
    lineTo(8.39f, 13.17f)
    lineTo(3.44f, 9.22f)
    lineTo(9.77f, 8.93f)
    close()
}

/**
 * Builds a 24×24 star [ImageVector]. When [filled] the interior is painted (the web selected `fill-current`
 * state); otherwise it is drawn as a round-capped stroked outline so it inherits the Material 3 content color
 * in every theme/state via the render-time tint.
 */
private fun star(
    name: String,
    filled: Boolean,
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
                fill = if (filled) SolidColor(Color.Black) else null,
                stroke = if (filled) null else SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = { starOutline() },
            )
        }.build()

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
