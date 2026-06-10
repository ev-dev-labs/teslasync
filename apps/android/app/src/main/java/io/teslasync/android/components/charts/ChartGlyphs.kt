package io.teslasync.android.components.charts

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * Chart-specific line glyphs not present in the shared `ui.TeslaGlyphs` set, drawn
 * as 24×24 stroked [ImageVector]s in the same monochrome style so they recolor via
 * the `Icon` tint. Kept local to the chart layer rather than expanding the shared UI
 * icon set from a chart prompt.
 */
object ChartGlyphs {
    /** Download / export tray — the `ChartExportMenu` trigger. */
    val Download: ImageVector =
        stroked("Download") {
            moveTo(12f, 4f)
            lineTo(12f, 15f)
            moveTo(7f, 10.5f)
            lineTo(12f, 15.5f)
            lineTo(17f, 10.5f)
            moveTo(5f, 19f)
            lineTo(19f, 19f)
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
