package io.teslasync.android.featureviews.notificationchannelsview

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notifications.NotificationChannelInput
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device coverage of the pure NotificationChannelsView projection — the parity-critical derivations the web
 * component performs before render (web/src/features/notifications/components/NotificationChannelsView.tsx):
 * channel → form-config flattening (`channelToFormConfig`), form-config → wire payload (`buildChannelPayload`,
 * incl. SMTP-port fallback / webhook method normalization / header JSON / ntfy default), the masked three-row
 * card preview, the four stat tiles, and the kind catalogue + fallback. Also pins the PII-safe `view.opened`
 * diagnostic. Run by the `:android:testReleaseUnitTest` gate.
 */
class NotificationChannelsViewProjectionTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    @Test
    fun channelKindFromMapsKnownAndFallsBackToWebhook() {
        assertEquals(ChannelKind.Discord, ChannelKind.from("discord"))
        assertEquals(ChannelKind.Pushover, ChannelKind.from("pushover"))
        assertEquals(ChannelKind.Webhook, ChannelKind.from("totally-unknown"))
    }

    @Test
    fun channelMetaForRawFallsBackToWebhookLikeWeb() {
        // web getChannelMeta: CHANNEL_TYPES.find(...) ?? CHANNEL_TYPES[4] (webhook).
        assertEquals(ChannelKind.Webhook, channelMetaFor("nope").kind)
        assertEquals(ChannelKind.Discord, channelMetaFor("discord").kind)
        assertEquals(7, CHANNEL_TYPES.size)
        assertEquals(ChannelKind.Webhook, CHANNEL_TYPES[4].kind)
    }

    @Test
    fun channelKindExtensionMatchesVariant() {
        assertEquals(ChannelKind.Discord, discordChannel().channelKind)
        assertEquals(ChannelKind.Email, emailChannel().channelKind)
        assertEquals(ChannelKind.Webhook, webhookChannel().channelKind)
    }

    @Test
    fun channelToFormConfigFlattensEmailWithStringPortAndJoinedRecipients() {
        val config = channelToFormConfig(emailChannel())
        assertEquals("smtp.example.com", config[ChannelFieldKeys.SMTP_HOST])
        assertEquals("587", config[ChannelFieldKeys.SMTP_PORT])
        assertEquals("a@example.com, b@example.com", config[ChannelFieldKeys.TO_ADDRESSES])
    }

    @Test
    fun channelToFormConfigEncodesWebhookHeadersAsJson() {
        val config = channelToFormConfig(webhookChannel())
        assertEquals("POST", config[ChannelFieldKeys.METHOD])
        assertEquals(mapOf("Authorization" to "Bearer abc"), parseHeaders(config.getValue(ChannelFieldKeys.HEADERS)))
    }

    @Test
    fun buildChannelPayloadDiscordIsIdFreeOnCreate() {
        val input = buildChannelPayload(ChannelKind.Discord, "Ops", true, mapOf(ChannelFieldKeys.WEBHOOK_URL to "https://x"))
        val discord = input as NotificationChannelInput.Discord
        assertNull(discord.id)
        assertEquals("Ops", discord.name)
        assertTrue(discord.enabled)
        assertEquals("https://x", discord.webhookUrl)
    }

    @Test
    fun buildChannelPayloadCarriesIdOnUpdate() {
        val input = buildChannelPayload(ChannelKind.Slack, "S", false, emptyMap(), id = 42L)
        assertEquals(42L, (input as NotificationChannelInput.Slack).id)
    }

    @Test
    fun buildChannelPayloadEmailDefaultsPortWhenBlankAndSplitsRecipients() {
        val input =
            buildChannelPayload(
                ChannelKind.Email,
                "Mail",
                true,
                mapOf(
                    ChannelFieldKeys.SMTP_PORT to "",
                    ChannelFieldKeys.TO_ADDRESSES to "a@x.com, b@x.com , ",
                ),
            ) as NotificationChannelInput.Email
        assertEquals(DEFAULT_SMTP_PORT, input.smtpPort)
        assertEquals(listOf("a@x.com", "b@x.com"), input.toAddresses)
        assertTrue(input.useTls)
    }

    @Test
    fun buildChannelPayloadEmailParsesNumericPort() {
        val input =
            buildChannelPayload(ChannelKind.Email, "Mail", true, mapOf(ChannelFieldKeys.SMTP_PORT to "2525"))
                as NotificationChannelInput.Email
        assertEquals(2525, input.smtpPort)
    }

    @Test
    fun buildChannelPayloadWebhookNormalizesMethodAndParsesHeaders() {
        val input =
            buildChannelPayload(
                ChannelKind.Webhook,
                "Hook",
                true,
                mapOf(
                    ChannelFieldKeys.METHOD to "patch",
                    ChannelFieldKeys.HEADERS to "{\"X-Key\":\"v\"}",
                ),
            ) as NotificationChannelInput.Webhook
        assertEquals("POST", input.method)
        assertEquals(mapOf("X-Key" to "v"), input.headers)
    }

    @Test
    fun buildChannelPayloadNtfyDefaultsServerWhenBlank() {
        val input =
            buildChannelPayload(ChannelKind.Ntfy, "N", true, mapOf(ChannelFieldKeys.SERVER_URL to "")) as NotificationChannelInput.Ntfy
        assertEquals(DEFAULT_NTFY_SERVER, input.serverUrl)
    }

    @Test
    fun safeWebhookMethodKeepsGetPutElsePost() {
        assertEquals("GET", safeWebhookMethod("get"))
        assertEquals("PUT", safeWebhookMethod(" put "))
        assertEquals("POST", safeWebhookMethod("delete"))
        assertEquals("POST", safeWebhookMethod(""))
    }

    @Test
    fun parseHeadersFallsBackToEmptyOnBlankOrInvalid() {
        assertTrue(parseHeaders("").isEmpty())
        assertTrue(parseHeaders("not-json").isEmpty())
        assertEquals(mapOf("a" to "b"), parseHeaders("{\"a\":\"b\"}"))
    }

    @Test
    fun isSecretKeyMatchesTokensKeysPasswords() {
        assertTrue(isSecretKey(ChannelFieldKeys.BOT_TOKEN))
        assertTrue(isSecretKey(ChannelFieldKeys.USER_KEY))
        assertTrue(isSecretKey(ChannelFieldKeys.SMTP_PASSWORD))
        assertTrue(!isSecretKey(ChannelFieldKeys.WEBHOOK_URL))
    }

    @Test
    fun configPreviewMasksSecretsAndKeepsFirstThree() {
        val preview = configPreviewEntries(emailChannel())
        assertEquals(3, preview.size)
        val asMap = preview.toMap()
        assertEquals("smtp.example.com", asMap[ChannelFieldKeys.SMTP_HOST])
        // smtp_password is within the first three for the email kind ordering and must be masked.
        assertTrue(configPreviewEntries(telegramChannel()).any { it.first == ChannelFieldKeys.BOT_TOKEN && it.second == SECRET_MASK })
    }

    @Test
    fun statTilesProjectCountsAndActiveRatio() {
        val tiles = statTiles(stats(), Locale.US)
        assertEquals(StatKind.Sent, tiles[0].kind)
        assertEquals("1,240", tiles[0].value)
        assertEquals("12", tiles[1].value)
        assertEquals("3", tiles[2].value)
        assertEquals(StatKind.ActiveChannels, tiles[3].kind)
        assertEquals("3/4", tiles[3].value)
    }

    @Test
    fun recordViewOpenedEmitsSlugOnce() {
        val logger = RecordingLogger()
        recordNotificationChannelsViewOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "NotificationChannelsView"), opened.single().second)
    }

    private fun discordChannel() = NotificationChannel.Discord(id = 1, name = "Ops", enabled = true, webhookUrl = "https://discord/x")

    private fun telegramChannel() = NotificationChannel.Telegram(id = 2, name = "TG", enabled = true, botToken = "123:ABC", chatId = "-100")

    private fun emailChannel() =
        NotificationChannel.Email(
            id = 3,
            name = "Mail",
            enabled = true,
            smtpHost = "smtp.example.com",
            smtpPort = 587,
            smtpUsername = "u@example.com",
            smtpPassword = "secret",
            fromAddress = "from@example.com",
            toAddresses = listOf("a@example.com", "b@example.com"),
            useTls = true,
        )

    private fun webhookChannel() =
        NotificationChannel.Webhook(
            id = 4,
            name = "Hook",
            enabled = true,
            url = "https://x/webhook",
            method = "POST",
            headers = mapOf("Authorization" to "Bearer abc"),
            bodyTemplate = "{}",
        )

    private fun stats() = NotificationStats(totalSent = 1300, sent = 1240, failed = 12, pending = 3, totalChannels = 4, enabledChannels = 3)
}
