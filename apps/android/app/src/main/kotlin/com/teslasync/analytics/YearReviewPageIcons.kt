// Locally-authored stroked vector glyphs for the YearReviewPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/analytics/pages/YearReviewPage.tsx imports X, ChevronLeft,
// ChevronRight). The shared icon catalogs ship no close / chevron glyph (Android has no bundled lucide set
// without the frozen material-icons-extended artifact), so they are authored here as 24×24 stroked vectors and
// recolored at render via the Icon `tint`, exactly as the sibling page surfaces (LifetimeStatsPageIcons /
// YearReviewWidget) author the glyphs the shared sets do not provide.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.yearreview

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val STROKE_WIDTH = 2f

/** Build a 24×24 stroked glyph; the stroke color is replaced by the Icon `tint` at render. */
private fun strokedGlyph(
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
                strokeLineWidth = STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** The three glyphs the full-screen story chrome needs (web `X` / `ChevronLeft` / `ChevronRight`). */
object YearReviewPageGlyphs {
    /** Close cross — web `X` (the top-end close affordance). */
    val Close: ImageVector =
        strokedGlyph("YearReviewClose") {
            moveTo(6f, 6f)
            lineTo(18f, 18f)
            moveTo(18f, 6f)
            lineTo(6f, 18f)
        }

    /** Left chevron — web `ChevronLeft` (the previous-slide arrow). */
    val ChevronLeft: ImageVector =
        strokedGlyph("YearReviewChevronLeft") {
            moveTo(15f, 6f)
            lineTo(9f, 12f)
            lineTo(15f, 18f)
        }

    /** Right chevron — web `ChevronRight` (the next-slide arrow). */
    val ChevronRight: ImageVector =
        strokedGlyph("YearReviewChevronRight") {
            moveTo(9f, 6f)
            lineTo(15f, 12f)
            lineTo(9f, 18f)
        }
}
