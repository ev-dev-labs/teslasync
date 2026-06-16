// Locally-authored 24×24 stroked icons for the SettingsPage cards, drawn as Material [ImageVector]s. The web
// page (web/src/features/settings/pages/SettingsPage.tsx) uses four `lucide-react` glyphs: `Download` and
// `ExternalLink` on the Data-Export link card, `PlayCircle` on the Onboarding-Tour card, and `Rocket` on the
// Setup-Checklist card. Android ships no lucide set and a page surface may not expand the shared icon library
// from its allowed-files, so each is authored here as a monochrome round-capped stroked vector in the same
// style as the sibling surfaces (e.g. ResetSectionGlyphs) — recolored at render time by `Icon`'s tint. All are
// decorative (the surrounding card title / button label carries the meaning), so each is rendered with a
// `null` content description at its call site.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings) cannot
// form the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.settings.page

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The four icons the page's cards render, ported in the lucide style. Each is a 24×24 round-capped stroked
 * vector so it inherits the Material 3 content color in every theme; each is decorative and rendered with a
 * `null` content description at its call site.
 */
object SettingsPageGlyphs {
    /** lucide `Download` — a down arrow dropping into an open tray (the Data-Export card icon). */
    val Download: ImageVector =
        stroked("Download") {
            moveTo(12f, 3f)
            lineTo(12f, 16f)
            moveTo(7f, 11f)
            lineTo(12f, 16f)
            lineTo(17f, 11f)
            moveTo(4f, 17f)
            lineTo(4f, 21f)
            lineTo(20f, 21f)
            lineTo(20f, 17f)
        }

    /** lucide `PlayCircle` — a play triangle inside a circle (the Onboarding-Tour card icon). */
    val PlayCircle: ImageVector =
        stroked("PlayCircle") {
            moveTo(22f, 12f)
            arcTo(10f, 10f, 0f, true, true, 2f, 12f)
            arcTo(10f, 10f, 0f, true, true, 22f, 12f)
            close()
            moveTo(10f, 8f)
            lineTo(16f, 12f)
            lineTo(10f, 16f)
            close()
        }

    /** lucide `Rocket` — a rocket body with two fins, a flame, and a window dot (the Setup-Checklist icon). */
    val Rocket: ImageVector =
        stroked("Rocket") {
            moveTo(12f, 2f)
            curveTo(15f, 5f, 16f, 9f, 16f, 13f)
            lineTo(8f, 13f)
            curveTo(8f, 9f, 9f, 5f, 12f, 2f)
            close()
            moveTo(8f, 13f)
            lineTo(5f, 16f)
            lineTo(8f, 16f)
            moveTo(16f, 13f)
            lineTo(19f, 16f)
            lineTo(16f, 16f)
            moveTo(10f, 16f)
            lineTo(12f, 20f)
            lineTo(14f, 16f)
            dot(12f, 8f)
        }

    /** lucide `ExternalLink` — a panel with an arrow leaving its top-right corner (the Data-Export affordance). */
    val ExternalLink: ImageVector =
        stroked("ExternalLink") {
            moveTo(13f, 4f)
            lineTo(4f, 4f)
            lineTo(4f, 20f)
            lineTo(20f, 20f)
            lineTo(20f, 11f)
            moveTo(14f, 3f)
            lineTo(21f, 3f)
            lineTo(21f, 10f)
            moveTo(21f, 3f)
            lineTo(11f, 13f)
        }

    /** A round-capped near-zero-length segment that renders as a dot at ([x], [y]) (the rocket window). */
    private fun PathBuilder.dot(
        x: Float,
        y: Float,
    ) {
        moveTo(x, y)
        lineTo(x + 0.1f, y)
    }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
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
                    pathBuilder = build,
                )
            }.build()
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
