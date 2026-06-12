// Line-style icon set for the FSMHealthPanel surface, drawn as Material [ImageVector]s.
//
// The web component (system/FSMHealthPanel.tsx) uses three `lucide-react` glyphs — AlertTriangle (flap),
// Timer (stuck sessions), and RotateCw (pod recoveries). Android has no bundled lucide equivalent without
// the frozen `material-icons-extended` artifact, so these surface-specific glyphs are authored here as
// 24×24 stroked vectors in the same monochrome style as the shared `ui.TeslaGlyphs` /
// `datadisplay.DataDisplayGlyphs` sets. Each is recolored at render time by the `Icon` composable's `tint`,
// so it inherits the alert's severity accent.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/FSMHealthPanel) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fsmhealthpanel

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The three alert-marker glyphs, mapped 1:1 onto the web `FSMHealthPanel` lucide icons. [resolve] turns a
 * pure [FSMHealthGlyph] key (chosen by the off-device projection) into the concrete vector the composable
 * renders, keeping glyph selection unit-testable and rendering declarative.
 */
object FSMHealthPanelGlyphs {
    /** Warning triangle with an exclamation — web lucide `AlertTriangle`, for the flap alert. */
    val AlertTriangle: ImageVector =
        stroked("AlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            dot(12f, 16.5f)
        }

    /** Stopwatch (top button + a single hand) — web lucide `Timer`, for the stuck-sessions alert. */
    val Timer: ImageVector =
        stroked("Timer") {
            moveTo(10f, 2f)
            lineTo(14f, 2f)
            circle(12f, 14f, 8f)
            moveTo(12f, 14f)
            lineTo(15f, 11f)
        }

    /** Clockwise circular arrow — web lucide `RotateCw`, for the pod-recoveries alert. */
    val RotateCw: ImageVector =
        stroked("RotateCw") {
            moveTo(20f, 8f)
            curveTo(18f, 5f, 15f, 4f, 12f, 4f)
            curveTo(7.6f, 4f, 4f, 7.6f, 4f, 12f)
            curveTo(4f, 16.4f, 7.6f, 20f, 12f, 20f)
            curveTo(16f, 20f, 19f, 18f, 20f, 15f)
            moveTo(20f, 4f)
            lineTo(20f, 8f)
            lineTo(16f, 8f)
        }

    /** Resolves a pure [FSMHealthGlyph] key to its authored vector. */
    fun resolve(glyph: FSMHealthGlyph): ImageVector =
        when (glyph) {
            FSMHealthGlyph.AlertTriangle -> AlertTriangle
            FSMHealthGlyph.Timer -> Timer
            FSMHealthGlyph.RotateCw -> RotateCw
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

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
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
