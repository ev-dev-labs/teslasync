package io.teslasync.android.components.forms

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * Line-style icon set for the forms layer, drawn as Material [ImageVector]s.
 *
 * Mirrors the approach in `ui.TeslaGlyphs` — Android has no bundled `lucide-react` equivalent, so
 * the search/filter/calendar/sort/tag/export glyphs the form primitives need (and that aren't in
 * `ui.TeslaGlyphs`) are authored here as 24×24 stroked vectors, recolored at render time by tint.
 */
object FormsGlyphs {
    val Search: ImageVector =
        stroked("Search") {
            circle(11f, 11f, 6f)
            moveTo(15.5f, 15.5f)
            lineTo(20f, 20f)
        }
    val Filter: ImageVector =
        stroked("Filter") {
            moveTo(4f, 5f)
            lineTo(20f, 5f)
            lineTo(14f, 12f)
            lineTo(14f, 19f)
            lineTo(10f, 16f)
            lineTo(10f, 12f)
            close()
        }
    val Calendar: ImageVector =
        stroked("Calendar") {
            rect(4f, 6f, 20f, 20f)
            moveTo(4f, 10f)
            lineTo(20f, 10f)
            moveTo(8f, 4f)
            lineTo(8f, 8f)
            moveTo(16f, 4f)
            lineTo(16f, 8f)
        }
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
    val Tag: ImageVector =
        stroked("Tag") {
            moveTo(4f, 4f)
            lineTo(12f, 4f)
            lineTo(20f, 12f)
            lineTo(12f, 20f)
            lineTo(4f, 12f)
            close()
            dot(8f, 8f)
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
