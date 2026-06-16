// Locally-authored stroked vector glyphs for the TeslaChargingHistoryPage surface — the native counterparts of
// the web lucide icons (`@/lib/icons`) the page uses: Zap (Total Sessions), Gauge (Total Energy), DollarSign
// (Total Spend), TrendingUp (Avg Cost/kWh), Receipt (no-chart-data empty), MapPin (location column), Download
// (invoice link + Export CSV), and RefreshCw (the Refresh-from-Tesla action). This mirrors the established A7
// precedent (ApiLogsPage / AlertStudioPage glyph sets): each glyph is authored locally as a 24×24 stroked vector
// and recolored at render via the Icon/StatCard/Button `tint`, rather than editing the shared TeslaGlyphs catalog
// (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.teslacharginghistory

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val STROKE_WIDTH = 2f

/** Build a 24×24 stroked glyph; the stroke color is replaced by the Icon/StatCard/Button `tint` at render. */
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

/** The local glyph set this surface needs (web lucide icons). */
object TeslaChargingHistoryGlyphs {
    /** Lightning bolt — web `Zap` (Total Sessions stat). */
    val Zap: ImageVector =
        strokedGlyph("TeslaChargingHistoryZap") {
            moveTo(13f, 3f)
            lineTo(4f, 13f)
            lineTo(11f, 13f)
            lineTo(10f, 21f)
            lineTo(20f, 11f)
            lineTo(13f, 11f)
            close()
        }

    /** Dial with a needle — web `Gauge` (Total Energy stat). */
    val Gauge: ImageVector =
        strokedGlyph("TeslaChargingHistoryGauge") {
            moveTo(12f, 13f)
            lineTo(15.5f, 9.5f)
            moveTo(4f, 16f)
            curveTo(3.4f, 14.8f, 3f, 13.4f, 3f, 12f)
            curveTo(3f, 7f, 7f, 3f, 12f, 3f)
            curveTo(17f, 3f, 21f, 7f, 21f, 12f)
            curveTo(21f, 13.4f, 20.6f, 14.8f, 20f, 16f)
        }

    /** Dollar sign — web `DollarSign` (Total Spend stat). */
    val DollarSign: ImageVector =
        strokedGlyph("TeslaChargingHistoryDollarSign") {
            moveTo(12f, 3f)
            lineTo(12f, 21f)
            moveTo(16f, 7f)
            lineTo(10f, 7f)
            curveTo(7.5f, 7f, 7.5f, 11f, 10f, 11f)
            lineTo(14f, 11f)
            curveTo(16.5f, 11f, 16.5f, 15f, 14f, 15f)
            lineTo(8f, 15f)
        }

    /** Up-and-to-the-right arrow — web `TrendingUp` (Avg Cost/kWh stat). */
    val TrendingUp: ImageVector =
        strokedGlyph("TeslaChargingHistoryTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }

    /** Receipt with a torn edge — web `Receipt` (no-chart-data empty state). */
    val Receipt: ImageVector =
        strokedGlyph("TeslaChargingHistoryReceipt") {
            moveTo(5f, 3f)
            lineTo(5f, 21f)
            lineTo(7f, 20f)
            lineTo(9f, 21f)
            lineTo(12f, 20f)
            lineTo(15f, 21f)
            lineTo(17f, 20f)
            lineTo(19f, 21f)
            lineTo(19f, 3f)
            close()
            moveTo(8f, 8f)
            lineTo(16f, 8f)
            moveTo(8f, 12f)
            lineTo(16f, 12f)
        }

    /** Location pin — web `MapPin` (Location column). */
    val MapPin: ImageVector =
        strokedGlyph("TeslaChargingHistoryMapPin") {
            moveTo(12f, 21f)
            curveTo(12f, 21f, 5f, 14.5f, 5f, 9f)
            curveTo(5f, 5.1f, 8.1f, 2f, 12f, 2f)
            curveTo(15.9f, 2f, 19f, 5.1f, 19f, 9f)
            curveTo(19f, 14.5f, 12f, 21f, 12f, 21f)
            close()
            moveTo(12f, 7f)
            curveTo(10.9f, 7f, 10f, 7.9f, 10f, 9f)
            curveTo(10f, 10.1f, 10.9f, 11f, 12f, 11f)
            curveTo(13.1f, 11f, 14f, 10.1f, 14f, 9f)
            curveTo(14f, 7.9f, 13.1f, 7f, 12f, 7f)
            close()
        }

    /** Down arrow into a tray — web `Download` (invoice link + Export CSV action). */
    val Download: ImageVector =
        strokedGlyph("TeslaChargingHistoryDownload") {
            moveTo(12f, 3f)
            lineTo(12f, 14f)
            moveTo(8f, 10f)
            lineTo(12f, 14f)
            lineTo(16f, 10f)
            moveTo(4f, 17f)
            lineTo(4f, 20f)
            lineTo(20f, 20f)
            lineTo(20f, 17f)
        }

    /** Circular refresh arrows — web `RefreshCw` (Refresh from Tesla action). */
    val RefreshCw: ImageVector =
        strokedGlyph("TeslaChargingHistoryRefreshCw") {
            moveTo(20f, 8f)
            curveTo(18.5f, 5.5f, 15.5f, 4f, 12f, 4f)
            curveTo(7.6f, 4f, 4f, 7.6f, 4f, 12f)
            moveTo(20f, 4f)
            lineTo(20f, 8f)
            lineTo(16f, 8f)
            moveTo(4f, 16f)
            curveTo(5.5f, 18.5f, 8.5f, 20f, 12f, 20f)
            curveTo(16.4f, 20f, 20f, 16.4f, 20f, 12f)
            moveTo(4f, 20f)
            lineTo(4f, 16f)
            lineTo(8f, 16f)
        }
}
