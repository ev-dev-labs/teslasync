// Locally-authored 24×24 stroked icon for the UserImpersonateButton surface — the Android stand-in for the web
// `lucide-react` `UserCog` glyph the button renders. Android ships no lucide equivalent without pulling the
// frozen `material-icons-extended` artifact, so the surface authors its own monochrome [ImageVector]
// (recolored at render time by the shared `Icon`/`Button` content color) — the same approach the sibling
// TimestampTool and ClientUtilitiesSection surfaces take. Authoring it here keeps the surface self-contained
// within its allowed-files directory rather than coupling it to another feature's glyph set.
//
// The path data reproduces lucide `user-cog` verbatim (a head + shoulders on the left, a gear hub + eight
// teeth on the right), so the native button reads identically to the web one.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/UserImpersonateButton) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.userimpersonatebutton

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The single glyph the UserImpersonateButton references, authored as a 24×24 round-capped stroked vector so it
 * inherits the Material 3 content color in every theme/state. It is decorative (the button label carries the
 * meaning), so it is rendered with a `null` content description at the call site.
 */
object UserImpersonateButtonGlyphs {
    /** lucide `UserCog` — a person beside a gear, the admin "impersonate / act-as user" affordance. */
    val UserCog: ImageVector =
        glyph("UserImpersonateButtonUserCog") {
            // User: head + shoulders (lucide `circle cx=9 cy=7 r=4` + `M10 15H6a4 4 0 0 0-4 4v2`).
            circle(9f, 7f, 4f)
            moveTo(10f, 15f)
            lineTo(6f, 15f)
            arcTo(4f, 4f, 0f, false, false, 2f, 19f)
            lineTo(2f, 21f)
            // Gear hub (lucide `circle cx=18 cy=15 r=3`).
            circle(18f, 15f, 3f)
            // Gear teeth (lucide's eight short spokes around the hub).
            spoke(21.7f, 16.4f, 20.8f, 16.1f)
            spoke(15.2f, 13.9f, 14.3f, 13.6f)
            spoke(16.6f, 18.7f, 16.9f, 17.8f)
            spoke(19.1f, 12.2f, 19.4f, 11.3f)
            spoke(19.6f, 18.7f, 19.2f, 17.7f)
            spoke(16.8f, 12.3f, 16.4f, 11.3f)
            spoke(14.3f, 16.6f, 15.3f, 16.2f)
            spoke(20.7f, 13.8f, 21.7f, 13.4f)
        }
}

/** Builds a standard 24×24 round-capped stroked [ImageVector] from a single [PathBuilder] program. */
private fun glyph(
    name: String,
    pathBuilder: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = pathBuilder,
            )
        }.build()

/** Emits a full circle of radius [r] centered at ([cx], [cy]) as two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
}

/** Emits one short gear-tooth segment from ([x0], [y0]) to ([x1], [y1]). */
private fun PathBuilder.spoke(
    x0: Float,
    y0: Float,
    x1: Float,
    y1: Float,
) {
    moveTo(x0, y0)
    lineTo(x1, y1)
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
