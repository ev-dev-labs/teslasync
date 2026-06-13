// Local glyphs for the SecuritySection feature view — the web lucide icons this surface uses that the shared
// component catalogs do not ship: `Unlock`, `DoorClosed`, and `Car` (the header `Shield` and the locked-lock
// `Lock` are reused from `components/datadisplay/DataDisplayGlyphs`, and `Eye` from `components/ui/TeslaGlyphs`).
// Authored as 24×24 stroked vectors mirroring the shared `DataDisplayGlyphs` / sibling SecurityStatusCards
// house style, since this surface's allowed files cannot extend the shared catalog. Each is monochrome (drawn
// in opaque black) and recolored at render time by the `MetricCard` leading-icon tint.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SecuritySection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.securitysection

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

/** The lucide-parity glyphs the SecuritySection tiles render that the shared catalogs do not ship. */
internal object SecuritySectionGlyphs {
    /** Open padlock — web `Unlock` (lock body with the shackle swung open on the right). */
    val Unlock: ImageVector =
        stroked("SecuritySectionUnlock") {
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

    /** Closed door panel with a knob and threshold — web `DoorClosed`. */
    val DoorClosed: ImageVector =
        stroked("SecuritySectionDoorClosed") {
            moveTo(6f, 20f)
            lineTo(6f, 5f)
            lineTo(18f, 5f)
            lineTo(18f, 20f)
            moveTo(3f, 20f)
            lineTo(21f, 20f)
            dot(14f, 12f)
        }

    /** Car silhouette (cabin + body + two wheels) — web `Car` (windows summary tile). */
    val Car: ImageVector =
        stroked("SecuritySectionCar") {
            moveTo(5f, 10.5f)
            lineTo(7f, 6.5f)
            lineTo(17f, 6.5f)
            lineTo(19f, 10.5f)
            moveTo(3f, 10.5f)
            lineTo(21f, 10.5f)
            lineTo(21f, 15f)
            lineTo(3f, 15f)
            close()
            circle(7.5f, 16f, 1.6f)
            circle(16.5f, 16f, 1.6f)
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

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]) — the door knob. */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + DOT_LEN, y)
}

/** Approximates a wheel of radius [r] at ([cx], [cy]) with two semicircular arcs. */
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
