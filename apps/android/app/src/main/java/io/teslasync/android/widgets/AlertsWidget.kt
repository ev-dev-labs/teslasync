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
 * The alerts home-screen widget (P3/A8): the count of unacknowledged critical alerts (matching the web
 * `severity == critical && !is_read`), total unread, the latest alert, and a quiet-hours indication —
 * all from the cached alert inbox + the device notification settings. Deep-links to the alerts page.
 */
class AlertsWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = WidgetSizes.responsive()

    override suspend fun provideGlance(
        context: Context,
        id: GlanceId,
    ) {
        val widgets = (context.applicationContext as? TeslaSyncApplication)?.container?.widgets
        val snapshot =
            if (widgets != null) {
                val syncStatus = WidgetSyncState.status(getAppWidgetState(context, PreferencesGlanceStateDefinition, id))
                widgets.reader.alerts(syncStatus)
            } else {
                WidgetSnapshot.loading()
            }
        provideContent {
            TeslaSyncGlanceTheme {
                AlertsBody(context = LocalContext.current, size = LocalSize.current, snapshot = snapshot)
            }
        }
    }
}

/** The alerts widget receiver registered in the manifest. */
class AlertsWidgetReceiver : TeslaSyncWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = AlertsWidget()
}

@Composable
private fun AlertsBody(
    context: Context,
    size: DpSize,
    snapshot: AlertsSnapshot,
) {
    val sizeClass = widgetSizeClassOf(size.width.value.toInt(), size.height.value.toInt())
    val title = context.getString(R.string.widget_alerts_title)
    val emptyMessage = context.getString(R.string.widget_alerts_empty)
    WidgetFrame(
        context = context,
        onClick = WidgetActions.openApp(context, WidgetKind.Alerts),
        description = alertsDescription(context, title, emptyMessage, snapshot),
        title = title,
        freshness = snapshot.freshness,
        renderState = snapshot.renderState,
        emptyMessage = emptyMessage,
    ) {
        snapshot.content?.let { AlertsContentView(context, sizeClass, it) }
    }
}

@Composable
private fun AlertsContentView(
    context: Context,
    sizeClass: WidgetSizeClass,
    content: AlertsContent,
) {
    Column(modifier = GlanceModifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(text = formatCount(content.criticalCount), style = widgetHeadlineStyle(), maxLines = 1)
            WidgetHSpace(10)
            Text(text = context.getString(R.string.widget_alerts_critical), style = widgetValueStyle(), maxLines = 1)
        }
        WidgetVSpace(6)
        WidgetKeyValueRow(
            label = context.getString(R.string.widget_alerts_unread),
            value = formatCount(content.unreadCount),
        )
        if (alertsShowsLatest(sizeClass) && content.latestTitle != null) {
            WidgetVSpace(4)
            Text(text = content.latestTitle, style = widgetCaptionStyle(), maxLines = 2)
        }
        if (content.quietHoursActive) {
            WidgetVSpace(4)
            Text(text = context.getString(R.string.widget_alerts_quiet_hours), style = widgetCaptionStyle(), maxLines = 1)
        }
    }
}

private fun alertsDescription(
    context: Context,
    title: String,
    emptyMessage: String,
    snapshot: AlertsSnapshot,
): String =
    buildList {
        add(title)
        val message = WidgetText.bodyMessage(context, snapshot.renderState, emptyMessage)
        if (message != null) {
            add(message)
        } else {
            snapshot.content?.let { c ->
                add("${c.criticalCount} ${context.getString(R.string.widget_alerts_critical)}")
                add("${c.unreadCount} ${context.getString(R.string.widget_alerts_unread)}")
                c.latestTitle?.let { add(it) }
                if (c.quietHoursActive) add(context.getString(R.string.widget_alerts_quiet_hours))
            }
        }
        WidgetText.stateBannerText(context, snapshot.renderState)?.let { add(it) }
        add(WidgetText.freshnessLabel(context, snapshot.freshness))
    }.joinToString(", ")
