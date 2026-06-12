// Self-contained line-style icon set for the AutopilotSection surface, drawn as Material [ImageVector]s.
//
// The web component uses two `lucide-react` glyphs: `Gauge` (current speed) and `Navigation` (cruise set
// speed + follow distance). The current-speed tile reuses the shared `DataDisplayGlyphs.Gauge`, so only the
// `Navigation` pointer is authored here — Android ships no lucide-equivalent set without the frozen
// `material-icons-extended` artifact, so (exactly as the shared glyph sets do for their lucide ports) it is a
// 24×24 stroked vector. It is monochrome (drawn in opaque black) and recolored at render time by the `Icon`
// composable / `StatCard`'s leading-icon tint.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AutopilotSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.autopilotsection

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyphs the AutopilotSection tiles render (the current-speed tile reuses Gauge). */
internal object AutopilotSectionGlyphs {
    /** lucide `navigation` — cruise / follow distance: a navigation pointer triangle. */
    val Navigation: ImageVector =
        stroked("Navigation") {
            moveTo(3f, 11f)
            lineTo(22f, 2f)
            lineTo(13f, 21f)
            lineTo(11f, 13f)
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
