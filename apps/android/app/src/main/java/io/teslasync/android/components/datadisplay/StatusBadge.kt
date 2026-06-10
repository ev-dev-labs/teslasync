package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Maps a vehicle status string onto a canonical [Severity], or `null` for a neutral (muted)
 * status. Pure so the dot color resolution stays testable; mirrors the FSM state palette intent.
 */
fun vehicleStatusSeverity(status: String): Severity? =
    when (status.trim().lowercase()) {
        "driving", "online", "awake", "active", "charging" -> Severity.Success
        "parked", "idle", "standby" -> Severity.Info
        "updating", "update", "waking" -> Severity.Warn
        "error", "fault", "offline_error" -> Severity.Critical
        else -> null
    }

/**
 * Vehicle status pill — the Android counterpart of the web `StatusBadge`: a neutral surface with a
 * leading status-colored dot and the (capitalized) [status] label. Unknown statuses render with a
 * muted dot rather than crashing.
 */
@Composable
fun StatusBadge(
    status: String,
    modifier: Modifier = Modifier,
    size: ChipSize = ChipSize.Md,
    label: String? = null,
) {
    val severity = vehicleStatusSeverity(status)
    val dotColor = if (severity != null) severityColor(severity) else MaterialTheme.colorScheme.onSurfaceVariant
    val dotSize = if (size == ChipSize.Sm) 6.dp else 8.dp
    val textStyle = if (size == ChipSize.Sm) MaterialTheme.typography.labelSmall else MaterialTheme.typography.labelMedium
    val vertical = if (size == ChipSize.Sm) 2.dp else Spacing.xs
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(Radius.pill),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = vertical),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Dot(dotColor, dotSize)
            Text(label ?: capitalizeStatus(status), style = textStyle)
        }
    }
}

@Composable
private fun Dot(
    color: Color,
    size: androidx.compose.ui.unit.Dp,
) {
    Box(modifier = Modifier.size(size).clip(CircleShape).background(color))
}

private fun capitalizeStatus(status: String): String =
    status.trim().replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
