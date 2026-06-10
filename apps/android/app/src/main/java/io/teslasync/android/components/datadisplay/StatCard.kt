// File named after its primary @Composable; the co-located data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/** Optional trend chip for a [StatCard]: an arrow, a pre-formatted change [text], and a tone. */
data class StatTrend(
    val direction: DeltaArrow,
    val text: String,
    /** `true` good (green), `false` bad (red), `null` follows the arrow (flat ⇒ muted). */
    val positive: Boolean? = null,
)

/**
 * KPI tile mirroring web `data-display/StatCard`: a [label], a large [value] with optional
 * [unit], an optional leading [icon], an optional [trend] chip, and a muted [sublabel]. When
 * [loading] is true a skeleton is shown instead of the value.
 */
@Composable
fun StatCard(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    unit: String? = null,
    icon: ImageVector? = null,
    trend: StatTrend? = null,
    sublabel: String? = null,
    loading: Boolean = false,
) {
    Card(modifier = modifier) {
        if (loading) {
            StatCardSkeleton()
            return@Card
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MetricLabel(label)
            if (icon != null) {
                Icon(
                    icon,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Row(
            modifier = Modifier.padding(top = Spacing.xs),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            MetricValue(value)
            if (unit != null) Caption(unit, modifier = Modifier.padding(bottom = Spacing.xs))
        }
        if (trend != null) StatCardTrend(trend, modifier = Modifier.padding(top = Spacing.xs))
        if (sublabel != null) HelperText(sublabel, modifier = Modifier.padding(top = Spacing.xs))
    }
}

@Composable
private fun StatCardTrend(
    trend: StatTrend,
    modifier: Modifier = Modifier,
) {
    val tone =
        when {
            trend.positive == true -> DeltaTone.Good
            trend.direction == DeltaArrow.Flat || trend.positive == null -> DeltaTone.Muted
            else -> DeltaTone.Bad
        }
    val color = deltaToneColor(tone)
    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = trend.text },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(deltaArrowGlyph(trend.direction), contentDescription = null, size = IconSize.Xs, tint = color)
        Caption(trend.text)
    }
}

@Composable
private fun StatCardSkeleton() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SkeletonBar(widthFraction = 0.6f, height = SKELETON_LABEL_HEIGHT)
        SkeletonBar(widthFraction = 0.4f, height = SKELETON_VALUE_HEIGHT)
    }
}

@Composable
private fun SkeletonBar(
    widthFraction: Float,
    height: Dp,
) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth(widthFraction)
                .height(height)
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(Radius.sm)),
    )
}

/** Maps a [DeltaArrow] to its glyph. */
internal fun deltaArrowGlyph(arrow: DeltaArrow): ImageVector =
    when (arrow) {
        DeltaArrow.Up -> DataDisplayGlyphs.ArrowUp
        DeltaArrow.Down -> DataDisplayGlyphs.ArrowDown
        DeltaArrow.Flat -> DataDisplayGlyphs.ArrowRight
    }

private val SKELETON_LABEL_HEIGHT = 16.dp
private val SKELETON_VALUE_HEIGHT = 28.dp
