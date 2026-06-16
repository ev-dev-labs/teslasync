// Locally-authored + reused stroked vector glyphs for the WatchFacePage wearable surface — the native
// counterparts of the web lucide icons the page renders
// (web/src/features/watch/pages/WatchFacePage.tsx imports Zap, Lock, Unlock, Thermometer, Shield). The shared
// data-display catalog ([DataDisplayGlyphs]) already ships Bolt (Zap), Lock and Shield, so those are reused
// verbatim (DRY); it ships no Unlock or Thermometer and editing it is outside this surface's allowed files, so
// those two are authored here as 24×24 monochrome stroked vectors recolored at render via the `Icon` tint —
// exactly the approach the sibling A7 ports (GlancePageIcons, WatchSummaryWidget) document.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/watch) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located glyph object.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.watch.watchface

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs

private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/**
 * The glyph set this surface needs (the web WatchFacePage lucide icons). Bolt / Lock / Shield are reused from
 * the shared [DataDisplayGlyphs] catalog; Unlock and Thermometer are monochrome 24×24 stroked vectors recolored
 * by the `Icon` tint at the render boundary, so each inherits every theme/state color automatically.
 */
object WatchFaceGlyphs {
    /** Lightning bolt — web `Zap` (the charging indicator). Reused from the shared catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Padlock closed — web `Lock` (the lock action when the vehicle is locked). Reused from the shared catalog. */
    val Lock: ImageVector = DataDisplayGlyphs.Lock

    /** Shield — web `Shield` (the Sentry-Mode indicator). Reused from the shared catalog. */
    val Shield: ImageVector = DataDisplayGlyphs.Shield

    /** Padlock open — web `Unlock` (the unlock action when the vehicle is unlocked). Body + open shackle. */
    val Unlock: ImageVector =
        strokedGlyph("WatchUnlock") {
            // Lock body.
            glyphRect(5f, 11f, 19f, 20f)
            // Open shackle: left post rising and arcing over to the right but not latching back down.
            moveTo(8f, 11f)
            lineTo(8f, 8f)
            curveTo(8f, 5.8f, 9.8f, 4f, 12f, 4f)
            curveTo(13.7f, 4f, 15.1f, 5.0f, 15.7f, 6.5f)
        }

    /** Thermometer — web `Thermometer` (the climate action). Stem with a rounded top + bulb. */
    val Thermometer: ImageVector =
        strokedGlyph("WatchThermometer") {
            moveTo(10f, 13.5f)
            lineTo(10f, 5f)
            arcTo(2f, 2f, 0f, true, true, 14f, 5f)
            lineTo(14f, 13.5f)
            glyphCircle(12f, 16.5f, 3f)
        }
}

/** Builds a monochrome 24×24 stroked [ImageVector] from a [PathBuilder] lambda (round caps + joins). */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Draws a closed rectangle (left, top) → (right, bottom) as a stroked path segment. */
private fun PathBuilder.glyphRect(
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

/** Draws a circle of [radius] centered at ([cx], [cy]) as two semicircular arcs. */
private fun PathBuilder.glyphCircle(
    cx: Float,
    cy: Float,
    radius: Float,
) {
    moveTo(cx - radius, cy)
    arcTo(radius, radius, 0f, false, true, cx + radius, cy)
    arcTo(radius, radius, 0f, false, true, cx - radius, cy)
    close()
}
