// Locally-authored stroked vector glyphs for the EnergyProductsPage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/battery/pages/EnergyProductsPage.tsx imports Sun, Battery, Zap, Grid3x3,
// RefreshCw, Shield, CloudLightning, Gauge, Activity, Settings, Cpu, Info, Clock). This mirrors the established
// battery/analytics-page precedent (BatteryHealthPageIcons / StatisticsPageIcons): glyphs the shared catalogs already
// carry are re-exported from those catalogs (Battery / Zap=Bolt / Shield / Gauge / Info / Clock / RefreshCw=Refresh),
// and the remainder (Sun / Grid3x3 / CloudLightning / Activity / Settings / Cpu) are authored locally as 24×24 stroked
// vectors and recolored at render via the Icon `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.energyproducts

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.FeedbackGlyphs

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
 * The glyph set this surface needs (web lucide icons). The seven glyphs the shared catalogs already carry are
 * re-exported so the page reads every icon from one source; the other six are authored locally.
 */
object EnergyGlyphs {
    /** Battery — web `Battery` (Powerwall / capacity). Reused from the shared data-display catalog. */
    val Battery: ImageVector = DataDisplayGlyphs.Battery

    /** Lightning bolt — web `Zap` (energy-site / wall-connector). Reused from the shared data-display catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Shield — web `Shield` (backup capability). Reused from the shared data-display catalog. */
    val Shield: ImageVector = DataDisplayGlyphs.Shield

    /** Speedometer — web `Gauge` (charge state). Reused from the shared data-display catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Info-in-circle — web `Info` (no-config empty state). Reused from the shared data-display catalog. */
    val Info: ImageVector = DataDisplayGlyphs.Info

    /** Clock — web `Clock` (rate-plan section). Reused from the shared data-display catalog. */
    val Clock: ImageVector = DataDisplayGlyphs.Clock

    /** Refresh cycle — web `RefreshCw` (refresh actions). Reused from the shared feedback catalog. */
    val Refresh: ImageVector = FeedbackGlyphs.Refresh

    /** Sun — web `Sun` (solar). A center disc plus eight rays. */
    val Sun: ImageVector =
        strokedGlyph("EnergySun") {
            moveTo(16f, 12f)
            arcTo(4f, 4f, 0f, true, true, 8f, 12f)
            arcTo(4f, 4f, 0f, true, true, 16f, 12f)
            close()
            moveTo(12f, 2f)
            lineTo(12f, 4f)
            moveTo(12f, 20f)
            lineTo(12f, 22f)
            moveTo(2f, 12f)
            lineTo(4f, 12f)
            moveTo(20f, 12f)
            lineTo(22f, 12f)
            moveTo(4.9f, 4.9f)
            lineTo(6.3f, 6.3f)
            moveTo(17.7f, 17.7f)
            lineTo(19.1f, 19.1f)
            moveTo(4.9f, 19.1f)
            lineTo(6.3f, 17.7f)
            moveTo(17.7f, 6.3f)
            lineTo(19.1f, 4.9f)
        }

    /** Grid — web `Grid3x3` (grid connection). A square with two inner verticals + two inner horizontals. */
    val Grid: ImageVector =
        strokedGlyph("EnergyGrid") {
            moveTo(3f, 3f)
            lineTo(21f, 3f)
            lineTo(21f, 21f)
            lineTo(3f, 21f)
            close()
            moveTo(9f, 3f)
            lineTo(9f, 21f)
            moveTo(15f, 3f)
            lineTo(15f, 21f)
            moveTo(3f, 9f)
            lineTo(21f, 9f)
            moveTo(3f, 15f)
            lineTo(21f, 15f)
        }

    /** Cloud + bolt — web `CloudLightning` (storm watch). A rounded cloud blob plus a small lightning bolt. */
    val CloudLightning: ImageVector =
        strokedGlyph("EnergyCloudLightning") {
            moveTo(7f, 17f)
            curveTo(4.8f, 17f, 3f, 15.2f, 3f, 13f)
            curveTo(3f, 11f, 4.5f, 9.3f, 6.5f, 9f)
            curveTo(7.2f, 6.7f, 9.4f, 5f, 12f, 5f)
            curveTo(15f, 5f, 17.5f, 7.2f, 17.9f, 10.1f)
            curveTo(19.7f, 10.5f, 21f, 12.1f, 21f, 14f)
            curveTo(21f, 15.7f, 19.7f, 17f, 18f, 17f)
            moveTo(12.5f, 13f)
            lineTo(10.5f, 16.5f)
            lineTo(13f, 16.5f)
            lineTo(11f, 20f)
        }

    /** Activity pulse line — web `Activity` (resource type). A baseline with a single spike. */
    val Activity: ImageVector =
        strokedGlyph("EnergyActivity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 4f)
            lineTo(14f, 20f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }

    /** Gear — web `Settings` (site configuration header). A center disc plus eight radial teeth. */
    val Settings: ImageVector =
        strokedGlyph("EnergySettings") {
            moveTo(15f, 12f)
            arcTo(3f, 3f, 0f, true, true, 9f, 12f)
            arcTo(3f, 3f, 0f, true, true, 15f, 12f)
            close()
            moveTo(12f, 2.5f)
            lineTo(12f, 5f)
            moveTo(12f, 19f)
            lineTo(12f, 21.5f)
            moveTo(2.5f, 12f)
            lineTo(5f, 12f)
            moveTo(19f, 12f)
            lineTo(21.5f, 12f)
            moveTo(5.2f, 5.2f)
            lineTo(7f, 7f)
            moveTo(17f, 17f)
            lineTo(18.8f, 18.8f)
            moveTo(5.2f, 18.8f)
            lineTo(7f, 17f)
            moveTo(17f, 7f)
            lineTo(18.8f, 5.2f)
        }

    /** Chip — web `Cpu` (gateway firmware). A chip body, an inner core square, and eight pins. */
    val Cpu: ImageVector =
        strokedGlyph("EnergyCpu") {
            moveTo(4f, 4f)
            lineTo(20f, 4f)
            lineTo(20f, 20f)
            lineTo(4f, 20f)
            close()
            moveTo(9f, 9f)
            lineTo(15f, 9f)
            lineTo(15f, 15f)
            lineTo(9f, 15f)
            close()
            moveTo(9f, 2f)
            lineTo(9f, 4f)
            moveTo(15f, 2f)
            lineTo(15f, 4f)
            moveTo(9f, 20f)
            lineTo(9f, 22f)
            moveTo(15f, 20f)
            lineTo(15f, 22f)
            moveTo(2f, 9f)
            lineTo(4f, 9f)
            moveTo(2f, 15f)
            lineTo(4f, 15f)
            moveTo(20f, 9f)
            lineTo(22f, 9f)
            moveTo(20f, 15f)
            lineTo(22f, 15f)
        }
}
