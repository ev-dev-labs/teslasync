// Self-contained line-style icon set for the LiveMotorStatus surface, drawn as Material [ImageVector]s.
//
// The web component uses `lucide-react` glyphs (Cog, Activity, Thermometer, Shield, Zap) that the shared
// `TeslaGlyphs` / `DataDisplayGlyphs` sets do not carry, and Android ships no lucide-equivalent set without
// the frozen `material-icons-extended` artifact. So — exactly as the sibling LiveVehicleState /
// DrivingTemperatureStats surfaces do for their lucide ports — the five this surface needs are authored here
// as 24×24 stroked vectors. Each is monochrome (drawn in opaque black) and recolored at render time by the
// [io.teslasync.android.components.ui.Icon] composable's `tint`, so they inherit the accent each cell
// computes (the web `text-{color}-400` / dynamic HV-isolation color).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveMotorStatus) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livemotorstatus

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyphs the LiveMotorStatus cells render. */
internal object LiveMotorStatusGlyphs {
    /** lucide `cog` — the panel title: a toothed gear around a center hub. */
    val Cog: ImageVector =
        stroked("Cog") {
            circle(12f, 12f, 3f)
            tooth(18f, 12f, 20.5f, 12f)
            tooth(16.24f, 16.24f, 18.01f, 18.01f)
            tooth(12f, 18f, 12f, 20.5f)
            tooth(7.76f, 16.24f, 5.99f, 18.01f)
            tooth(6f, 12f, 3.5f, 12f)
            tooth(7.76f, 7.76f, 5.99f, 5.99f)
            tooth(12f, 6f, 12f, 3.5f)
            tooth(16.24f, 7.76f, 18.01f, 5.99f)
        }

    /** lucide `activity` — the axle-speed metrics: a single ECG-style pulse line. */
    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    /** lucide `thermometer` — the temperature metrics: a stem over a rounded bulb. */
    val Thermometer: ImageVector =
        stroked("Thermometer") {
            moveTo(12f, 4f)
            lineTo(12f, 14f)
            circle(12f, 17f, 2.5f)
        }

    /** lucide `shield` — the HV-isolation metric: a crest that tapers to a point. */
    val Shield: ImageVector =
        stroked("Shield") {
            moveTo(12f, 3f)
            lineTo(19f, 5.5f)
            lineTo(19f, 12f)
            lineTo(12f, 21f)
            lineTo(5f, 12f)
            lineTo(5f, 5.5f)
            close()
        }

    /** lucide `zap` — the torque metrics: a lightning bolt. */
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

/** A single gear tooth: a short radial segment from ([innerX], [innerY]) out to ([outerX], [outerY]). */
private fun PathBuilder.tooth(
    innerX: Float,
    innerY: Float,
    outerX: Float,
    outerY: Float,
) {
    moveTo(innerX, innerY)
    lineTo(outerX, outerY)
}

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
