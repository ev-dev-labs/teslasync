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
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxWidth
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.Text
import io.teslasync.android.R
import io.teslasync.android.TeslaSyncApplication

/**
 * The vehicle-status home-screen widget (P3/A8): battery SOC, range, drive/charge/park/sleep state,
 * lock, and freshness — read entirely from the cached shared-core vehicle state (never from a live
 * stream). It supports a compact (battery + range) and a medium/large (battery + range + temperature
 * + lock) layout, and deep-links into the at-a-glance page.
 */
class VehicleStatusWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = WidgetSizes.responsive()

    override suspend fun provideGlance(
        context: Context,
        id: GlanceId,
    ) {
        val widgets = (context.applicationContext as? TeslaSyncApplication)?.container?.widgets
        val snapshot =
            if (widgets != null) {
                val syncStatus = WidgetSyncState.status(getAppWidgetState(context, PreferencesGlanceStateDefinition, id))
                widgets.reader.vehicleStatus(syncStatus)
            } else {
                WidgetSnapshot.loading()
            }
        provideContent {
            TeslaSyncGlanceTheme {
                VehicleStatusBody(context = LocalContext.current, size = LocalSize.current, snapshot = snapshot)
            }
        }
    }
}

/** The vehicle-status widget receiver registered in the manifest. */
class VehicleStatusWidgetReceiver : TeslaSyncWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = VehicleStatusWidget()
}

@Composable
private fun VehicleStatusBody(
    context: Context,
    size: DpSize,
    snapshot: VehicleStatusSnapshot,
) {
    val sizeClass = widgetSizeClassOf(size.width.value.toInt(), size.height.value.toInt())
    val title = snapshot.content?.vehicleName ?: context.getString(R.string.widget_vehicle_title)
    val emptyMessage = context.getString(R.string.widget_vehicle_empty)
    WidgetFrame(
        context = context,
        onClick = WidgetActions.openApp(context, WidgetKind.VehicleStatus),
        description = vehicleStatusDescription(context, title, emptyMessage, snapshot),
        title = title,
        freshness = snapshot.freshness,
        renderState = snapshot.renderState,
        emptyMessage = emptyMessage,
    ) {
        snapshot.content?.let { VehicleStatusContentView(context, sizeClass, it) }
    }
}

@Composable
private fun VehicleStatusContentView(
    context: Context,
    sizeClass: WidgetSizeClass,
    content: VehicleStatusContent,
) {
    Column(modifier = GlanceModifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(text = content.socText, style = widgetHeadlineStyle(), maxLines = 1)
            WidgetHSpace(10)
            Text(text = WidgetText.fsmStateLabel(context, content.fsmState), style = widgetValueStyle(), maxLines = 1)
        }
        WidgetVSpace(6)
        for (metric in vehicleStatusMetrics(sizeClass)) {
            WidgetKeyValueRow(
                label = vehicleMetricLabel(context, metric),
                value = vehicleMetricValue(context, content, metric),
            )
        }
    }
}

private fun vehicleMetricLabel(
    context: Context,
    metric: VehicleStatusMetric,
): String =
    context.getString(
        when (metric) {
            VehicleStatusMetric.Range -> R.string.widget_metric_range
            VehicleStatusMetric.Temperature -> R.string.widget_metric_temp
            VehicleStatusMetric.Lock -> R.string.widget_metric_lock
        },
    )

private fun vehicleMetricValue(
    context: Context,
    content: VehicleStatusContent,
    metric: VehicleStatusMetric,
): String =
    when (metric) {
        VehicleStatusMetric.Range -> content.rangeText
        VehicleStatusMetric.Temperature -> content.insideTempText
        VehicleStatusMetric.Lock -> lockText(context, content.isLocked)
    }

private fun lockText(
    context: Context,
    isLocked: Boolean?,
): String =
    when (isLocked) {
        true -> context.getString(R.string.widget_lock_locked)
        false -> context.getString(R.string.widget_lock_unlocked)
        null -> WIDGET_EM_DASH
    }

private fun vehicleStatusDescription(
    context: Context,
    title: String,
    emptyMessage: String,
    snapshot: VehicleStatusSnapshot,
): String =
    buildList {
        add(title)
        val message = WidgetText.bodyMessage(context, snapshot.renderState, emptyMessage)
        if (message != null) {
            add(message)
        } else {
            snapshot.content?.let { c ->
                add(WidgetText.fsmStateLabel(context, c.fsmState))
                add("${context.getString(R.string.widget_metric_battery)} ${c.socText}")
                add("${context.getString(R.string.widget_metric_range)} ${c.rangeText}")
            }
        }
        WidgetText.stateBannerText(context, snapshot.renderState)?.let { add(it) }
        add(WidgetText.freshnessLabel(context, snapshot.freshness))
    }.joinToString(", ")
