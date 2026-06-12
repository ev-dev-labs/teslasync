// Locally authored line-style glyphs for the OverviewTab Quick Links — the native analogues of the web
// lucide icons (BarChart3, Activity, Calendar, MapPin, Clock) plus the trailing ArrowRight affordance.
// Each is a 24×24 stroked [ImageVector] recolored at render time by the [Icon] tint. They are kept local
// to this surface (the mandated allowed-files path) rather than expanding a shared icon set from a feature
// prompt — the same approach the SentryModeChart and ReferenceLinksSection surfaces take.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/OverviewTab) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the object name.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.overviewtab

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-style glyphs the OverviewTab Quick Links render, mapped from [QuickLinkGlyph]. */
internal object OverviewTabGlyphs {
    /** Bar-chart glyph (lucide `bar-chart-3`) — the Statistics link. */
    val BarChart: ImageVector =
        overviewStroked("OverviewBarChart") {
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

    /** Activity heartbeat glyph (lucide `activity`) — the Compare link. */
    val Activity: ImageVector =
        overviewStroked("OverviewActivity") {
            moveTo(22f, 12f)
            horizontalLineToRelative(-4f)
            lineToRelative(-3f, 9f)
            lineTo(9f, 3f)
            lineToRelative(-3f, 9f)
            horizontalLineTo(2f)
        }

    /** Calendar glyph (lucide `calendar`) — the Weekly Digest link. */
    val Calendar: ImageVector =
        overviewStroked("OverviewCalendar") {
            moveTo(3f, 4f)
            horizontalLineTo(21f)
            verticalLineTo(22f)
            horizontalLineTo(3f)
            close()
            moveTo(3f, 10f)
            horizontalLineTo(21f)
            moveTo(8f, 2f)
            verticalLineTo(6f)
            moveTo(16f, 2f)
            verticalLineTo(6f)
        }

    /** Map-pin glyph (lucide `map-pin`) — the Mileage link. */
    val MapPin: ImageVector =
        overviewStroked("OverviewMapPin") {
            moveTo(12f, 21f)
            curveTo(12f, 21f, 5f, 13.5f, 5f, 9f)
            arcTo(7f, 7f, 0f, isMoreThanHalf = false, isPositiveArc = true, 19f, 9f)
            curveTo(19f, 13.5f, 12f, 21f, 12f, 21f)
            close()
            overviewCircle(12f, 9f, 2.5f)
        }

    /** Clock glyph (lucide `clock`) — the Timeline link. */
    val Clock: ImageVector =
        overviewStroked("OverviewClock") {
            overviewCircle(12f, 12f, 9f)
            moveTo(12f, 7f)
            verticalLineTo(12f)
            lineTo(16f, 14f)
        }

    /** Arrow-right affordance (lucide `arrow-right`) — the trailing chevron on each Quick Link card. */
    val ArrowRight: ImageVector =
        overviewStroked("OverviewArrowRight") {
            moveTo(5f, 12f)
            horizontalLineTo(19f)
            moveTo(12f, 5f)
            lineTo(19f, 12f)
            lineTo(12f, 19f)
        }
}

/** Builds a 24×24 round-joined stroked vector from a path [build] block — the shared glyph drawing style. */
private fun overviewStroked(
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

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.overviewCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = cx + r, y1 = cy)
    arcTo(r, r, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = cx - r, y1 = cy)
    close()
}
