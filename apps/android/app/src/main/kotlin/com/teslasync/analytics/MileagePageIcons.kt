// Self-contained line glyphs for the analytics MileagePage surface, authored as 24×24 stroked vectors. The
// web source leans on lucide-react (`Gauge`, `TrendingUp`, `Calendar`, `BarChart3`, `AlertCircle`), which
// has no bundled Android equivalent, so each marker is reproduced here as a monochrome stroked path and
// recoloured at render time by the consuming `Icon` / `MetricCard` / `AlertBanner` tint.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.analytics.mileage

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The line glyphs the MileagePage draws — the lucide markers the web page imports. */
internal object MileageGlyphs {
    /** Speedometer dial — the Total-Distance metric card (web lucide `Gauge`). */
    val Gauge: ImageVector =
        glyph("MileageGauge") {
            moveTo(12f, 14f)
            lineTo(16f, 10f)
            moveTo(4.5f, 18f)
            curveTo(3.2f, 16.3f, 2.5f, 14.2f, 2.5f, 12f)
            curveTo(2.5f, 6.8f, 6.8f, 2.5f, 12f, 2.5f)
            curveTo(17.2f, 2.5f, 21.5f, 6.8f, 21.5f, 12f)
            curveTo(21.5f, 14.2f, 20.8f, 16.3f, 19.5f, 18f)
        }

    /** Up-trend line + arrow — the Total-Drives metric card (web lucide `TrendingUp`). */
    val TrendingUp: ImageVector =
        glyph("MileageTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }

    /** Calendar frame — the Daily-Avg-30d metric card (web lucide `Calendar`). */
    val Calendar: ImageVector =
        glyph("MileageCalendar") {
            moveTo(5f, 4f)
            lineTo(19f, 4f)
            lineTo(19f, 20f)
            lineTo(5f, 20f)
            lineTo(5f, 4f)
            moveTo(16f, 2f)
            lineTo(16f, 6f)
            moveTo(8f, 2f)
            lineTo(8f, 6f)
            moveTo(5f, 9f)
            lineTo(19f, 9f)
        }

    /** Axis + three ascending bars — the Annual-Projection card + daily chart icon (web lucide `BarChart3`). */
    val BarChart3: ImageVector =
        glyph("MileageBarChart3") {
            moveTo(3f, 3f)
            lineTo(3f, 21f)
            lineTo(21f, 21f)
            moveTo(8f, 17f)
            lineTo(8f, 14f)
            moveTo(13f, 17f)
            lineTo(13f, 5f)
            moveTo(18f, 17f)
            lineTo(18f, 9f)
        }

    /** Circled exclamation — the error banner marker (web lucide `AlertCircle`). */
    val AlertCircle: ImageVector =
        glyph("MileageAlertCircle") {
            moveTo(12f, 3f)
            curveTo(16.97f, 3f, 21f, 7.03f, 21f, 12f)
            curveTo(21f, 16.97f, 16.97f, 21f, 12f, 21f)
            curveTo(7.03f, 21f, 3f, 16.97f, 3f, 12f)
            curveTo(3f, 7.03f, 7.03f, 3f, 12f, 3f)
            moveTo(12f, 8f)
            lineTo(12f, 12f)
            moveTo(12f, 16f)
            lineTo(12.01f, 16f)
        }
}

private fun glyph(
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
