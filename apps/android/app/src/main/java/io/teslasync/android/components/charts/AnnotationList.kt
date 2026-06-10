package io.teslasync.android.components.charts

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * List of a chart's annotations with category color dots and an optional remove
 * action — the Android counterpart of the web `AnnotationList`. Pairs with the
 * `ChartMarkerRail` (which shows them on the plot) to give a readable, removable
 * roster below the chart. Renders nothing when empty.
 */
@Composable
fun AnnotationList(
    annotations: List<DataAnnotation>,
    modifier: Modifier = Modifier,
    title: String = "Annotations",
    removeLabel: String = "Remove annotation",
    onRemove: ((String) -> Unit)? = null,
) {
    if (annotations.isEmpty()) return
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(title)
        annotations.forEach { annotation ->
            val dotColor = annotationColor(annotation.category)
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(Radius.md))
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Box(modifier = Modifier.size(DOT_SIZE).clip(CircleShape).background(dotColor))
                BodyText(annotation.label, modifier = Modifier.weight(1f))
                if (annotation.timestampLabel.isNotEmpty()) {
                    Caption(annotation.timestampLabel)
                }
                if (onRemove != null) {
                    IconButton(
                        imageVector = TeslaGlyphs.Close,
                        contentDescription = removeLabel,
                        onClick = { onRemove(annotation.id) },
                        size = IconSize.Sm,
                    )
                }
            }
        }
    }
}

private val DOT_SIZE = 8.dp
