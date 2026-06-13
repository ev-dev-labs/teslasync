// Self-contained line-style icon set for the MotorSection surface, drawn as Material [ImageVector]s.
//
// The web component uses `lucide-react` glyphs (Cog, Settings, Battery, Zap, Activity, Gauge, Thermometer)
// that the shared `TeslaGlyphs` / `DataDisplayGlyphs` sets do not carry, and Android ships no lucide-equivalent
// set without the frozen `material-icons-extended` artifact. So — exactly as the sibling LiveMotorStatus /
// ChargingTelemetryWidget surfaces do for their lucide ports — the seven this surface needs are authored here
// as 24×24 stroked vectors. Each is monochrome (drawn in opaque black) and recolored at render time by the
// [io.teslasync.android.components.ui.Icon] composable's `tint` (the per-card accent the web expresses as
// `text-[var(--neon-cyan)]` for the header and the `MetricCard color` prop for each cell), so they inherit the
// accent each cell computes.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/MotorSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.motorsection

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyphs the MotorSection header + metric cards render. */
internal object MotorSectionGlyphs {
    /** lucide `cog` — the panel header: a toothed gear around a center hub (web `<Cog/>`). */
    val Cog: ImageVector =
        stroked("Cog") {
            gear()
        }

    /** lucide `settings` — the Shift State card: a gear (web `<Settings/>`, a cog with a center hub). */
    val Settings: ImageVector =
        stroked("Settings") {
            gear()
        }

    /** lucide `battery` — the Pack Voltage card: a horizontal cell body with a positive terminal nub. */
    val Battery: ImageVector =
        stroked("Battery") {
            moveTo(2f, 8f)
            lineTo(17f, 8f)
            lineTo(17f, 16f)
            lineTo(2f, 16f)
            close()
            moveTo(20f, 11f)
            lineTo(20f, 13f)
        }

    /** lucide `zap` — the Motor Current card: a lightning bolt. */
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

    /** lucide `activity` — the Torque cards: a single ECG-style pulse line. */
    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    /** lucide `gauge` — the RPM cards: a dial arc with a needle pointing up-right (web `<Gauge/>`). */
    val Gauge: ImageVector =
        stroked("Gauge") {
            moveTo(12f, 14f)
            lineTo(16f, 10f)
            moveTo(3.34f, 19f)
            arcTo(10f, 10f, 0f, true, true, 20.66f, 19f)
        }

    /** lucide `thermometer` — the Motor Temp card: a stem over a rounded bulb. */
    val Thermometer: ImageVector =
        stroked("Thermometer") {
            moveTo(12f, 4f)
            lineTo(12f, 14f)
            circle(12f, 17f, 2.5f)
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

/** A toothed gear: a center hub circled by eight short radial teeth — shared by [MotorSectionGlyphs.Cog] / `Settings`. */
private fun PathBuilder.gear() {
    circle(12f, 12f, 3f)
    tooth(12f, 6f, 12f, 3.5f)
    tooth(16.24f, 7.76f, 18.01f, 5.99f)
    tooth(18f, 12f, 20.5f, 12f)
    tooth(16.24f, 16.24f, 18.01f, 18.01f)
    tooth(12f, 18f, 12f, 20.5f)
    tooth(7.76f, 16.24f, 5.99f, 18.01f)
    tooth(6f, 12f, 3.5f, 12f)
    tooth(7.76f, 7.76f, 5.99f, 5.99f)
}

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
