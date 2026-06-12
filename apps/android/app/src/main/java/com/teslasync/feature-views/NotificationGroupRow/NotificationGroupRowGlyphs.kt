// Line-style icon set for the NotificationGroupRow surface, drawn as Material [ImageVector]s.
//
// The web component (notifications/components/NotificationGroupRow.tsx) and the row it composes use a handful
// of `lucide-react` glyphs: ChevronDown / ChevronRight (the expand toggle), Loader2 (the members spinner), and
// MailOpen (the "Mark group read" action), plus the per-member read / archive affordances the row carries. The
// shared sets already provide the chevrons (`TeslaGlyphs`), a spinner (`Spinner`), and a bell empty-state icon
// (`FeedbackGlyphs.Bell`), so those are reused verbatim (DRY); the envelope + archive glyphs the shared sets
// lack are authored here as 24×24 stroked vectors in the same monochrome style. Each is recolored at render
// time by the `Icon` composable's `tint`, so they inherit their container's foreground in every theme/state — a
// feature view may not widen the shared icon library from a surface prompt (allowed-files), exactly as the
// sibling feature-view surfaces author their own.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/NotificationGroupRow) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.notificationgrouprow

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The envelope + archive glyphs the row's per-member actions render, authored to match the web lucide icons. */
object NotificationGroupRowGlyphs {
    /** Open envelope — web lucide `MailOpen`, the "Mark group read" + per-row mark-read action. */
    val MailOpen: ImageVector =
        stroked("MailOpen") {
            moveTo(3f, 9f)
            lineTo(3f, 19f)
            lineTo(21f, 19f)
            lineTo(21f, 9f)
            moveTo(3f, 9f)
            lineTo(12f, 3f)
            lineTo(21f, 9f)
            moveTo(3f, 9f)
            lineTo(12f, 14f)
            lineTo(21f, 9f)
        }

    /** Closed envelope — web lucide `Mail`, the per-row mark-unread action (shown while a row is read). */
    val Mail: ImageVector =
        stroked("Mail") {
            moveTo(4f, 5f)
            lineTo(20f, 5f)
            lineTo(20f, 19f)
            lineTo(4f, 19f)
            close()
            moveTo(4f, 6f)
            lineTo(12f, 13f)
            lineTo(20f, 6f)
        }

    /** Lidded box — web lucide `Archive`, the per-row archive action (shown in the active inbox). */
    val Archive: ImageVector =
        stroked("Archive") {
            moveTo(3f, 4f)
            lineTo(21f, 4f)
            lineTo(21f, 8f)
            lineTo(3f, 8f)
            close()
            moveTo(4f, 8f)
            lineTo(4f, 20f)
            lineTo(20f, 20f)
            lineTo(20f, 8f)
            moveTo(10f, 12f)
            lineTo(14f, 12f)
        }

    /** Lidded box with an up-arrow — web lucide `ArchiveRestore`, the per-row restore action (archived mode). */
    val ArchiveRestore: ImageVector =
        stroked("ArchiveRestore") {
            moveTo(3f, 4f)
            lineTo(21f, 4f)
            lineTo(21f, 8f)
            lineTo(3f, 8f)
            close()
            moveTo(4f, 8f)
            lineTo(4f, 20f)
            lineTo(20f, 20f)
            lineTo(20f, 8f)
            moveTo(12f, 17f)
            lineTo(12f, 11f)
            moveTo(9f, 14f)
            lineTo(12f, 11f)
            lineTo(15f, 14f)
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
