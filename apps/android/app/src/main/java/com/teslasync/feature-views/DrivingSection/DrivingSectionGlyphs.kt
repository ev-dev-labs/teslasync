// Locally authored line-style glyphs for the DrivingSection surface — the native analogues of the web lucide
// icons the section renders (`Car`, `BarChart3`, `TrendingUp`, `Activity`). The shared data-display icon set
// already ships `Clock` and `TrendingDown`, so only the four it lacks are authored here. Each is a 24×24
// stroked [ImageVector] in the shared monochrome style so it recolors at render time via the [Icon] tint.
// They are kept local to this surface (the mandated allowed-files path) rather than expanding a shared icon
// set from a feature prompt — the same approach the sibling OverviewTab / SentryModeChart surfaces take.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DrivingSection) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the object name.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivingsection

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-style glyphs DrivingSection renders that the shared icon set does not already provide. */
internal object DrivingSectionGlyphs {
    /** Car glyph (lucide `car`) — the section-title icon beside "Driving". */
    val Car: ImageVector =
        drivingStroked("DrivingCar") {
            moveTo(3f, 13f)
            lineTo(3f, 11.5f)
            lineTo(5.5f, 11.5f)
            curveTo(6f, 11.5f, 6.3f, 11.3f, 6.6f, 11f)
            lineTo(8.5f, 8.5f)
            curveTo(8.8f, 8.1f, 9.3f, 8f, 9.8f, 8f)
            lineTo(14.5f, 8f)
            curveTo(15.2f, 8f, 15.8f, 8.3f, 16.2f, 8.9f)
            lineTo(17.8f, 11.2f)
            curveTo(18f, 11.4f, 18.3f, 11.5f, 18.6f, 11.5f)
            lineTo(21f, 11.5f)
            lineTo(21f, 13f)
            moveTo(3f, 13f)
            horizontalLineTo(5.5f)
            moveTo(9.5f, 13f)
            horizontalLineTo(14.5f)
            moveTo(18.5f, 13f)
            horizontalLineTo(21f)
            drivingCircle(7.5f, 13f, 2f)
            drivingCircle(16.5f, 13f, 2f)
        }

    /** Bar-chart glyph (lucide `bar-chart-3`) — the Avg Efficiency mini stat. */
    val BarChart: ImageVector =
        drivingStroked("DrivingBarChart") {
            moveTo(3f, 3f)
            verticalLineToRelative(18f)
            horizontalLineToRelative(18f)
            moveTo(18f, 17f)
            verticalLineTo(9f)
            moveTo(13f, 17f)
            verticalLineTo(5f)
            moveTo(8f, 17f)
            verticalLineToRelative(-3f)
        }

    /** Trending-up glyph (lucide `trending-up`) — the Efficiency Change mini stat when efficiency worsened. */
    val TrendingUp: ImageVector =
        drivingStroked("DrivingTrendingUp") {
            moveTo(4f, 17f)
            lineTo(11f, 10f)
            lineTo(14f, 13f)
            lineTo(20f, 7f)
            moveTo(15f, 7f)
            lineTo(20f, 7f)
            lineTo(20f, 12f)
        }

    /** Activity heartbeat glyph (lucide `activity`) — the Drives count mini stat. */
    val Activity: ImageVector =
        drivingStroked("DrivingActivity") {
            moveTo(22f, 12f)
            horizontalLineToRelative(-4f)
            lineToRelative(-3f, 9f)
            lineTo(9f, 3f)
            lineToRelative(-3f, 9f)
            horizontalLineTo(2f)
        }
}

/** Builds a 24×24 round-joined stroked vector from a path [build] block — the shared glyph drawing style. */
private fun drivingStroked(
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

/** Approximates a wheel of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.drivingCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = cx + r, y1 = cy)
    arcTo(r, r, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = cx - r, y1 = cy)
    close()
}
