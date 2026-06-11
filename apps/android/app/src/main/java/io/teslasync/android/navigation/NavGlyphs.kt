package io.teslasync.android.navigation

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * Navigation icon set for the section/group destinations and shell chrome, drawn as 24×24 stroked
 * [ImageVector]s. The program deliberately avoids the frozen `material-icons-extended` artifact
 * (see [io.teslasync.android.components.ui.TeslaGlyphs]); the handful of glyphs the navigation
 * shell needs are authored here and recolored at render time via the shared `Icon` composable.
 */
object NavGlyphs {
    val Dashboard: ImageVector =
        stroked("Dashboard") {
            rect(4f, 4f, 10f, 10f)
            rect(14f, 4f, 20f, 10f)
            rect(4f, 14f, 10f, 20f)
            rect(14f, 14f, 20f, 20f)
        }

    val Car: ImageVector =
        stroked("Car") {
            moveTo(4f, 14f)
            lineTo(6f, 8f)
            lineTo(18f, 8f)
            lineTo(20f, 14f)
            lineTo(20f, 17f)
            lineTo(4f, 17f)
            close()
            dot(7.5f, 17f)
            dot(16.5f, 17f)
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

    val Route: ImageVector =
        stroked("Route") {
            moveTo(6f, 19f)
            lineTo(6f, 11f)
            lineTo(18f, 11f)
            lineTo(18f, 5f)
            dot(6f, 19f)
            dot(18f, 5f)
        }

    val Battery: ImageVector =
        stroked("Battery") {
            rect(3f, 8f, 19f, 16f)
            moveTo(19f, 11f)
            lineTo(21f, 11f)
            lineTo(21f, 13f)
            lineTo(19f, 13f)
            moveTo(6f, 11f)
            lineTo(6f, 13f)
            moveTo(9f, 11f)
            lineTo(9f, 13f)
        }

    val Chart: ImageVector =
        stroked("Chart") {
            moveTo(4f, 20f)
            lineTo(20f, 20f)
            moveTo(7f, 20f)
            lineTo(7f, 13f)
            moveTo(12f, 20f)
            lineTo(12f, 7f)
            moveTo(17f, 20f)
            lineTo(17f, 10f)
        }

    val Sliders: ImageVector =
        stroked("Sliders") {
            moveTo(4f, 8f)
            lineTo(20f, 8f)
            moveTo(4f, 16f)
            lineTo(20f, 16f)
            dot(9f, 8f)
            dot(15f, 16f)
        }

    val Workflow: ImageVector =
        stroked("Workflow") {
            rect(4f, 4f, 9f, 9f)
            rect(15f, 15f, 20f, 20f)
            moveTo(9f, 6.5f)
            lineTo(17.5f, 6.5f)
            lineTo(17.5f, 15f)
        }

    val Bell: ImageVector =
        stroked("Bell") {
            moveTo(6f, 16f)
            lineTo(6f, 11f)
            arcTo(6f, 6f, 0f, false, true, 18f, 11f)
            lineTo(18f, 16f)
            lineTo(20f, 18f)
            lineTo(4f, 18f)
            close()
            moveTo(10f, 18f)
            arcTo(2f, 2f, 0f, false, false, 14f, 18f)
        }

    val Pulse: ImageVector =
        stroked("Pulse") {
            moveTo(3f, 12f)
            lineTo(8f, 12f)
            lineTo(10f, 6f)
            lineTo(14f, 18f)
            lineTo(16f, 12f)
            lineTo(21f, 12f)
        }

    val Shield: ImageVector =
        stroked("Shield") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 12f)
            arcTo(9f, 9f, 0f, false, true, 12f, 21f)
            arcTo(9f, 9f, 0f, false, true, 5f, 12f)
            lineTo(5f, 6f)
            close()
        }

    val Terminal: ImageVector =
        stroked("Terminal") {
            rect(3f, 5f, 21f, 19f)
            moveTo(7f, 10f)
            lineTo(10f, 12.5f)
            lineTo(7f, 15f)
            moveTo(12.5f, 15f)
            lineTo(16.5f, 15f)
        }

    val Server: ImageVector =
        stroked("Server") {
            rect(4f, 4f, 20f, 10f)
            rect(4f, 14f, 20f, 20f)
            dot(7.5f, 7f)
            dot(7.5f, 17f)
        }

    val Gear: ImageVector =
        stroked("Gear") {
            moveTo(12f, 8f)
            arcTo(4f, 4f, 0f, true, true, 11.99f, 8f)
            close()
            moveTo(12f, 3f)
            lineTo(12f, 5f)
            moveTo(12f, 19f)
            lineTo(12f, 21f)
            moveTo(3f, 12f)
            lineTo(5f, 12f)
            moveTo(19f, 12f)
            lineTo(21f, 12f)
        }

    val Search: ImageVector =
        stroked("Search") {
            moveTo(11f, 4f)
            arcTo(7f, 7f, 0f, true, true, 10.99f, 4f)
            close()
            moveTo(16f, 16f)
            lineTo(21f, 21f)
        }

    val Share: ImageVector =
        stroked("Share") {
            dot(6f, 12f)
            dot(18f, 6f)
            dot(18f, 18f)
            moveTo(8f, 11f)
            lineTo(16f, 7f)
            moveTo(8f, 13f)
            lineTo(16f, 17f)
        }

    val Watch: ImageVector =
        stroked("Watch") {
            rect(7f, 7f, 17f, 17f)
            moveTo(9f, 7f)
            lineTo(9.5f, 3f)
            lineTo(14.5f, 3f)
            lineTo(15f, 7f)
            moveTo(9f, 17f)
            lineTo(9.5f, 21f)
            lineTo(14.5f, 21f)
            lineTo(15f, 17f)
            dot(12f, 12f)
        }

    val Flag: ImageVector =
        stroked("Flag") {
            moveTo(6f, 21f)
            lineTo(6f, 4f)
            lineTo(17f, 4f)
            lineTo(14f, 8f)
            lineTo(17f, 12f)
            lineTo(6f, 12f)
        }

    val Menu: ImageVector =
        stroked("Menu") {
            moveTo(4f, 7f)
            lineTo(20f, 7f)
            moveTo(4f, 12f)
            lineTo(20f, 12f)
            moveTo(4f, 17f)
            lineTo(20f, 17f)
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
