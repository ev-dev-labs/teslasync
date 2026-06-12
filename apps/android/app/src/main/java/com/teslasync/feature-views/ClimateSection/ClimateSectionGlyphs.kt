// Self-contained line-style icon set for the ClimateSection surface, drawn as Material [ImageVector]s.
//
// The web component uses five `lucide-react` glyphs: `Wind` (the panel header + the Fan Speed tile),
// `Thermometer` (the three temperature tiles), `CircleDot` (the two seat-heater tiles), `Snowflake` (the
// Defrost tile) and `Flame` (the Climate On tile). Android ships no lucide-equivalent set without the frozen
// `material-icons-extended` artifact, so — exactly as the sibling feature-view surfaces do for their lucide
// ports — each is authored here as a 24×24 round-capped stroked vector faithful to the lucide shape. Each is
// monochrome (drawn in opaque black) and recolored at render time by the `Icon` composable / `MetricCard`'s
// leading-icon tint.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ClimateSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.climatesection

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyphs the ClimateSection header + tiles render. */
internal object ClimateSectionGlyphs {
    /** lucide `wind` — three horizontal air streams, each curling back into a hook (header + Fan Speed). */
    val Wind: ImageVector =
        stroked("ClimateSectionWind") {
            moveTo(2f, 8f)
            lineTo(11.2f, 8f)
            curveTo(13f, 8f, 13f, 4.4f, 10.5f, 4.4f)
            moveTo(2f, 12f)
            lineTo(18f, 12f)
            curveTo(20.5f, 12f, 20.5f, 7.5f, 17.5f, 7.5f)
            moveTo(2f, 16f)
            lineTo(13f, 16f)
            curveTo(15.2f, 16f, 15.2f, 19.6f, 12.8f, 19.6f)
        }

    /** lucide `thermometer` — a capped stem with a mercury bulb (the three temperature tiles). */
    val Thermometer: ImageVector =
        stroked("ClimateSectionThermometer") {
            moveTo(10.5f, 14.5f)
            lineTo(10.5f, 4f)
            curveTo(10.5f, 2f, 13.5f, 2f, 13.5f, 4f)
            lineTo(13.5f, 14.5f)
            moveTo(12f, 15f)
            curveTo(13.38f, 15f, 14.5f, 16.12f, 14.5f, 17.5f)
            curveTo(14.5f, 18.88f, 13.38f, 20f, 12f, 20f)
            curveTo(10.62f, 20f, 9.5f, 18.88f, 9.5f, 17.5f)
            curveTo(9.5f, 16.12f, 10.62f, 15f, 12f, 15f)
            close()
        }

    /** lucide `circle-dot` — an outer ring around a centre dot (the two seat-heater tiles). */
    val CircleDot: ImageVector =
        stroked("ClimateSectionCircleDot") {
            moveTo(12f, 2f)
            curveTo(17.52f, 2f, 22f, 6.48f, 22f, 12f)
            curveTo(22f, 17.52f, 17.52f, 22f, 12f, 22f)
            curveTo(6.48f, 22f, 2f, 17.52f, 2f, 12f)
            curveTo(2f, 6.48f, 6.48f, 2f, 12f, 2f)
            close()
            moveTo(12f, 11f)
            curveTo(12.55f, 11f, 13f, 11.45f, 13f, 12f)
            curveTo(13f, 12.55f, 12.55f, 13f, 12f, 13f)
            curveTo(11.45f, 13f, 11f, 12.55f, 11f, 12f)
            curveTo(11f, 11.45f, 11.45f, 11f, 12f, 11f)
            close()
        }

    /** lucide `snowflake` — two axes, two diagonals, and branch ticks (the Defrost tile). */
    val Snowflake: ImageVector =
        stroked("ClimateSectionSnowflake") {
            moveTo(2f, 12f)
            lineTo(22f, 12f)
            moveTo(12f, 2f)
            lineTo(12f, 22f)
            moveTo(5f, 5f)
            lineTo(19f, 19f)
            moveTo(19f, 5f)
            lineTo(5f, 19f)
            moveTo(12f, 5f)
            lineTo(9f, 8f)
            moveTo(12f, 5f)
            lineTo(15f, 8f)
            moveTo(12f, 19f)
            lineTo(9f, 16f)
            moveTo(12f, 19f)
            lineTo(15f, 16f)
            moveTo(5f, 12f)
            lineTo(8f, 9f)
            moveTo(5f, 12f)
            lineTo(8f, 15f)
            moveTo(19f, 12f)
            lineTo(16f, 9f)
            moveTo(19f, 12f)
            lineTo(16f, 15f)
        }

    /** lucide `flame` — a teardrop flame body with an inner curl (the Climate On tile). */
    val Flame: ImageVector =
        stroked("ClimateSectionFlame") {
            moveTo(12f, 2f)
            curveTo(15f, 7f, 19f, 9f, 19f, 14f)
            curveTo(19f, 17.87f, 15.87f, 21f, 12f, 21f)
            curveTo(8.13f, 21f, 5f, 17.87f, 5f, 14f)
            curveTo(5f, 11f, 7f, 9f, 8f, 7f)
            curveTo(8.5f, 9.5f, 9.5f, 10.5f, 11f, 11f)
            curveTo(12.5f, 9f, 12f, 5f, 12f, 2f)
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
