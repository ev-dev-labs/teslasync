// Self-contained line glyph for the BatteryRangePanel surface, drawn as a Material [ImageVector].
//
// The web component uses three `lucide-react` glyphs: `Navigation` (Rated Range), `MapPin` (Ideal Range), and
// `BatteryCharging` (Charging). The latter two are carried by the shared `DataDisplayGlyphs` set and are
// reused directly; `Navigation` has no shared-set equivalent and Android ships no lucide-equivalent without
// the frozen `material-icons-extended` artifact, so — exactly as the sibling surfaces do for their lucide
// ports — it is authored here as a 24×24 stroked vector faithful to the lucide path. It is monochrome (drawn
// in opaque black) and recolored at render time by the [io.teslasync.android.components.ui.Icon] composable's
// `tint`, so it inherits the card's accent color.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BatteryRangePanel) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batteryrangepanel

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE_WIDTH = 2f

/** The single lucide-equivalent glyph the BatteryRangePanel needs that the shared set does not carry. */
internal object BatteryRangePanelGlyphs {
    /**
     * lucide `navigation` — the Rated Range card icon: the navigation arrow / paper-plane polygon
     * `3,11 → 22,2 → 13,21 → 11,13 → 3,11` (the exact lucide points), drawn as a closed stroked path.
     */
    val Navigation: ImageVector =
        stroked("BatteryRangeNavigation") {
            moveTo(3f, 11f)
            lineTo(22f, 2f)
            lineTo(13f, 21f)
            lineTo(11f, 13f)
            close()
        }
}

private fun stroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_VIEWPORT.dp,
            defaultHeight = GLYPH_VIEWPORT.dp,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()
