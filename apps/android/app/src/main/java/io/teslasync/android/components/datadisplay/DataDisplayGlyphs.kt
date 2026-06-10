package io.teslasync.android.components.datadisplay

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * Line-style icon set for the data-display layer, drawn as Material [ImageVector]s.
 *
 * The web library uses `lucide-react`; Android has no bundled equivalent without the frozen
 * `material-icons-extended` artifact, so the glyphs the data-display primitives need are authored
 * here as 24×24 stroked vectors (mirroring the approach in `components/ui/TeslaGlyphs`). Each is
 * monochrome and recolored at render time by the `Icon` composable's `tint`.
 */
object DataDisplayGlyphs {
    val ArrowUp: ImageVector =
        stroked("ArrowUp") {
            moveTo(12f, 19f)
            lineTo(12f, 5f)
            moveTo(6f, 11f)
            lineTo(12f, 5f)
            lineTo(18f, 11f)
        }
    val ArrowDown: ImageVector =
        stroked("ArrowDown") {
            moveTo(12f, 5f)
            lineTo(12f, 19f)
            moveTo(6f, 13f)
            lineTo(12f, 19f)
            lineTo(18f, 13f)
        }
    val ArrowRight: ImageVector =
        stroked("ArrowRight") {
            moveTo(5f, 12f)
            lineTo(19f, 12f)
            moveTo(13f, 6f)
            lineTo(19f, 12f)
            lineTo(13f, 18f)
        }

    val Battery: ImageVector =
        stroked("Battery") {
            rect(3f, 8f, 18f, 16f)
            moveTo(20f, 11f)
            lineTo(20f, 13f)
        }
    val BatteryCharging: ImageVector =
        stroked("BatteryCharging") {
            moveTo(8f, 8f)
            lineTo(3f, 8f)
            lineTo(3f, 16f)
            lineTo(8f, 16f)
            moveTo(13f, 8f)
            lineTo(18f, 8f)
            lineTo(18f, 16f)
            lineTo(13f, 16f)
            moveTo(20f, 11f)
            lineTo(20f, 13f)
            moveTo(11f, 7f)
            lineTo(8f, 12f)
            lineTo(12f, 12f)
            lineTo(9f, 17f)
        }

    val MapPin: ImageVector =
        stroked("MapPin") {
            moveTo(12f, 21f)
            curveTo(12f, 21f, 5f, 14.5f, 5f, 9.5f)
            curveTo(5f, 5.6f, 8.1f, 3f, 12f, 3f)
            curveTo(15.9f, 3f, 19f, 5.6f, 19f, 9.5f)
            curveTo(19f, 14.5f, 12f, 21f, 12f, 21f)
            close()
            dot(12f, 9.5f)
        }

    val Play: ImageVector =
        stroked("Play") {
            moveTo(7f, 5f)
            lineTo(19f, 12f)
            lineTo(7f, 19f)
            close()
        }
    val Pause: ImageVector =
        stroked("Pause") {
            moveTo(8f, 5f)
            lineTo(8f, 19f)
            moveTo(16f, 5f)
            lineTo(16f, 19f)
        }
    val Stop: ImageVector =
        stroked("Stop") {
            rect(6f, 6f, 18f, 18f)
        }
    val SkipBack: ImageVector =
        stroked("SkipBack") {
            moveTo(18f, 5f)
            lineTo(8f, 12f)
            lineTo(18f, 19f)
            close()
            moveTo(6f, 5f)
            lineTo(6f, 19f)
        }

    val Person: ImageVector =
        stroked("Person") {
            circle(12f, 8f, 3.5f)
            moveTo(5f, 20f)
            curveTo(5f, 16f, 8f, 14f, 12f, 14f)
            curveTo(16f, 14f, 19f, 16f, 19f, 20f)
        }
    val Robot: ImageVector =
        stroked("Robot") {
            rect(5f, 8f, 19f, 18f)
            moveTo(12f, 5f)
            lineTo(12f, 8f)
            dot(9f, 13f)
            dot(15f, 13f)
        }

    val Wifi: ImageVector =
        stroked("Wifi") {
            moveTo(4f, 9f)
            curveTo(8.5f, 5f, 15.5f, 5f, 20f, 9f)
            moveTo(7f, 12.5f)
            curveTo(10f, 9.8f, 14f, 9.8f, 17f, 12.5f)
            moveTo(10f, 16f)
            curveTo(11.2f, 14.9f, 12.8f, 14.9f, 14f, 16f)
            dot(12f, 19f)
        }
    val WifiOff: ImageVector =
        stroked("WifiOff") {
            moveTo(7f, 12.5f)
            curveTo(8.4f, 11.2f, 10.1f, 10.4f, 11.8f, 10.1f)
            moveTo(16.5f, 12f)
            curveTo(16.7f, 12.2f, 16.9f, 12.3f, 17f, 12.5f)
            moveTo(10f, 16f)
            curveTo(11.2f, 14.9f, 12.8f, 14.9f, 14f, 16f)
            dot(12f, 19f)
            moveTo(4f, 4f)
            lineTo(20f, 20f)
        }

    val Info: ImageVector =
        stroked("Info") {
            circle(12f, 12f, 9f)
            moveTo(12f, 11f)
            lineTo(12f, 16f)
            dot(12f, 8f)
        }
    val AlertTriangle: ImageVector =
        stroked("AlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            dot(12f, 16.5f)
        }
    val AlertOctagon: ImageVector =
        stroked("AlertOctagon") {
            moveTo(8f, 3f)
            lineTo(16f, 3f)
            lineTo(21f, 8f)
            lineTo(21f, 16f)
            lineTo(16f, 21f)
            lineTo(8f, 21f)
            lineTo(3f, 16f)
            lineTo(3f, 8f)
            close()
            moveTo(12f, 7.5f)
            lineTo(12f, 13f)
            dot(12f, 16f)
        }
    val CheckCircle: ImageVector =
        stroked("CheckCircle") {
            circle(12f, 12f, 9f)
            moveTo(8f, 12.5f)
            lineTo(11f, 15.5f)
            lineTo(16f, 9f)
        }

    val Lock: ImageVector =
        stroked("Lock") {
            rect(5f, 11f, 19f, 20f)
            moveTo(8f, 11f)
            lineTo(8f, 8f)
            curveTo(8f, 5.8f, 9.8f, 4f, 12f, 4f)
            curveTo(14.2f, 4f, 16f, 5.8f, 16f, 8f)
            lineTo(16f, 11f)
        }
    val Snowflake: ImageVector =
        stroked("Snowflake") {
            moveTo(12f, 3f)
            lineTo(12f, 21f)
            moveTo(4f, 7.5f)
            lineTo(20f, 16.5f)
            moveTo(20f, 7.5f)
            lineTo(4f, 16.5f)
        }
    val Shield: ImageVector =
        stroked("Shield") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 12f)
            curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
            curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
            lineTo(5f, 6f)
            close()
        }
    val Bolt: ImageVector =
        stroked("Bolt") {
            moveTo(13f, 3f)
            lineTo(5f, 13f)
            lineTo(11f, 13f)
            lineTo(11f, 21f)
            lineTo(19f, 11f)
            lineTo(13f, 11f)
            close()
        }
    val Clock: ImageVector =
        stroked("Clock") {
            circle(12f, 12f, 9f)
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }
    val TrendingDown: ImageVector =
        stroked("TrendingDown") {
            moveTo(4f, 7f)
            lineTo(11f, 14f)
            lineTo(14f, 11f)
            lineTo(20f, 17f)
            moveTo(15f, 17f)
            lineTo(20f, 17f)
            lineTo(20f, 12f)
        }
    val Gauge: ImageVector =
        stroked("Gauge") {
            moveTo(4f, 16f)
            curveTo(4f, 11f, 7.6f, 7f, 12f, 7f)
            curveTo(16.4f, 7f, 20f, 11f, 20f, 16f)
            moveTo(12f, 16f)
            lineTo(15f, 11f)
        }
    val ExternalLink: ImageVector =
        stroked("ExternalLink") {
            moveTo(14f, 5f)
            lineTo(19f, 5f)
            lineTo(19f, 10f)
            moveTo(19f, 5f)
            lineTo(11f, 13f)
            moveTo(16f, 14f)
            lineTo(16f, 19f)
            lineTo(5f, 19f)
            lineTo(5f, 8f)
            lineTo(10f, 8f)
        }
    val History: ImageVector =
        stroked("History") {
            moveTo(4f, 8f)
            curveTo(6f, 5f, 9f, 4f, 12f, 4f)
            curveTo(16.4f, 4f, 20f, 7.6f, 20f, 12f)
            curveTo(20f, 16.4f, 16.4f, 20f, 12f, 20f)
            curveTo(8f, 20f, 5f, 18f, 4f, 15f)
            moveTo(4f, 4f)
            lineTo(4f, 8f)
            lineTo(8f, 8f)
            moveTo(12f, 8f)
            lineTo(12f, 12f)
            lineTo(15f, 14f)
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
