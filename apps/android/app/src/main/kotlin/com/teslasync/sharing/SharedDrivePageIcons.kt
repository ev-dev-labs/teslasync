// Locally-authored stroked vector glyphs for the SharedDrivePage sharing surface — the native counterparts of the
// web lucide icons the page renders (web/src/features/sharing/pages/SharedDrivePage.tsx imports MapPin, Clock, Zap,
// Battery, Mountain, Gauge, TrendingUp). This mirrors the established A7 precedent (LifetimeStatsPageIcons): the
// five glyphs the shared catalogs already carry are re-exported from DataDisplayGlyphs (MapPin / Clock / Zap=Bolt /
// Battery / Gauge), and the remaining two (TrendingUp, Mountain) are authored locally as 24×24 stroked vectors and
// recoloured at render via the Icon `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/sharing) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharing.shareddrive

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

/** Build a 24×24 stroked glyph; the stroke colour is replaced by the Icon `tint` at render. */
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
 * The glyph set this surface needs (web lucide icons). The five glyphs the shared catalogs already carry are
 * re-exported so the page reads every icon from one source; the other two are authored locally.
 */
object SharedDriveGlyphs {
    /** Pin — web `MapPin` (distance card + the unavailable + no-route surfaces). From the shared data-display catalog. */
    val MapPin: ImageVector = DataDisplayGlyphs.MapPin

    /** Clock — web `Clock` (duration card). From the shared data-display catalog. */
    val Clock: ImageVector = DataDisplayGlyphs.Clock

    /** Lightning bolt — web `Zap` (efficiency card + vehicle badge). From the shared data-display catalog. */
    val Zap: ImageVector = DataDisplayGlyphs.Bolt

    /** Battery — web `Battery` (battery card). From the shared data-display catalog. */
    val Battery: ImageVector = DataDisplayGlyphs.Battery

    /** Speedometer — web `Gauge` (max-speed card). From the shared data-display catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Rising trend line — web `TrendingUp` (avg-speed card). */
    val TrendingUp: ImageVector =
        strokedGlyph("SharedDriveTrendingUp") {
            moveTo(2f, 17f)
            lineTo(8.5f, 10.5f)
            lineTo(13.5f, 15.5f)
            lineTo(22f, 7f)
            moveTo(16f, 7f)
            lineTo(22f, 7f)
            lineTo(22f, 13f)
        }

    /** Mountain — web `Mountain` (elevation-gain card). */
    val Mountain: ImageVector =
        strokedGlyph("SharedDriveMountain") {
            moveTo(3f, 20f)
            lineTo(9.5f, 7f)
            lineTo(13.5f, 14f)
            lineTo(16f, 9.5f)
            lineTo(21f, 20f)
            close()
        }
}
