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
 * The charging home-screen widget (P3/A8): plugged/charging state, charge power, time-to-full ETA,
 * current SOC, the last session's energy/cost summary, and a charge-limit target — all from the cached
 * vehicle state + latest charging session. Shows offline/stale/error states honestly and deep-links to
 * the charging page.
 */
class ChargingWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = WidgetSizes.responsive()

    override suspend fun provideGlance(
        context: Context,
        id: GlanceId,
    ) {
        val widgets = (context.applicationContext as? TeslaSyncApplication)?.container?.widgets
        val snapshot =
            if (widgets != null) {
                val syncStatus = WidgetSyncState.status(getAppWidgetState(context, PreferencesGlanceStateDefinition, id))
                widgets.reader.charging(syncStatus)
            } else {
                WidgetSnapshot.loading()
            }
        provideContent {
            TeslaSyncGlanceTheme {
                ChargingBody(context = LocalContext.current, size = LocalSize.current, snapshot = snapshot)
            }
        }
    }
}

/** The charging widget receiver registered in the manifest. */
class ChargingWidgetReceiver : TeslaSyncWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ChargingWidget()
}

@Composable
private fun ChargingBody(
    context: Context,
    size: DpSize,
    snapshot: ChargingSnapshot,
) {
    val sizeClass = widgetSizeClassOf(size.width.value.toInt(), size.height.value.toInt())
    val title = context.getString(R.string.widget_charging_title)
    val emptyMessage = context.getString(R.string.widget_charging_empty)
    WidgetFrame(
        context = context,
        onClick = WidgetActions.openApp(context, WidgetKind.Charging),
        description = chargingDescription(context, title, emptyMessage, snapshot),
        title = title,
        freshness = snapshot.freshness,
        renderState = snapshot.renderState,
        emptyMessage = emptyMessage,
    ) {
        snapshot.content?.let { ChargingContentView(context, sizeClass, it) }
    }
}

@Composable
private fun ChargingContentView(
    context: Context,
    sizeClass: WidgetSizeClass,
    content: ChargingContent,
) {
    Column(modifier = GlanceModifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(text = content.socText, style = widgetHeadlineStyle(), maxLines = 1)
            WidgetHSpace(10)
            Text(text = chargingPhaseLabel(context, content.phase), style = widgetValueStyle(), maxLines = 1)
        }
        WidgetVSpace(6)
        for (detail in chargingDetails(sizeClass)) {
            chargingDetailValue(content, detail)?.let { value ->
                WidgetKeyValueRow(label = chargingDetailLabel(context, detail), value = value)
            }
        }
    }
}

private fun chargingPhaseLabel(
    context: Context,
    phase: ChargingPhase,
): String =
    when (phase) {
        ChargingPhase.Charging -> context.getString(R.string.widget_charging_charging)
        ChargingPhase.Idle -> context.getString(R.string.widget_charging_idle)
        ChargingPhase.Unknown -> WIDGET_EM_DASH
    }

private fun chargingDetailLabel(
    context: Context,
    detail: ChargingDetail,
): String =
    context.getString(
        when (detail) {
            ChargingDetail.Power -> R.string.widget_metric_power
            ChargingDetail.Eta -> R.string.widget_metric_eta
            ChargingDetail.Target -> R.string.widget_metric_target
            ChargingDetail.SessionSummary -> R.string.widget_metric_last_session
        },
    )

private fun chargingDetailValue(
    content: ChargingContent,
    detail: ChargingDetail,
): String? =
    when (detail) {
        ChargingDetail.Power -> content.powerText
        ChargingDetail.Eta -> content.etaText
        ChargingDetail.Target -> content.targetSocText
        ChargingDetail.SessionSummary -> content.sessionSummaryText
    }

private fun chargingDescription(
    context: Context,
    title: String,
    emptyMessage: String,
    snapshot: ChargingSnapshot,
): String =
    buildList {
        add(title)
        val message = WidgetText.bodyMessage(context, snapshot.renderState, emptyMessage)
        if (message != null) {
            add(message)
        } else {
            snapshot.content?.let { c ->
                add(chargingPhaseLabel(context, c.phase))
                add("${context.getString(R.string.widget_metric_battery)} ${c.socText}")
                c.powerText?.let { add("${context.getString(R.string.widget_metric_power)} $it") }
                c.etaText?.let { add("${context.getString(R.string.widget_metric_eta)} $it") }
            }
        }
        WidgetText.stateBannerText(context, snapshot.renderState)?.let { add(it) }
        add(WidgetText.freshnessLabel(context, snapshot.freshness))
    }.joinToString(", ")
