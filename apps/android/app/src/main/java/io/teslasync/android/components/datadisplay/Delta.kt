// File named after its primary @Composable; the co-located enum is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.ui.theme.generated.Spacing
import kotlin.math.abs

/** How a [Delta] renders its change: percent, absolute, or both. */
enum class DeltaDisplay { Percent, Absolute, Both }

private const val EM_DASH = "\u2014"

/**
 * Direction-aware change indicator with a unified arrow and tone color — the Android counterpart
 * of the web `Delta`. The arrow encodes the sign (the value is always rendered positive); color
 * follows the [metric] direction via [deltaTone]. Missing inputs render an em dash with no color.
 *
 * Unit conversion is the page's job: pass [unitPrefix] / [unitSuffix] (e.g. "$" / "kWh") already
 * resolved for the user's preferences.
 */
@Composable
fun Delta(
    current: Double?,
    previous: Double?,
    metric: MetricSemantic,
    modifier: Modifier = Modifier,
    display: DeltaDisplay = DeltaDisplay.Percent,
    comparedTo: String? = null,
    hideArrow: Boolean = false,
    loading: Boolean = false,
    decimals: Int = 1,
    unitPrefix: String = "",
    unitSuffix: String = "",
) {
    if (loading) {
        Box(
            modifier =
                modifier
                    .width(DELTA_SKELETON_WIDTH)
                    .height(DELTA_SKELETON_HEIGHT)
                    .clip(RoundedCornerShape(4.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
        )
        return
    }

    val hasData = current != null && current.isFinite() && previous != null && previous.isFinite()
    if (!hasData) {
        Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(EM_DASH, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (comparedTo !=
                null
            ) {
                Text(comparedTo, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        return
    }

    val signed = signedDelta(current, previous)
    val pct = percentDelta(current, previous)
    val tone = deltaTone(metric.direction, signed)
    val color = deltaToneColor(tone)
    val arrow = deltaArrow(signed)

    val absText = formatAbsolute(abs(signed), unitPrefix, unitSuffix, decimals)
    val pctText = pct?.let { "${ChartFormat.number(abs(it), decimals)}%" }
    val valueText =
        when (display) {
            DeltaDisplay.Absolute -> absText
            DeltaDisplay.Both -> if (pctText != null) "$absText ($pctText)" else absText
            DeltaDisplay.Percent -> pctText ?: EM_DASH
        }

    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = listOfNotNull(valueText, comparedTo).joinToString(" ") },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (!hideArrow) Icon(deltaArrowGlyph(arrow), contentDescription = null, size = IconSize.Xs, tint = color)
        Text(valueText, style = MaterialTheme.typography.labelMedium, color = color)
        if (comparedTo != null) {
            Text(comparedTo, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Formats a positive [absValue] with the resolved unit prefix/suffix (matches the web rules). */
private fun formatAbsolute(
    absValue: Double,
    prefix: String,
    suffix: String,
    decimals: Int,
): String {
    val num = ChartFormat.number(absValue, decimals)
    return when {
        prefix.isNotEmpty() && suffix.isNotEmpty() -> "$prefix$num $suffix"
        prefix.isNotEmpty() -> "$prefix$num"
        suffix == "%" -> "$num%"
        suffix.isNotEmpty() -> "$num $suffix"
        else -> num
    }
}

private val DELTA_SKELETON_WIDTH = 56.dp
private val DELTA_SKELETON_HEIGHT = 14.dp
