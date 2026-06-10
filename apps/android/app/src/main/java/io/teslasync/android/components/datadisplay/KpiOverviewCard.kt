package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Section card composed of a [header] (typically a [ComparisonHeader]), a [kpis] slot (the page
 * arranges its `MetricCard`s in a grid/flow), an optional muted [secondary] line, and an optional
 * [footer] slot — the Android counterpart of the web `KpiOverviewCard`. Purely presentational.
 */
@Composable
fun KpiOverviewCard(
    header: @Composable () -> Unit,
    kpis: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    secondary: String? = null,
    footer: (@Composable () -> Unit)? = null,
) {
    GlassPanel(modifier = modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            header()
            kpis()
            if (secondary != null) HelperText(secondary)
            if (footer != null) footer()
        }
    }
}
