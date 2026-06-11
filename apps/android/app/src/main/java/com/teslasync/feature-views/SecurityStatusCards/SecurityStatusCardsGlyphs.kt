// Local glyphs for the SecurityStatusCards feature view — the web lucide icons this surface uses that the
// shared data-display catalog does not ship: Unlock, ShieldCheck, ShieldAlert, DoorClosed, DoorOpen, Home,
// UserCheck (the `Lock` glyph is reused from `components/datadisplay/DataDisplayGlyphs`). Authored as 24×24
// stroked vectors, mirroring the approach in `DataDisplayGlyphs` and the sibling SecurityStatusWidget's
// hand-authored glyphs, since this surface's allowed files cannot extend the shared catalog. Each is
// monochrome and recolored at render time by the `Icon` composable's `tint`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SecurityStatusCards) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.securitystatuscards

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val GLYPH_DIMEN = 24f
private const val GLYPH_STROKE = 2f
private const val DOT_LEN = 0.1f

/**
 * The lucide-parity glyphs the SecurityStatusCards render layer maps each card kind + state onto. Drawn as
 * stroked 24×24 vectors with round caps/joins, matching the shared `DataDisplayGlyphs` house style.
 */
object SecurityStatusCardsGlyphs {
    /** Open padlock — web `Unlock` (lock body with the shackle swung open on the right). */
    val Unlock: ImageVector =
        stroked("SecurityCardsUnlock") {
            moveTo(5f, 11f)
            lineTo(19f, 11f)
            lineTo(19f, 20f)
            lineTo(5f, 20f)
            close()
            moveTo(8f, 11f)
            lineTo(8f, 8f)
            curveTo(8f, 5.8f, 9.8f, 4f, 12f, 4f)
            curveTo(14.2f, 4f, 16f, 5.8f, 16f, 8f)
        }

    /** Shield with a check — web `ShieldCheck` (sentry active). */
    val ShieldCheck: ImageVector =
        stroked("SecurityCardsShieldCheck") {
            shieldOutline()
            moveTo(9f, 12f)
            lineTo(11.5f, 14.5f)
            lineTo(15.5f, 9.5f)
        }

    /** Shield with an exclamation — web `ShieldAlert` (sentry off). */
    val ShieldAlert: ImageVector =
        stroked("SecurityCardsShieldAlert") {
            shieldOutline()
            moveTo(12f, 8f)
            lineTo(12f, 13f)
            dot(12f, 16.5f)
        }

    /** Closed door panel with a knob and threshold — web `DoorClosed`. */
    val DoorClosed: ImageVector =
        stroked("SecurityCardsDoorClosed") {
            moveTo(6f, 20f)
            lineTo(6f, 5f)
            lineTo(18f, 5f)
            lineTo(18f, 20f)
            moveTo(3f, 20f)
            lineTo(21f, 20f)
            dot(14f, 12f)
        }

    /** Door ajar (angled panel) with a knob and threshold — web `DoorOpen`. */
    val DoorOpen: ImageVector =
        stroked("SecurityCardsDoorOpen") {
            moveTo(14f, 3f)
            lineTo(14f, 21f)
            lineTo(7f, 19f)
            lineTo(7f, 5f)
            close()
            moveTo(14f, 4f)
            lineTo(18f, 4f)
            lineTo(18f, 20f)
            moveTo(3f, 21f)
            lineTo(21f, 21f)
            dot(10f, 12f)
        }

    /** House outline with a door — web `Home` (HomeLink proximity). */
    val Home: ImageVector =
        stroked("SecurityCardsHome") {
            moveTo(3f, 9f)
            lineTo(12f, 2f)
            lineTo(21f, 9f)
            lineTo(21f, 20f)
            lineTo(3f, 20f)
            close()
            moveTo(9f, 20f)
            lineTo(9f, 12f)
            lineTo(15f, 12f)
            lineTo(15f, 20f)
        }

    /** Person with a check — web `UserCheck` (guest mode). */
    val UserCheck: ImageVector =
        stroked("SecurityCardsUserCheck") {
            circle(9f, 8f, 3.5f)
            moveTo(2f, 20f)
            curveTo(2f, 16f, 5f, 14f, 9f, 14f)
            curveTo(11f, 14f, 12.7f, 14.5f, 14f, 15.3f)
            moveTo(16f, 12f)
            lineTo(18f, 14f)
            lineTo(22f, 9f)
        }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = GLYPH_DIMEN.dp,
                defaultHeight = GLYPH_DIMEN.dp,
                viewportWidth = GLYPH_DIMEN,
                viewportHeight = GLYPH_DIMEN,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = GLYPH_STROKE,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

/** The shared shield silhouette used by both shield glyphs (web lucide shield body). */
private fun PathBuilder.shieldOutline() {
    moveTo(12f, 3f)
    lineTo(19f, 6f)
    lineTo(19f, 12f)
    curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
    curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
    lineTo(5f, 6f)
    close()
}

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + DOT_LEN, y)
}

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}
