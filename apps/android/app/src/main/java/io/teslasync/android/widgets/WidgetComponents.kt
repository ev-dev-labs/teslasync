package io.teslasync.android.widgets

import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalContext
import androidx.glance.action.clickable
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle

/*
 * Shared Glance building blocks for the four TeslaSync widgets (P3/A8). Centralizing the surface,
 * header, freshness chip, state banner, and metric cells keeps every widget consistent and DRY; each
 * widget composes these around its own snapshot and adds no styling of its own.
 */

/** The brand-tinted big-number headline (battery %, primary count). */
@Composable
internal fun widgetHeadlineStyle(): TextStyle =
    TextStyle(color = GlanceTheme.colors.primary, fontSize = 30.sp, fontWeight = FontWeight.Bold)

/** A metric value (range, power, energy …). */
@Composable
internal fun widgetValueStyle(): TextStyle = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 16.sp, fontWeight = FontWeight.Bold)

/** The widget title / vehicle name. */
@Composable
internal fun widgetTitleStyle(): TextStyle =
    TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 13.sp, fontWeight = FontWeight.Medium)

/** A muted caption (labels, freshness, banners). */
@Composable
internal fun widgetCaptionStyle(): TextStyle = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 11.sp)

/**
 * The rounded, brand-surfaced widget root: marks the app-widget background (so the launcher's
 * rounded outline + background toggle apply), makes the whole widget the [onClick] tap target, and
 * publishes [description] as the accessibility label for the entire widget (TalkBack reads one
 * coherent sentence per ADR-015).
 */
@Composable
internal fun WidgetSurface(
    description: String,
    onClick: androidx.glance.action.Action,
    content: @Composable () -> Unit,
) {
    Box(
        modifier =
            GlanceModifier
                .fillMaxSize()
                .appWidgetBackground()
                .background(GlanceTheme.colors.surface)
                .cornerRadius(16.dp)
                .clickable(onClick)
                .padding(12.dp)
                .semantics { contentDescription = description },
        content = { content() },
    )
}

/** Title row: the widget/vehicle name on the left, the freshness chip on the right. */
@Composable
internal fun WidgetHeader(
    title: String,
    freshness: WidgetFreshness,
) {
    val context = LocalContext.current
    Row(
        modifier = GlanceModifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = title, style = widgetTitleStyle(), maxLines = 1)
        Spacer(GlanceModifier.defaultWeight())
        Text(text = WidgetText.freshnessLabel(context, freshness), style = widgetCaptionStyle(), maxLines = 1)
    }
}

/**
 * A tappable status banner for the offline / stale / error / loading states — last-known data stays
 * visible above it and the banner offers a retry (re-runs the background refresh) so a degraded widget
 * is honest and actionable rather than blank.
 */
@Composable
internal fun WidgetBanner(text: String) {
    Row(
        modifier =
            GlanceModifier
                .fillMaxWidth()
                .background(GlanceTheme.colors.secondaryContainer)
                .cornerRadius(8.dp)
                .clickable(WidgetActions.retry())
                .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = text,
            style = TextStyle(color = GlanceTheme.colors.onSecondaryContainer, fontSize = 11.sp),
            maxLines = 2,
        )
    }
}

/** A centered, single-line empty / loading / error body message. */
@Composable
internal fun WidgetMessageBody(message: String) {
    Box(
        modifier = GlanceModifier.fillMaxSize().padding(top = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = message, style = widgetCaptionStyle(), maxLines = 3)
    }
}

/** One labelled metric (value over caption), used in the metric grids. */
@Composable
internal fun WidgetMetricCell(
    label: String,
    value: String,
    modifier: GlanceModifier = GlanceModifier,
) {
    Column(modifier = modifier) {
        Text(text = value, style = widgetValueStyle(), maxLines = 1)
        Text(text = label, style = widgetCaptionStyle(), maxLines = 1)
    }
}

/** A label/value row (label left, value right) for the vertical detail lists. */
@Composable
internal fun WidgetKeyValueRow(
    label: String,
    value: String,
) {
    Row(
        modifier = GlanceModifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = label, style = widgetCaptionStyle(), maxLines = 1)
        Spacer(GlanceModifier.defaultWeight())
        Text(
            text = value,
            style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 12.sp, fontWeight = FontWeight.Medium),
            maxLines = 1,
        )
    }
}

/** A thin vertical gap. */
@Composable
internal fun WidgetVSpace(heightDp: Int = 8) {
    Spacer(GlanceModifier.height(heightDp.dp))
}

/** A thin horizontal gap. */
@Composable
internal fun WidgetHSpace(widthDp: Int = 8) {
    Spacer(GlanceModifier.width(widthDp.dp))
}
