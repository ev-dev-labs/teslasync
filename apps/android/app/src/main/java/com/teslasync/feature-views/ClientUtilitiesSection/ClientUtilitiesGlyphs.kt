// Locally-authored 24×24 stroked icons for the client-utilities registry — the Android stand-ins for the
// web `lucide-react` glyphs (`Car`, `Key`, `Braces`, …) the section maps to each tool. Android ships no
// lucide equivalent, so the surface authors its own monochrome [ImageVector]s (recolored at render time by
// `Icon`'s `tint`) — the same approach the sibling SignalCatalog / CommandQuickActions widgets use. Clock
// and Lock are reused from the shared [FeedbackGlyphs] set (already lucide-derived) to avoid duplication.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ClientUtilitiesSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.feature.views.clientutilities

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.feedback.FeedbackGlyphs

/**
 * The icon set the [ClientUtilitiesCatalog] references — one recognizable, monochrome glyph per tool,
 * authored as 24×24 round-capped stroked vectors so they inherit the Material 3 content color in every
 * theme. Purely decorative (the card's name text carries the meaning), so each is rendered with a `null`
 * content description at the call site.
 */
object ClientUtilitiesGlyphs {
    /** lucide `Car` — vehicle body, cabin and two wheels (VIN Decoder). */
    val Car: ImageVector =
        glyph("Car") {
            moveTo(3f, 16f)
            lineTo(4f, 12f)
            lineTo(7f, 12f)
            lineTo(9f, 8f)
            lineTo(15f, 8f)
            lineTo(17f, 12f)
            lineTo(20f, 12f)
            lineTo(21f, 16f)
            moveTo(3f, 16f)
            lineTo(21f, 16f)
            circle(7.5f, 17f, 1.6f)
            circle(16.5f, 17f, 1.6f)
        }

    /** lucide `Key` — ring bow, shaft and two teeth (JWT Decoder). */
    val Key: ImageVector =
        glyph("Key") {
            circle(8f, 9f, 3.2f)
            moveTo(10.3f, 11.3f)
            lineTo(19f, 20f)
            moveTo(16f, 17f)
            lineTo(18.5f, 14.5f)
            moveTo(13.7f, 14.7f)
            lineTo(15.5f, 12.9f)
        }

    /** lucide `Braces` — a curly-brace pair `{ }` (Base64 + JSON Formatter). */
    val Braces: ImageVector =
        glyph("Braces") {
            moveTo(9f, 5f)
            lineTo(7.5f, 5f)
            lineTo(7.5f, 11f)
            lineTo(6f, 12f)
            lineTo(7.5f, 13f)
            lineTo(7.5f, 19f)
            lineTo(9f, 19f)
            moveTo(15f, 5f)
            lineTo(16.5f, 5f)
            lineTo(16.5f, 11f)
            lineTo(18f, 12f)
            lineTo(16.5f, 13f)
            lineTo(16.5f, 19f)
            lineTo(15f, 19f)
        }

    /** lucide `Link` — two nodes joined by a diagonal connector (URL Encoder). */
    val Link: ImageVector =
        glyph("Link") {
            circle(8f, 16f, 2.4f)
            circle(16f, 8f, 2.4f)
            moveTo(9.7f, 14.3f)
            lineTo(14.3f, 9.7f)
        }

    /** lucide `Fingerprint` — nested ridge arcs over a center tick (UUID Generator). */
    val Fingerprint: ImageVector =
        glyph("Fingerprint") {
            moveTo(8f, 15f)
            arcTo(4f, 4f, 0f, false, true, 16f, 15f)
            moveTo(6.5f, 15f)
            arcTo(5.5f, 5.5f, 0f, false, true, 17.5f, 15f)
            moveTo(12f, 11f)
            lineTo(12f, 16f)
        }

    /** lucide `Hash` — the `#` glyph (Hash Calculator). */
    val Hash: ImageVector =
        glyph("Hash") {
            moveTo(9f, 4f)
            lineTo(7f, 20f)
            moveTo(17f, 4f)
            lineTo(15f, 20f)
            moveTo(5f, 9f)
            lineTo(19f, 9f)
            moveTo(5f, 15f)
            lineTo(19f, 15f)
        }

    /** lucide `HardDrive` — a drive body, platter line and activity dot (Byte Size). */
    val HardDrive: ImageVector =
        glyph("HardDrive") {
            moveTo(4f, 9f)
            lineTo(20f, 9f)
            lineTo(20f, 15f)
            lineTo(4f, 15f)
            lineTo(4f, 9f)
            moveTo(4f, 12f)
            lineTo(20f, 12f)
            circle(16.5f, 13.5f, 0.7f)
        }

    /** lucide `Palette` — a round palette with three paint wells (Color Converter). */
    val Palette: ImageVector =
        glyph("Palette") {
            circle(12f, 12f, 7.5f)
            circle(9f, 9f, 0.9f)
            circle(15f, 9f, 0.9f)
            circle(9f, 15f, 0.9f)
        }

    /** lucide `Timer` — a stopwatch with top stem and hand (Cron Parser). */
    val Timer: ImageVector =
        glyph("Timer") {
            moveTo(10f, 3f)
            lineTo(14f, 3f)
            moveTo(12f, 3f)
            lineTo(12f, 5f)
            circle(12f, 13f, 7f)
            moveTo(12f, 13f)
            lineTo(12f, 9f)
        }

    /** lucide `Network` — a parent node linked to two children (HTTP Status). */
    val Network: ImageVector =
        glyph("Network") {
            circle(12f, 5f, 2f)
            circle(6f, 19f, 2f)
            circle(18f, 19f, 2f)
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            moveTo(12f, 12f)
            lineTo(6f, 17f)
            moveTo(12f, 12f)
            lineTo(18f, 17f)
        }

    /** lucide `BookOpen` — an open book with spine and two pages (Tesla API Ref). */
    val BookOpen: ImageVector =
        glyph("BookOpen") {
            moveTo(12f, 7f)
            lineTo(12f, 20f)
            moveTo(12f, 7f)
            lineTo(4f, 5.5f)
            lineTo(4f, 17.5f)
            lineTo(12f, 19f)
            moveTo(12f, 7f)
            lineTo(20f, 5.5f)
            lineTo(20f, 17.5f)
            lineTo(12f, 19f)
        }

    /** lucide `Regex` — brackets around an asterisk and a literal dot (Regex Tester). */
    val Regex: ImageVector =
        glyph("Regex") {
            moveTo(7f, 6f)
            lineTo(5f, 6f)
            lineTo(5f, 18f)
            lineTo(7f, 18f)
            moveTo(17f, 6f)
            lineTo(19f, 6f)
            lineTo(19f, 18f)
            lineTo(17f, 18f)
            moveTo(12f, 7f)
            lineTo(12f, 13f)
            moveTo(9.5f, 8.5f)
            lineTo(14.5f, 11.5f)
            moveTo(14.5f, 8.5f)
            lineTo(9.5f, 11.5f)
            circle(12f, 16.5f, 0.6f)
        }

    /** lucide `Clock` — reused from the shared feedback glyph set (Timestamp). */
    val Clock: ImageVector get() = FeedbackGlyphs.Clock

    /** lucide `Lock` — reused from the shared feedback glyph set (Unix Permission). */
    val Lock: ImageVector get() = FeedbackGlyphs.Lock
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

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
