// Local lucide glyphs for the InboxBody feature view. The web component draws nine lucide icons (`Bell`,
// `Archive`, `ArchiveRestore`, `Mail`, `MailOpen`, `Trash2`, `CheckCheck`, `Layers`, `List`). Android has no
// bundled lucide set, and feature views may not expand the shared icon library from a surface prompt
// (allowed-files), so they are authored here as 24×24 stroked vectors in the shared monochrome style —
// recolored at render time by the `Icon` composable's tint, exactly as the sibling surfaces author their local
// glyphs. (`ExternalLink`, the "View context" glyph, already exists in the shared DataDisplayGlyphs set and is
// reused there rather than re-authored.)
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/InboxBody) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed for the co-located glyph declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.inboxbody

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The web header / inbox-empty `Bell` (lucide) — a bell dome with a rim and a clapper. */
val BellGlyph: ImageVector =
    strokedGlyph("Bell") {
        moveTo(12f, 3f)
        lineTo(12f, 5f)
        moveTo(6.5f, 17f)
        lineTo(17.5f, 17f)
        moveTo(7f, 17f)
        lineTo(7f, 11f)
        arcTo(5f, 5f, 0f, false, true, 17f, 11f)
        lineTo(17f, 17f)
        moveTo(10f, 20f)
        arcTo(2f, 2f, 0f, false, false, 14f, 20f)
    }

/** The web bulk/row `Archive` (lucide) — a lidded box with a centered handle slot. */
val ArchiveGlyph: ImageVector =
    strokedGlyph("Archive") {
        archiveBox()
        moveTo(10f, 12f)
        lineTo(14f, 12f)
    }

/** The web `ArchiveRestore` (lucide) — the archive box with a restore (up) arrow. */
val ArchiveRestoreGlyph: ImageVector =
    strokedGlyph("ArchiveRestore") {
        archiveBox()
        moveTo(12f, 17f)
        lineTo(12f, 12f)
        moveTo(9.5f, 14.5f)
        lineTo(12f, 12f)
        lineTo(14.5f, 14.5f)
    }

/** The web row `MailOpen` (lucide) — an opened envelope (the read-state row glyph). */
val MailOpenGlyph: ImageVector =
    strokedGlyph("MailOpen") {
        moveTo(3f, 10f)
        lineTo(12f, 4f)
        lineTo(21f, 10f)
        moveTo(3f, 10f)
        lineTo(3f, 18f)
        lineTo(21f, 18f)
        lineTo(21f, 10f)
        moveTo(3f, 18f)
        lineTo(10f, 13f)
        moveTo(21f, 18f)
        lineTo(14f, 13f)
    }

/** The web row `Mail` (lucide) — a closed envelope (the mark-unread row glyph). */
val MailGlyph: ImageVector =
    strokedGlyph("Mail") {
        moveTo(3f, 6f)
        lineTo(21f, 6f)
        lineTo(21f, 18f)
        lineTo(3f, 18f)
        close()
        moveTo(3f, 7f)
        lineTo(12f, 13f)
        lineTo(21f, 7f)
    }

/** The web `Trash2` (lucide) — a trash can with a lid and two ribs (the delete glyph). */
val TrashGlyph: ImageVector =
    strokedGlyph("Trash") {
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
        moveTo(10f, 11f)
        lineTo(10f, 17f)
        moveTo(14f, 11f)
        lineTo(14f, 17f)
    }

/** The web `CheckCheck` (lucide) — the double check of the "Mark all read" affordance. */
val CheckCheckGlyph: ImageVector =
    strokedGlyph("CheckCheck") {
        moveTo(2f, 12f)
        lineTo(7f, 17f)
        lineTo(13f, 9f)
        moveTo(11f, 15f)
        lineTo(12.5f, 16.5f)
        lineTo(22f, 6f)
    }

/** The web `Layers` (lucide) — three stacked planes of the grouped-view toggle. */
val LayersGlyph: ImageVector =
    strokedGlyph("Layers") {
        moveTo(12f, 3f)
        lineTo(21f, 8f)
        lineTo(12f, 13f)
        lineTo(3f, 8f)
        close()
        moveTo(3f, 12f)
        lineTo(12f, 17f)
        lineTo(21f, 12f)
        moveTo(3f, 16f)
        lineTo(12f, 21f)
        lineTo(21f, 16f)
    }

/** The web `List` (lucide) — three bulleted lines of the flat-view toggle. */
val ListGlyph: ImageVector =
    strokedGlyph("List") {
        moveTo(8f, 6f)
        lineTo(21f, 6f)
        moveTo(8f, 12f)
        lineTo(21f, 12f)
        moveTo(8f, 18f)
        lineTo(21f, 18f)
        bulletDot(3.5f, 6f)
        bulletDot(3.5f, 12f)
        bulletDot(3.5f, 18f)
    }

/** The lidded box shared by [ArchiveGlyph] and [ArchiveRestoreGlyph] — a top lid plus the body. */
private fun PathBuilder.archiveBox() {
    moveTo(3f, 5f)
    lineTo(21f, 5f)
    lineTo(21f, 8f)
    lineTo(3f, 8f)
    close()
    moveTo(5f, 8f)
    lineTo(5f, 19f)
    lineTo(19f, 19f)
    lineTo(19f, 8f)
}

/** A round-capped near-zero-length segment that renders as a bullet dot at ([x], [y]). */
private fun PathBuilder.bulletDot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
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
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()
