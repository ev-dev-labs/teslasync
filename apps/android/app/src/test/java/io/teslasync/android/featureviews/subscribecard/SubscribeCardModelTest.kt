package io.teslasync.android.featureviews.subscribecard

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the SubscribeCard's pure logic — the native analogue of everything the web component
 * declares before returning JSX (web/src/features/system/components/status/SubscribeCard.tsx): the ordered set of
 * channel tiles, the navigation target each tile links to (the web `to` prop), the verbatim copy the shared
 * catalog has no key for, and the `view.opened` telemetry. Runs in the :android:testReleaseUnitTest gate.
 */
class SubscribeCardModelTest {
    // ── Tile composition (web <ChannelTile> order) ────────────────────────────

    @Test
    fun channelsReturnFiveTilesInWebSourceOrder() {
        val kinds = SubscribeCardProjection.channels().map { it.kind }
        assertEquals(
            listOf(
                SubscribeChannelKind.Email,
                SubscribeChannelKind.Slack,
                SubscribeChannelKind.Discord,
                SubscribeChannelKind.Webhook,
                SubscribeChannelKind.BrowserPush,
            ),
            kinds,
        )
    }

    @Test
    fun channelsMapEachTileToItsWebLinkTarget() {
        val byKind = SubscribeCardProjection.channels().associate { it.kind to it.destination }

        // Email / Slack / Discord / Webhook all link to the notification-channels setup surface (web
        // to="/notifications/channels").
        assertEquals(SubscribeDestination.NotificationChannels, byKind[SubscribeChannelKind.Email])
        assertEquals(SubscribeDestination.NotificationChannels, byKind[SubscribeChannelKind.Slack])
        assertEquals(SubscribeDestination.NotificationChannels, byKind[SubscribeChannelKind.Discord])
        assertEquals(SubscribeDestination.NotificationChannels, byKind[SubscribeChannelKind.Webhook])

        // Browser push links to the Settings opt-in (web to="/settings/notifications").
        assertEquals(SubscribeDestination.BrowserPushSettings, byKind[SubscribeChannelKind.BrowserPush])
    }

    @Test
    fun destinationRoutesMatchTheWebLinkPaths() {
        assertEquals("/notifications/channels", SubscribeDestination.NotificationChannels.route)
        assertEquals("/settings/notifications", SubscribeDestination.BrowserPushSettings.route)
    }

    @Test
    fun everyProjectedChannelKindHasAStableDistinctTile() {
        val channels = SubscribeCardProjection.channels()
        assertEquals(SubscribeChannelKind.entries.size, channels.size)
        assertEquals(channels.map { it.kind }.toSet().size, channels.size)
    }

    // ── Verbatim copy (regions with no shared-catalog key) ────────────────────

    @Test
    fun verbatimCopyMatchesTheWebSource() {
        assertEquals("Slack", SubscribeCardCopy.SLACK_LABEL)
        assertEquals("Discord", SubscribeCardCopy.DISCORD_LABEL)
        assertEquals("Webhook", SubscribeCardCopy.WEBHOOK_LABEL)
        assertEquals("SMTP-based delivery", SubscribeCardCopy.EMAIL_DESCRIPTION)
        assertEquals("Webhook channel", SubscribeCardCopy.WEBHOOK_CHANNEL_DESCRIPTION)
        assertEquals("Custom HTTP endpoint", SubscribeCardCopy.CUSTOM_HTTP_DESCRIPTION)
        assertEquals("Opt-in PWA notifications", SubscribeCardCopy.BROWSER_PUSH_DESCRIPTION)
    }

    // ── Registration + telemetry (P1/S11) ─────────────────────────────────────

    @Test
    fun registrationExposesStableIdentifiers() {
        assertEquals("subscribe-card", SubscribeCardRegistration.ID)
        assertEquals("SubscribeCard", SubscribeCardRegistration.SLUG)
    }

    @Test
    fun recordOpenedEmitsViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordSubscribeCardOpened(logger)

        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "SubscribeCard"), record.fields)
    }

    @Test
    fun recordOpenedNeverCarriesPii() {
        val logger = RecordingLogger()

        recordSubscribeCardOpened(logger)

        // The only field is the static surface slug — no vehicle id, token, or location can leak.
        val fields = logger.records.single().fields
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.all { it == "SubscribeCard" })
    }

    /** A [Logger] that captures every emitted record for assertion — the off-device telemetry double. */
    private class RecordingLogger : Logger {
        data class Record(
            val level: LogLevel,
            val event: String,
            val fields: Map<String, String>,
        )

        val records: MutableList<Record> = mutableListOf()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
