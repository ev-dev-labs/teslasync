package io.teslasync.android.notifications

import io.teslasync.android.push.PushDiagnostics
import io.teslasync.android.push.PushPayload

/**
 * The ambient probes the dispatcher reads live when deciding delivery (P3/A6): whether the app is
 * foreground, whether the OS notification permission is granted, and the local time-of-day. Grouped so
 * the dispatcher's collaborators stay cohesive and injectable for unit testing.
 */
class NotificationEnvironment(
    val isForeground: () -> Boolean,
    val isPermissionGranted: () -> Boolean,
    val nowMinuteOfDay: () -> Int,
)

/**
 * Routes a decoded foreground/background push into the app (P3/A6, ADR-009) — the single fan-out point
 * the FCM service calls for every message. For each payload it:
 *
 * 1. composes the localized [NotificationContent] (honoring the user's redaction setting);
 * 2. records-only when there is no display text (an empty toast/banner is never shown);
 * 3. decides delivery via [NotificationDeliveryPolicy] (foreground → in-app banner; background → OS
 *    notification, gated by the runtime permission, the user's per-kind toggle and quiet hours);
 * 4. publishes the banner and/or posts the OS notification accordingly.
 *
 * It is headless and unit-tested with fakes: the settings store, banner sink, OS presenter and the
 * ambient [NotificationEnvironment] probes are all injected.
 */
class NotificationDispatcher(
    private val settingsStore: NotificationSettingsStore,
    private val bannerSink: ForegroundBannerSink,
    private val systemPresenter: SystemNotificationPresenter,
    private val diagnostics: PushDiagnostics,
    private val environment: NotificationEnvironment,
) {
    /** Composes, decides and fans out [payload] to the banner and/or OS notification surfaces. */
    suspend fun dispatch(payload: PushPayload) {
        val settings = settingsStore.load()
        val content = NotificationComposer.compose(payload, settings)
        if (!content.hasDisplayText) {
            diagnostics.recordPayloadRouted()
            return
        }

        val delivery =
            NotificationDeliveryPolicy.decide(
                NotificationDeliveryContext(
                    kind = content.kind,
                    severity = content.severity,
                    settings = settings,
                    isForeground = environment.isForeground(),
                    permissionGranted = environment.isPermissionGranted(),
                    nowMinuteOfDay = environment.nowMinuteOfDay(),
                ),
            )

        if (delivery.showBanner) {
            bannerSink.publish(PushBanner(content.severity, content.title, content.body, content.deepLinkUri))
        }
        if (delivery.showSystemNotification) {
            systemPresenter.show(content)
        }
        diagnostics.recordPayloadRouted()
    }
}
