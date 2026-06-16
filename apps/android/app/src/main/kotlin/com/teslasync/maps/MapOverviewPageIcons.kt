// Line-style icon glyphs for the MapOverviewPage surface, authored as 24×24 stroked Material [ImageVector]s.
//
// The web page uses `lucide-react` glyphs (Gauge, Compass, MapPin, Clock, Home, Briefcase, Link2, Fence,
// AlertCircle). Android ships no bundled lucide equivalent without the frozen `material-icons-extended` artifact
// (which this module deliberately does not depend on — see components/maps/MapsGlyphs.kt), so the glyphs the page's
// metric cards / location-detail rows / GPS-warning banner need are authored here, mirroring `MapsGlyphs`. Each is
// monochrome and recolored at render time by the shared `Icon` composable's `tint`. The map-control glyphs already
// in `MapsGlyphs` (Navigation, Route, Crosshair) are reused for the odometer row + the quick links rather than
// re-authored.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.maps

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The page-local glyph set — the lucide icons the web MapOverviewPage uses, authored as stroked vectors. */
object MapOverviewGlyphs {
    /** Speedometer (web `Gauge`) — the Current Speed metric card. */
    val Gauge: ImageVector =
        stroked("Gauge") {
            moveTo(5f, 17f)
            arcTo(7f, 7f, 0f, true, true, 19f, 17f)
            moveTo(12f, 16.5f)
            lineTo(15.5f, 11.5f)
            dot(12f, 16.5f)
        }

    /** Compass rose (web `Compass`) — the Heading metric card. */
    val Compass: ImageVector =
        stroked("Compass") {
            circle(12f, 12f, 8f)
            moveTo(15.5f, 8.5f)
            lineTo(11f, 11f)
            lineTo(8.5f, 15.5f)
            lineTo(13f, 13f)
            close()
        }

    /** Map pin (web `MapPin`) — the Lat / Lon metric card + the map empty state. */
    val MapPin: ImageVector =
        stroked("MapPin") {
            moveTo(12f, 2f)
            curveTo(8.13f, 2f, 5f, 5.13f, 5f, 9f)
            curveTo(5f, 14.25f, 12f, 22f, 12f, 22f)
            curveTo(12f, 22f, 19f, 14.25f, 19f, 9f)
            curveTo(19f, 5.13f, 15.87f, 2f, 12f, 2f)
            close()
            circle(12f, 9f, 2.5f)
        }

    /** Clock (web `Clock`) — the Last Updated metric card + the history empty state. */
    val Clock: ImageVector =
        stroked("Clock") {
            circle(12f, 12f, 9f)
            moveTo(12f, 7.5f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }

    /** House (web `Home`) — the "At Home" location-detail row. */
    val Home: ImageVector =
        stroked("Home") {
            moveTo(3f, 11f)
            lineTo(12f, 3f)
            lineTo(21f, 11f)
            moveTo(5f, 9.5f)
            lineTo(5f, 20f)
            lineTo(19f, 20f)
            lineTo(19f, 9.5f)
        }

    /** Briefcase (web `Briefcase`) — the "At Work" location-detail row. */
    val Briefcase: ImageVector =
        stroked("Briefcase") {
            rect(3f, 7f, 21f, 20f)
            moveTo(8f, 7f)
            lineTo(8f, 5f)
            lineTo(16f, 5f)
            lineTo(16f, 7f)
            moveTo(3f, 13f)
            lineTo(21f, 13f)
        }

    /** Chain link (web `Link2`) — the "HomeLink Nearby" location-detail row. */
    val Link: ImageVector =
        stroked("Link") {
            moveTo(8f, 12f)
            lineTo(16f, 12f)
            moveTo(8f, 9f)
            lineTo(6f, 9f)
            curveTo(4.34f, 9f, 3f, 10.34f, 3f, 12f)
            curveTo(3f, 13.66f, 4.34f, 15f, 6f, 15f)
            lineTo(8f, 15f)
            moveTo(16f, 9f)
            lineTo(18f, 9f)
            curveTo(19.66f, 9f, 21f, 10.34f, 21f, 12f)
            curveTo(21f, 13.66f, 19.66f, 15f, 18f, 15f)
            lineTo(16f, 15f)
        }

    /** Picket fence (web `Fence`) — the Geofences quick-link button. */
    val Fence: ImageVector =
        stroked("Fence") {
            moveTo(3f, 9f)
            lineTo(21f, 9f)
            moveTo(3f, 15f)
            lineTo(21f, 15f)
            moveTo(7f, 5f)
            lineTo(7f, 21f)
            moveTo(13f, 5f)
            lineTo(13f, 21f)
            moveTo(17f, 5f)
            lineTo(17f, 21f)
        }

    /** Alert circle (web `AlertCircle`) — the data-load + GPS-warning banners. */
    val Alert: ImageVector =
        stroked("Alert") {
            circle(12f, 12f, 9f)
            moveTo(12f, 8f)
            lineTo(12f, 13f)
            dot(12f, 16.5f)
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
