// Locally-authored stroked vector glyphs for the ChargingDetailPage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/charging/pages/ChargingDetailPage.tsx imports ArrowLeft, Zap, Battery, Clock,
// Gauge, DollarSign, MapPin, Activity). This mirrors the established battery-page precedent (BatteryHealthPageIcons):
// glyphs the shared catalogs already carry are re-exported from those catalogs (Battery / Clock / Gauge / MapPin /
// Zap=Bolt), and the remainder (ArrowLeft / DollarSign / Activity) are authored locally as 24×24 stroked vectors and
// recolored at render via the Icon `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.chargingdetail

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
 * The glyph set this surface needs (web lucide icons). The five glyphs the shared data-display catalog already carries
 * are re-exported so the page reads every icon from one source; the other three are authored locally.
 */
object ChargingGlyphs {
    /** Lightning bolt — web `Zap` (energy stats + status). Reused from the shared data-display catalog. */
    val Zap: ImageVector = DataDisplayGlyphs.Bolt

    /** Battery — web `Battery` (SoC range stat). Reused from the shared data-display catalog. */
    val Battery: ImageVector = DataDisplayGlyphs.Battery

    /** Clock — web `Clock` (duration stat). Reused from the shared data-display catalog. */
    val Clock: ImageVector = DataDisplayGlyphs.Clock

    /** Speedometer — web `Gauge` (peak/avg power). Reused from the shared data-display catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Map pin — web `MapPin` (location + miles-added + range). Reused from the shared data-display catalog. */
    val MapPin: ImageVector = DataDisplayGlyphs.MapPin

    /** Left arrow — web `ArrowLeft` (back to the charging list). Authored locally. */
    val ArrowLeft: ImageVector =
        strokedGlyph("ChargingArrowLeft") {
            moveTo(19f, 12f)
            lineTo(5f, 12f)
            moveTo(12f, 19f)
            lineTo(5f, 12f)
            lineTo(12f, 5f)
        }

    /** Dollar sign — web `DollarSign` (cost + per-kWh stats). Vertical bar plus the S body. Authored locally. */
    val DollarSign: ImageVector =
        strokedGlyph("ChargingDollarSign") {
            moveTo(12f, 1f)
            lineTo(12f, 23f)
            moveTo(17f, 5f)
            lineTo(9.5f, 5f)
            arcTo(3.5f, 3.5f, 0f, isMoreThanHalf = false, isPositiveArc = false, 9.5f, 12f)
            lineTo(14.5f, 12f)
            arcTo(3.5f, 3.5f, 0f, isMoreThanHalf = false, isPositiveArc = true, 14.5f, 19f)
            lineTo(6f, 19f)
        }

    /** Activity pulse — web `Activity` (chart empty-state icon). Authored locally. */
    val Activity: ImageVector =
        strokedGlyph("ChargingActivity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }
}
