// File named after its primary @Composable; the co-located enums/data classes are supporting.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.ui.theme.generated.Spacing
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

/** Quality tier for a 0–100 drive score. */
enum class ScoreTone { Good, Warn, Bad }

/** SI-canonical drive inputs for [computeDriveScore] (meters, seconds, m/s, percent). */
data class DriveInput(
    val distanceM: Double,
    val durationS: Double,
    val maxSpeedMps: Double? = null,
    val startBatteryPct: Double? = null,
    val endBatteryPct: Double? = null,
)

/** Component breakdown of a drive score (each rounded to a whole number). */
data class DriveScoreBreakdown(
    val total: Int,
    val efficiency: Int,
    val speed: Int,
    val range: Int,
    val trip: Int,
)

private const val EFFICIENCY_MAX = 40.0
private const val COMPONENT_MAX = 20.0
private const val WH_PER_PCT = 750.0
private const val OPTIMAL_WH_KM = 150.0
private const val DEFAULT_WH_KM = 250.0
private const val DEFAULT_SPEED_RATIO = 0.5
private const val TRIP_PLATEAU_KM = 50.0
private const val BEST_PCT_PER_KM = 0.1
private const val PCT_PER_KM_RANGE = 0.9
private const val FULL_BATTERY = 100.0

private fun clamp(
    value: Double,
    min: Double,
    max: Double,
): Double = value.coerceIn(min, max)

/**
 * Computes a 0–100 drive score and its component breakdown — a faithful port of the web
 * `computeDriveScore`. Inputs are SI canonical; efficiency assumes ~75 kWh usable (750 Wh/%).
 */
fun computeDriveScore(input: DriveInput): DriveScoreBreakdown {
    val distanceKm = input.distanceM / 1000.0
    val avgSpeedMps = if (input.durationS > 0.0) input.distanceM / input.durationS else 0.0
    val maxSpeedMps = input.maxSpeedMps ?: avgSpeedMps
    val startBattery = input.startBatteryPct ?: FULL_BATTERY
    val endBattery = input.endBatteryPct ?: startBattery
    val batteryUsed = (startBattery - endBattery).coerceAtLeast(0.0)

    val whPerKm = if (distanceKm > 0.0) (batteryUsed * WH_PER_PCT) / distanceKm else DEFAULT_WH_KM
    val effDeviation = abs(whPerKm - OPTIMAL_WH_KM) / OPTIMAL_WH_KM
    val efficiency = clamp(EFFICIENCY_MAX * (1 - effDeviation), 0.0, EFFICIENCY_MAX)

    val speedRatio = if (maxSpeedMps > 0.0) avgSpeedMps / maxSpeedMps else DEFAULT_SPEED_RATIO
    val speed = clamp(COMPONENT_MAX * speedRatio, 0.0, COMPONENT_MAX)

    val batteryPerKm = if (distanceKm > 0.0) batteryUsed / distanceKm else 1.0
    val rangeScore = clamp(COMPONENT_MAX * (1 - (batteryPerKm - BEST_PCT_PER_KM) / PCT_PER_KM_RANGE), 0.0, COMPONENT_MAX)

    val tripScore = clamp(COMPONENT_MAX * min(distanceKm / TRIP_PLATEAU_KM, 1.0), 0.0, COMPONENT_MAX)

    val total = clamp(efficiency + speed + rangeScore + tripScore, 0.0, 100.0).roundToInt()
    return DriveScoreBreakdown(
        total = total,
        efficiency = efficiency.roundToInt(),
        speed = speed.roundToInt(),
        range = rangeScore.roundToInt(),
        trip = tripScore.roundToInt(),
    )
}

/** Quality tier for a total [score]: <40 bad, <70 warn, else good. */
fun scoreTone(score: Int): ScoreTone =
    when {
        score < 40 -> ScoreTone.Bad
        score < 70 -> ScoreTone.Warn
        else -> ScoreTone.Good
    }

/**
 * Drive score gauge + component breakdown — the Android counterpart of the web `DriveScore`. The
 * ring's color follows [scoreTone]; each component renders as a labeled [MetricBar]. Labels are
 * caller-provided for i18n.
 */
@Composable
fun DriveScore(
    input: DriveInput,
    modifier: Modifier = Modifier,
    title: String = "Drive Score",
    scoreLabel: String = "Score",
    efficiencyLabel: String = "Efficiency",
    speedLabel: String = "Speed Discipline",
    rangeLabel: String = "Range Preservation",
    tripLabel: String = "Trip Length",
) {
    val score = remember(input) { computeDriveScore(input) }
    GlassPanel(modifier = modifier) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg), verticalAlignment = Alignment.CenterVertically) {
            ProgressRing(
                value = score.total * 1.0,
                size = RING_SIZE,
                strokeWidth = RING_STROKE,
                color = scoreToneColor(scoreTone(score.total)),
                centerLabel = score.total.toString(),
                centerSubLabel = scoreLabel,
                contentDescription = "$scoreLabel ${score.total}",
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                PanelTitle(title)
                MetricBar(
                    score.efficiency * 1.0,
                    EFFICIENCY_MAX,
                    efficiencyLabel,
                    valueText = "${score.efficiency}/${EFFICIENCY_MAX.toInt()}",
                    color = paletteColor(0),
                )
                MetricBar(
                    score.speed * 1.0,
                    COMPONENT_MAX,
                    speedLabel,
                    valueText = "${score.speed}/${COMPONENT_MAX.toInt()}",
                    color = paletteColor(1),
                )
                MetricBar(
                    score.range * 1.0,
                    COMPONENT_MAX,
                    rangeLabel,
                    valueText = "${score.range}/${COMPONENT_MAX.toInt()}",
                    color = paletteColor(2),
                )
                MetricBar(
                    score.trip * 1.0,
                    COMPONENT_MAX,
                    tripLabel,
                    valueText = "${score.trip}/${COMPONENT_MAX.toInt()}",
                    color = paletteColor(3),
                )
            }
        }
    }
}

private val RING_SIZE = 120.dp
private val RING_STROKE = 10.dp
