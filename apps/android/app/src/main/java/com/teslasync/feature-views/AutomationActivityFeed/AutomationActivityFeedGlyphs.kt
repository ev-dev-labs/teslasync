// Line-style icon set for the AutomationActivityFeed surface, drawn as Material [ImageVector]s.
//
// The web component (automations/pages/AutomationActivityFeed.tsx) uses eight `lucide-react` glyphs across its
// `statusConfig` and `typeMap`: CheckCircle / XCircle / SkipForward / Activity / Clock / Wifi / WifiOff / Zap.
// The shared `components/datadisplay/DataDisplayGlyphs` set already carries CheckCircle, Clock, Bolt (Zap),
// Wifi and WifiOff in the same monochrome stroked style, so those are reused verbatim (DRY); the three the
// shared sets lack — XCircle, SkipForward, Activity — are authored here as 24×24 stroked vectors in the same
// style. Each is recolored at render time by the `Icon` composable's `tint`, so they inherit the marker accent.
//
// [resolve] turns a pure [AutomationGlyph] key (chosen by the off-device projection) into the concrete vector
// the composable renders, keeping glyph selection unit-testable and the rendering declarative. The connection
// indicator's Wifi/WifiOff glyphs are resolved directly by the composable (they reflect SSE wire health, not a
// run status), so they are not part of this enum.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AutomationActivityFeed) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.automationactivityfeed

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs

/**
 * The activity-marker glyphs, mapped 1:1 onto the web `statusConfig` / `typeMap` lucide icons. [resolve]
 * maps a pure [AutomationGlyph] key to its concrete vector — reusing the shared [DataDisplayGlyphs] for the
 * glyphs that already exist there and the locally-authored ones for the rest.
 */
object AutomationActivityFeedGlyphs {
    /** Circle enclosing an X — web lucide `XCircle`, for `failed` / `cancelled` and `automation.failed`. */
    val XCircle: ImageVector =
        stroked("XCircle") {
            circle(12f, 12f, 9f)
            moveTo(9f, 9f)
            lineTo(15f, 15f)
            moveTo(15f, 9f)
            lineTo(9f, 15f)
        }

    /** Forward triangle + end bar — web lucide `SkipForward`, for `skipped` and `automation.skipped`. */
    val SkipForward: ImageVector =
        stroked("SkipForward") {
            moveTo(5f, 5f)
            lineTo(15f, 12f)
            lineTo(5f, 19f)
            close()
            moveTo(19f, 5f)
            lineTo(19f, 19f)
        }

    /** Heartbeat pulse line — web lucide `Activity`, for `running`, `automation.state_changed`, the header
     * glyph, and the empty-state icon. */
    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    /** Resolves a pure [AutomationGlyph] key to its concrete vector (shared set or locally authored). */
    fun resolve(glyph: AutomationGlyph): ImageVector =
        when (glyph) {
            AutomationGlyph.CheckCircle -> DataDisplayGlyphs.CheckCircle
            AutomationGlyph.XCircle -> XCircle
            AutomationGlyph.SkipForward -> SkipForward
            AutomationGlyph.Activity -> Activity
            AutomationGlyph.Clock -> DataDisplayGlyphs.Clock
            AutomationGlyph.Bolt -> DataDisplayGlyphs.Bolt
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
