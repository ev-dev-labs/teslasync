package io.teslasync.android.featureviews.webhookchannelssection

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notifications.NotificationChannelInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device coverage of the pure WebhookChannelsSection projection — the parity-critical derivations the web
 * component performs before render (web/src/features/settings/components/WebhookChannelsSection.tsx): the HTTP
 * method catalogue + normalization (`HTTP_METHODS` / `fromChannel`), the save-method narrowing
 * (`SAVE_METHOD_FALLBACK`), the channel -> form-state flattening (`fromChannel`), the URL guard (`isHttpsLike`),
 * the submit validation (`handleSubmit`), the form-state -> wire payload (`toSavePayload`), the name sort
 * (`sortedWebhooks`), the method-badge label, and the sample body. Also pins the PII-safe `view.opened`
 * diagnostic. Run by the `:android:testReleaseUnitTest` gate.
 */
class WebhookChannelsSectionProjectionTest {
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

    private fun webhook(
        id: Long,
        name: String = "Hook",
        enabled: Boolean = true,
        url: String = "https://example.com/webhook",
        method: String = "POST",
    ): NotificationChannel.Webhook = NotificationChannel.Webhook(id = id, name = name, enabled = enabled, url = url, method = method)

    @Test
    fun httpMethodFromMapsKnownAndFallsBackToPost() {
        assertEquals(WebhookHttpMethod.Post, WebhookHttpMethod.from("post"))
        assertEquals(WebhookHttpMethod.Put, WebhookHttpMethod.from(" PUT "))
        assertEquals(WebhookHttpMethod.Patch, WebhookHttpMethod.from("patch"))
        assertEquals(WebhookHttpMethod.Post, WebhookHttpMethod.from("delete"))
        assertEquals(WebhookHttpMethod.Post, WebhookHttpMethod.from(""))
    }

    @Test
    fun httpMethodCatalogueMatchesWebOrder() {
        assertEquals(listOf(WebhookHttpMethod.Post, WebhookHttpMethod.Put, WebhookHttpMethod.Patch), WEBHOOK_HTTP_METHODS)
    }

    @Test
    fun saveMethodNarrowsPatchToPostAndKeepsPut() {
        assertEquals("POST", webhookSaveMethod(WebhookHttpMethod.Post))
        assertEquals("PUT", webhookSaveMethod(WebhookHttpMethod.Put))
        assertEquals("POST", webhookSaveMethod(WebhookHttpMethod.Patch))
    }

    @Test
    fun formFromChannelNormalizesMethodAndBlanksSecret() {
        val form = webhookFormFrom(webhook(id = 7, name = "Discord", url = "https://d/x", method = "put"))
        assertEquals(7L, form.id)
        assertEquals("Discord", form.name)
        assertEquals("https://d/x", form.url)
        assertEquals(WebhookHttpMethod.Put, form.method)
        assertEquals("", form.secret)
        assertTrue(form.enabled)
    }

    @Test
    fun isHttpLikeUrlAcceptsHttpAndHttpsRejectsOther() {
        assertTrue(isHttpLikeUrl("http://x"))
        assertTrue(isHttpLikeUrl("HTTPS://x"))
        assertTrue(isHttpLikeUrl("  https://x  "))
        assertFalse(isHttpLikeUrl(""))
        assertFalse(isHttpLikeUrl("ftp://x"))
        assertFalse(isHttpLikeUrl("example.com"))
    }

    @Test
    fun validateFlagsBlankNameFirstThenInvalidUrl() {
        assertEquals(WebhookFormError.NameRequired, validateWebhookForm("   ", "not-a-url"))
        assertEquals(WebhookFormError.UrlInvalid, validateWebhookForm("Name", "not-a-url"))
        assertNull(validateWebhookForm("Name", "https://ok"))
    }

    @Test
    fun toSavePayloadTrimsNarrowsAndSendsEmptyHeaderAndBody() {
        val form =
            WebhookFormState(
                id = 42,
                name = "  Hook  ",
                url = "  https://x/webhook  ",
                method = WebhookHttpMethod.Patch,
                secret = "s3cret",
                enabled = false,
            )
        val payload = toWebhookSavePayload(form)
        assertEquals(42L, payload.id)
        assertEquals("Hook", payload.name)
        assertEquals("https://x/webhook", payload.url)
        assertEquals("POST", payload.method)
        assertFalse(payload.enabled)
        assertTrue(payload.headers.isEmpty())
        assertEquals("", payload.bodyTemplate)
    }

    @Test
    fun toSavePayloadIsIdFreeOnCreate() {
        val payload = toWebhookSavePayload(WebhookFormState(name = "New", url = "https://x", method = WebhookHttpMethod.Put))
        assertNull(payload.id)
        assertEquals("PUT", payload.method)
    }

    @Test
    fun toSavePayloadProducesWebhookInputVariant() {
        val payload: NotificationChannelInput = toWebhookSavePayload(WebhookFormState(name = "N", url = "https://x"))
        assertTrue(payload is NotificationChannelInput.Webhook)
    }

    @Test
    fun sortWebhookChannelsSortsByNameCaseInsensitively() {
        val sorted = sortWebhookChannels(listOf(webhook(1, "zeta"), webhook(2, "Alpha"), webhook(3, "beta")))
        assertEquals(listOf("Alpha", "beta", "zeta"), sorted.map { it.name })
    }

    @Test
    fun methodLabelUppercasesAndDefaultsBlankToPost() {
        assertEquals("POST", webhookMethodLabel("post"))
        assertEquals("PUT", webhookMethodLabel(" put "))
        assertEquals("POST", webhookMethodLabel(""))
    }

    @Test
    fun payloadVariablesMatchWebDocsBox() {
        assertEquals(listOf("title", "message", "source", "timestamp"), WEBHOOK_PAYLOAD_VARIABLES)
    }

    @Test
    fun sampleBodyMatchesWebStringifyOutput() {
        assertEquals(
            "{\"title\":\"Test event\",\"message\":\"Hello from TeslaSync\",\"source\":\"teslasync\",\"test\":true}",
            WEBHOOK_SAMPLE_BODY,
        )
    }

    @Test
    fun recordViewOpenedEmitsSlugOnce() {
        val logger = RecordingLogger()
        recordWebhookChannelsViewOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "WebhookChannelsSection"), opened.single().second)
        assertEquals("WebhookChannelsSection", WebhookChannelsSectionRegistration.SLUG)
    }
}
