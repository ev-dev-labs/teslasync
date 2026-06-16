// Locally-authored stroked vector glyphs for the SleepEfficiencyPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/battery/pages/SleepEfficiencyPage.tsx imports Moon, Eye, Clock, Zap,
// DollarSign, Thermometer). This mirrors the established analytics-page precedent (StatisticsPageIcons): glyphs the
// shared catalogs already carry are re-exported from those catalogs (Clock, Zap=Bolt), and the remainder (Moon, Eye,
// DollarSign, Thermometer) are authored locally as 24×24 stroked vectors and recolored at render via the Icon `tint`,
// rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.sleepefficiency

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs

private const val STROKE_WIDTH = 2f

/** Build a 24×24 stroked glyph; the stroke color is replaced by the Icon `tint` at render. */
private fun strokedGlyph(
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
                strokeLineWidth = STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/**
 * The glyph set this surface needs (web lucide icons). The two glyphs the shared catalogs already carry are
 * re-exported so the page reads every icon from one source; the other four are authored locally.
 */
object SleepGlyphs {
    /** Clock — web `Clock` (avg-time-to-sleep + event time). Reused from the shared data-display catalog. */
    val Clock: ImageVector = DataDisplayGlyphs.Clock

    /** Lightning bolt — web `Zap` (recent-drain-events header). Reused from the shared data-display catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Crescent moon — web `Moon` (sleep-efficiency hero + the no-data + sentry-off badge). */
    val Moon: ImageVector =
        strokedGlyph("SleepMoon") {
            moveTo(21f, 12.8f)
            arcTo(9f, 9f, 0f, true, true, 11.2f, 3f)
            arcTo(7f, 7f, 0f, false, false, 21f, 12.8f)
            close()
        }

    /** Eye — web `Eye` (sentry drain rate + the sentry-on badge + the monthly impact callout). */
    val Eye: ImageVector =
        strokedGlyph("SleepEye") {
            moveTo(2f, 12f)
            curveTo(4f, 7f, 8f, 5f, 12f, 5f)
            curveTo(16f, 5f, 20f, 7f, 22f, 12f)
            curveTo(20f, 17f, 16f, 19f, 12f, 19f)
            curveTo(8f, 19f, 4f, 17f, 2f, 12f)
            close()
            moveTo(15f, 12f)
            arcTo(3f, 3f, 0f, true, true, 9f, 12f)
            arcTo(3f, 3f, 0f, true, true, 15f, 12f)
            close()
        }

    /** Dollar sign — web `DollarSign` (sentry monthly cost). */
    val DollarSign: ImageVector =
        strokedGlyph("SleepDollarSign") {
            moveTo(16f, 7.5f)
            curveTo(16f, 6.1f, 14.2f, 5.5f, 12f, 5.5f)
            curveTo(9.8f, 5.5f, 8f, 6.4f, 8f, 8.2f)
            curveTo(8f, 12.5f, 16f, 10.5f, 16f, 14.8f)
            curveTo(16f, 16.8f, 14f, 17.5f, 12f, 17.5f)
            curveTo(9.8f, 17.5f, 8f, 16.9f, 8f, 15.5f)
            moveTo(12f, 3f)
            lineTo(12f, 5.5f)
            moveTo(12f, 17.5f)
            lineTo(12f, 21f)
        }

    /** Thermometer — web `Thermometer` (event outside temperature). Stem plus a bulb. */
    val Thermometer: ImageVector =
        strokedGlyph("SleepThermometer") {
            moveTo(14f, 14.8f)
            lineTo(14f, 5f)
            curveTo(14f, 3.9f, 13.1f, 3f, 12f, 3f)
            curveTo(10.9f, 3f, 10f, 3.9f, 10f, 5f)
            lineTo(10f, 14.8f)
            curveTo(8.8f, 15.5f, 8f, 16.8f, 8f, 18.2f)
            curveTo(8f, 20.3f, 9.7f, 22f, 12f, 22f)
            curveTo(14.3f, 22f, 16f, 20.3f, 16f, 18.2f)
            curveTo(16f, 16.8f, 15.2f, 15.5f, 14f, 14.8f)
            close()
        }
}
