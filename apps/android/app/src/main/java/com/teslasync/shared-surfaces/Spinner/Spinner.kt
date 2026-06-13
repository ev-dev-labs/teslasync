// The native Jetpack Compose + Material 3 Spinner shared surface — a parity port of
// web/src/components/feedback/Spinner.tsx. The web surface is the brand loading mark: a lightning bolt that
// draws itself like a strike, fills to solid, holds, then fades and redraws over a 2s loop, wrapped in a
// cyan/emerald electrical glow, with an optional caption beneath it. It honors `prefers-reduced-motion` via
// useMotionPreference(): when reduced motion is requested it renders a static, fully-filled bolt with the same
// glow (no draw cycle). This port reproduces that composition, animation, and the surface's genuine states in
// native primitives — no ported Tailwind classes; platform tokens from P1/S9.
//
// Every derivation flows through the pure [SpinnerProjection] (unit-tested off-device): the bolt outline, the
// size scale, and the `boltDraw` keyframe timeline. This composable is a thin render layer that binds no data
// (web parity — `size` / `label` arrive as parameters), reads only the reduced-motion preference over the
// shared motion layer (P1/S9, the native `useMotionPreference`), and emits the one PII-safe `view.opened`
// diagnostic (P1/S11) on first composition. Because the surface fetches nothing it IS the loading state for
// whatever page hosts it; the branches reproduced here are the ones the web source actually has — the animated
// draw cycle, the reduced-motion static frame, the three sizes, and the with-/without-label split.
//
// Color mapping (P1/S9 tokens, no ported Tailwind): the web bolt `text-white` maps to the theme
// `colorScheme.onSurface` (the on-surface "primary text", near-white in the dark brand theme, dark on light so
// the mark stays visible either way); the glow's cyan inner halo (web `--theme-primary`, #22d3ee) maps to
// `colorScheme.primary` and its emerald outer halo (web `--theme-accent`, #10b981) to the semantic
// `TeslaTokens.status.success` (#10b981 in the dark brand palette), so the halo tracks the active theme exactly
// as the web CSS-variable-driven `drop-shadow` stack does. The native glow is composed from two widening,
// softening strokes of the visible bolt rather than a platform blur, so it renders identically on every
// supported API level (26+).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Spinner) cannot form a valid Kotlin package;
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.spinner

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The web `boltDraw` loop period (`animation: boltDraw 2s …`). */
private const val ANIMATION_PERIOD_MS = 2_000

// Glow halo widths as multiples of the bolt stroke — the native analogue of the web drop-shadow stack
// (`drop-shadow(0 0 4px --theme-primary) drop-shadow(0 0 10px --theme-accent)`): a wider, softer emerald outer
// halo and a tighter, brighter cyan inner halo. Scaling off the stroke keeps the glow proportional at every
// size, exactly as the web blur radii sit relative to the rendered bolt.
private const val GLOW_ACCENT_WIDTH_FACTOR = 3.2f
private const val GLOW_PRIMARY_WIDTH_FACTOR = 1.9f
private const val GLOW_ACCENT_ALPHA = 0.18f
private const val GLOW_PRIMARY_ALPHA = 0.32f

/**
 * Stateful entry point — the faithful port of the web `Spinner`. Records the one-shot `view.opened` diagnostic
 * (P1/S11) on first composition, reads the reduced-motion preference (web `useMotionPreference`), drives the 2s
 * draw loop (suppressed entirely under reduced motion), and renders the bolt. Binds no data of its own (web
 * parity).
 *
 * @param modifier optional layout modifier for the centred mark + caption column.
 * @param size the mark size (web `size`, default md).
 * @param label an optional caption shown beneath the mark; when present it is also the accessible name, else
 *   the localized "Loading" is used (web `label` / `aria-label={label ?? 'Loading'}`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun Spinner(
    modifier: Modifier = Modifier,
    size: SpinnerSize = SpinnerSize.Md,
    label: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SpinnerDiagnostics.recordViewOpened(logger) }

    val frame = if (rememberReducedMotion()) SpinnerProjection.STATIC_FRAME else rememberBoltFrame()
    SpinnerContent(frame = frame, modifier = modifier, size = size, label = label)
}

/**
 * Stateless renderer — the preview entry point and the boundary the pure projection drives. Paints the centred
 * column (web `flex flex-col items-center gap-3`): the glowing lightning bolt at [frame], and the optional
 * caption beneath it. The whole surface is one polite live region announcing the accessible name (web
 * `role="status"` / `aria-label`); the bolt canvas itself is decorative (web `aria-hidden`).
 */
@Composable
fun SpinnerContent(
    frame: BoltFrame,
    modifier: Modifier = Modifier,
    size: SpinnerSize = SpinnerSize.Md,
    label: String? = null,
) {
    val spinnerSize = size
    val accessibleName = SpinnerProjection.accessibleLabel(label, stringResource(R.string.translation_a11y_loading))
    val colors =
        BoltColors(
            boltColor = MaterialTheme.colorScheme.onSurface,
            glowPrimary = MaterialTheme.colorScheme.primary,
            glowAccent = TeslaTokens.status.success,
        )

    Column(
        modifier =
            modifier.clearAndSetSemantics {
                contentDescription = accessibleName
                liveRegion = LiveRegionMode.Polite
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Canvas(modifier = Modifier.size(spinnerSize.boxDp.dp)) {
            drawBolt(frame = frame, spinnerSize = spinnerSize, colors = colors)
        }
        label?.takeIf { SpinnerProjection.hasVisibleLabel(it) }?.let { Caption(it) }
    }
}

/** The animated [BoltFrame] driven by the 2s infinite draw loop (web `boltDraw … infinite`). */
@Composable
private fun rememberBoltFrame(): BoltFrame {
    val transition = rememberInfiniteTransition(label = "spinnerBolt")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(ANIMATION_PERIOD_MS, easing = LinearEasing), RepeatMode.Restart),
        label = "boltProgress",
    )
    return SpinnerProjection.frameAt(progress)
}

/** The resolved paint for the bolt + its two-color glow, computed once in the composable and handed to draw. */
private class BoltColors(
    val boltColor: Color,
    val glowPrimary: Color,
    val glowAccent: Color,
)

/**
 * Draw the glowing lightning bolt at [frame] into the current [DrawScope]. The outline is scaled out of the
 * 200-unit viewBox into the canvas; only the currently-visible segment ([BoltFrame.drawStart]..[BoltFrame.drawEnd],
 * the web `stroke-dashoffset` reveal) is painted, so the cycle's first instant and its fully-retreated last
 * instant show nothing — exactly as the web bolt does. The cyan/emerald halo is laid down first (two widening,
 * softening strokes whose alpha tracks the frame opacity), then the bolt fill (web `fill-opacity`), then the
 * struck-in edge (web `stroke`).
 */
private fun DrawScope.drawBolt(
    frame: BoltFrame,
    spinnerSize: SpinnerSize,
    colors: BoltColors,
) {
    if (frame.opacity <= 0f) return
    val scale = size.width / SpinnerProjection.VIEWBOX
    val path = boltPath(scale)
    val strokePx = SpinnerProjection.strokeWidthPx(spinnerSize, size.width)
    val segment = strokeSegment(path, frame.drawStart, frame.drawEnd) ?: return

    drawPath(
        path = segment,
        color = colors.glowAccent.copy(alpha = GLOW_ACCENT_ALPHA * frame.opacity),
        style = Stroke(width = strokePx * GLOW_ACCENT_WIDTH_FACTOR, cap = StrokeCap.Round, join = StrokeJoin.Round),
    )
    drawPath(
        path = segment,
        color = colors.glowPrimary.copy(alpha = GLOW_PRIMARY_ALPHA * frame.opacity),
        style = Stroke(width = strokePx * GLOW_PRIMARY_WIDTH_FACTOR, cap = StrokeCap.Round, join = StrokeJoin.Round),
    )

    if (frame.fillOpacity > 0f) {
        drawPath(path = path, color = colors.boltColor.copy(alpha = frame.fillOpacity * frame.opacity), style = Fill)
    }

    drawPath(
        path = segment,
        color = colors.boltColor.copy(alpha = frame.opacity),
        style = Stroke(width = strokePx, cap = StrokeCap.Round, join = StrokeJoin.Round),
    )
}

/** Build the closed bolt outline scaled out of the viewBox by [scale]. */
private fun boltPath(scale: Float): Path =
    Path().apply {
        SpinnerProjection.BOLT_OUTLINE.forEachIndexed { index, vertex ->
            val x = vertex.x * scale
            val y = vertex.y * scale
            if (index == 0) moveTo(x, y) else lineTo(x, y)
        }
        close()
    }

/**
 * The `[start, end]` fraction of the bolt outline as its own [Path] — the native analogue of the web
 * `stroke-dasharray` / `stroke-dashoffset` reveal. Returns `null` for an empty segment so the renderer paints
 * nothing (the cycle's first instant, and the fully-retreated last instant).
 */
private fun strokeSegment(
    path: Path,
    start: Float,
    end: Float,
): Path? {
    if (end <= start) return null
    val measure = PathMeasure().apply { setPath(path, forceClosed = true) }
    val length = measure.length
    val destination = Path()
    val added = length > 0f && measure.getSegment(start * length, end * length, destination, startWithMoveTo = true)
    return if (added) destination else null
}

// ── Previews (tooling-only; each @Preview exercises one render branch) ───────────────────────────────────

@Preview(name = "Bolt — striking in", showBackground = true)
@Composable
private fun SpinnerStrikingInPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpinnerContent(frame = SpinnerProjection.frameAt(0.18f))
    }
}

@Preview(name = "Bolt — filled, with label", showBackground = true)
@Composable
private fun SpinnerFilledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpinnerContent(frame = SpinnerProjection.frameAt(0.65f), label = "Syncing vehicles")
    }
}

@Preview(name = "Bolt — reduced motion, small", showBackground = true)
@Composable
private fun SpinnerReducedSmallPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpinnerContent(frame = SpinnerProjection.STATIC_FRAME, size = SpinnerSize.Sm)
    }
}

@Preview(name = "Bolt — reduced motion, large", showBackground = true)
@Composable
private fun SpinnerReducedLargePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpinnerContent(frame = SpinnerProjection.STATIC_FRAME, size = SpinnerSize.Lg)
    }
}

@Preview(name = "Bolt — fading out", showBackground = true)
@Composable
private fun SpinnerFadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpinnerContent(frame = SpinnerProjection.frameAt(0.92f))
    }
}
