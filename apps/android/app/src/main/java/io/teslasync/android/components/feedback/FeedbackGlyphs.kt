package io.teslasync.android.components.feedback

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * Line-style icon set for the feedback layer, drawn as Material [ImageVector]s.
 *
 * The web library uses `lucide-react`; Android has no bundled equivalent without the frozen
 * `material-icons-extended` artifact, so the glyphs the feedback primitives need (and that aren't
 * already in `ui.TeslaGlyphs`) are authored here as 24×24 stroked vectors. Each is monochrome and
 * recolored at render time by the `Icon` composable's `tint`.
 */
object FeedbackGlyphs {
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
    val Refresh: ImageVector =
        stroked("Refresh") {
            moveTo(20f, 12f)
            curveTo(20f, 16.4f, 16.4f, 20f, 12f, 20f)
            curveTo(8f, 20f, 5f, 18f, 4f, 15f)
            moveTo(4f, 12f)
            curveTo(4f, 7.6f, 7.6f, 4f, 12f, 4f)
            curveTo(16f, 4f, 19f, 6f, 20f, 9f)
            moveTo(20f, 4f)
            lineTo(20f, 9f)
            lineTo(15f, 9f)
            moveTo(4f, 20f)
            lineTo(4f, 15f)
            lineTo(9f, 15f)
        }
    val Download: ImageVector =
        stroked("Download") {
            moveTo(12f, 4f)
            lineTo(12f, 15f)
            moveTo(7f, 10f)
            lineTo(12f, 15f)
            lineTo(17f, 10f)
            moveTo(4f, 19f)
            lineTo(20f, 19f)
        }
    val Bell: ImageVector =
        stroked("Bell") {
            moveTo(6f, 16f)
            curveTo(6f, 16f, 7f, 14.5f, 7f, 11f)
            curveTo(7f, 8f, 9f, 6f, 12f, 6f)
            curveTo(15f, 6f, 17f, 8f, 17f, 11f)
            curveTo(17f, 14.5f, 18f, 16f, 18f, 16f)
            lineTo(6f, 16f)
            close()
            moveTo(10.5f, 19f)
            curveTo(11.4f, 20f, 12.6f, 20f, 13.5f, 19f)
        }
    val Rocket: ImageVector =
        stroked("Rocket") {
            moveTo(12f, 3f)
            curveTo(16f, 5f, 17f, 9f, 16f, 13f)
            lineTo(11f, 13f)
            curveTo(10f, 9f, 11f, 5f, 12f, 3f)
            close()
            moveTo(8f, 14f)
            lineTo(6f, 18f)
            lineTo(10f, 16f)
            dot(13.5f, 8.5f)
        }
    val Keyboard: ImageVector =
        stroked("Keyboard") {
            rect(3f, 7f, 21f, 17f)
            dot(7f, 11f)
            dot(11f, 11f)
            dot(15f, 11f)
            moveTo(8f, 14f)
            lineTo(16f, 14f)
        }
    val Cookie: ImageVector =
        stroked("Cookie") {
            circle(12f, 12f, 8f)
            dot(9f, 9f)
            dot(14f, 10f)
            dot(15f, 14f)
            dot(10f, 15f)
        }
    val Clock: ImageVector =
        stroked("Clock") {
            circle(12f, 12f, 9f)
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }
    val Hourglass: ImageVector =
        stroked("Hourglass") {
            moveTo(7f, 4f)
            lineTo(17f, 4f)
            moveTo(7f, 20f)
            lineTo(17f, 20f)
            moveTo(7f, 4f)
            curveTo(7f, 9f, 12f, 11f, 12f, 12f)
            curveTo(12f, 13f, 7f, 15f, 7f, 20f)
            moveTo(17f, 4f)
            curveTo(17f, 9f, 12f, 11f, 12f, 12f)
            curveTo(12f, 13f, 17f, 15f, 17f, 20f)
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
    val Wrench: ImageVector =
        stroked("Wrench") {
            moveTo(15f, 4f)
            curveTo(17.5f, 4f, 19.5f, 6f, 19.5f, 8.5f)
            curveTo(19.5f, 9.5f, 19f, 10.5f, 19f, 10.5f)
            lineTo(10.5f, 19f)
            curveTo(9.5f, 20f, 8f, 20f, 7f, 19f)
            curveTo(6f, 18f, 6f, 16.5f, 7f, 15.5f)
            lineTo(15.5f, 7f)
            curveTo(15.5f, 7f, 14.5f, 4f, 15f, 4f)
            close()
        }
    val Users: ImageVector =
        stroked("Users") {
            circle(9f, 8f, 3f)
            moveTo(3f, 19f)
            curveTo(3f, 15.5f, 5.5f, 13.5f, 9f, 13.5f)
            curveTo(12.5f, 13.5f, 15f, 15.5f, 15f, 19f)
            moveTo(16f, 6f)
            curveTo(18f, 6f, 19.5f, 7.5f, 19.5f, 9.5f)
            curveTo(19.5f, 11f, 18.5f, 12.3f, 17f, 12.8f)
        }
    val ArrowRight: ImageVector =
        stroked("ArrowRight") {
            moveTo(5f, 12f)
            lineTo(19f, 12f)
            moveTo(13f, 6f)
            lineTo(19f, 12f)
            lineTo(13f, 18f)
        }
    val Browser: ImageVector =
        stroked("Browser") {
            rect(3f, 5f, 21f, 19f)
            moveTo(3f, 9f)
            lineTo(21f, 9f)
            dot(6f, 7f)
            dot(8.5f, 7f)
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
