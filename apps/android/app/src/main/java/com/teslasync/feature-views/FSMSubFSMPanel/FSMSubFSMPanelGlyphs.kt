// Locally authored line-style glyphs for the FSMSubFSMPanel surface — the native analogues of the two web
// lucide icons the panel renders: `Car` (drive sub-FSM) and `Zap` (charge sub-FSM,
// web/src/features/system/components/FSMSubFSMPanel.tsx). Each is a 24×24 round-joined stroked
// [ImageVector] in the shared monochrome glyph style, so it recolors at render time via the [Icon] tint
// (active ⇒ success green, terminal ⇒ muted). They are kept local to this surface (the mandated
// allowed-files path) rather than expanding a shared icon set from a feature prompt — the same approach the
// sibling DrivingSection / SentryModeChart surfaces take.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FSMSubFSMPanel) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the object name.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fsmsubfsmpanel

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-style glyphs FSMSubFSMPanel renders that the shared icon set does not already provide. */
internal object FSMSubFSMPanelGlyphs {
    /** Car glyph (lucide `car`) — the drive sub-FSM icon chip. */
    val Car: ImageVector =
        fsmStroked("FsmSubFsmCar") {
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
            fsmWheel(7.5f, 13f, 2f)
            fsmWheel(16.5f, 13f, 2f)
        }

    /** Lightning-bolt glyph (lucide `zap`) — the charge sub-FSM icon chip. */
    val Zap: ImageVector =
        fsmStroked("FsmSubFsmZap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }
}

/** Builds a 24×24 round-joined stroked vector from a path [build] block — the shared glyph drawing style. */
private fun fsmStroked(
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
private fun PathBuilder.fsmWheel(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = cx + r, y1 = cy)
    arcTo(r, r, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = cx - r, y1 = cy)
    close()
}
