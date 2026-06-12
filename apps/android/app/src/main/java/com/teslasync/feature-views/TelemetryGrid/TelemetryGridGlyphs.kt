// Self-contained line-style icon set for the TelemetryGrid surface, drawn as Material [ImageVector]s.
//
// The web component uses six `lucide-react` glyphs (Battery, Gauge, Thermometer, Navigation, BatteryCharging,
// Eye). Four already exist in the shared sets and are reused verbatim — `DataDisplayGlyphs.Battery`,
// `DataDisplayGlyphs.Gauge`, `DataDisplayGlyphs.BatteryCharging`, and `TeslaGlyphs.Eye` — so only the two the
// shared sets do not carry are authored here. Android ships no lucide-equivalent set without the frozen
// `material-icons-extended` artifact, so — exactly as the sibling glyph sets do for their lucide ports — the
// Thermometer and Navigation glyphs are authored as 24×24 stroked vectors faithful to the lucide paths. Each
// is monochrome (drawn in opaque black) and recolored at render time by the [Icon] composable's `tint`, so
// they inherit the muted-foreground color the tile's label row computes.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TelemetryGrid) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.telemetrygrid

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The two lucide-equivalent glyphs the TelemetryGrid tiles render that the shared sets do not carry. */
internal object TelemetryGridGlyphs {
    /** lucide `thermometer` — Inside/Outside temperature: a capped tube over a bulb with a mercury line. */
    val Thermometer: ImageVector =
        stroked("Thermometer") {
            moveTo(10.5f, 13f)
            lineTo(10.5f, 5f)
            arcTo(1.5f, 1.5f, 0f, false, true, 13.5f, 5f)
            lineTo(13.5f, 13f)
            circle(12f, 16.5f, 3.2f)
            moveTo(12f, 9f)
            lineTo(12f, 15f)
        }

    /** lucide `navigation` — Odometer: the paper-plane direction arrow. */
    val Navigation: ImageVector =
        stroked("Navigation") {
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

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}
