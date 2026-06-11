package io.teslasync.android.components.maps

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * Line-style icon set for the maps layer, drawn as Material [ImageVector]s.
 *
 * The web library uses `lucide-react`; Android has no bundled equivalent without the frozen
 * `material-icons-extended` artifact, so the glyphs the map controls need are authored here as
 * 24×24 stroked vectors (mirroring `components/ui/TeslaGlyphs`). Each is monochrome and
 * recolored at render time by the `Icon` composable's `tint`.
 */
object MapsGlyphs {
    val Layers: ImageVector =
        stroked("Layers") {
            moveTo(12f, 3f)
            lineTo(21f, 8f)
            lineTo(12f, 13f)
            lineTo(3f, 8f)
            close()
            moveTo(3f, 12f)
            lineTo(12f, 17f)
            lineTo(21f, 12f)
            moveTo(3f, 16f)
            lineTo(12f, 21f)
            lineTo(21f, 16f)
        }

    val Map: ImageVector =
        stroked("Map") {
            moveTo(3f, 6f)
            lineTo(9f, 4f)
            lineTo(15f, 6f)
            lineTo(21f, 4f)
            lineTo(21f, 18f)
            lineTo(15f, 20f)
            lineTo(9f, 18f)
            lineTo(3f, 20f)
            close()
            moveTo(9f, 4f)
            lineTo(9f, 18f)
            moveTo(15f, 6f)
            lineTo(15f, 20f)
        }

    val Satellite: ImageVector =
        stroked("Satellite") {
            circle(12f, 12f, 5f)
            moveTo(4f, 9f)
            curveTo(9f, 5.5f, 15f, 5.5f, 20f, 9f)
            moveTo(4f, 15f)
            curveTo(9f, 18.5f, 15f, 18.5f, 20f, 15f)
        }

    val Terrain: ImageVector =
        stroked("Terrain") {
            moveTo(3f, 19f)
            lineTo(9f, 9f)
            lineTo(13f, 15f)
            lineTo(16f, 11f)
            lineTo(21f, 19f)
            close()
        }

    val Navigation: ImageVector =
        stroked("Navigation") {
            moveTo(12f, 3f)
            lineTo(19f, 20f)
            lineTo(12f, 16f)
            lineTo(5f, 20f)
            close()
        }

    val Crosshair: ImageVector =
        stroked("Crosshair") {
            circle(12f, 12f, 7f)
            moveTo(12f, 2f)
            lineTo(12f, 5f)
            moveTo(12f, 19f)
            lineTo(12f, 22f)
            moveTo(2f, 12f)
            lineTo(5f, 12f)
            moveTo(19f, 12f)
            lineTo(22f, 12f)
            dot(12f, 12f)
        }

    val CircleShape: ImageVector =
        stroked("CircleShape") {
            circle(12f, 12f, 8f)
        }

    val SquareShape: ImageVector =
        stroked("SquareShape") {
            rect(5f, 5f, 19f, 19f)
        }

    val PolygonShape: ImageVector =
        stroked("PolygonShape") {
            moveTo(12f, 3f)
            lineTo(21f, 10f)
            lineTo(17f, 20f)
            lineTo(7f, 20f)
            lineTo(3f, 10f)
            close()
        }

    val Trash: ImageVector =
        stroked("Trash") {
            moveTo(4f, 7f)
            lineTo(20f, 7f)
            moveTo(9f, 7f)
            lineTo(9f, 4f)
            lineTo(15f, 4f)
            lineTo(15f, 7f)
            moveTo(6f, 7f)
            lineTo(7f, 20f)
            lineTo(17f, 20f)
            lineTo(18f, 7f)
            moveTo(10f, 11f)
            lineTo(10f, 17f)
            moveTo(14f, 11f)
            lineTo(14f, 17f)
        }

    val Route: ImageVector =
        stroked("Route") {
            circle(6f, 18f, 2f)
            circle(18f, 6f, 2f)
            moveTo(6f, 16f)
            curveTo(6f, 10f, 18f, 12f, 18f, 8f)
        }

    val Plus: ImageVector =
        stroked("Plus") {
            moveTo(12f, 5f)
            lineTo(12f, 19f)
            moveTo(5f, 12f)
            lineTo(19f, 12f)
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
