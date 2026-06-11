package io.teslasync.android.notifications

import io.teslasync.android.push.PushPayload

/**
 * The fully-composed semantic notification (P3/A6). Produced by [NotificationComposer] from a decoded
 * [PushPayload], it is the single source the dispatcher fans out: the in-app banner renders [title] /
 * [body] at [severity]; the OS notification is posted on [channelId] with a tap that opens
 * [deepLinkUri] and the [actions] rendered as buttons. [routePath] is the validated in-app route the
 * tap navigates to.
 */
data class NotificationContent(
    val kind: NotificationKind,
    val channelId: String,
    val title: String,
    val body: String,
    val severity: BannerSeverity,
    val routePath: String,
    val entityId: String?,
    val deepLinkUri: String,
    val actions: List<NotificationAction> = emptyList(),
) {
    /** True when there is something to show — a payload with no title and no body is recorded only. */
    val hasDisplayText: Boolean get() = title.isNotBlank() || body.isNotBlank()
}

/**
 * Composes a decoded [PushPayload] into a localized-by-the-backend [NotificationContent] (P3/A6). The
 * title/body come from the backend (the only safe display text source per ADR-009); when the user has
 * enabled privacy redaction they are additionally run through [NotificationRedaction] so a VIN, GPS
 * pair or email is masked. Pure and total so it is fully unit-tested.
 */
object NotificationComposer {
    /** Builds the [NotificationContent] for [payload] honoring the user's [settings]. */
    fun compose(
        payload: PushPayload,
        settings: NotificationSettings,
    ): NotificationContent {
        val kind = NotificationKinds.parse(payload.kind)
        val severity = BannerSeverities.of(payload.category, kind)
        val resolved = NotificationRouteMap.resolve(kind, payload.data)
        val channelId = NotificationChannels.channelIdFor(kind, payload.data["channel"] ?: payload.category)
        val content =
            NotificationContent(
                kind = kind,
                channelId = channelId,
                title = display(payload.title, settings),
                body = display(payload.body, settings),
                severity = severity,
                routePath = resolved.path,
                entityId = resolved.entityId,
                deepLinkUri = NotificationRouteMap.deepLinkUriFor(resolved.path),
            )
        return content.copy(actions = NotificationActions.actionsFor(content))
    }

    private fun display(
        text: String?,
        settings: NotificationSettings,
    ): String {
        val raw = text?.trim().orEmpty()
        return if (settings.redactSensitiveContent) NotificationRedaction.redact(raw) else raw
    }
}
