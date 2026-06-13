// The native Jetpack Compose + Material 3 ProgressRing shared surface — a parity port of
// web/src/components/data-display/ProgressRing.tsx. The web component draws a circular gauge: a gray track
// circle with a colored progress arc filling clockwise from the top in proportion to `value / max`, an
// optional centre label + sub-label sized proportionally to the ring so it reads like a real gauge, and an
// optional caption below it. This port reproduces that geometry, composition, and the surface's genuine
// presentational states in native primitives — no ported Tailwind classes; platform tokens from P1/S9.
//
// Every derivation flows through the pure [ProgressRingProjection] (unit-tested off-device); this file is a
// thin render layer that binds no data (the `value` and labels arrive as parameters, web parity) and emits
// the one PII-safe `view.opened` diagnostic (P1/S11) on first composition. The surface is purely
// presentational, so the generic data lifecycle (loading / error / stale / offline) belongs to the owning
// page — the branches reproduced here are the ones the web source actually has: the empty/zero fill
// (track only), the partial and full fills, the clamped over-max fill, and the optional centre / caption
// text.
//
// Color mapping (P1/S9 tokens, no ported Tailwind): the web default arc blue (#3b82f6) maps to the theme
// `colorScheme.primary`; the web gray track (gray-200 / gray-700) maps to `colorScheme.surfaceVariant`; the
// centre label uses `onSurface` (web `--text-primary`) and the sub-label `onSurfaceVariant`
// (web `--text-muted`). The fill transition (web `transition-all duration-slow`) honors the reduced-motion
// preference (P1/S9, `rememberReducedMotion`): it snaps to the target instead of animating when reduced
// motion is requested.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ProgressRing) cannot form a valid Kotlin package;
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.progressring

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

// ── Web prop defaults (size px / strokeWidth px) ────────────────────────────────────────────────────
private val DEFAULT_SIZE: Dp = 48.dp
private val DEFAULT_STROKE: Dp = 4.dp

// ── Fill animation (web `transition-all duration-slow`) ─────────────────────────────────────────────
private const val FILL_ANIMATION_MS = 500

// Web `tabular-nums` on the centre value, and `tracking-wide` on the uppercase sub-label.
private val TABULAR_NUMS_STYLE = TextStyle(fontFeatureSettings = "tnum")
private const val SUBLABEL_TRACKING_EM = 0.025
private const val CENTER_MAX_LINES = 1
private const val TRACK_START_DEGREES = 0f
private val PROGRESS_RANGE = 0f..1f

/**
 * Stateful entry point — the faithful 1:1 port of the web `ProgressRing` props. Records the one-shot
 * `view.opened` diagnostic on first composition (P1/S11) and renders the gauge. The surface binds no data
 * of its own; the caller supplies the [value] and the optional labels (web parity).
 *
 * @param value the progress value (web `value`); clamped to `0..max` before it is drawn.
 * @param max the value mapped to a full ring (web `max`, default 100).
 * @param size the ring diameter (web `size`, default 48); also scales the centre text.
 * @param strokeWidth the ring/arc stroke width (web `strokeWidth`, default 4).
 * @param color the progress-arc color (web `color`, default the theme primary).
 * @param trackColor the unfilled track color (web gray track).
 * @param label an optional caption rendered below the ring (web `label`).
 * @param centerLabel optional primary text centred inside the ring (web `centerLabel`).
 * @param centerSubLabel optional secondary text below [centerLabel], inside the ring (web `centerSubLabel`).
 * @param contentDescription an explicit accessibility label; when null one is derived from the visible text.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ProgressRing(
    value: Double,
    modifier: Modifier = Modifier,
    max: Double = ProgressRingProjection.DEFAULT_MAX,
    size: Dp = DEFAULT_SIZE,
    strokeWidth: Dp = DEFAULT_STROKE,
    color: Color = MaterialTheme.colorScheme.primary,
    trackColor: Color = MaterialTheme.colorScheme.surfaceVariant,
    label: String? = null,
    centerLabel: String? = null,
    centerSubLabel: String? = null,
    contentDescription: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ProgressRingDiagnostics.recordViewOpened(logger) }
    ProgressRingContent(
        value = value,
        modifier = modifier,
        max = max,
        size = size,
        strokeWidth = strokeWidth,
        color = color,
        trackColor = trackColor,
        label = label,
        centerLabel = centerLabel,
        centerSubLabel = centerSubLabel,
        contentDescription = contentDescription,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Reproduces the web layout exactly: a centred
 * column (web `inline-flex flex-col items-center gap-1`) holding the ring (track + animated progress arc)
 * with the optional centre text, and the optional caption below. The whole surface exposes a single
 * progress-bar semantics node so TalkBack announces the percentage (the web centre text is `aria-hidden`).
 */
@Composable
fun ProgressRingContent(
    value: Double,
    modifier: Modifier = Modifier,
    max: Double = ProgressRingProjection.DEFAULT_MAX,
    size: Dp = DEFAULT_SIZE,
    strokeWidth: Dp = DEFAULT_STROKE,
    color: Color = MaterialTheme.colorScheme.primary,
    trackColor: Color = MaterialTheme.colorScheme.surfaceVariant,
    label: String? = null,
    centerLabel: String? = null,
    centerSubLabel: String? = null,
    contentDescription: String? = null,
) {
    val geometry =
        remember(value, max, size) {
            val sizeDp = size.value.toDouble() // parity:allow Kotlin Float-to-Double dp conversion
            ProgressRingProjection.project(value = value, sizeDp = sizeDp, max = max)
        }
    val reducedMotion = rememberReducedMotion()
    val animatedFraction by animateFloatAsState(
        targetValue = geometry.fraction,
        animationSpec = if (reducedMotion) snap() else tween(durationMillis = FILL_ANIMATION_MS),
        label = "progress-ring-fill",
    )
    val locale: Locale = LocalConfiguration.current.locales[0]
    val description =
        remember(contentDescription, centerLabel, centerSubLabel, label) {
            contentDescription ?: listOfNotNull(centerLabel, centerSubLabel, label).joinToString(" ").ifBlank { null }
        }

    Column(
        modifier =
            modifier.clearAndSetSemantics {
                progressBarRangeInfo = ProgressBarRangeInfo(geometry.fraction, PROGRESS_RANGE)
                if (description != null) this.contentDescription = description
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Box(modifier = Modifier.size(size), contentAlignment = Alignment.Center) {
            ProgressRingArc(
                fraction = animatedFraction,
                size = size,
                strokeWidth = strokeWidth,
                color = color,
                trackColor = trackColor,
            )
            if (ProgressRingProjection.hasCenter(centerLabel, centerSubLabel)) {
                ProgressRingCenter(
                    centerLabel = centerLabel,
                    centerSubLabel = centerSubLabel,
                    geometry = geometry,
                    locale = locale,
                )
            }
        }
        if (label != null) Caption(label)
    }
}

/**
 * The two stacked arcs — the native analogue of the web SVG's track + progress `<circle>` pair. The track is
 * a full revolution; the progress arc sweeps [fraction] of the ring clockwise from the top
 * ([ProgressRingProjection.START_ANGLE_DEGREES]) with a round cap (web `strokeLinecap="round"`). The arc is
 * inset by half the stroke so the round cap never clips the bounding box.
 */
@Composable
private fun ProgressRingArc(
    fraction: Float,
    size: Dp,
    strokeWidth: Dp,
    color: Color,
    trackColor: Color,
) {
    Canvas(modifier = Modifier.size(size)) {
        val strokePx = strokeWidth.toPx()
        val stroke = Stroke(width = strokePx, cap = StrokeCap.Round)
        val inset = strokePx / 2f
        val arcSize = Size(this.size.width - strokePx, this.size.height - strokePx)
        val topLeft = Offset(inset, inset)
        drawArc(
            color = trackColor,
            startAngle = TRACK_START_DEGREES,
            sweepAngle = ProgressRingProjection.FULL_SWEEP_DEGREES,
            useCenter = false,
            topLeft = topLeft,
            size = arcSize,
            style = stroke,
        )
        drawArc(
            color = color,
            startAngle = ProgressRingProjection.START_ANGLE_DEGREES,
            sweepAngle = ProgressRingProjection.FULL_SWEEP_DEGREES * fraction,
            useCenter = false,
            topLeft = topLeft,
            size = arcSize,
            style = stroke,
        )
    }
}

/**
 * The centre text stack — the web `centerLabel` (semibold, tabular figures, primary text, proportional size)
 * over the optional `centerSubLabel` (uppercase, wide tracking, muted, smaller proportional size). Both
 * sizes come from the projection so they track the ring diameter, and both use sp so the OS font-scale
 * preference is honored.
 */
@Composable
private fun ProgressRingCenter(
    centerLabel: String?,
    centerSubLabel: String?,
    geometry: ProgressRingGeometry,
    locale: Locale,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        if (centerLabel != null) {
            Text(
                text = centerLabel,
                color = MaterialTheme.colorScheme.onSurface,
                fontSize = geometry.centerLabelSp.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = CENTER_MAX_LINES,
                style = TABULAR_NUMS_STYLE,
            )
        }
        if (centerSubLabel != null) {
            Text(
                text = centerSubLabel.uppercase(locale),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = geometry.centerSubLabelSp.sp,
                letterSpacing = SUBLABEL_TRACKING_EM.em,
                maxLines = CENTER_MAX_LINES,
            )
        }
    }
}

// ── Previews (tooling-only; each @Preview exercises one render branch) ───────────────────────────────

@Preview(name = "Gauge — partial", showBackground = true)
@Composable
private fun ProgressRingPartialPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ProgressRingContent(
            value = 72.0,
            size = 96.dp,
            strokeWidth = 8.dp,
            centerLabel = "72%",
            centerSubLabel = "SOC",
            label = "Battery",
        )
    }
}

@Preview(name = "Gauge — empty", showBackground = true)
@Composable
private fun ProgressRingEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ProgressRingContent(value = 0.0, size = 96.dp, strokeWidth = 8.dp, centerLabel = "0%")
    }
}

@Preview(name = "Gauge — full", showBackground = true)
@Composable
private fun ProgressRingFullPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ProgressRingContent(value = 100.0, size = 96.dp, strokeWidth = 8.dp, centerLabel = "100%")
    }
}

@Preview(name = "Ring — no labels", showBackground = true)
@Composable
private fun ProgressRingBarePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ProgressRingContent(value = 40.0)
    }
}

@Preview(name = "Gauge — clamped over max", showBackground = true)
@Composable
private fun ProgressRingOverMaxPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ProgressRingContent(
            value = 9.0,
            max = 6.0,
            size = 72.dp,
            strokeWidth = 6.dp,
            centerLabel = "6",
            centerSubLabel = "of 6",
        )
    }
}
