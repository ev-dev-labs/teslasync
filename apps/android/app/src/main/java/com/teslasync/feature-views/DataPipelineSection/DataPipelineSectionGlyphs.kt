// Locally-authored 24×24 stroked icons for the DataPipelineSection feature view — the Android stand-ins for
// the web component's `lucide-react` glyphs (Archive, TrendingUp, HardDrive, BarChart3, Clock, Activity,
// CheckCircle, XCircle). Android ships no lucide equivalent, so the surface authors its own monochrome
// [ImageVector]s (recolored at render time by each MetricCard / StatCard accent or the status tone) — the
// same approach the sibling ChargingTab / SecurityStatistics surfaces use. Kept self-contained to this
// surface so the glyphs never couple to another icon set.
//
// The card glyphs are decorative — the localized card label carries the meaning — so each renders with a
// `null` content description; the status glyphs likewise sit beside the textual status, so they too stay out
// of the TalkBack reading order (the row's own description carries the status).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DataPipelineSection) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.datapipelinesection

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The monochrome line glyphs the surface renders — the four compression MetricCard accents, the four export
 * StatCard accents, and the three per-row status icons. Authored as 24×24 round-capped stroked vectors so
 * each inherits the rendering `Icon`'s `tint` (the card accent / status tone) in every theme.
 */
object DataPipelineSectionGlyphs {
    /** lucide `archive` — a lid over a box body with a handle (the header + Compressed tile). */
    val Archive: ImageVector =
        glyph("DataPipelineArchive") {
            rect(3f, 4f, 21f, 8f)
            moveTo(4f, 8f)
            lineTo(4f, 20f)
            lineTo(20f, 20f)
            lineTo(20f, 8f)
            moveTo(10f, 12f)
            lineTo(14f, 12f)
        }

    /** lucide `trending-up` — a rising zig-zag with a corner arrow (the Compression Ratio tile). */
    val TrendingUp: ImageVector =
        glyph("DataPipelineTrendingUp") {
            moveTo(22f, 7f)
            lineTo(13.5f, 15.5f)
            lineTo(8.5f, 10.5f)
            lineTo(2f, 17f)
            moveTo(16f, 7f)
            lineTo(22f, 7f)
            lineTo(22f, 13f)
        }

    /** lucide `hard-drive` — a horizontal drive with a slanted top, an indicator dot, and a divider (Estimated Savings). */
    val HardDrive: ImageVector =
        glyph("DataPipelineHardDrive") {
            moveTo(4f, 12f)
            lineTo(6.2f, 6f)
            lineTo(17.8f, 6f)
            lineTo(20f, 12f)
            rect(3f, 12f, 21f, 18f)
            moveTo(11f, 15f)
            lineTo(17f, 15f)
            dot(7f, 15f)
        }

    /** lucide `bar-chart-3` — an L-shaped axis with three rising bars (the Total Positions tile). */
    val BarChart: ImageVector =
        glyph("DataPipelineBarChart") {
            moveTo(4f, 4f)
            lineTo(4f, 20f)
            lineTo(20f, 20f)
            moveTo(8f, 17f)
            lineTo(8f, 13f)
            moveTo(12f, 17f)
            lineTo(12f, 9f)
            moveTo(16f, 17f)
            lineTo(16f, 11f)
        }

    /** lucide `clock` — a circle with two hands (the Pending tile). */
    val Clock: ImageVector =
        glyph("DataPipelineClock") {
            circle(12f, 12f, 9f)
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }

    /** lucide `activity` — an ECG-style pulse line (the Processing tile). */
    val Activity: ImageVector =
        glyph("DataPipelineActivity") {
            moveTo(3f, 12f)
            lineTo(8f, 12f)
            lineTo(10f, 5f)
            lineTo(14f, 19f)
            lineTo(16f, 12f)
            lineTo(21f, 12f)
        }

    /** lucide `check-circle` — a circle with a check (the Completed tile + the `ready` status icon). */
    val CheckCircle: ImageVector =
        glyph("DataPipelineCheckCircle") {
            circle(12f, 12f, 9f)
            moveTo(8.5f, 12.5f)
            lineTo(11f, 15f)
            lineTo(15.5f, 9.5f)
        }

    /** lucide `x-circle` — a circle with an x (the Failed tile + the `failed` status icon). */
    val XCircle: ImageVector =
        glyph("DataPipelineXCircle") {
            circle(12f, 12f, 9f)
            moveTo(9f, 9f)
            lineTo(15f, 15f)
            moveTo(15f, 9f)
            lineTo(9f, 15f)
        }

    /** lucide `alert-triangle` — a triangle with an exclamation (the `queued`/`processing`/default status icon). */
    val AlertTriangle: ImageVector =
        glyph("DataPipelineAlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            dot(12f, 16.5f)
        }
}

/**
 * Builds a 24×24 round-capped, round-joined stroked [ImageVector] from a [PathBuilder] block — the one
 * authoring helper every glyph in this surface shares. The stroke is solid black so the rendering `Icon`'s
 * `tint` fully recolors it in every theme (light / dark / high-contrast).
 */
private fun glyph(
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

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
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

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
