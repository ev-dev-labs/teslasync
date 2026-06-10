package io.teslasync.android.components.charts

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.patrykandpatrick.vico.compose.cartesian.axis.rememberAxisGuidelineComponent
import com.patrykandpatrick.vico.compose.common.component.rememberShapeComponent
import com.patrykandpatrick.vico.compose.common.component.rememberTextComponent
import com.patrykandpatrick.vico.compose.common.fill
import com.patrykandpatrick.vico.compose.common.insets
import com.patrykandpatrick.vico.compose.common.shape.markerCorneredShape
import com.patrykandpatrick.vico.core.cartesian.marker.CartesianMarker
import com.patrykandpatrick.vico.core.cartesian.marker.DefaultCartesianMarker
import com.patrykandpatrick.vico.core.common.shape.CorneredShape
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Chart tooltip surfaces — the Android counterpart of the web `ChartTooltip`.
 *
 * On Vico the live hover tooltip is a "marker", so [rememberChartMarker] builds a
 * themed [DefaultCartesianMarker] (rounded label background + guideline) that the
 * chart wrappers attach. [ChartTooltipContent] is the same visual as a standalone
 * composable for previews and non-Vico contexts.
 */
@Composable
internal fun rememberChartMarker(): CartesianMarker {
    val background =
        rememberShapeComponent(
            fill = fill(MaterialTheme.colorScheme.surfaceContainerHigh),
            shape = markerCorneredShape(CorneredShape.Corner.Rounded),
        )
    val label =
        rememberTextComponent(
            color = MaterialTheme.colorScheme.onSurface,
            padding = insets(Spacing.sm, Spacing.xs),
            background = background,
        )
    val guideline = rememberAxisGuidelineComponent()
    return remember(label, guideline) {
        DefaultCartesianMarker(
            label = label,
            valueFormatter = DefaultCartesianMarker.ValueFormatter.default(),
            guideline = guideline,
        )
    }
}

/** A floating tooltip body: a [label] header over one [ChartTooltipEntry] row per series. */
@Composable
fun ChartTooltipContent(
    label: String,
    entries: List<ChartTooltipEntry>,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = Elevation.overlay,
    ) {
        Column(modifier = Modifier.padding(Spacing.sm)) {
            Caption(label)
            entries.forEach { entry ->
                Row(
                    modifier = Modifier.padding(top = Spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier =
                            Modifier
                                .padding(end = Spacing.xs)
                                .size(SWATCH_SIZE)
                                .clip(CircleShape)
                                .background(entry.color),
                    )
                    BodyText(entry.label, modifier = Modifier.padding(end = Spacing.sm))
                    MetricLabel(entry.value)
                }
            }
        }
    }
}

private val SWATCH_SIZE = 10.dp
