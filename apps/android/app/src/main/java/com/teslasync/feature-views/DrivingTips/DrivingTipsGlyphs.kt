// Self-contained line-style icon set for the DrivingTips surface, drawn as Material [ImageVector]s.
//
// The web component uses `lucide-react` glyphs (Lightbulb, ShieldCheck, AlertTriangle). The shared
// `DataDisplayGlyphs` set already ships `AlertTriangle` (reused by the surface for the non-conservative row),
// but carries no `Lightbulb` or `ShieldCheck`, and Android ships no lucide-equivalent set without the frozen
// `material-icons-extended` artifact. So — exactly as the sibling LiveMotorStatus / HealthRecommendations
// surfaces do for their lucide ports — the two this surface needs are authored here as 24×24 stroked vectors.
// Each is monochrome (drawn in opaque black) and recolored at render time by the
// [io.teslasync.android.components.ui.Icon] composable's `tint`, so they inherit the accent each row computes
// (the web `text-yellow-400` lightbulb + alert, `text-green-400` shield-check).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DrivingTips) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivingtips

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyphs the DrivingTips surface renders. */
internal object DrivingTipsGlyphs {
    /** lucide `lightbulb` — the panel title: a glass bulb with a small filament over a threaded base. */
    val Lightbulb: ImageVector =
        stroked("Lightbulb") {
            circle(12f, 9f, 5f)
            moveTo(9.5f, 9f)
            lineTo(12f, 11.5f)
            lineTo(14.5f, 9f)
            moveTo(9.5f, 15.5f)
            lineTo(14.5f, 15.5f)
            moveTo(10f, 18f)
            lineTo(14f, 18f)
            moveTo(10.5f, 20.5f)
            lineTo(13.5f, 20.5f)
        }

    /** lucide `shield-check` — the conservative tip rows: a crest enclosing a check mark. */
    val ShieldCheck: ImageVector =
        stroked("ShieldCheck") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 12f)
            curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
            curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
            lineTo(5f, 6f)
            close()
            moveTo(9f, 12f)
            lineTo(11f, 14f)
            lineTo(15f, 9.5f)
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
