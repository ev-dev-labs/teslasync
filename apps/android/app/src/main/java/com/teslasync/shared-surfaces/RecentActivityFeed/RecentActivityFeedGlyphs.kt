// Line-style marker glyphs for the RecentActivityFeed surface, drawn as Material [ImageVector]s.
//
// The web component resolves each row's icon through `getActivityVisual` (web/src/lib/activityIcons.ts), which
// references eighteen distinct `lucide-react` glyphs. The shared `components/datadisplay/DataDisplayGlyphs` and
// `components/feedback/FeedbackGlyphs` sets already carry faithful equivalents for eight of them — Bolt,
// History, Lock, Person (lucide `User`), Gauge (the dashboard metaphor), Snowflake (climate), Bell
// (notifications), and Download — so those are reused verbatim (DRY). The remaining nine — Gamepad, Power,
// Unlock, Settings, NotificationsAdd, NotificationsMuted, Workflow, LayoutGrid and Key — have no shared
// counterpart and are authored here as 24×24 stroked vectors in the same monochrome line style. Each is
// recolored at render time by the `Icon` composable's `tint`, so it inherits the row's accent.
//
// [resolve] turns a pure [ActivityGlyph] key (chosen by the off-device projection in RecentActivityFeedModel)
// into the concrete vector the composable renders, keeping glyph selection unit-testable and the rendering
// declarative. A [Map] lookup (not a `when`) keeps the resolver a one-liner and within the detekt complexity
// budget for non-composable code.
//
// Native adaptation (documented per Honesty Covenant #9): lucide `Settings` is a cog; the native equivalent is
// drawn as the canonical "sliders" controls glyph, which reads as settings at a 14 dp marker size far more
// legibly than a many-toothed gear would. Both are standard settings iconography.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/RecentActivityFeed) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.recentactivityfeed

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

/**
 * The activity-marker glyphs. The nine glyphs absent from the shared sets are authored here; [resolve] maps a
 * pure [ActivityGlyph] key to its concrete vector — reusing the shared [DataDisplayGlyphs] / [FeedbackGlyphs]
 * for the eight that already exist, and the locally-authored ones for the rest.
 */
object RecentActivityFeedGlyphs {
    /** A games controller — web lucide `Gamepad2`, for the generic `vehicle.command`. */
    val Gamepad: ImageVector =
        stroked("Gamepad") {
            roundRect(2f, 8f, 22f, 17f, 4f)
            moveTo(6.5f, 11f)
            lineTo(6.5f, 14.5f)
            moveTo(4.75f, 12.75f)
            lineTo(8.25f, 12.75f)
            circle(16f, 11.5f, 0.6f)
            circle(18f, 13.5f, 0.6f)
        }

    /** A power / standby symbol — web lucide `Power`, for `vehicle.command.wake` and `…flash`. */
    val Power: ImageVector =
        stroked("Power") {
            circle(12f, 13f, 6.5f)
            moveTo(12f, 5f)
            lineTo(12f, 12.5f)
        }

    /** An open padlock — web lucide `LockOpen`, for `vehicle.command.unlock`. */
    val Unlock: ImageVector =
        stroked("Unlock") {
            roundRect(6f, 11f, 18f, 20f, 2f)
            moveTo(9f, 11f)
            lineTo(9f, 8f)
            arcTo(3.5f, 3.5f, 0f, isMoreThanHalf = false, isPositiveArc = true, 15.5f, 8f)
            circle(12f, 15.5f, 0.7f)
        }

    /** The canonical "sliders" controls glyph — the native stand-in for lucide `Settings`. */
    val Settings: ImageVector =
        stroked("Settings") {
            moveTo(4f, 8f)
            lineTo(20f, 8f)
            circle(9f, 8f, 1.7f)
            moveTo(4f, 12f)
            lineTo(20f, 12f)
            circle(15f, 12f, 1.7f)
            moveTo(4f, 16f)
            lineTo(20f, 16f)
            circle(8f, 16f, 1.7f)
        }

    /** A bell with a plus badge — web lucide `BellPlus`, for `alert.rule.create`. */
    val NotificationsAdd: ImageVector =
        stroked("NotificationsAdd") {
            bell()
            moveTo(17.5f, 6f)
            lineTo(17.5f, 10f)
            moveTo(15.5f, 8f)
            lineTo(19.5f, 8f)
        }

    /** A bell with a slash — web lucide `BellOff`, for `alert.rule.delete`. */
    val NotificationsMuted: ImageVector =
        stroked("NotificationsMuted") {
            bell()
            moveTo(4.5f, 4.5f)
            lineTo(19.5f, 19.5f)
        }

    /** Two connected nodes — web lucide `Workflow`, for the automation actions. */
    val Workflow: ImageVector =
        stroked("Workflow") {
            roundRect(3f, 3f, 9f, 9f, 1.5f)
            roundRect(15f, 15f, 21f, 21f, 1.5f)
            moveTo(6f, 9f)
            lineTo(6f, 18f)
            lineTo(15f, 18f)
        }

    /** A 2×2 grid — web lucide `LayoutGrid`, for `dashboard.layout.save`. */
    val LayoutGrid: ImageVector =
        stroked("LayoutGrid") {
            roundRect(3f, 3f, 10f, 10f, 1.5f)
            roundRect(14f, 3f, 21f, 10f, 1.5f)
            roundRect(3f, 14f, 10f, 21f, 1.5f)
            roundRect(14f, 14f, 21f, 21f, 1.5f)
        }

    /** A key — web lucide `Key`, for the `api_key` actions. */
    val Key: ImageVector =
        stroked("Key") {
            circle(8f, 8f, 3.2f)
            moveTo(10.3f, 10.3f)
            lineTo(20f, 20f)
            moveTo(15f, 15f)
            lineTo(13f, 17f)
            moveTo(18f, 18f)
            lineTo(16f, 20f)
        }

    private val byKind: Map<ActivityGlyph, ImageVector> =
        mapOf(
            ActivityGlyph.Gamepad to Gamepad,
            ActivityGlyph.Power to Power,
            ActivityGlyph.NotificationsActive to FeedbackGlyphs.Bell,
            ActivityGlyph.Lock to DataDisplayGlyphs.Lock,
            ActivityGlyph.Unlock to Unlock,
            ActivityGlyph.Climate to DataDisplayGlyphs.Snowflake,
            ActivityGlyph.Bolt to DataDisplayGlyphs.Bolt,
            ActivityGlyph.Settings to Settings,
            ActivityGlyph.NotificationsAdd to NotificationsAdd,
            ActivityGlyph.Notifications to FeedbackGlyphs.Bell,
            ActivityGlyph.NotificationsMuted to NotificationsMuted,
            ActivityGlyph.Workflow to Workflow,
            ActivityGlyph.LayoutGrid to LayoutGrid,
            ActivityGlyph.Dashboard to DataDisplayGlyphs.Gauge,
            ActivityGlyph.Download to FeedbackGlyphs.Download,
            ActivityGlyph.Key to Key,
            ActivityGlyph.User to DataDisplayGlyphs.Person,
            ActivityGlyph.History to DataDisplayGlyphs.History,
        )

    /** Resolves a pure [ActivityGlyph] key to its concrete vector (shared set or locally authored). */
    fun resolve(glyph: ActivityGlyph): ImageVector = byKind[glyph] ?: DataDisplayGlyphs.History

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

/** A simplified hand-bell outline shared by the [RecentActivityFeedGlyphs] bell variants. */
private fun PathBuilder.bell() {
    moveTo(7.5f, 16.5f)
    lineTo(16.5f, 16.5f)
    moveTo(9f, 16.5f)
    lineTo(9f, 12f)
    arcTo(3f, 3f, 0f, isMoreThanHalf = false, isPositiveArc = true, 15f, 12f)
    lineTo(15f, 16.5f)
    moveTo(10.5f, 19f)
    arcTo(1.5f, 1.5f, 0f, isMoreThanHalf = false, isPositiveArc = false, 13.5f, 19f)
}

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, isMoreThanHalf = false, isPositiveArc = true, cx + r, cy)
    arcTo(r, r, 0f, isMoreThanHalf = false, isPositiveArc = true, cx - r, cy)
    close()
}

/** Draws a clockwise rounded rectangle from ([left], [top]) to ([right], [bottom]) with corner [radius]. */
private fun PathBuilder.roundRect(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
    radius: Float,
) {
    moveTo(left + radius, top)
    lineTo(right - radius, top)
    arcTo(radius, radius, 0f, isMoreThanHalf = false, isPositiveArc = true, right, top + radius)
    lineTo(right, bottom - radius)
    arcTo(radius, radius, 0f, isMoreThanHalf = false, isPositiveArc = true, right - radius, bottom)
    lineTo(left + radius, bottom)
    arcTo(radius, radius, 0f, isMoreThanHalf = false, isPositiveArc = true, left, bottom - radius)
    lineTo(left, top + radius)
    arcTo(radius, radius, 0f, isMoreThanHalf = false, isPositiveArc = true, left + radius, top)
    close()
}
