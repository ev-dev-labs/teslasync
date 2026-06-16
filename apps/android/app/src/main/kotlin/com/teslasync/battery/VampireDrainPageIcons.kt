// Locally-authored stroked vector glyphs for the VampireDrainPage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/battery/pages/VampireDrainPage.tsx imports BatteryWarning, Clock, Zap,
// Activity, Lightbulb, ShieldAlert). This mirrors the established battery/energy-page precedent
// (EnergyProductsPageIcons / BatteryHealthPageIcons): glyphs the shared catalogs already carry are re-exported from
// those catalogs (Zap=Bolt / Clock), and the remainder (Activity / BatteryWarning / Lightbulb / ShieldAlert) are
// authored locally as 24×24 stroked vectors and recolored at render via the Icon `tint`, rather than editing the shared
// catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.vampiredrain

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs

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
 * The glyph set this surface needs (web lucide icons). The two glyphs the shared catalog already carries are
 * re-exported so the page reads them from one source; the other four are authored locally.
 */
object VampireGlyphs {
    /** Lightning bolt — web `Zap` (Avg-Drain-Rate tile). Reused from the shared data-display catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Clock — web `Clock` (polling-interval tip). Reused from the shared data-display catalog. */
    val Clock: ImageVector = DataDisplayGlyphs.Clock

    /** Activity pulse line — web `Activity` (Worst-Session tile / drain rate). A baseline with a single spike. */
    val Activity: ImageVector =
        strokedGlyph("VampireActivity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 4f)
            lineTo(14f, 20f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }

    /** Battery with a warning bar — web `BatteryWarning` (Total-Phantom-Loss tile, app-frequency tip). */
    val BatteryWarning: ImageVector =
        strokedGlyph("VampireBatteryWarning") {
            moveTo(2f, 8f)
            lineTo(13f, 8f)
            lineTo(13f, 16f)
            lineTo(2f, 16f)
            close()
            moveTo(16f, 11f)
            lineTo(16f, 13f)
            moveTo(20f, 10f)
            lineTo(20f, 14f)
            moveTo(7.5f, 10.5f)
            lineTo(7.5f, 12.5f)
            moveTo(7.5f, 14f)
            lineTo(7.5f, 14.1f)
        }

    /** Lightbulb — web `Lightbulb` (Tips panel header). A glass bulb plus a two-line base. */
    val Lightbulb: ImageVector =
        strokedGlyph("VampireLightbulb") {
            moveTo(9f, 18f)
            lineTo(15f, 18f)
            moveTo(10f, 21f)
            lineTo(14f, 21f)
            moveTo(12f, 3f)
            curveTo(8.7f, 3f, 6f, 5.7f, 6f, 9f)
            curveTo(6f, 11.4f, 7.4f, 13.5f, 9.5f, 14.5f)
            lineTo(9.5f, 17f)
            lineTo(14.5f, 17f)
            lineTo(14.5f, 14.5f)
            curveTo(16.6f, 13.5f, 18f, 11.4f, 18f, 9f)
            curveTo(18f, 5.7f, 15.3f, 3f, 12f, 3f)
            close()
        }

    /** Shield with an exclamation — web `ShieldAlert` (Drain-Score tile, Sentry-mode tip). */
    val ShieldAlert: ImageVector =
        strokedGlyph("VampireShieldAlert") {
            moveTo(12f, 2f)
            lineTo(20f, 5f)
            lineTo(20f, 11f)
            curveTo(20f, 16f, 16.5f, 20f, 12f, 22f)
            curveTo(7.5f, 20f, 4f, 16f, 4f, 11f)
            lineTo(4f, 5f)
            close()
            moveTo(12f, 8f)
            lineTo(12f, 12f)
            moveTo(12f, 15.5f)
            lineTo(12f, 15.6f)
        }
}
