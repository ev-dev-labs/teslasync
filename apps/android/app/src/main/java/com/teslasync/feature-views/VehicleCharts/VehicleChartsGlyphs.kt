// Self-contained line-style icon set for the VehicleCharts surface, drawn as Material [ImageVector]s.
//
// The web component titles its panels with `lucide-react` glyphs (Navigation, Car, Settings, Activity). The
// shared maps set already carries the navigation pin (`MapsGlyphs.Navigation`, reused for the Location panel),
// but Car / Settings / Activity have no shared equivalent and Android ships no lucide set without the frozen
// `material-icons-extended` artifact. So — exactly as the sibling VehicleStatePanel surface does for the same
// three lucide glyphs — they are authored here as 24x24 stroked vectors. Each is monochrome (drawn in opaque
// black) and recolored at render time by the [io.teslasync.android.components.ui.Icon] composable's `tint`, so
// it inherits the per-section accent the panel header passes.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleCharts) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecharts

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent panel-title glyphs the VehicleCharts surface renders that the shared sets do not carry. */
internal object VehicleChartsGlyphs {
    /** lucide `activity` — the Speed History title: a single pulse/heartbeat polyline. */
    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 20f)
            lineTo(14f, 4f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }

    /** lucide `car` — the Vehicle Configuration title: a cabin curve over a body line with two wheels. */
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

    /** lucide `settings` — the Car Display Preferences title: a cog of eight teeth around a centre hub. */
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
