// Locally-authored stroked vector glyphs for the AutomationBuilderPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/automations/pages/AutomationBuilderPage.tsx imports ArrowLeft,
// PlayCircle, Save, X, Zap, AlertTriangle, plus the per-row Plus / ChevronUp / ChevronDown the trigger/condition/action
// editors use). This mirrors the established analytics-page precedent (StatisticsPageIcons): glyphs the shared catalogs
// already carry are re-exported from those catalogs (Play=PlayCircle, X=Close, Zap=Bolt, AlertTriangle=Warning, Plus,
// ChevronUp/Down), and the remainder (ArrowLeft, Save) are authored locally as 24×24 stroked vectors recolored at render
// via the Icon `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations.builder

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.ui.TeslaGlyphs

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
 * the page reads every icon from one source; the other two are authored locally.
 */
object AutomationBuilderGlyphs {
    /** Triangle in a ring — web `PlayCircle` (the Test Run action). Reused from the shared data-display catalog. */
    val Play: ImageVector = DataDisplayGlyphs.Play

    /** Cross — web `X` (the Cancel action + per-row remove). Reused from the shared UI catalog. */
    val Close: ImageVector = TeslaGlyphs.Close

    /** Lightning bolt — web `Zap` (the "test run started" confirmation). Reused from the shared data-display catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Warning triangle — web `AlertTriangle` (the save-error banner + not-found state). Reused from the shared catalog. */
    val Warning: ImageVector = TeslaGlyphs.Warning

    /** Plus — the trigger/condition/action editors' add-row affordance. Reused from the shared UI catalog. */
    val Plus: ImageVector = TeslaGlyphs.Plus

    /** Chevron up — the per-row "move up" affordance. Reused from the shared UI catalog. */
    val ChevronUp: ImageVector = TeslaGlyphs.ChevronUp

    /** Chevron down — the per-row "move down" affordance. Reused from the shared UI catalog. */
    val ChevronDown: ImageVector = TeslaGlyphs.ChevronDown

    /** Left arrow — web `ArrowLeft` (the Back-to-Automations link). */
    val ArrowLeft: ImageVector =
        strokedGlyph("AutomationBuilderArrowLeft") {
            moveTo(19f, 12f)
            lineTo(5f, 12f)
            moveTo(12f, 19f)
            lineTo(5f, 12f)
            lineTo(12f, 5f)
        }

    /** Floppy disk — web `Save` (the Save / Create submit). */
    val Save: ImageVector =
        strokedGlyph("AutomationBuilderSave") {
            moveTo(19f, 21f)
            lineTo(5f, 21f)
            curveTo(3.9f, 21f, 3f, 20.1f, 3f, 19f)
            lineTo(3f, 5f)
            curveTo(3f, 3.9f, 3.9f, 3f, 5f, 3f)
            lineTo(16f, 3f)
            lineTo(21f, 8f)
            lineTo(21f, 19f)
            curveTo(21f, 20.1f, 20.1f, 21f, 19f, 21f)
            close()
            moveTo(17f, 21f)
            lineTo(17f, 13f)
            lineTo(7f, 13f)
            lineTo(7f, 21f)
            moveTo(7f, 3f)
            lineTo(7f, 8f)
            lineTo(15f, 8f)
        }
}
