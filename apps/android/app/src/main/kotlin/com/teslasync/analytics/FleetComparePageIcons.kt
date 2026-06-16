// Locally-authored stroked vector glyphs for the FleetComparePage surface — the native counterparts of the web
// lucide-react icons the page renders (web/src/features/analytics/pages/FleetComparePage.tsx). This mirrors the
// established A7 precedent (e.g. IngestXRayPageIcons / MonthlyMileageGlyphs): each glyph is authored locally as a
// 24×24 stroked vector and recolored at render via the shared Icon `tint`, rather than editing the shared
// TeslaGlyphs catalog (out of scope here) — lucide-react has no bundled Android equivalent.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.analytics.fleetcompare

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

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

/** The local glyph set this surface needs — one per web lucide icon the page renders. */
object FleetCompareGlyphs {
    /** Battery cell with terminal — web `Battery` (the current-status battery row + the battery highlight). */
    val Battery: ImageVector =
        strokedGlyph("FleetCompareBattery") {
            moveTo(3f, 8f)
            lineTo(17f, 8f)
            lineTo(17f, 16f)
            lineTo(3f, 16f)
            lineTo(3f, 8f)
            moveTo(20f, 11f)
            lineTo(20f, 13f)
        }

    /** Bulb thermometer — web `Thermometer` (the temperature row). */
    val Thermometer: ImageVector =
        strokedGlyph("FleetCompareThermometer") {
            moveTo(12f, 4f)
            curveTo(10.9f, 4f, 10f, 4.9f, 10f, 6f)
            lineTo(10f, 14f)
            curveTo(8.8f, 14.9f, 8f, 16.3f, 8f, 18f)
            curveTo(8f, 20.2f, 9.8f, 22f, 12f, 22f)
            curveTo(14.2f, 22f, 16f, 20.2f, 16f, 18f)
            curveTo(16f, 16.3f, 15.2f, 14.9f, 14f, 14f)
            lineTo(14f, 6f)
            curveTo(14f, 4.9f, 13.1f, 4f, 12f, 4f)
            close()
        }

    /** Closed padlock — web `Lock` (the security row). */
    val Lock: ImageVector =
        strokedGlyph("FleetCompareLock") {
            moveTo(5f, 11f)
            lineTo(19f, 11f)
            lineTo(19f, 21f)
            lineTo(5f, 21f)
            lineTo(5f, 11f)
            moveTo(8f, 11f)
            lineTo(8f, 7f)
            curveTo(8f, 4.8f, 9.8f, 3f, 12f, 3f)
            curveTo(14.2f, 3f, 16f, 4.8f, 16f, 7f)
            lineTo(16f, 11f)
        }

    /** Shield — web `Shield` (the Sentry chip). */
    val Shield: ImageVector =
        strokedGlyph("FleetCompareShield") {
            moveTo(12f, 3f)
            lineTo(20f, 6f)
            lineTo(20f, 12f)
            curveTo(20f, 17f, 16.5f, 20.5f, 12f, 22f)
            curveTo(7.5f, 20.5f, 4f, 17f, 4f, 12f)
            lineTo(4f, 6f)
            close()
        }

    /** Wi-Fi arcs — web `Wifi` (the status row). */
    val Wifi: ImageVector =
        strokedGlyph("FleetCompareWifi") {
            moveTo(4f, 9f)
            curveTo(8.5f, 5f, 15.5f, 5f, 20f, 9f)
            moveTo(7f, 13f)
            curveTo(10f, 10.5f, 14f, 10.5f, 17f, 13f)
            moveTo(10f, 16.5f)
            curveTo(11.2f, 15.5f, 12.8f, 15.5f, 14f, 16.5f)
            moveTo(12f, 20f)
            lineTo(12.01f, 20f)
        }

    /** Car silhouette — web `Car` (the status-card header + the single-vehicle / empty states). */
    val Car: ImageVector =
        strokedGlyph("FleetCompareCar") {
            moveTo(5f, 17f)
            lineTo(3f, 17f)
            lineTo(3f, 12f)
            lineTo(5.5f, 7f)
            lineTo(18.5f, 7f)
            lineTo(21f, 12f)
            lineTo(21f, 17f)
            lineTo(19f, 17f)
            moveTo(5f, 17f)
            lineTo(19f, 17f)
            moveTo(3f, 12f)
            lineTo(21f, 12f)
            moveTo(7f, 20f)
            curveTo(8.1f, 20f, 9f, 19.1f, 9f, 18f)
            curveTo(9f, 16.9f, 8.1f, 16f, 7f, 16f)
            curveTo(5.9f, 16f, 5f, 16.9f, 5f, 18f)
            curveTo(5f, 19.1f, 5.9f, 20f, 7f, 20f)
            close()
            moveTo(17f, 20f)
            curveTo(18.1f, 20f, 19f, 19.1f, 19f, 18f)
            curveTo(19f, 16.9f, 18.1f, 16f, 17f, 16f)
            curveTo(15.9f, 16f, 15f, 16.9f, 15f, 18f)
            curveTo(15f, 19.1f, 15.9f, 20f, 17f, 20f)
            close()
        }

    /** Speed gauge — web `Gauge` (the range row). */
    val Gauge: ImageVector =
        strokedGlyph("FleetCompareGauge") {
            moveTo(4f, 18f)
            curveTo(2.7f, 16.3f, 2f, 14.2f, 2f, 12f)
            curveTo(2f, 6.5f, 6.5f, 2f, 12f, 2f)
            curveTo(17.5f, 2f, 22f, 6.5f, 22f, 12f)
            curveTo(22f, 14.2f, 21.3f, 16.3f, 20f, 18f)
            moveTo(12f, 12f)
            lineTo(15.5f, 8.5f)
        }

    /** Lightning bolt — web `Zap` (the efficiency highlight). */
    val Zap: ImageVector =
        strokedGlyph("FleetCompareZap") {
            moveTo(13f, 2f)
            lineTo(4f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(20f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** Rising trend line — web `TrendingUp` (the monthly-distance empty state). */
    val TrendingUp: ImageVector =
        strokedGlyph("FleetCompareTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(16f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 12f)
        }

    /** Dollar sign — web `DollarSign` (the charging-cost highlight). */
    val DollarSign: ImageVector =
        strokedGlyph("FleetCompareDollarSign") {
            moveTo(12f, 2f)
            lineTo(12f, 22f)
            moveTo(17f, 6f)
            curveTo(17f, 6f, 14.5f, 5f, 12f, 5f)
            curveTo(9.5f, 5f, 7.5f, 6.3f, 7.5f, 8.5f)
            curveTo(7.5f, 13f, 16.5f, 11f, 16.5f, 15.5f)
            curveTo(16.5f, 17.7f, 14.5f, 19f, 12f, 19f)
            curveTo(9.5f, 19f, 7f, 18f, 7f, 18f)
        }

    /** Leaf — web `Leaf` (the CO₂-saved highlight). */
    val Leaf: ImageVector =
        strokedGlyph("FleetCompareLeaf") {
            moveTo(4f, 20f)
            curveTo(4f, 10f, 11f, 4f, 20f, 4f)
            curveTo(20f, 13f, 14f, 20f, 4f, 20f)
            close()
            moveTo(4f, 20f)
            curveTo(7f, 14f, 11f, 11f, 16f, 9f)
        }

    /** Route waypoints — web `Route` (the drives-per-month empty state). */
    val Route: ImageVector =
        strokedGlyph("FleetCompareRoute") {
            moveTo(6f, 19f)
            curveTo(7.1f, 19f, 8f, 18.1f, 8f, 17f)
            curveTo(8f, 15.9f, 7.1f, 15f, 6f, 15f)
            curveTo(4.9f, 15f, 4f, 15.9f, 4f, 17f)
            curveTo(4f, 18.1f, 4.9f, 19f, 6f, 19f)
            close()
            moveTo(18f, 9f)
            curveTo(19.1f, 9f, 20f, 8.1f, 20f, 7f)
            curveTo(20f, 5.9f, 19.1f, 5f, 18f, 5f)
            curveTo(16.9f, 5f, 16f, 5.9f, 16f, 7f)
            curveTo(16f, 8.1f, 16.9f, 9f, 18f, 9f)
            close()
            moveTo(18f, 9f)
            lineTo(18f, 12f)
            curveTo(18f, 14f, 16f, 15f, 12f, 15f)
            lineTo(10f, 15f)
            curveTo(8f, 15f, 6f, 14f, 6f, 12f)
            lineTo(6f, 9f)
        }

    /** Left-right swap arrows — web `ArrowLeftRight` (the selector divider). */
    val ArrowLeftRight: ImageVector =
        strokedGlyph("FleetCompareArrowLeftRight") {
            moveTo(8f, 4f)
            lineTo(4f, 8f)
            lineTo(8f, 12f)
            moveTo(4f, 8f)
            lineTo(20f, 8f)
            moveTo(16f, 12f)
            lineTo(20f, 16f)
            lineTo(16f, 20f)
            moveTo(20f, 16f)
            lineTo(4f, 16f)
        }

    /** Info circle — web `Info` (the lifetime-note row). */
    val Info: ImageVector =
        strokedGlyph("FleetCompareInfo") {
            moveTo(12f, 22f)
            curveTo(17.5f, 22f, 22f, 17.5f, 22f, 12f)
            curveTo(22f, 6.5f, 17.5f, 2f, 12f, 2f)
            curveTo(6.5f, 2f, 2f, 6.5f, 2f, 12f)
            curveTo(2f, 17.5f, 6.5f, 22f, 12f, 22f)
            close()
            moveTo(12f, 16f)
            lineTo(12f, 12f)
            moveTo(12f, 8f)
            lineTo(12.01f, 8f)
        }

    /** Calendar — web `Calendar` (the disambiguation banner icon). */
    val Calendar: ImageVector =
        strokedGlyph("FleetCompareCalendar") {
            moveTo(4f, 6f)
            lineTo(20f, 6f)
            lineTo(20f, 20f)
            lineTo(4f, 20f)
            lineTo(4f, 6f)
            moveTo(8f, 3f)
            lineTo(8f, 7f)
            moveTo(16f, 3f)
            lineTo(16f, 7f)
            moveTo(4f, 10f)
            lineTo(20f, 10f)
        }
}
