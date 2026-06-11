package io.teslasync.android.widgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.glance.GlanceModifier
import androidx.glance.action.Action
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth

/**
 * The common widget chrome every widget composes through (P3/A8): the brand surface (whole-widget
 * [onClick] deep link + [description] a11y label), the title + freshness header, the render-state body
 * (loading / empty / error message vs. [content]), and the offline/stale/error retry banner. This is
 * the single place the [WidgetRenderState] contract becomes UI, so no section is ever silently hidden.
 */
@Composable
internal fun WidgetFrame(
    context: Context,
    onClick: Action,
    description: String,
    title: String,
    freshness: WidgetFreshness,
    renderState: WidgetRenderState,
    emptyMessage: String,
    content: @Composable () -> Unit,
) {
    WidgetSurface(description = description, onClick = onClick) {
        Column(modifier = GlanceModifier.fillMaxSize()) {
            WidgetHeader(title = title, freshness = freshness)
            WidgetVSpace(6)
            Box(modifier = GlanceModifier.defaultWeight().fillMaxWidth()) {
                WidgetFrameBody(context = context, renderState = renderState, emptyMessage = emptyMessage, content = content)
            }
            WidgetFrameBanner(context = context, renderState = renderState)
        }
    }
}

@Composable
private fun WidgetFrameBody(
    context: Context,
    renderState: WidgetRenderState,
    emptyMessage: String,
    content: @Composable () -> Unit,
) {
    val message = WidgetText.bodyMessage(context, renderState, emptyMessage)
    if (message != null) WidgetMessageBody(message) else content()
}

@Composable
private fun WidgetFrameBanner(
    context: Context,
    renderState: WidgetRenderState,
) {
    val text = WidgetText.stateBannerText(context, renderState) ?: return
    Column(modifier = GlanceModifier.fillMaxWidth()) {
        WidgetVSpace(6)
        WidgetBanner(text)
    }
}
