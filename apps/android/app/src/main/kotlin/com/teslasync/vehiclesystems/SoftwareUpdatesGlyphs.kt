// Co-located line-style glyphs for the SoftwareUpdatesPage vehicle-systems surface. The web page uses
// `lucide-react` icons (Smartphone for the current-version card + empty state, ArrowUpCircle for the
// "available" update status); Android ships no bundled lucide equivalent, so the two glyphs that the
// shared TeslaGlyphs / DataDisplayGlyphs / FeedbackGlyphs / FormsGlyphs sets do not already provide are
// authored here as 24×24 stroked vectors — the same approach as `components/datadisplay/DataDisplayGlyphs`.
// Each is monochrome and recolored at render time by the `Icon` composable's `tint`, so dark/dynamic theme
// and the per-status accent colours all flow through untouched.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems)
// diverges from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.softwareupdates

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** Bezier control fraction (kappa) used to approximate a circular quadrant with one cubic segment. */
private const val CIRCLE_KAPPA = 5.523f

/**
 * The two SoftwareUpdates-specific glyphs the shared icon sets don't already provide. Everything else the
 * page draws (CheckCircle, Download, Clock, Calendar, ExternalLink) is reused from the shared sets.
 */
object SoftwareUpdatesGlyphs {
    /** A phone outline + home dot — the web `Smartphone` icon (current-version card + the empty-state icon). */
    val Smartphone: ImageVector =
        stroked("Smartphone") {
            // Body
            moveTo(7f, 2f)
            lineTo(17f, 2f)
            lineTo(17f, 22f)
            lineTo(7f, 22f)
            close()
            // Home dot
            dot(12f, 18.5f)
        }

    /** A circle enclosing an up arrow — the web `ArrowUpCircle` icon (the "available" update status). */
    val ArrowUpCircle: ImageVector =
        stroked("ArrowUpCircle") {
            // Circle centred at (12,12) r=10, approximated with four cubic quadrants.
            moveTo(12f, 2f)
            curveTo(12f + CIRCLE_KAPPA, 2f, 22f, 12f - CIRCLE_KAPPA, 22f, 12f)
            curveTo(22f, 12f + CIRCLE_KAPPA, 12f + CIRCLE_KAPPA, 22f, 12f, 22f)
            curveTo(12f - CIRCLE_KAPPA, 22f, 2f, 12f + CIRCLE_KAPPA, 2f, 12f)
            curveTo(2f, 12f - CIRCLE_KAPPA, 12f - CIRCLE_KAPPA, 2f, 12f, 2f)
            // Up arrow
            moveTo(12f, 16f)
            lineTo(12f, 8f)
            moveTo(8f, 12f)
            lineTo(12f, 8f)
            lineTo(16f, 12f)
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

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}
