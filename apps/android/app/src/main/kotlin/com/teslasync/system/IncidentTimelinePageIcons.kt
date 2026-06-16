// Locally-authored stroked vector glyphs for the IncidentTimelinePage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/system/pages/IncidentTimelinePage.tsx imports ArrowLeft,
// AlertCircle, AlertTriangle, AlertOctagon, CheckCircle2, Clock, MessageSquare). The shared icon catalog
// (TeslaGlyphs) ships none of these page glyphs and editing it is outside this surface's allowed files, so they are
// authored here as 24×24 monochrome stroked vectors and recolored at render via the `Icon` tint — exactly the
// approach the sibling A7 page surfaces document (CommandsPageIcons, GlancePageIcons).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.incidenttimeline

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/**
 * The glyph set this surface needs (the web IncidentTimelinePage lucide icons). Each is a monochrome 24×24 stroked
 * vector recolored by the `Icon` tint at the render boundary, so it inherits every theme/state color automatically.
 */
object IncidentTimelineGlyphs {
    /** Arrow-left — web `ArrowLeft` (the Back header action + the not-found back link). Shaft + chevron head. */
    val ArrowLeft: ImageVector =
        strokedGlyph("IncidentArrowLeft") {
            moveTo(19f, 12f)
            lineTo(5f, 12f)
            moveTo(12f, 19f)
            lineTo(5f, 12f)
            lineTo(12f, 5f)
        }

    /** Alert-circle — web `AlertCircle` (minor severity). Ring + exclamation stem and dot. */
    val AlertCircle: ImageVector =
        strokedGlyph("IncidentAlertCircle") {
            glyphCircle(12f, 12f, 9f)
            moveTo(12f, 8f)
            lineTo(12f, 12.5f)
            glyphCircle(12f, 16f, 0.5f)
        }

    /** Alert-triangle — web `AlertTriangle` (major severity). Triangle + exclamation. */
    val AlertTriangle: ImageVector =
        strokedGlyph("IncidentAlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            glyphCircle(12f, 16.5f, 0.5f)
        }

    /** Alert-octagon — web `AlertOctagon` (critical severity). Cut-corner octagon + exclamation. */
    val AlertOctagon: ImageVector =
        strokedGlyph("IncidentAlertOctagon") {
            moveTo(7.86f, 2f)
            lineTo(16.14f, 2f)
            lineTo(22f, 7.86f)
            lineTo(22f, 16.14f)
            lineTo(16.14f, 22f)
            lineTo(7.86f, 22f)
            lineTo(2f, 16.14f)
            lineTo(2f, 7.86f)
            close()
            moveTo(12f, 8f)
            lineTo(12f, 12.5f)
            glyphCircle(12f, 16f, 0.5f)
        }

    /** Check-circle — web `CheckCircle2` (the Resolve action). Ring + check mark. */
    val CheckCircle: ImageVector =
        strokedGlyph("IncidentCheckCircle") {
            glyphCircle(12f, 12f, 9f)
            moveTo(8.5f, 12f)
            lineTo(11f, 14.5f)
            lineTo(15.5f, 9.5f)
        }

    /** Clock — web `Clock` (the "Started …" timestamp). Ring + hour/minute hands. */
    val Clock: ImageVector =
        strokedGlyph("IncidentClock") {
            glyphCircle(12f, 12f, 9f)
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(15.5f, 13.5f)
        }

    /** Message-square — web `MessageSquare` (the Timeline heading). Speech bubble with a bottom-left tail. */
    val MessageSquare: ImageVector =
        strokedGlyph("IncidentMessageSquare") {
            moveTo(3f, 5f)
            lineTo(21f, 5f)
            lineTo(21f, 16f)
            lineTo(8f, 16f)
            lineTo(4f, 20f)
            lineTo(4f, 5f)
            close()
        }
}

/** Builds a 24×24 round-capped stroked [ImageVector]; the stroke color is replaced by the `Icon` tint at render. */
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

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.glyphCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}
