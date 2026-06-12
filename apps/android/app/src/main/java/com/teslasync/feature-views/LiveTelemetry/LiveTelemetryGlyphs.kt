// Self-contained line-style icon set for the LiveTelemetry surface, drawn as Material [ImageVector]s.
//
// The web component uses `lucide-react` glyphs (Cog, Thermometer, CircleDot, Headphones, Navigation2,
// ShieldCheck) that the shared `DataDisplayGlyphs` set does not carry, and Android ships no lucide-equivalent
// set without the frozen `material-icons-extended` artifact. So — exactly as the sibling LiveVehicleState
// surface does for its lucide ports — the six this surface needs are authored here as 24×24 stroked vectors.
// Each is monochrome (drawn in opaque black) and recolored at render time by the [Icon] composable's `tint`.
// The remaining three web glyphs — Shield (security header), Snowflake (defrost chip), Zap (battery-heater
// chip) — reuse the shared `DataDisplayGlyphs`, so they are not re-authored here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveTelemetry) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livetelemetry

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyphs the LiveTelemetry panels render that the shared sets do not provide. */
internal object LiveTelemetryGlyphs {
    /** lucide `cog` — the section + drivetrain header: a hub ring with eight teeth. */
    val Cog: ImageVector =
        stroked("Cog") {
            circle(12f, 12f, 5.5f)
            dot(12f, 12f)
            moveTo(12f, 3.5f)
            lineTo(12f, 6.5f)
            moveTo(12f, 17.5f)
            lineTo(12f, 20.5f)
            moveTo(3.5f, 12f)
            lineTo(6.5f, 12f)
            moveTo(17.5f, 12f)
            lineTo(20.5f, 12f)
            moveTo(6f, 6f)
            lineTo(7.8f, 7.8f)
            moveTo(18f, 6f)
            lineTo(16.2f, 7.8f)
            moveTo(6f, 18f)
            lineTo(7.8f, 16.2f)
            moveTo(18f, 18f)
            lineTo(16.2f, 16.2f)
        }

    /** lucide `thermometer` — the climate header: a mercury column with a bulb and two tick marks. */
    val Thermometer: ImageVector =
        stroked("Thermometer") {
            moveTo(12f, 4f)
            lineTo(12f, 14.5f)
            circle(12f, 17.5f, 2.5f)
            moveTo(13.5f, 7f)
            lineTo(15f, 7f)
            moveTo(13.5f, 10f)
            lineTo(15f, 10f)
        }

    /** lucide `circle-dot` — the tire-pressure header: a ring around a center dot. */
    val CircleDot: ImageVector =
        stroked("CircleDot") {
            circle(12f, 12f, 8f)
            dot(12f, 12f)
        }

    /** lucide `headphones` — the media header: a band arc over two earcups. */
    val Headphones: ImageVector =
        stroked("Headphones") {
            moveTo(4f, 15f)
            curveTo(4f, 9f, 7.6f, 5.5f, 12f, 5.5f)
            curveTo(16.4f, 5.5f, 20f, 9f, 20f, 15f)
            moveTo(4f, 14.5f)
            lineTo(4f, 18f)
            curveTo(4f, 19.3f, 6f, 19.3f, 6f, 18f)
            lineTo(6f, 14.5f)
            close()
            moveTo(18f, 14.5f)
            lineTo(18f, 18f)
            curveTo(18f, 19.3f, 20f, 19.3f, 20f, 18f)
            lineTo(20f, 14.5f)
            close()
        }

    /** lucide `navigation-2` — the navigation header: an upward location pointer. */
    val Navigation2: ImageVector =
        stroked("Navigation2") {
            moveTo(12f, 2.5f)
            lineTo(19f, 20.5f)
            lineTo(12f, 16.5f)
            lineTo(5f, 20.5f)
            close()
        }

    /** lucide `shield-check` — the tire-pressure "all normal" badge: a shield with an inner check mark. */
    val ShieldCheck: ImageVector =
        stroked("ShieldCheck") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 12f)
            curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
            curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
            lineTo(5f, 6f)
            close()
            moveTo(9f, 12f)
            lineTo(11f, 14f)
            lineTo(15f, 9.5f)
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
