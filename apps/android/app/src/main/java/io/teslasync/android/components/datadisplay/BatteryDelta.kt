// File named after its primary @Composable; the co-located enum is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.ui.theme.generated.Spacing
import kotlin.math.abs
import kotlin.math.roundToInt

/** Direction of a battery state-of-charge change. */
enum class BatteryTrend { Charge, Drain, Flat }

/** Display variant for [BatteryDelta]: just the change, or a "79% → 78%" pair. */
enum class BatteryDeltaVariant { Compact, Pair }

private const val EM_DASH = "\u2014"
private const val MINUS = "\u2212"

/** True when both endpoints are present and finite. */
fun hasBatteryData(
    startPct: Double?,
    endPct: Double?,
): Boolean = startPct != null && endPct != null && startPct.isFinite() && endPct.isFinite()

/** Signed SoC change `end - start`, or `null` when data is missing. */
fun batteryDeltaValue(
    startPct: Double?,
    endPct: Double?,
): Double? = if (hasBatteryData(startPct, endPct)) endPct!! - startPct!! else null

/** Trend tier for a signed [delta] (null/zero ⇒ flat). */
fun batteryTrend(delta: Double?): BatteryTrend =
    when {
        delta == null || delta == 0.0 -> BatteryTrend.Flat
        delta > 0.0 -> BatteryTrend.Charge
        else -> BatteryTrend.Drain
    }

/** Compact label for a signed [delta] (e.g. "+12%", "−1%", "—"). */
fun batteryDeltaLabel(delta: Double?): String {
    if (delta == null || delta == 0.0) return EM_DASH
    val magnitude = abs(delta).roundToInt()
    val sign = if (delta > 0.0) "+" else MINUS
    return "$sign$magnitude%"
}

/**
 * Compact battery state-of-charge change — the Android counterpart of the web `BatteryDelta`.
 * Charge gains render green, drains amber, and zero/missing render muted.
 */
@Composable
fun BatteryDelta(
    startPct: Double?,
    endPct: Double?,
    modifier: Modifier = Modifier,
    showIcon: Boolean = true,
    variant: BatteryDeltaVariant = BatteryDeltaVariant.Compact,
    contentDescription: String? = null,
) {
    val hasData = hasBatteryData(startPct, endPct)
    val delta = batteryDeltaValue(startPct, endPct)
    val trend = batteryTrend(delta)
    val color = batteryTrendColor(trend)
    val visible =
        when {
            !hasData -> EM_DASH
            variant == BatteryDeltaVariant.Pair -> "${startPct!!.roundToInt()}% \u2192 ${endPct!!.roundToInt()}%"
            else -> batteryDeltaLabel(delta)
        }
    Row(
        modifier = modifier.clearAndSetSemantics { if (contentDescription != null) this.contentDescription = contentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (showIcon) {
            Icon(
                DataDisplayGlyphs.Battery,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            visible,
            style = MaterialTheme.typography.labelMedium,
            color = if (hasData) color else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
