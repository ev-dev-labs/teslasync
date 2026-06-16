// Locally-authored stroked vector glyphs for the FleetTelemetryCoveragePage surface — the native counterparts
// of the web lucide icons the page uses (the `RefreshCw` refresh control and the `AlertTriangle` warning glyph
// shared by the orphan-fields panel and the error state). This mirrors the established admin precedent
// (ApiLogsPage / FeedbackQueuePage glyph sets): a glyph is authored locally as a 24×24 stroked vector and
// recolored at render via the Icon `tint`, rather than editing the shared TeslaGlyphs catalog (out of scope
// here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.fleettelemetry

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.BadgeVariant

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

/** The local glyph set this surface needs (web lucide icons not present in the shared catalog). */
object FleetTelemetryCoverageGlyphs {
    /** Two circular arrows — web `RefreshCw` (the Refresh control). */
    val Refresh: ImageVector =
        strokedGlyph("CoverageRefresh") {
            moveTo(20f, 11f)
            curveTo(19.5f, 7.1f, 16.1f, 4f, 12f, 4f)
            curveTo(9.2f, 4f, 6.7f, 5.4f, 5.3f, 7.5f)
            moveTo(4f, 13f)
            curveTo(4.5f, 16.9f, 7.9f, 20f, 12f, 20f)
            curveTo(14.8f, 20f, 17.3f, 18.6f, 18.7f, 16.5f)
            // Top-right arrowhead
            moveTo(20f, 5f)
            lineTo(20f, 11f)
            lineTo(14f, 11f)
            // Bottom-left arrowhead
            moveTo(4f, 19f)
            lineTo(4f, 13f)
            lineTo(10f, 13f)
        }

    /** Triangle with a bang — web `AlertTriangle` (orphan-fields warning + error state). */
    val AlertTriangle: ImageVector =
        strokedGlyph("CoverageAlertTriangle") {
            moveTo(12f, 3.5f)
            lineTo(22f, 20.5f)
            lineTo(2f, 20.5f)
            close()
            // Exclamation stem
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            // Exclamation dot
            moveTo(12f, 17.5f)
            lineTo(12.01f, 17.5f)
        }
}

/** Map a [BadgeVariant] from the model's intent to the design-system chip palette (identity helper). */
internal fun subscribedVariant(subscribed: Boolean): BadgeVariant =
    if (subscribed) BadgeVariant.Success else BadgeVariant.Neutral
