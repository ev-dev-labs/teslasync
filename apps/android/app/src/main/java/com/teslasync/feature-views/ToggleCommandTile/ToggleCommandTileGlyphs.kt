// Locally-authored 24×24 star glyphs for the ToggleCommandTile surface — the Android stand-in for the web
// `lucide-react` `Star` the favourite toggle renders (outline normally, `fill-current` when favourited).
// Android ships no lucide equivalent without pulling the frozen `material-icons-extended` artifact, and the
// shared io.teslasync.android.components.ui.TeslaGlyphs catalog (which is outside this surface's allowed-files
// scope) carries no star — so, exactly as the sibling CommandTile / InputCommandTile surfaces author their own
// lucide ports, this surface authors its own monochrome [ImageVector]s (recolored at render time by the shared
// `IconButton` tint). Keeping them here makes the surface self-contained within its directory.
//
// Both glyphs trace the same five-point star; [Outline] is stroked (the unselected outline) and [Filled] is
// filled (the web `fill-current` selected state). The path is the canonical feather/lucide `star` polygon,
// round-joined to match the lucide stroke style.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ToggleCommandTile) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.togglecommandtile

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The two star glyphs the favourite toggle references — the native analogue of the single web `Star` whose
 * `fill-current` is conditionally applied. Both share identical geometry; only the fill differs, so the
 * favourite/not-favourite states read as the same star, hollow or filled. Each is decorative (the toggle button
 * carries an explicit "Toggle favorite" accessibility label), so it is rendered with a `null` content
 * description at the call site.
 */
object ToggleCommandTileGlyphs {
    /** lucide `Star`, hollow — the not-a-favourite state (web `Star` without `fill-current`). */
    val Outline: ImageVector = star(name = "ToggleCommandTileStarOutline", filled = false)

    /** lucide `Star`, solid — the favourite state (web `Star` with `fill-current`). */
    val Filled: ImageVector = star(name = "ToggleCommandTileStarFilled", filled = true)
}

/** The canonical 5-point star polygon (feather/lucide `star` points), closed. */
private fun PathBuilder.starPath() {
    moveTo(12f, 2f)
    lineTo(15.09f, 8.26f)
    lineTo(22f, 9.27f)
    lineTo(17f, 14.14f)
    lineTo(18.18f, 21.02f)
    lineTo(12f, 17.77f)
    lineTo(5.82f, 21.02f)
    lineTo(7f, 14.14f)
    lineTo(2f, 9.27f)
    lineTo(8.91f, 8.26f)
    close()
}

/**
 * Builds the 24×24 round-joined star [ImageVector]. When [filled] the interior is painted (the web selected
 * `fill-current` state); otherwise it is drawn as a round-capped stroked outline so it inherits the Material 3
 * content color in every theme/state via the render-time tint.
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
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = { starPath() },
            )
        }.build()

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
