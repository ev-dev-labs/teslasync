// Self-contained line-style icon set for the LiveVehicleState surface, drawn as Material [ImageVector]s.
//
// The web component uses `lucide-react` glyphs (Flashlight, Lightbulb, Signal, Armchair, Key, Car, Wrench,
// Home, Monitor, CircleDot) that the shared `TeslaGlyphs` / `DataDisplayGlyphs` sets do not carry, and
// Android ships no lucide-equivalent set without the frozen `material-icons-extended` artifact. So — exactly
// as the shared glyph sets do for their lucide ports — the ten this surface needs are authored here as 24×24
// stroked vectors. Each is monochrome (drawn in opaque black) and recolored at render time by the [Icon]
// composable's `tint`, so they inherit the active-accent / muted-foreground color the cell computes. The
// `speed_limit_mode` signal reuses the shared `DataDisplayGlyphs.Gauge`, so no Gauge is authored here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveVehicleState) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livevehiclestate

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyphs the LiveVehicleState cells render (one per [LiveSignalKey], minus Gauge). */
internal object LiveVehicleStateGlyphs {
    /** lucide `flashlight` — hazards: a torch head over a body with a button. */
    val Flashlight: ImageVector =
        stroked("Flashlight") {
            moveTo(8f, 3f)
            lineTo(16f, 3f)
            lineTo(14.5f, 8f)
            lineTo(9.5f, 8f)
            close()
            moveTo(9.5f, 8f)
            lineTo(9.5f, 20f)
            lineTo(14.5f, 20f)
            lineTo(14.5f, 8f)
            dot(12f, 12.5f)
        }

    /** lucide `lightbulb` — high beams: a bulb over a screw base. */
    val Lightbulb: ImageVector =
        stroked("Lightbulb") {
            circle(12f, 9f, 5f)
            moveTo(10f, 14f)
            lineTo(10f, 16f)
            moveTo(14f, 14f)
            lineTo(14f, 16f)
            moveTo(9.5f, 16.5f)
            lineTo(14.5f, 16.5f)
            moveTo(10.5f, 19f)
            lineTo(13.5f, 19f)
        }

    /** lucide `signal` — turn signal: four ascending bars. */
    val Signal: ImageVector =
        stroked("Signal") {
            moveTo(5f, 18f)
            lineTo(5f, 16f)
            moveTo(10f, 18f)
            lineTo(10f, 13f)
            moveTo(15f, 18f)
            lineTo(15f, 9f)
            moveTo(20f, 18f)
            lineTo(20f, 5f)
        }

    /** lucide `armchair` — driver seat: backrest, arms, cushion, and legs. */
    val Armchair: ImageVector =
        stroked("Armchair") {
            moveTo(6f, 11f)
            lineTo(6f, 8f)
            curveTo(6f, 7f, 7f, 7f, 8f, 7f)
            lineTo(16f, 7f)
            curveTo(17f, 7f, 18f, 7f, 18f, 8f)
            lineTo(18f, 11f)
            moveTo(5f, 11f)
            lineTo(19f, 11f)
            lineTo(19f, 16f)
            lineTo(5f, 16f)
            close()
            moveTo(6f, 13.5f)
            lineTo(18f, 13.5f)
            moveTo(7f, 16f)
            lineTo(7f, 19f)
            moveTo(17f, 16f)
            lineTo(17f, 19f)
        }

    /** lucide `key` — paired keys: a round bow with a toothed shaft. */
    val Key: ImageVector =
        stroked("Key") {
            circle(8f, 8f, 3f)
            moveTo(10f, 10f)
            lineTo(19f, 19f)
            moveTo(16f, 16f)
            lineTo(18f, 14f)
            moveTo(13.5f, 13.5f)
            lineTo(15.5f, 11.5f)
        }

    /** lucide `car` — valet mode: a cabin curve over a body line with two wheels. */
    val Car: ImageVector =
        stroked("Car") {
            moveTo(6f, 14f)
            lineTo(7.5f, 10f)
            curveTo(7.8f, 9.3f, 8.4f, 9f, 9f, 9f)
            lineTo(15f, 9f)
            curveTo(15.6f, 9f, 16.2f, 9.3f, 16.5f, 10f)
            lineTo(18f, 14f)
            moveTo(4f, 14f)
            lineTo(20f, 14f)
            circle(8f, 16.5f, 1.5f)
            circle(16f, 16.5f, 1.5f)
        }

    /** lucide `wrench` — service mode: an open-jaw spanner on a diagonal handle. */
    val Wrench: ImageVector =
        stroked("Wrench") {
            moveTo(7f, 18f)
            lineTo(13f, 12f)
            curveTo(11.7f, 9.5f, 12.8f, 6.3f, 15.5f, 6f)
            lineTo(14f, 8.5f)
            lineTo(15.5f, 10f)
            lineTo(18f, 8.5f)
            curveTo(18.5f, 11.3f, 15.8f, 13f, 13f, 12f)
        }

    /** lucide `home` — HomeLink devices: a roof over walls with a door. */
    val Home: ImageVector =
        stroked("Home") {
            moveTo(4f, 11.5f)
            lineTo(12f, 4.5f)
            lineTo(20f, 11.5f)
            moveTo(6f, 10f)
            lineTo(6f, 19f)
            lineTo(18f, 19f)
            lineTo(18f, 10f)
            moveTo(10f, 19f)
            lineTo(10f, 14f)
            lineTo(14f, 14f)
            lineTo(14f, 19f)
        }

    /** lucide `monitor` — center display: a screen on a stand. */
    val Monitor: ImageVector =
        stroked("Monitor") {
            rect(3f, 5f, 21f, 16f)
            moveTo(12f, 16f)
            lineTo(12f, 19f)
            moveTo(8f, 19f)
            lineTo(16f, 19f)
        }

    /** lucide `circle-dot` — the "Live" indicator: a ring around a center dot. */
    val CircleDot: ImageVector =
        stroked("CircleDot") {
            circle(12f, 12f, 8f)
            dot(12f, 12f)
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
