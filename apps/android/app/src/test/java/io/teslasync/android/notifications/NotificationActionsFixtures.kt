package io.teslasync.android.notifications

/** Builds a [NotificationContent] for a [kind] with a real [routePath] for action-mapping tests. */
internal fun content(
    kind: NotificationKind,
    routePath: String,
): NotificationContent =
    NotificationContent(
        kind = kind,
        channelId = NotificationChannels.channelIdFor(kind),
        title = "t",
        body = "b",
        severity = BannerSeverity.Info,
        routePath = routePath,
        entityId = null,
        deepLinkUri = NotificationRouteMap.deepLinkUriFor(routePath),
    )
