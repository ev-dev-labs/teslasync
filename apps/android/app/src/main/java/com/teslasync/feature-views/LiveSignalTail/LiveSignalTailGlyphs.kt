// Self-contained line-style icon set for the LiveSignalTail surface, drawn as Material [ImageVector]s.
//
// The web component uses `lucide-react` glyphs (Radio, Activity, ArrowUpDown, Trash2) that the shared
// `TeslaGlyphs` / `DataDisplayGlyphs` / `FormsGlyphs` sets do not all carry, and Android ships no
// lucide-equivalent set without the frozen `material-icons-extended` artifact. So — exactly as the sibling
// LiveMotorStatus / LiveVehicleState surfaces do for their lucide ports — the four this surface needs are
// authored here as 24×24 stroked vectors mirroring the lucide paths. Each is monochrome (drawn in opaque
// black) and recolored at render time by the [io.teslasync.android.components.ui.Icon] composable's `tint`.
// The remaining web glyphs reuse the shared sets: Search -> FormsGlyphs.Search, Play/Pause/ArrowDown ->
// DataDisplayGlyphs, Wifi -> DataDisplayGlyphs.Wifi.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveSignalTail) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livesignaltail

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyphs the LiveSignalTail header, stat cards, and controls render. */
internal object LiveSignalTailGlyphs {
    /** lucide `radio` — the live-tail title: concentric broadcast arcs around a center hub. */
    val Radio: ImageVector =
        stroked("Radio") {
            moveTo(4.9f, 19.1f)
            curveTo(1f, 15.2f, 1f, 8.8f, 4.9f, 4.9f)
            moveTo(7.8f, 16.2f)
            curveTo(5.5f, 13.9f, 5.5f, 10.1f, 7.8f, 7.7f)
            circle(12f, 12f, 2f)
            moveTo(16.2f, 7.8f)
            curveTo(18.5f, 10.1f, 18.5f, 13.9f, 16.2f, 16.3f)
            moveTo(19.1f, 4.9f)
            curveTo(23f, 8.8f, 23f, 15.2f, 19.1f, 19.1f)
        }

    /** lucide `activity` — the stat cards: a single ECG-style pulse line. */
    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    /** lucide `arrow-up-down` — the Buffer Size stat: paired up/down arrows. */
    val ArrowUpDown: ImageVector =
        stroked("ArrowUpDown") {
            moveTo(7f, 4f)
            lineTo(7f, 20f)
            moveTo(3f, 8f)
            lineTo(7f, 4f)
            lineTo(11f, 8f)
            moveTo(17f, 4f)
            lineTo(17f, 20f)
            moveTo(13f, 16f)
            lineTo(17f, 20f)
            lineTo(21f, 16f)
        }

    /** lucide `trash-2` — the Clear control: a lidded waste bin with two vertical bars. */
    val Trash: ImageVector =
        stroked("Trash") {
            moveTo(3f, 6f)
            lineTo(21f, 6f)
            moveTo(9f, 6f)
            lineTo(9f, 4f)
            lineTo(15f, 4f)
            lineTo(15f, 6f)
            moveTo(5f, 6f)
            lineTo(6f, 20f)
            lineTo(18f, 20f)
            lineTo(19f, 6f)
            moveTo(10f, 10f)
            lineTo(10f, 17f)
            moveTo(14f, 10f)
            lineTo(14f, 17f)
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
