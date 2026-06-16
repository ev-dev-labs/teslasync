// Locally-authored + re-exported vector glyphs for the WeeklyDigestPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/analytics/pages/WeeklyDigestPage.tsx imports Calendar; its digest
// body sub-sections render Car / Gauge / Zap / Clock / DollarSign). This mirrors the established LifetimeStatsPageIcons
// precedent: glyphs the shared catalogs already carry are re-exported from those catalogs (Calendar / Car / Gauge /
// Bolt / Clock), and the one remaining glyph (DollarSign) is authored locally as a 24×24 stroked vector and recolored
// at render via the Icon `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.weeklydigest

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
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
 * The glyph set this surface needs (web lucide icons). The five glyphs the shared catalogs already carry are
 * re-exported so the page reads every icon from one source; the dollar sign is authored locally.
 */
object WeeklyDigestGlyphs {
    /** Calendar — web `Calendar` (the empty-state icon). Reused from the shared forms catalog. */
    val Calendar: ImageVector = FormsGlyphs.Calendar

    /** Vehicle — web `Car` (drives card). Reused from the shared nav catalog. */
    val Car: ImageVector = NavGlyphs.Car

    /** Speedometer — web `Gauge` (distance + efficiency cards). Reused from the shared data-display catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Lightning bolt — web `Zap` (energy card). Reused from the shared data-display catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Clock — web `Clock` (week-over-week header). Reused from the shared data-display catalog. */
    val Clock: ImageVector = DataDisplayGlyphs.Clock

    /** Dollar sign — web `DollarSign` (cost card). */
    val DollarSign: ImageVector =
        strokedGlyph("WeeklyDigestDollarSign") {
            moveTo(16f, 7.5f)
            curveTo(16f, 6.1f, 14.2f, 5.5f, 12f, 5.5f)
            curveTo(9.8f, 5.5f, 8f, 6.4f, 8f, 8.2f)
            curveTo(8f, 12.5f, 16f, 10.5f, 16f, 14.8f)
            curveTo(16f, 16.8f, 14f, 17.5f, 12f, 17.5f)
            curveTo(9.8f, 17.5f, 8f, 16.9f, 8f, 15.5f)
            moveTo(12f, 3f)
            lineTo(12f, 5.5f)
            moveTo(12f, 17.5f)
            lineTo(12f, 21f)
        }
}
