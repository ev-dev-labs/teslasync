// Self-contained line-style icon set for the ShareDriveDialog surface, drawn as Material [ImageVector]s.
//
// The web component uses `lucide-react` glyphs (Link, Trash2, Eye, ExternalLink). `Eye` is already in the shared
// `TeslaGlyphs` set (reused by the surface for the per-row view count) and the per-row copy affordance is the shared
// `CopyButton` (its own glyph); the two this surface still needs — the revoke `trash-2` and the open-in-browser
// `external-link` — are authored here as 24×24 stroked vectors, exactly as the sibling DrivingTips / RecentDrivesList
// surfaces author their lucide ports. The web's decorative `Link` glyph on the Generate button is intentionally not
// reproduced: a Material 3 text button needs no leading flourish, and the label already names the action, so adding a
// hand-authored chain glyph would be polish for polish's sake. Each glyph is monochrome (drawn in opaque black) and
// recoloured at render time by the [io.teslasync.android.components.ui.Icon] composable's `tint`, so it inherits the
// content/accent colour each call site sets (the web `text-red-400` revoke tint, the inherited button tint for open).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/ShareDriveDialog) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.sharedrivedialog

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyphs the ShareDriveDialog surface renders. */
internal object ShareDriveDialogGlyphs {
    /** lucide `trash-2` — the revoke affordance: a lid + handle over a tapered can with two inner streaks. */
    val Trash: ImageVector =
        stroked("Trash") {
            moveTo(4f, 7f)
            lineTo(20f, 7f)
            moveTo(9f, 7f)
            lineTo(9f, 5f)
            lineTo(15f, 5f)
            lineTo(15f, 7f)
            moveTo(6f, 7f)
            lineTo(7f, 20f)
            lineTo(17f, 20f)
            lineTo(18f, 7f)
            moveTo(10f, 10.5f)
            lineTo(10f, 16.5f)
            moveTo(14f, 10.5f)
            lineTo(14f, 16.5f)
        }

    /** lucide `external-link` — the open-in-browser affordance: an open frame with an out-pointing arrow. */
    val ExternalLink: ImageVector =
        stroked("ExternalLink") {
            moveTo(12f, 5f)
            lineTo(5f, 5f)
            lineTo(5f, 19f)
            lineTo(19f, 19f)
            lineTo(19f, 12f)
            moveTo(10f, 14f)
            lineTo(19f, 5f)
            moveTo(14f, 5f)
            lineTo(19f, 5f)
            lineTo(19f, 10f)
        }
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
