// Self-contained line-style icon set for the MotorEfficiencyInsights surface, drawn as Material
// [ImageVector]s.
//
// The web component uses `lucide-react` glyphs (Zap, Gauge, Thermometer, Activity) that the shared
// `TeslaGlyphs` / `DataDisplayGlyphs` sets do not carry, and Android ships no lucide-equivalent set without
// the frozen `material-icons-extended` artifact. So — exactly as the sibling LiveMotorStatus /
// DrivingTemperatureStats surfaces do for their lucide ports — the four this surface needs are authored here
// as 24×24 stroked vectors. Each is monochrome (drawn in opaque black) and recolored at render time by the
// [io.teslasync.android.components.ui.Icon] composable's `tint`, so they inherit the accent each panel
// computes (the web `text-blue-400` / `text-cyan-400` / `text-amber-400` and the empty-state muted tint).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/MotorEfficiencyInsights) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.motorefficiencyinsights

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyphs the MotorEfficiencyInsights panels render. */
internal object MotorEfficiencyInsightsGlyphs {
    /** lucide `zap` — the Torque Distribution title: a lightning bolt. */
    val Zap: ImageVector =
        stroked("Zap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** lucide `gauge` — the Throttle Behavior title: a speedometer arc with a needle. */
    val Gauge: ImageVector =
        stroked("Gauge") {
            moveTo(4f, 18f)
            curveTo(4f, 10f, 20f, 10f, 20f, 18f)
            moveTo(12f, 18f)
            lineTo(15.5f, 11.5f)
        }

    /** lucide `thermometer` — the Motor Thermal title: a stem over a rounded bulb. */
    val Thermometer: ImageVector =
        stroked("Thermometer") {
            moveTo(12f, 4f)
            lineTo(12f, 14f)
            circle(12f, 17f, 2.5f)
        }

    /** lucide `activity` — the empty-state glyph: a single ECG-style pulse line. */
    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
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

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs (the thermometer bulb). */
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
