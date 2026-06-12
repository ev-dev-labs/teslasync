// Self-contained line-style icon set for the TOTPEnrollmentSection surface, drawn as Material [ImageVector]s.
//
// The web component uses six `lucide-react` glyphs — ShieldCheck, KeyRound, Download, RefreshCw, Trash2 and
// AlertTriangle. Android ships no lucide-equivalent set without the frozen `material-icons-extended` artifact,
// so (exactly as the sibling surfaces do for their lucide ports) each is authored here as a 24×24 stroked
// vector built through the compile-checked [PathBuilder] DSL (never a runtime-parsed path string),
// monochrome (opaque black) and recolored at render time by the `Icon` tint.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TOTPEnrollmentSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.totpenrollmentsection

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The lucide-equivalent glyphs the TOTPEnrollmentSection renders. Each is a recognizable stroked approximation
 * in lucide's 24×24 / 2px-round style, sufficient for the section marker + action affordances the web draws
 * (every glyph is `aria-hidden` in the web source, so it carries no standalone meaning — the accessible name
 * comes from the labelled control around it).
 */
internal object TOTPEnrollmentSectionGlyphs {
    /** lucide `shield-check` — a shield outline enclosing a check mark (the section marker when active). */
    val ShieldCheck: ImageVector =
        stroked("ShieldCheck") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 11f)
            curveTo(19f, 16f, 15.8f, 19.4f, 12f, 21f)
            curveTo(8.2f, 19.4f, 5f, 16f, 5f, 11f)
            lineTo(5f, 6f)
            close()
            moveTo(9f, 12f)
            lineTo(11f, 14f)
            lineTo(15f, 9.5f)
        }

    /** lucide `key-round` — a circular bow on the left with a notched shaft to the right. */
    val KeyRound: ImageVector =
        stroked("KeyRound") {
            circleAt(7.5f, 12f, 3.5f)
            moveTo(11f, 12f)
            lineTo(20f, 12f)
            moveTo(17f, 12f)
            lineTo(17f, 15f)
            moveTo(20f, 12f)
            lineTo(20f, 15.5f)
        }

    /** lucide `download` — a downward arrow dropping into an open tray. */
    val Download: ImageVector =
        stroked("Download") {
            moveTo(12f, 3f)
            lineTo(12f, 15f)
            moveTo(7f, 10f)
            lineTo(12f, 15f)
            lineTo(17f, 10f)
            moveTo(4f, 17f)
            lineTo(4f, 20f)
            lineTo(20f, 20f)
            lineTo(20f, 17f)
        }

    /** lucide `refresh-cw` — a clockwise circular arrow with an arrowhead at the top-right. */
    val RefreshCw: ImageVector =
        stroked("RefreshCw") {
            moveTo(20.5f, 12f)
            arcToRelative(8.5f, 8.5f, 0f, true, true, -2.8f, -6.3f)
            lineTo(20.5f, 8f)
            moveTo(20.5f, 3.5f)
            lineTo(20.5f, 8f)
            lineTo(16f, 8f)
        }

    /** lucide `trash-2` — a lidded can with a top handle and two vertical guides. */
    val Trash2: ImageVector =
        stroked("Trash2") {
            moveTo(3f, 6f)
            lineTo(21f, 6f)
            moveTo(8f, 6f)
            lineTo(8f, 4.5f)
            curveTo(8f, 4.2f, 8.2f, 4f, 8.5f, 4f)
            lineTo(15.5f, 4f)
            curveTo(15.8f, 4f, 16f, 4.2f, 16f, 4.5f)
            lineTo(16f, 6f)
            moveTo(6f, 6f)
            lineTo(6f, 19.5f)
            curveTo(6f, 19.8f, 6.2f, 20f, 6.5f, 20f)
            lineTo(17.5f, 20f)
            curveTo(17.8f, 20f, 18f, 19.8f, 18f, 19.5f)
            lineTo(18f, 6f)
            moveTo(10f, 10f)
            lineTo(10f, 16.5f)
            moveTo(14f, 10f)
            lineTo(14f, 16.5f)
        }

    /** lucide `alert-triangle` — a rounded warning triangle with an exclamation (the open-mode marker). */
    val AlertTriangle: ImageVector =
        stroked("AlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19.5f)
            lineTo(3f, 19.5f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            moveTo(12f, 17f)
            lineTo(12.01f, 17f)
        }

    /** Appends a full circle subpath centered at ([cx], [cy]) with radius [r], built from two semicircle arcs. */
    private fun PathBuilder.circleAt(
        cx: Float,
        cy: Float,
        r: Float,
    ) {
        moveTo(cx - r, cy)
        arcToRelative(r, r, 0f, false, true, 2f * r, 0f)
        arcToRelative(r, r, 0f, false, true, -2f * r, 0f)
        close()
    }

    private fun stroked(
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
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}
