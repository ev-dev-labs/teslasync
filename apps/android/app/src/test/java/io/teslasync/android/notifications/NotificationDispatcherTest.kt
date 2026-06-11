package io.teslasync.android.notifications

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.push.PushDiagnostics
import io.teslasync.android.push.PushPayload
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for [NotificationDispatcher] — the foreground/background fan-out exercised end to end
 * over fakes (banner sink, OS presenter, settings store) and injected foreground/permission/clock
 * predicates (P3/A6, ADR-009).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationDispatcherTest {
    private class Harness(
        val dispatcher: NotificationDispatcher,
        val bannerSink: DefaultForegroundBannerSink,
        val presenter: FakeSystemNotificationPresenter,
    )

    private fun harness(
        settings: NotificationSettings = NotificationSettings.Default,
        isForeground: Boolean,
        permissionGranted: Boolean = true,
        nowMinuteOfDay: Int = 100,
    ): Harness {
        val bannerSink = DefaultForegroundBannerSink()
        val presenter = FakeSystemNotificationPresenter()
        val dispatcher =
            NotificationDispatcher(
                settingsStore = InMemoryNotificationSettingsStore(settings),
                bannerSink = bannerSink,
                systemPresenter = presenter,
                diagnostics = PushDiagnostics(NoopLogger),
                environment =
                    NotificationEnvironment(
                        isForeground = { isForeground },
                        isPermissionGranted = { permissionGranted },
                        nowMinuteOfDay = { nowMinuteOfDay },
                    ),
            )
        return Harness(dispatcher, bannerSink, presenter)
    }

    private fun payload(
        kind: String = "alert",
        title: String? = "Low battery",
        body: String? = "Down to 12%",
        category: String? = null,
    ): PushPayload = PushPayload(kind, title, body, category, emptyMap())

    @Test
    fun foregroundPublishesABannerAndNoOsNotification() =
        runTest {
            val harness = harness(isForeground = true)
            harness.dispatcher.dispatch(payload())

            val banner = harness.bannerSink.banner.value
            assertNotNull(banner)
            assertEquals("Low battery", banner?.title)
            assertEquals("teslasync://app/notifications/alerts", banner?.deepLinkUri)
            assertTrue(harness.presenter.shown.isEmpty())
        }

    @Test
    fun backgroundPostsAnOsNotificationAndNoBanner() =
        runTest {
            val harness = harness(isForeground = false)
            harness.dispatcher.dispatch(payload())

            assertEquals(1, harness.presenter.shown.size)
            assertEquals(
                NotificationChannels.CRITICAL_ALERTS,
                harness.presenter.shown
                    .first()
                    .channelId,
            )
            assertNull(harness.bannerSink.banner.value)
        }

    @Test
    fun aPayloadWithNoDisplayTextIsRecordedOnly() =
        runTest {
            val harness = harness(isForeground = false)
            harness.dispatcher.dispatch(payload(kind = "vehicle_state", title = null, body = null))

            assertTrue(harness.presenter.shown.isEmpty())
            assertNull(harness.bannerSink.banner.value)
        }

    @Test
    fun backgroundWithoutPermissionShowsNothing() =
        runTest {
            val harness = harness(isForeground = false, permissionGranted = false)
            harness.dispatcher.dispatch(payload())

            assertTrue(harness.presenter.shown.isEmpty())
            assertNull(harness.bannerSink.banner.value)
        }

    @Test
    fun quietHoursSuppressABackgroundNonCriticalNotification() =
        runTest {
            val settings =
                NotificationSettings(quietHours = QuietHours(enabled = true, startMinuteOfDay = 600, endMinuteOfDay = 700))
            val harness = harness(settings = settings, isForeground = false, nowMinuteOfDay = 650)
            harness.dispatcher.dispatch(payload(kind = "generic", category = "info"))

            assertTrue(harness.presenter.shown.isEmpty())
        }

    @Test
    fun aCriticalNotificationBreaksThroughQuietHours() =
        runTest {
            val settings =
                NotificationSettings(quietHours = QuietHours(enabled = true, startMinuteOfDay = 600, endMinuteOfDay = 700))
            val harness = harness(settings = settings, isForeground = false, nowMinuteOfDay = 650)
            harness.dispatcher.dispatch(payload(kind = "alert", category = "critical"))

            assertEquals(1, harness.presenter.shown.size)
        }
}
