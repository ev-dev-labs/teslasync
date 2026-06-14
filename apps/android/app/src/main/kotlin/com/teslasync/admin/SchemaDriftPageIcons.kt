// Locally-authored stroked vector glyphs for the SchemaDriftPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/admin/pages/SchemaDriftPage.tsx imports `Fingerprint`,
// `AlertTriangle`, `CheckCircle2`). This mirrors the established admin-page precedent
// (IngestXRayPageIcons / ApiLogsPageIcons): each glyph is authored locally as a 24×24 stroked vector and
// recolored at render via the Icon `tint`, rather than editing the shared TeslaGlyphs catalog (out of scope
// here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.schemadrift

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

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

/** The local glyph set this surface needs (web lucide icons). */
object SchemaDriftGlyphs {
    /** Concentric fingerprint ridges — web `Fingerprint` (the no-fingerprint empty state). */
    val Fingerprint: ImageVector =
        strokedGlyph("SchemaDriftFingerprint") {
            moveTo(4f, 12f)
            curveTo(4f, 7.6f, 7.6f, 4f, 12f, 4f)
            curveTo(16.4f, 4f, 20f, 7.6f, 20f, 12f)
            moveTo(7f, 13f)
            curveTo(7f, 9.1f, 9.9f, 6.5f, 12f, 6.5f)
            curveTo(15f, 6.5f, 17f, 9f, 17f, 12.5f)
            curveTo(17f, 14.5f, 16.7f, 16.3f, 16f, 18f)
            moveTo(10f, 9.7f)
            curveTo(11f, 9.2f, 12.6f, 9.2f, 13.5f, 10.2f)
            curveTo(14.2f, 11f, 14.3f, 12.4f, 14.2f, 13.6f)
            curveTo(14.1f, 15.2f, 13.7f, 16.8f, 13f, 18.3f)
            moveTo(11.4f, 12f)
            curveTo(11.7f, 11.8f, 12.2f, 11.9f, 12.4f, 12.3f)
            curveTo(12.7f, 13.6f, 12.5f, 15.1f, 12f, 16.4f)
        }

    /** Warning triangle with an exclamation — web `AlertTriangle` (the drift-detected status badge). */
    val AlertTriangle: ImageVector =
        strokedGlyph("SchemaDriftAlertTriangle") {
            moveTo(12f, 3f)
            lineTo(22f, 20f)
            lineTo(2f, 20f)
            close()
            moveTo(12f, 9f)
            lineTo(12f, 14f)
            moveTo(12f, 17f)
            lineTo(12.01f, 17f)
        }

    /** A check inside a circle — web `CheckCircle2` (the no-drift status badge). */
    val CheckCircle2: ImageVector =
        strokedGlyph("SchemaDriftCheckCircle2") {
            moveTo(21f, 12f)
            arcToRelative(9f, 9f, 0f, isMoreThanHalf = false, isPositiveArc = true, -18f, 0f)
            arcToRelative(9f, 9f, 0f, isMoreThanHalf = false, isPositiveArc = true, 18f, 0f)
            moveTo(8.5f, 12.5f)
            lineTo(11f, 15f)
            lineTo(16f, 9f)
        }
}
