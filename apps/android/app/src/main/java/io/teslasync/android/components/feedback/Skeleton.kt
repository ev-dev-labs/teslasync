package io.teslasync.android.components.feedback

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Shimmering loading primitives mirroring web `components/feedback/Skeleton`,
 * `StatSkeleton`, `PageSkeleton`, `PageLoadSkeleton`, and `ChartSkeleton`. A single pulsing-alpha
 * [rememberInfiniteTransition] animates the neutral `surfaceVariant` fill so loading regions are
 * never blank. Compose into page-level scaffolds while the first data fetch is in flight.
 */
@Composable
private fun shimmerAlpha(): Float {
    val transition = rememberInfiniteTransition(label = "skeleton")
    val alpha by transition.animateFloat(
        initialValue = SHIMMER_MIN_ALPHA,
        targetValue = SHIMMER_MAX_ALPHA,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = MotionDurations.slow * 2),
                repeatMode = RepeatMode.Reverse,
            ),
        label = "skeleton-alpha",
    )
    return alpha
}

/** A single shimmering bar of [height], filling [widthFraction] of its parent width. */
@Composable
fun Skeleton(
    modifier: Modifier = Modifier,
    widthFraction: Float = 1f,
    height: Dp = 16.dp,
    rounded: Boolean = false,
) {
    val shape = if (rounded) RoundedCornerShape(Radius.pill) else RoundedCornerShape(Radius.sm)
    val alpha = shimmerAlpha()
    Box(
        modifier =
            modifier
                .fillMaxWidth(widthFraction.coerceIn(0f, 1f))
                .height(height)
                .clip(shape)
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = alpha)),
    )
}

/** A stack of [lines] shimmering bars; the final line is shortened to 60% (paragraph loading shape). */
@Composable
fun SkeletonLines(
    modifier: Modifier = Modifier,
    lines: Int = 3,
    lineHeight: Dp = 12.dp,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        for (i in 0 until lines.coerceAtLeast(1)) {
            Skeleton(widthFraction = skeletonLineFraction(i, lines), height = lineHeight)
        }
    }
}

/** Loading shape for a single stat tile (label + large value). */
@Composable
fun StatSkeleton(modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Skeleton(widthFraction = STAT_LABEL_FRACTION, height = 10.dp)
        Skeleton(widthFraction = STAT_VALUE_FRACTION, height = 24.dp)
    }
}

/** Loading shape for a page header (title + subtitle). */
@Composable
fun PageHeaderSkeleton(modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Skeleton(widthFraction = HEADER_TITLE_FRACTION, height = 22.dp)
        Skeleton(widthFraction = HEADER_SUBTITLE_FRACTION, height = 12.dp)
    }
}

/** Loading row of [count] stat tiles. */
@Composable
fun StatGridSkeleton(
    modifier: Modifier = Modifier,
    count: Int = 4,
) {
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        repeat(count.coerceAtLeast(1)) {
            Column(modifier = Modifier.weight(1f)) { StatSkeleton() }
        }
    }
}

/** Loading shape for a chart panel of [height]. */
@Composable
fun ChartBlockSkeleton(
    modifier: Modifier = Modifier,
    height: Dp = 200.dp,
) {
    Skeleton(modifier = modifier, height = height)
}

/** Loading shape for a list/table of [rows] × [columns] cells. */
@Composable
fun TableSkeleton(
    modifier: Modifier = Modifier,
    rows: Int = 5,
    columns: Int = 4,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        repeat(rows.coerceAtLeast(1)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
                repeat(columns.coerceAtLeast(1)) {
                    Column(modifier = Modifier.weight(1f)) { Skeleton(height = 14.dp) }
                }
            }
        }
    }
}

/** Chart loading shape with a caption line — mirrors web `ChartSkeleton`. */
@Composable
fun ChartSkeleton(
    modifier: Modifier = Modifier,
    height: Dp = 200.dp,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Skeleton(widthFraction = HEADER_SUBTITLE_FRACTION, height = 12.dp)
        ChartBlockSkeleton(height = height)
    }
}

/** Full-page skeleton: header, stat grid, and a chart block — mirrors web `PageSkeleton`. */
@Composable
fun PageSkeleton(
    modifier: Modifier = Modifier,
    statCount: Int = 4,
    accessibleLabel: String = "Loading page",
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = accessibleLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageHeaderSkeleton()
        StatGridSkeleton(count = statCount)
        ChartBlockSkeleton()
    }
}

/** Alias scaffold used while a lazily-loaded route boots — mirrors web `PageLoadSkeleton`. */
@Composable
fun PageLoadSkeleton(
    modifier: Modifier = Modifier,
    accessibleLabel: String = "Loading page",
) {
    PageSkeleton(modifier = modifier, accessibleLabel = accessibleLabel)
}

private const val SHIMMER_MIN_ALPHA = 0.35f
private const val SHIMMER_MAX_ALPHA = 0.85f
private const val STAT_LABEL_FRACTION = 0.5f
private const val STAT_VALUE_FRACTION = 0.7f
private const val HEADER_TITLE_FRACTION = 0.6f
private const val HEADER_SUBTITLE_FRACTION = 0.4f
