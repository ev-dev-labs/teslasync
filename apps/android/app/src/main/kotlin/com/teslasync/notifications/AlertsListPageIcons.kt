// Locally-resolved glyph set for the AlertsListPage surface — the native counterparts of the web lucide icons the page
// + its AlertCard render (web/src/features/notifications/pages/AlertsListPage.tsx + components/AlertCard.tsx import
// Bell, Filter, AlertCircle, BellOff, Clock, CheckCircle, RefreshCw, ArrowRight). This mirrors the established
// analytics/driving-page precedent (StatisticsPageIcons): glyphs the shared catalogs already carry are re-exported
// from those catalogs, and the one glyph they do not carry (the muted "bell-off" used by the empty states) is authored
// locally as a 24×24 stroked vector and recolored at render via the Icon `tint`, rather than editing the shared
// catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.notifications.alertslist

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
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.navigation.NavGlyphs

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
 * The glyph set this surface needs (web lucide icons). The glyphs the shared catalogs already carry are re-exported so
 * the page reads every icon from one source; the muted bell is authored locally.
 */
object AlertsListGlyphs {
    /** Bell — web `Bell`/`notifications` (panel titles, pinned section, detail action, default row icon). */
    val Notifications: ImageVector = NavGlyphs.Bell

    /** Funnel — web `Filter` (the by-type panel title + the filter row). Reused from the shared forms catalog. */
    val Filter: ImageVector = FormsGlyphs.Filter

    /** Alert triangle — web `AlertCircle` (the critical callout). Reused from the shared data-display catalog. */
    val AlertCircle: ImageVector = DataDisplayGlyphs.AlertTriangle

    /** Clock — web `Clock` (the per-row relative time). Reused from the shared data-display catalog. */
    val Clock: ImageVector = DataDisplayGlyphs.Clock

    /** Check circle — web `CheckCircle`/`success` (the acknowledge action). Reused from the shared data-display catalog. */
    val Acknowledge: ImageVector = DataDisplayGlyphs.CheckCircle

    /** Refresh cycle — web `RefreshCw` (the reopen action). Reused from the shared feedback catalog. */
    val Reopen: ImageVector = FeedbackGlyphs.Refresh

    /** Arrow — web `next` (the "View context" affordance). Reused from the shared data-display catalog. */
    val Next: ImageVector = DataDisplayGlyphs.ArrowRight

    /** Muted bell — web `notificationsMuted`/`BellOff` (the empty states): a bell crossed by a diagonal slash. */
    val NotificationsMuted: ImageVector =
        strokedGlyph("AlertsBellOff") {
            moveTo(13.73f, 21f)
            curveTo(13.55f, 21.3f, 13.3f, 21.55f, 13f, 21.73f)
            curveTo(12.7f, 21.9f, 12.35f, 22f, 12f, 22f)
            curveTo(11.65f, 22f, 11.3f, 21.9f, 11f, 21.73f)
            curveTo(10.7f, 21.55f, 10.45f, 21.3f, 10.27f, 21f)
            moveTo(18.63f, 13f)
            curveTo(18.9f, 11.65f, 19.03f, 10.28f, 19f, 8.91f)
            moveTo(6.26f, 6.26f)
            curveTo(6.09f, 6.83f, 6f, 7.41f, 6f, 8f)
            curveTo(6f, 11.5f, 5.12f, 13.74f, 4.14f, 15f)
            curveTo(3.84f, 15.39f, 3.69f, 15.58f, 3.7f, 15.64f)
            curveTo(3.71f, 15.7f, 3.74f, 15.74f, 3.8f, 15.81f)
            curveTo(3.92f, 15.93f, 4.06f, 16f, 4.33f, 16f)
            lineTo(16f, 16f)
            moveTo(8.66f, 3.66f)
            curveTo(9.61f, 2.89f, 10.79f, 2.47f, 12f, 2.5f)
            curveTo(13.59f, 2.5f, 15.12f, 3.13f, 16.24f, 4.26f)
            curveTo(17.37f, 5.38f, 18f, 6.91f, 18f, 8.5f)
            moveTo(2f, 2f)
            lineTo(22f, 22f)
        }
}
