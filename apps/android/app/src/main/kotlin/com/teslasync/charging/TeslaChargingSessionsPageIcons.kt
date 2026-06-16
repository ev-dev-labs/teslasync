// Locally-authored stroked vector glyphs for the TeslaChargingSessionsPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/charging/pages/TeslaChargingSessionsPage.tsx imports Zap, DollarSign,
// RefreshCw, MapPin, TrendingUp, Gauge, Clock, Building2, Info, Download). Mirroring the established A7 precedent
// (BatteryHealthPageIcons): glyphs the shared catalogs already carry are re-exported from those catalogs
// (Zap=Bolt / RefreshCw=Refresh / MapPin / Gauge / Clock / Info / Download / Map), and the remainder
// (DollarSign / TrendingUp / Building2) are authored locally as 24×24 stroked vectors and recolored at render via the
// Icon `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.teslachargingsessions

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.charts.ChartGlyphs
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.maps.MapsGlyphs

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
 * The glyph set this surface needs (web lucide icons). The eight glyphs the shared catalogs already carry are
 * re-exported so the page reads every icon from one source; the other three are authored locally.
 */
object TeslaChargingSessionsGlyphs {
    /** Lightning bolt — web `Zap` (the Total-Sessions card + the table energy column). Reused from data-display. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Refresh cycle — web `RefreshCw` (the "Refresh from Tesla" control). Reused from the shared feedback catalog. */
    val Refresh: ImageVector = FeedbackGlyphs.Refresh

    /** Map pin — web `MapPin` (the location column + the Session-Locations panel). Reused from data-display. */
    val MapPin: ImageVector = DataDisplayGlyphs.MapPin

    /** Map — the session-location panel's accessible icon. Reused from the shared maps catalog. */
    val Map: ImageVector = MapsGlyphs.Map

    /** Speedometer — web `Gauge` (the Total-Energy card). Reused from the shared data-display catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Clock — web `Clock` (the Peak-Power card). Reused from the shared data-display catalog. */
    val Clock: ImageVector = DataDisplayGlyphs.Clock

    /** Info-in-circle — web `Info` (the empty-table state). Reused from the shared data-display catalog. */
    val Info: ImageVector = DataDisplayGlyphs.Info

    /** Download tray — web `Download` (the bulk "Export CSV" action). Reused from the shared charts catalog. */
    val Download: ImageVector = ChartGlyphs.Download

    /** Dollar sign — web `DollarSign` (the Total-Cost card). A vertical bar through an `S` spine. */
    val DollarSign: ImageVector =
        strokedGlyph("TeslaSessionsDollarSign") {
            moveTo(12f, 1.5f)
            lineTo(12f, 22.5f)
            moveTo(17f, 5.5f)
            lineTo(9.5f, 5.5f)
            curveTo(7.6f, 5.5f, 6f, 7.1f, 6f, 9f)
            curveTo(6f, 10.9f, 7.6f, 12.5f, 9.5f, 12.5f)
            lineTo(14.5f, 12.5f)
            curveTo(16.4f, 12.5f, 18f, 14.1f, 18f, 16f)
            curveTo(18f, 17.9f, 16.4f, 19.5f, 14.5f, 19.5f)
            lineTo(6f, 19.5f)
        }

    /** Up-trend line + arrow head — web `TrendingUp` (the Avg-Cost/kWh card). */
    val TrendingUp: ImageVector =
        strokedGlyph("TeslaSessionsTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }

    /** Office building — web `Building2` (the business-account info banner). Outline + a door + window slits. */
    val Building2: ImageVector =
        strokedGlyph("TeslaSessionsBuilding2") {
            moveTo(6f, 22f)
            lineTo(6f, 4f)
            curveTo(6f, 2.9f, 6.9f, 2f, 8f, 2f)
            lineTo(16f, 2f)
            curveTo(17.1f, 2f, 18f, 2.9f, 18f, 4f)
            lineTo(18f, 22f)
            close()
            moveTo(10f, 22f)
            lineTo(10f, 18f)
            lineTo(14f, 18f)
            lineTo(14f, 22f)
            moveTo(9.5f, 6f)
            lineTo(14.5f, 6f)
            moveTo(9.5f, 10f)
            lineTo(14.5f, 10f)
            moveTo(9.5f, 14f)
            lineTo(14.5f, 14f)
        }
}
