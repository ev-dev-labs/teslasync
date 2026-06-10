package io.teslasync.android.components.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * Self-contained line-style icon set drawn as Material [ImageVector]s.
 *
 * The web library leans on `lucide-react`; Android has no equivalent bundled set without
 * pulling the (frozen, deprecated) `material-icons-extended` artifact, so the handful of
 * glyphs the shared UI primitives need are authored here as 24×24 stroked vectors. Each is
 * monochrome (drawn in opaque black) and recolored at render time by the [Icon] composable's
 * `tint`, so they inherit `LocalContentColor` and every theme/state color automatically.
 */
object TeslaGlyphs {
    val ChevronLeft: ImageVector =
        stroked("ChevronLeft") {
            moveTo(15f, 6f)
            lineTo(9f, 12f)
            lineTo(15f, 18f)
        }
    val ChevronRight: ImageVector =
        stroked("ChevronRight") {
            moveTo(9f, 6f)
            lineTo(15f, 12f)
            lineTo(9f, 18f)
        }
    val ChevronUp: ImageVector =
        stroked("ChevronUp") {
            moveTo(6f, 15f)
            lineTo(12f, 9f)
            lineTo(18f, 15f)
        }
    val ChevronDown: ImageVector =
        stroked("ChevronDown") {
            moveTo(6f, 9f)
            lineTo(12f, 15f)
            lineTo(18f, 9f)
        }

    val FirstPage: ImageVector =
        stroked("FirstPage") {
            moveTo(17f, 6f)
            lineTo(11f, 12f)
            lineTo(17f, 18f)
            moveTo(7f, 6f)
            lineTo(7f, 18f)
        }
    val LastPage: ImageVector =
        stroked("LastPage") {
            moveTo(7f, 6f)
            lineTo(13f, 12f)
            lineTo(7f, 18f)
            moveTo(17f, 6f)
            lineTo(17f, 18f)
        }

    val Close: ImageVector =
        stroked("Close") {
            moveTo(6f, 6f)
            lineTo(18f, 18f)
            moveTo(18f, 6f)
            lineTo(6f, 18f)
        }
    val Check: ImageVector =
        stroked("Check") {
            moveTo(5f, 12.5f)
            lineTo(10f, 17.5f)
            lineTo(19f, 6.5f)
        }
    val Plus: ImageVector =
        stroked("Plus") {
            moveTo(12f, 5f)
            lineTo(12f, 19f)
            moveTo(5f, 12f)
            lineTo(19f, 12f)
        }
    val Minus: ImageVector =
        stroked("Minus") {
            moveTo(5f, 12f)
            lineTo(19f, 12f)
        }

    val Copy: ImageVector =
        stroked("Copy") {
            rect(9f, 9f, 20f, 20f)
            moveTo(15f, 5f)
            lineTo(5f, 5f)
            lineTo(5f, 15f)
        }

    val Eye: ImageVector =
        stroked("Eye") {
            moveTo(2f, 12f)
            curveTo(4.5f, 6.5f, 8f, 5f, 12f, 5f)
            curveTo(16f, 5f, 19.5f, 6.5f, 22f, 12f)
            curveTo(19.5f, 17.5f, 16f, 19f, 12f, 19f)
            curveTo(8f, 19f, 4.5f, 17.5f, 2f, 12f)
            close()
            dot(12f, 12f)
        }
    val EyeOff: ImageVector =
        stroked("EyeOff") {
            moveTo(4f, 12f)
            curveTo(6f, 8f, 9f, 6.5f, 12f, 6.5f)
            curveTo(13f, 6.5f, 14f, 6.7f, 15f, 7f)
            moveTo(20f, 12f)
            curveTo(18.5f, 15f, 16f, 17.5f, 12f, 17.5f)
            curveTo(11f, 17.5f, 10f, 17.3f, 9f, 17f)
            moveTo(4f, 4f)
            lineTo(20f, 20f)
        }

    val Pin: ImageVector =
        stroked("Pin") {
            moveTo(12f, 14f)
            lineTo(12f, 21f)
            moveTo(8f, 4f)
            lineTo(16f, 4f)
            moveTo(9f, 4f)
            lineTo(9.5f, 10f)
            lineTo(7f, 13f)
            lineTo(17f, 13f)
            lineTo(14.5f, 10f)
            lineTo(15f, 4f)
        }
    val Printer: ImageVector =
        stroked("Printer") {
            moveTo(7f, 9f)
            lineTo(7f, 4f)
            lineTo(17f, 4f)
            lineTo(17f, 9f)
            rect(3f, 9f, 21f, 16f)
            rect(7f, 14f, 17f, 20f)
        }
    val Fullscreen: ImageVector =
        stroked("Fullscreen") {
            moveTo(4f, 9f)
            lineTo(4f, 4f)
            lineTo(9f, 4f)
            moveTo(15f, 4f)
            lineTo(20f, 4f)
            lineTo(20f, 9f)
            moveTo(20f, 15f)
            lineTo(20f, 20f)
            lineTo(15f, 20f)
            moveTo(9f, 20f)
            lineTo(4f, 20f)
            lineTo(4f, 15f)
        }
    val FullscreenExit: ImageVector =
        stroked("FullscreenExit") {
            moveTo(9f, 4f)
            lineTo(9f, 9f)
            lineTo(4f, 9f)
            moveTo(20f, 9f)
            lineTo(15f, 9f)
            lineTo(15f, 4f)
            moveTo(15f, 20f)
            lineTo(15f, 15f)
            lineTo(20f, 15f)
            moveTo(4f, 15f)
            lineTo(9f, 15f)
            lineTo(9f, 20f)
        }
    val Edit: ImageVector =
        stroked("Edit") {
            moveTo(16f, 4f)
            lineTo(20f, 8f)
            lineTo(8f, 20f)
            lineTo(4f, 20f)
            lineTo(4f, 16f)
            close()
            moveTo(13f, 7f)
            lineTo(17f, 11f)
        }
    val Help: ImageVector =
        stroked("Help") {
            circle(12f, 12f, 9f)
            moveTo(9.2f, 9.5f)
            curveTo(9.5f, 8f, 11f, 7.3f, 12.3f, 7.6f)
            curveTo(13.8f, 7.9f, 14.6f, 9.3f, 14.1f, 10.6f)
            curveTo(13.6f, 11.9f, 12f, 12f, 12f, 13.5f)
            dot(12f, 16.5f)
        }
    val Warning: ImageVector =
        stroked("Warning") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            dot(12f, 16.5f)
        }
    val Info: ImageVector =
        stroked("Info") {
            circle(12f, 12f, 9f)
            moveTo(12f, 11f)
            lineTo(12f, 16f)
            dot(12f, 8f)
        }
    val Octagon: ImageVector =
        stroked("Octagon") {
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
