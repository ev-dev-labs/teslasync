// Locally-authored 24×24 stroked icons for the BackgroundWorkersCard surface — the Android stand-ins for the
// web `lucide-react` glyphs the card uses (`Boxes` for a worker-type group, `Server` for a host instance,
// `Activity` for the API-logs link). Android ships no lucide-equivalent set without the frozen
// `material-icons-extended` artifact, so the surface authors its own monochrome [ImageVector]s (recolored at
// render time by the shared `Icon` composable's `tint`) — the same approach the sibling ClientUtilitiesSection
// and AlertStudioPage surfaces use. `AlertTriangle` (the per-instance error glyph) is reused from the shared
// [io.teslasync.android.components.datadisplay.DataDisplayGlyphs] set to avoid duplication.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BackgroundWorkersCard) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path, exactly as the model + composable files in this surface do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.backgroundworkerscard

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The icon set the BackgroundWorkersCard references — one recognizable, monochrome glyph per role, authored as
 * 24×24 round-capped stroked vectors so they inherit the Material 3 content color in every theme. Purely
 * decorative (the adjacent text carries the meaning), so each is rendered with a `null` content description at
 * the call site.
 */
object WorkersGlyphs {
    /** lucide `Boxes` — a 2×2 cluster of boxes, marking a worker-type group header. */
    val Boxes: ImageVector =
        glyph("Boxes") {
            rect(4f, 4f, 10f, 10f)
            rect(14f, 4f, 20f, 10f)
            rect(4f, 14f, 10f, 20f)
            rect(14f, 14f, 20f, 20f)
        }

    /** lucide `Server` — two stacked rack units, each with a status LED, marking a host instance row. */
    val Server: ImageVector =
        glyph("Server") {
            rect(4f, 4f, 20f, 10f)
            rect(4f, 14f, 20f, 20f)
            dot(7.5f, 7f)
            dot(7.5f, 17f)
        }

    /** lucide `Activity` — a heart-rate pulse line, marking the API-logs link. */
    val Activity: ImageVector =
        glyph("Activity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 5f)
            lineTo(14f, 19f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
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

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.rect(
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

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
