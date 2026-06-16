// Locally-authored stroked vector glyphs for the RbacMatrixPage surface — the native counterparts of the web
// lucide icons the page uses (`ShieldCheck` for the effective-permissions pill + empty state, `Unlock` for
// the Edit affordance, `Lock` for the Save affordance). This mirrors the established admin precedent
// (FeedbackQueuePage / ApiLogsPage glyph sets): a glyph is authored locally as a 24×24 stroked vector and
// recolored at render via the Icon `tint`, rather than editing the shared TeslaGlyphs catalog (out of scope
// here). The check / dash marks the read-only cells draw reuse the shared
// [io.teslasync.android.components.ui.TeslaGlyphs].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.rbac

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

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]) — a keyhole/peg mark. */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]) — the padlock body. */
private fun PathBuilder.rect(
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

/** The local glyph set this surface needs (web lucide icons not present in the shared catalog). */
object RbacGlyphs {
    /** A shield outline with an interior check — web `ShieldCheck` (effective-permissions pill + empty state). */
    val ShieldCheck: ImageVector =
        strokedGlyph("RbacShieldCheck") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 11f)
            curveTo(19f, 16f, 15.5f, 19.5f, 12f, 21f)
            curveTo(8.5f, 19.5f, 5f, 16f, 5f, 11f)
            lineTo(5f, 6f)
            close()
            moveTo(9f, 12f)
            lineTo(11.2f, 14.2f)
            lineTo(15.5f, 9.5f)
        }

    /** A closed padlock — web `Lock` (the Save affordance). */
    val Lock: ImageVector =
        strokedGlyph("RbacLock") {
            rect(5f, 11f, 19f, 20f)
            moveTo(8f, 11f)
            lineTo(8f, 7.5f)
            curveTo(8f, 5.3f, 9.8f, 3.5f, 12f, 3.5f)
            curveTo(14.2f, 3.5f, 16f, 5.3f, 16f, 7.5f)
            lineTo(16f, 11f)
            dot(12f, 15.5f)
        }

    /** An open padlock (shackle lifted on one side) — web `Unlock` (the Edit affordance). */
    val Unlock: ImageVector =
        strokedGlyph("RbacUnlock") {
            rect(5f, 11f, 19f, 20f)
            moveTo(8f, 11f)
            lineTo(8f, 7.5f)
            curveTo(8f, 5.3f, 9.8f, 3.5f, 12f, 3.5f)
            curveTo(13.8f, 3.5f, 15.4f, 4.7f, 15.9f, 6.3f)
            dot(12f, 15.5f)
        }
}
