// Self-contained line-style icon set for the VehicleStatePanel surface, drawn as Material [ImageVector]s.
//
// The web component uses `lucide-react` glyphs (Activity, Lightbulb, Car, ShieldAlert, Key, Settings,
// Monitor) that the shared `TeslaGlyphs` / `DataDisplayGlyphs` sets do not carry, and Android ships no
// lucide-equivalent set without the frozen `material-icons-extended` artifact. So — exactly as the shared
// glyph sets do for their lucide ports — the seven this surface needs are authored here as 24×24 stroked
// vectors. Each is monochrome (drawn in opaque black) and recolored at render time by the [Icon] composable's
// `tint`, so they inherit the active-accent / muted-foreground color the row computes. The remaining three
// web glyphs (User → `DataDisplayGlyphs.Person`, Gauge → `DataDisplayGlyphs.Gauge`, MapPin →
// `DataDisplayGlyphs.MapPin`) reuse the shared set, so no duplicate is authored here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleStatePanel) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclestatepanel

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyphs the VehicleStatePanel rows render that the shared sets do not provide. */
internal object VehicleStatePanelGlyphs {
    /** lucide `activity` — the panel title: a single pulse/heartbeat polyline. */
    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 20f)
            lineTo(14f, 4f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
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

    /** lucide `car` — turn signal / valet mode: a cabin curve over a body line with two wheels. */
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

    /** lucide `shield-alert` — hazards: a shield outline around an exclamation mark. */
    val ShieldAlert: ImageVector =
        stroked("ShieldAlert") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 11f)
            curveTo(19f, 16f, 15.5f, 19f, 12f, 21f)
            curveTo(8.5f, 19f, 5f, 16f, 5f, 11f)
            lineTo(5f, 6f)
            close()
            moveTo(12f, 8f)
            lineTo(12f, 13f)
            dot(12f, 16f)
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

    /** lucide `settings` — service mode: a cog of eight teeth around a center hub. */
    val Settings: ImageVector =
        stroked("Settings") {
            circle(12f, 12f, 3f)
            moveTo(16.8f, 12f)
            lineTo(19.2f, 12f)
            moveTo(4.8f, 12f)
            lineTo(7.2f, 12f)
            moveTo(12f, 16.8f)
            lineTo(12f, 19.2f)
            moveTo(12f, 4.8f)
            lineTo(12f, 7.2f)
            moveTo(15.4f, 15.4f)
            lineTo(17.1f, 17.1f)
            moveTo(6.9f, 6.9f)
            lineTo(8.6f, 8.6f)
            moveTo(15.4f, 8.6f)
            lineTo(17.1f, 6.9f)
            moveTo(6.9f, 17.1f)
            lineTo(8.6f, 15.4f)
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
