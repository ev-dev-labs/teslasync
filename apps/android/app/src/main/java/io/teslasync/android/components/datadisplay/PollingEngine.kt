// File named after its primary @Composable; the co-located data classes/functions are supporting.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.ui.theme.generated.Spacing

/** Adaptive-polling cost snapshot for [PollingEngine]. */
data class PollingSavings(
    val savingsPercent: Double,
    val estimatedSavings: Double,
    val pollsMade: Int,
    val remainingCredit: Double,
)

/** Per-vehicle adaptive-polling status row. */
data class PollingVehicle(
    val vin: String,
    val activity: String,
    val profile: String,
    val batteryLevelPct: Int,
    val nextPollInMs: Long,
)

/** Compact duration label for the polling engine: "now" / "5s" / "3m" / "2h 5m". */
fun formatPollingDurationMs(ms: Long): String {
    val seconds = ms / 1_000L
    val minutes = seconds / 60L
    val hours = minutes / 60L
    return when {
        ms <= 0L -> "now"
        seconds < 60L -> "${seconds}s"
        minutes < 60L -> "${minutes}m"
        else -> "${hours}h ${minutes % 60L}m"
    }
}

/** Title-cases an adaptive-polling profile id for display. */
fun pollingProfileLabel(profile: String): String =
    profile.trim().replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }

/**
 * Adaptive-polling engine panel — the Android counterpart of the web `PollingEngine`. Purely
 * presentational: pass [savings] + per-[vehicles] status. Renders nothing when [enabled] is false
 * (the engine is off), and an empty hint when no vehicles are tracked yet.
 */
@Composable
fun PollingEngine(
    savings: PollingSavings?,
    vehicles: List<PollingVehicle>,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    title: String = "Adaptive Polling Engine",
    activeLabel: String = "Active",
    pollsSavedLabel: String = "Polls Saved",
    savedAmountLabel: String = "$ Saved",
    pollsMadeLabel: String = "Polls Made",
    creditLeftLabel: String = "Credit Left",
    nextLabel: String = "Next",
    emptyMessage: String = "No vehicles tracked yet.",
) {
    if (!enabled) return
    GlassPanel(modifier = modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Icon(
                        DataDisplayGlyphs.TrendingDown,
                        contentDescription = null,
                        size = IconSize.Sm,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    PanelTitle(title)
                }
                Badge(text = activeLabel, variant = BadgeVariant.Success)
            }
            if (savings != null) {
                PollingSavingsRow(savings, pollsSavedLabel, savedAmountLabel, pollsMadeLabel, creditLeftLabel)
            }
            if (vehicles.isEmpty()) {
                Caption(emptyMessage)
            } else {
                vehicles.forEach { PollingVehicleRow(it, nextLabel) }
            }
        }
    }
}

@Composable
private fun PollingSavingsRow(
    savings: PollingSavings,
    pollsSavedLabel: String,
    savedAmountLabel: String,
    pollsMadeLabel: String,
    creditLeftLabel: String,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        PollingStat(modifier = Modifier.weight(1f), value = savings.savingsPercent, decimals = 1, suffix = "%", label = pollsSavedLabel)
        PollingStat(modifier = Modifier.weight(1f), value = savings.estimatedSavings, decimals = 2, prefix = "$", label = savedAmountLabel)
        PollingStat(modifier = Modifier.weight(1f), value = savings.pollsMade * 1.0, decimals = 0, label = pollsMadeLabel)
        PollingStat(modifier = Modifier.weight(1f), value = savings.remainingCredit, decimals = 2, prefix = "$", label = creditLeftLabel)
    }
}

@Composable
private fun PollingStat(
    value: Double,
    decimals: Int,
    label: String,
    modifier: Modifier = Modifier,
    prefix: String = "",
    suffix: String = "",
) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        AnimatedNumber(value = value, decimals = decimals, prefix = prefix, suffix = suffix)
        Caption(label)
    }
}

@Composable
private fun PollingVehicleRow(
    vehicle: PollingVehicle,
    nextLabel: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(pollingActivityIcon(vehicle.activity), contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.primary)
        Text(
            vehicle.vin.takeLast(VIN_TAIL),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Caption("${vehicle.activity} \u00b7 ${pollingProfileLabel(vehicle.profile)}")
        Text(
            "$nextLabel: ${formatPollingDurationMs(vehicle.nextPollInMs)}",
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun pollingActivityIcon(activity: String) =
    when (activity.lowercase()) {
        "active", "critical" -> DataDisplayGlyphs.Bolt
        "moderate" -> DataDisplayGlyphs.BatteryCharging
        "low" -> DataDisplayGlyphs.Gauge
        else -> DataDisplayGlyphs.Clock
    }

private const val VIN_TAIL = 8
