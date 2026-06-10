// File named after its primary @Composable; the co-located enums/data class are supporting types.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing

/** Tesla model family. */
enum class TeslaModel { Model3, ModelS, ModelY, ModelX, Cybertruck }

/** Display size for [TeslaCarViz]. */
enum class CarVizSize { Sm, Md, Lg }

/** Live vehicle state rendered by [TeslaCarViz]. [speedText] is pre-formatted by the page. */
data class TeslaVehicleViz(
    val batteryLevelPct: Double,
    val isCharging: Boolean = false,
    val isLocked: Boolean = true,
    val isClimateOn: Boolean = false,
    val sentryMode: Boolean = false,
    val speedText: String? = null,
)

/** Parses a vehicle model string (e.g. "Model 3 P", "Cybertruck") into a [TeslaModel]. */
fun parseModelKey(modelStr: String?): TeslaModel {
    if (modelStr.isNullOrBlank()) return TeslaModel.Model3
    val normalized = modelStr.lowercase().replace(Regex("\\s+"), "")
    return when {
        normalized.contains("cybertruck") || normalized.contains("ct") -> TeslaModel.Cybertruck
        normalized.contains("modelx") || normalized.contains("mx") -> TeslaModel.ModelX
        normalized.contains("modely") || normalized.contains("my") -> TeslaModel.ModelY
        normalized.contains("models") || normalized.contains("ms") -> TeslaModel.ModelS
        else -> TeslaModel.Model3
    }
}

/**
 * Stylized side-profile vehicle visualization — the Android counterpart of the web `TeslaCarViz`.
 * The body is tinted by state-of-charge; status chips below surface charging / lock / climate /
 * sentry and the optional [TeslaVehicleViz.speedText]. The whole widget exposes a single TalkBack
 * summary so screen-reader users get state without traversing each glyph.
 */
@Composable
fun TeslaCarViz(
    state: TeslaVehicleViz,
    modifier: Modifier = Modifier,
    model: TeslaModel = TeslaModel.Model3,
    size: CarVizSize = CarVizSize.Md,
    contentDescription: String? = null,
) {
    val bodyColor = batteryLevelColor(state.batteryLevelPct)
    val cabinColor = MaterialTheme.colorScheme.surfaceVariant
    val wheelColor = MaterialTheme.colorScheme.onSurface
    val (width, height) = carDimensions(size)
    val summary = contentDescription ?: defaultCarSummary(model, state)

    Column(
        modifier = modifier.clearAndSetSemantics { this.contentDescription = summary },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Canvas(modifier = Modifier.size(width, height)) {
            drawCar(model = model, bodyColor = bodyColor, cabinColor = cabinColor, wheelColor = wheelColor)
        }
        CarStatusRow(state)
    }
}

@Composable
private fun CarStatusRow(state: TeslaVehicleViz) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
        StatusGlyph(DataDisplayGlyphs.Battery, "${state.batteryLevelPct.toInt()}%", batteryLevelColor(state.batteryLevelPct))
        if (state.isCharging) StatusGlyph(DataDisplayGlyphs.BatteryCharging, null, TeslaTokens.status.success)
        StatusGlyph(
            DataDisplayGlyphs.Lock,
            null,
            if (state.isLocked) MaterialTheme.colorScheme.onSurfaceVariant else TeslaTokens.status.warning,
        )
        if (state.isClimateOn) StatusGlyph(DataDisplayGlyphs.Snowflake, null, TeslaTokens.status.info)
        if (state.sentryMode) StatusGlyph(DataDisplayGlyphs.Shield, null, TeslaTokens.status.danger)
        if (state.speedText != null) StatusGlyph(DataDisplayGlyphs.Gauge, state.speedText, MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun StatusGlyph(
    icon: ImageVector,
    label: String?,
    tint: Color,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Icon(icon, contentDescription = null, size = IconSize.Xs, tint = tint)
        if (label != null) {
            androidx.compose.material3.Text(label, style = MaterialTheme.typography.labelSmall, color = tint)
        }
    }
}

@Composable
private fun batteryLevelColor(pct: Double): Color =
    when {
        pct < 20.0 -> TeslaTokens.status.danger
        pct < 50.0 -> TeslaTokens.status.warning
        else -> TeslaTokens.status.success
    }

private fun defaultCarSummary(
    model: TeslaModel,
    state: TeslaVehicleViz,
): String {
    val parts = mutableListOf("${model.name} ${state.batteryLevelPct.toInt()}%")
    if (state.isCharging) parts += "charging"
    parts += if (state.isLocked) "locked" else "unlocked"
    if (state.isClimateOn) parts += "climate on"
    if (state.sentryMode) parts += "sentry on"
    state.speedText?.let { parts += it }
    return parts.joinToString(", ")
}

private fun carDimensions(size: CarVizSize): Pair<Dp, Dp> =
    when (size) {
        CarVizSize.Sm -> 120.dp to 64.dp
        CarVizSize.Md -> 180.dp to 96.dp
        CarVizSize.Lg -> 240.dp to 128.dp
    }

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawCar(
    model: TeslaModel,
    bodyColor: Color,
    cabinColor: Color,
    wheelColor: Color,
) {
    val w = size.width
    val h = size.height
    // Cabin/roof — a Cybertruck gets an angular wedge; others a smooth dome.
    val roofTop = if (model == TeslaModel.Cybertruck) h * 0.18f else h * 0.26f
    val cabin =
        Path().apply {
            moveTo(w * 0.30f, h * 0.50f)
            if (model == TeslaModel.Cybertruck) {
                lineTo(w * 0.40f, roofTop)
                lineTo(w * 0.72f, roofTop + h * 0.06f)
            } else {
                lineTo(w * 0.40f, roofTop)
                lineTo(w * 0.60f, roofTop)
                lineTo(w * 0.70f, h * 0.50f)
            }
            lineTo(w * 0.70f, h * 0.52f)
            lineTo(w * 0.30f, h * 0.52f)
            close()
        }
    drawPath(cabin, cabinColor)
    // Body — rounded slab tinted by state-of-charge.
    drawRoundRect(
        color = bodyColor,
        topLeft = Offset(w * 0.06f, h * 0.48f),
        size = Size(w * 0.88f, h * 0.30f),
        cornerRadius = CornerRadius(h * 0.14f, h * 0.14f),
    )
    // Wheels.
    val wheelRadius = h * 0.15f
    val wheelY = h * 0.80f
    listOf(w * 0.26f, w * 0.74f).forEach { cx ->
        drawCircle(color = wheelColor, radius = wheelRadius, center = Offset(cx, wheelY))
        drawCircle(color = cabinColor, radius = wheelRadius * 0.45f, center = Offset(cx, wheelY))
    }
    // Window strip hint.
    drawRect(
        color = cabinColor.copy(alpha = 0.6f),
        topLeft = Offset(w * 0.34f, roofTop + h * 0.04f),
        size = Size(w * 0.30f, h * 0.12f),
    )
}
