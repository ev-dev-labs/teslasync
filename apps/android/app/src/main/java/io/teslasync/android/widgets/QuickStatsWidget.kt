package io.teslasync.android.widgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.state.PreferencesGlanceStateDefinition
import io.teslasync.android.R
import io.teslasync.android.TeslaSyncApplication

/**
 * The quick-stats home-screen widget (P3/A8): fleet distance, energy, cost, efficiency, and trip/charge
 * counts from the cached dashboard summary — the at-a-glance analogue of the web Quick Stats page. A
 * fresh install (all-zero summary) shows the empty state; the grid grows from 2 tiles (compact) to 6
 * (large). Deep-links to the quick-stats page.
 */
class QuickStatsWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = WidgetSizes.responsive()

    override suspend fun provideGlance(
        context: Context,
        id: GlanceId,
    ) {
        val widgets = (context.applicationContext as? TeslaSyncApplication)?.container?.widgets
        val snapshot =
            if (widgets != null) {
                val syncStatus = WidgetSyncState.status(getAppWidgetState(context, PreferencesGlanceStateDefinition, id))
                widgets.reader.quickStats(syncStatus)
            } else {
                WidgetSnapshot.loading()
            }
        provideContent {
            TeslaSyncGlanceTheme {
                QuickStatsBody(context = LocalContext.current, size = LocalSize.current, snapshot = snapshot)
            }
        }
    }
}

/** The quick-stats widget receiver registered in the manifest. */
class QuickStatsWidgetReceiver : TeslaSyncWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = QuickStatsWidget()
}

@Composable
private fun QuickStatsBody(
    context: Context,
    size: DpSize,
    snapshot: QuickStatsSnapshot,
) {
    val sizeClass = widgetSizeClassOf(size.width.value.toInt(), size.height.value.toInt())
    val title = context.getString(R.string.widget_quickstats_title)
    val emptyMessage = context.getString(R.string.widget_quickstats_empty)
    WidgetFrame(
        context = context,
        onClick = WidgetActions.openApp(context, WidgetKind.QuickStats),
        description = quickStatsDescription(context, title, emptyMessage, snapshot),
        title = title,
        freshness = snapshot.freshness,
        renderState = snapshot.renderState,
        emptyMessage = emptyMessage,
    ) {
        snapshot.content?.let { QuickStatsContentView(context, sizeClass, it) }
    }
}

@Composable
private fun QuickStatsContentView(
    context: Context,
    sizeClass: WidgetSizeClass,
    content: QuickStatsContent,
) {
    Column(modifier = GlanceModifier.fillMaxWidth()) {
        for (rowMetrics in quickStatsMetrics(sizeClass).chunked(2)) {
            Row(modifier = GlanceModifier.fillMaxWidth()) {
                WidgetMetricCell(
                    label = quickStatMetricLabel(context, rowMetrics[0]),
                    value = quickStatMetricValue(content, rowMetrics[0]),
                    modifier = GlanceModifier.defaultWeight(),
                )
                WidgetHSpace(8)
                val second = rowMetrics.getOrNull(1)
                if (second != null) {
                    WidgetMetricCell(
                        label = quickStatMetricLabel(context, second),
                        value = quickStatMetricValue(content, second),
                        modifier = GlanceModifier.defaultWeight(),
                    )
                } else {
                    Spacer(GlanceModifier.defaultWeight())
                }
            }
            WidgetVSpace(6)
        }
    }
}

private fun quickStatMetricLabel(
    context: Context,
    metric: QuickStatMetric,
): String =
    context.getString(
        when (metric) {
            QuickStatMetric.Distance -> R.string.widget_metric_distance
            QuickStatMetric.Energy -> R.string.widget_metric_energy
            QuickStatMetric.Cost -> R.string.widget_metric_cost
            QuickStatMetric.Efficiency -> R.string.widget_metric_efficiency
            QuickStatMetric.Drives -> R.string.widget_metric_drives
            QuickStatMetric.Charges -> R.string.widget_metric_charges
        },
    )

private fun quickStatMetricValue(
    content: QuickStatsContent,
    metric: QuickStatMetric,
): String =
    when (metric) {
        QuickStatMetric.Distance -> content.distanceText
        QuickStatMetric.Energy -> content.energyText
        QuickStatMetric.Cost -> content.costText
        QuickStatMetric.Efficiency -> content.efficiencyText
        QuickStatMetric.Drives -> formatCount(content.drivesCount)
        QuickStatMetric.Charges -> formatCount(content.chargesCount)
    }

private fun quickStatsDescription(
    context: Context,
    title: String,
    emptyMessage: String,
    snapshot: QuickStatsSnapshot,
): String =
    buildList {
        add(title)
        val message = WidgetText.bodyMessage(context, snapshot.renderState, emptyMessage)
        if (message != null) {
            add(message)
        } else {
            snapshot.content?.let { c ->
                add("${context.getString(R.string.widget_metric_distance)} ${c.distanceText}")
                add("${context.getString(R.string.widget_metric_energy)} ${c.energyText}")
                add("${context.getString(R.string.widget_metric_cost)} ${c.costText}")
            }
        }
        WidgetText.stateBannerText(context, snapshot.renderState)?.let { add(it) }
        add(WidgetText.freshnessLabel(context, snapshot.freshness))
    }.joinToString(", ")
