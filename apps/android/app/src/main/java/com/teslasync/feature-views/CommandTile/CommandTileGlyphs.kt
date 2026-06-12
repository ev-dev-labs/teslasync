// Locally-authored 24×24 star icons for the CommandTile surface — the Android stand-in for the web
// `lucide-react` `Star` glyph the favourite toggle renders. Android ships no lucide equivalent without pulling
// the frozen `material-icons-extended` artifact, so — exactly as the sibling AddWidgetButton / WeekSelector
// surfaces do for their lucide ports — the surface authors its own monochrome [ImageVector]s (recolored at
// render time by the shared `Icon` content color). Authoring them here keeps the surface self-contained within
// its allowed-files directory rather than coupling it to another feature's glyph set.
//
// The web tile draws one `Star` whose `fill-current` is toggled on when the command is a favourite
// (`<Star className={cn('h-3 w-3', isFavorite && 'fill-current')} />`). A Compose [ImageVector] bakes its
// fill/stroke at build time, so the toggle is reproduced as two vectors sharing identical path data: [Outline]
// (stroked only — the not-a-favourite state) and [Filled] (filled + stroked — the favourite state). Both are
// drawn in opaque black and recolored by the call-site `Icon` tint, so they inherit every theme/state color.
// The path is the canonical 5-point star polygon (the feather/lucide `star` points), round-joined to match the
// lucide stroke style.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/CommandTile) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.commandtile

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The two star glyphs the CommandTile favourite toggle references — the native analogue of the single web
 * `Star` whose `fill-current` is conditionally applied. Both share identical geometry; only the fill differs,
 * so the favourite/not-favourite states read as the same star, filled or hollow. Each is decorative (the toggle
 * button carries an explicit "Toggle favorite" accessibility label), so it is rendered with a `null` content
 * description at the call site.
 */
object CommandTileGlyphs {
    /** lucide `Star`, hollow — the not-a-favourite state (web `Star` without `fill-current`). */
    val Outline: ImageVector = star(name = "CommandTileStarOutline", filled = false)

    /** lucide `Star`, solid — the favourite state (web `Star` with `fill-current`). */
    val Filled: ImageVector = star(name = "CommandTileStarFilled", filled = true)
}

/** Builds the 24×24 round-joined star [ImageVector], optionally [filled] (favourite) as well as stroked. */
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

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
