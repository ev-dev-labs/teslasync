package io.teslasync.android.components.maps

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * The non-visual list alternative for an opaque map, mirroring the accessible-summary intent
 * of the chart layer. Renders [label] plus one row per [lines] entry (markers, route points, or
 * geofences) so screen-reader and forced-colors users get the same information the map conveys.
 * Pair it with [TeslaMap] on every map-bearing page.
 */
@Composable
fun MapAccessibleSummary(
    label: String,
    lines: List<String>,
    modifier: Modifier = Modifier,
    emptyMessage: String = "Nothing to describe yet.",
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(MapsGlyphs.Map, contentDescription = null, size = IconSize.Sm)
            PanelTitle(label)
        }
        if (lines.isEmpty()) {
            Caption(emptyMessage)
        } else {
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(max = SUMMARY_MAX_HEIGHT)
                        .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                lines.forEach { line ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.Top,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    ) {
                        Icon(MapsGlyphs.Navigation, contentDescription = null, size = IconSize.Xs)
                        BodyText(line, modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

private val SUMMARY_MAX_HEIGHT = 220.dp
