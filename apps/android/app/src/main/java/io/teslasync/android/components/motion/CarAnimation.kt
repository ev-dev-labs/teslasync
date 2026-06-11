package io.teslasync.android.components.motion

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.MotionDurations
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/*
 * Brand motion illustrations, the Android counterpart of the web `CarAnimation` file. Drawn on
 * a Compose Canvas (no SVG) and recolored from the active theme so they track light / dark /
 * high-contrast. Decorative pieces use a one-shot entrance (no perpetual battery drain); the
 * `WheelSpin` loader is the lone deliberate loop and, like Material's progress spinner, only
 * animates while shown and honors reduced motion. All expose a content description.
 */

private const val CAR_ASPECT = 0.4f
private const val VIEW_W = 240f
private const val VIEW_H = 96f
private const val ENTER_FROM = 0.9f
private const val SPIN_MS = 2000

/**
 * Animated Tesla silhouette for hero / loading sections. Fades + scales in once, then holds.
 * Under reduced motion it renders the final frame immediately. [contentDescription] is the
 * caller-supplied (translated) label announced to screen readers.
 */
@Composable
fun CarAnimation(
    modifier: Modifier = Modifier,
    sizeDp: Int = 120,
    contentDescription: String = "Tesla vehicle illustration",
) {
    val reduce = rememberReducedMotion()
    val enter = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(reduce) {
        if (reduce) enter.snapTo(1f) else enter.animateTo(1f, tween(MotionDurations.slow))
    }
    val body = MaterialTheme.colorScheme.surfaceVariant
    val accent = MaterialTheme.colorScheme.primary
    val wheel = MaterialTheme.colorScheme.surface
    val outline = MaterialTheme.colorScheme.outline
    val tail = TeslaTokens.status.danger
    val shadow = MaterialTheme.colorScheme.onSurfaceVariant
    Canvas(
        modifier =
            modifier
                .size(sizeDp.dp, (sizeDp * CAR_ASPECT).dp)
                .semantics { this.contentDescription = contentDescription }
                .graphicsLayer {
                    alpha = enter.value
                    val s = ENTER_FROM + (1f - ENTER_FROM) * enter.value
                    scaleX = s
                    scaleY = s
                },
    ) {
        val sx = size.width / VIEW_W
        val sy = size.height / VIEW_H
        drawShadow(sx, sy, shadow)
        drawBody(sx, sy, body, accent)
        drawWindshield(sx, sy, accent)
        drawWheels(sx, sy, wheel, outline)
        drawLights(sx, sy, accent, tail)
    }
}

private fun DrawScope.drawShadow(
    sx: Float,
    sy: Float,
    color: Color,
) {
    drawOval(
        color = color.copy(alpha = 0.15f),
        topLeft = Offset(40f * sx, 82f * sy),
        size = Size(180f * sx, 8f * sy),
    )
}

private fun DrawScope.drawBody(
    sx: Float,
    sy: Float,
    fill: Color,
    stroke: Color,
) {
    val path =
        Path().apply {
            moveTo(30f * sx, 60f * sy)
            quadraticTo(30f * sx, 40f * sy, 50f * sx, 35f * sy)
            lineTo(80f * sx, 28f * sy)
            quadraticTo(100f * sx, 20f * sy, 130f * sx, 20f * sy)
            quadraticTo(160f * sx, 20f * sy, 180f * sx, 28f * sy)
            lineTo(210f * sx, 35f * sy)
            quadraticTo(230f * sx, 40f * sy, 230f * sx, 60f * sy)
            lineTo(230f * sx, 65f * sy)
            quadraticTo(230f * sx, 70f * sy, 225f * sx, 70f * sy)
            lineTo(35f * sx, 70f * sy)
            quadraticTo(30f * sx, 70f * sy, 30f * sx, 65f * sy)
            close()
        }
    drawPath(path, color = fill)
    drawPath(path, color = stroke, style = Stroke(width = 1.5f * sx))
}

private fun DrawScope.drawWindshield(
    sx: Float,
    sy: Float,
    accent: Color,
) {
    val path =
        Path().apply {
            moveTo(85f * sx, 30f * sy)
            quadraticTo(100f * sx, 22f * sy, 130f * sx, 22f * sy)
            quadraticTo(155f * sx, 22f * sy, 170f * sx, 28f * sy)
            lineTo(155f * sx, 42f * sy)
            quadraticTo(140f * sx, 44f * sy, 120f * sx, 44f * sy)
            quadraticTo(100f * sx, 44f * sy, 90f * sx, 42f * sy)
            close()
        }
    drawPath(path, color = accent.copy(alpha = 0.18f))
}

private fun DrawScope.drawWheels(
    sx: Float,
    sy: Float,
    fill: Color,
    outline: Color,
) {
    for (cx in listOf(70f, 190f)) {
        val center = Offset(cx * sx, 70f * sy)
        drawCircle(color = fill, radius = 14f * min(sx, sy), center = center)
        drawCircle(color = outline, radius = 14f * min(sx, sy), center = center, style = Stroke(2f * sx))
        drawCircle(color = outline, radius = 6f * min(sx, sy), center = center, style = Stroke(1.5f * sx))
    }
}

private fun DrawScope.drawLights(
    sx: Float,
    sy: Float,
    head: Color,
    tail: Color,
) {
    drawOval(
        color = head.copy(alpha = 0.85f),
        topLeft = Offset(224f * sx, 49f * sy),
        size = Size(8f * sx, 12f * sy),
    )
    drawRoundRect(
        color = tail.copy(alpha = 0.8f),
        topLeft = Offset(28f * sx, 50f * sy),
        size = Size(4f * sx, 12f * sy),
        cornerRadius = CornerRadius(2f * sx, 2f * sx),
    )
}

/**
 * Continuous wheel spinner for drive-related loading states. Like Material's progress
 * indicator the spin runs only while mounted; under reduced motion it renders a static wheel.
 */
@Composable
fun WheelSpin(
    modifier: Modifier = Modifier,
    sizeDp: Int = 24,
    contentDescription: String = "Loading",
) {
    val reduce = rememberReducedMotion()
    val transition = rememberInfiniteTransition(label = "wheel-spin")
    val angle by transition.animateFloat(
        initialValue = 0f,
        targetValue = if (reduce) 0f else 360f,
        animationSpec =
            infiniteRepeatable(
                animation = tween(SPIN_MS, easing = LinearEasing),
                repeatMode = RepeatMode.Restart,
            ),
        label = "wheel-angle",
    )
    val hub = MaterialTheme.colorScheme.surface
    val outline = MaterialTheme.colorScheme.outline
    Canvas(
        modifier =
            modifier
                .size(sizeDp.dp)
                .semantics { this.contentDescription = contentDescription }
                .graphicsLayer { rotationZ = angle },
    ) {
        val r = size.minDimension / 2f
        val center = Offset(size.width / 2f, size.height / 2f)
        drawCircle(color = hub, radius = r, center = center)
        drawCircle(color = outline, radius = r, center = center, style = Stroke(1.5.dp.toPx()))
        for (spoke in 0 until SPOKES) {
            val a = Math.toRadians((spoke * (360.0 / SPOKES))).toFloat()
            val inner = Offset(center.x + r * 0.35f * sin(a), center.y - r * 0.35f * cos(a))
            val outer = Offset(center.x + r * 0.85f * sin(a), center.y - r * 0.85f * cos(a))
            drawLine(outline, inner, outer, strokeWidth = 1.5.dp.toPx())
        }
    }
}

/**
 * Charging bolt accent that fades + scales in once (no perpetual loop). Honors reduced motion
 * by rendering its final frame immediately.
 */
@Composable
fun ChargingBolt(
    modifier: Modifier = Modifier,
    sizeDp: Int = 32,
    contentDescription: String = "Charging",
) {
    val reduce = rememberReducedMotion()
    val enter = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(reduce) {
        if (reduce) enter.snapTo(1f) else enter.animateTo(1f, tween(MotionDurations.normal))
    }
    val accent = MaterialTheme.colorScheme.primary
    Canvas(
        modifier =
            modifier
                .size(sizeDp.dp)
                .semantics { this.contentDescription = contentDescription }
                .graphicsLayer { alpha = enter.value },
    ) {
        val sx = size.width / VIEW_BOLT
        val sy = size.height / VIEW_BOLT
        val path =
            Path().apply {
                moveTo(13f * sx, 2f * sy)
                lineTo(3f * sx, 14f * sy)
                lineTo(12f * sx, 14f * sy)
                lineTo(11f * sx, 22f * sy)
                lineTo(21f * sx, 10f * sy)
                lineTo(12f * sx, 10f * sy)
                close()
            }
        drawPath(path, color = accent.copy(alpha = 0.25f))
        drawPath(path, color = accent, style = Stroke(width = 1.5f * sx))
    }
}

/**
 * Battery gauge whose fill animates from empty to [levelPercent] once. The [levelPercent]
 * (0..100) also colors the fill (green / amber / red). Honors reduced motion.
 */
@Composable
fun BatteryFillAnimation(
    levelPercent: Int,
    modifier: Modifier = Modifier,
    sizeDp: Int = 48,
    contentDescription: String = "Battery level",
) {
    val reduce = rememberReducedMotion()
    val target = levelPercent.coerceIn(0, 100) / 100f
    val fill = remember { Animatable(if (reduce) target else 0f) }
    LaunchedEffect(reduce, target) {
        if (reduce) fill.snapTo(target) else fill.animateTo(target, tween(MotionDurations.slow))
    }
    val good = TeslaTokens.status.success
    val warn = TeslaTokens.status.warning
    val bad = TeslaTokens.status.danger
    val outline = MaterialTheme.colorScheme.outline
    val color =
        when {
            target >= FILL_GOOD -> good
            target >= FILL_WARN -> warn
            else -> bad
        }
    Canvas(
        modifier =
            modifier
                .size(sizeDp.dp, (sizeDp / 2).dp)
                .semantics { this.contentDescription = contentDescription },
    ) {
        val w = size.width
        val h = size.height
        drawRoundRect(
            color = outline,
            topLeft = Offset(w * 0.04f, h * 0.16f),
            size = Size(w * 0.8f, h * 0.66f),
            cornerRadius = CornerRadius(h * 0.12f, h * 0.12f),
            style = Stroke(1.5.dp.toPx()),
        )
        drawRoundRect(
            color = outline.copy(alpha = 0.4f),
            topLeft = Offset(w * 0.85f, h * 0.34f),
            size = Size(w * 0.08f, h * 0.32f),
            cornerRadius = CornerRadius(h * 0.06f, h * 0.06f),
        )
        val innerW = w * 0.74f
        drawRoundRect(
            color = color,
            topLeft = Offset(w * 0.07f, h * 0.24f),
            size = Size(innerW * fill.value, h * 0.5f),
            cornerRadius = CornerRadius(h * 0.08f, h * 0.08f),
        )
    }
}

private const val SPOKES = 5
private const val VIEW_BOLT = 24f
private const val FILL_GOOD = 0.6f
private const val FILL_WARN = 0.3f
