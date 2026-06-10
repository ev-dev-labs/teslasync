package io.teslasync.shared.core.presentation.notificationchannels

import io.teslasync.shared.core.data.repo.NotificationChannelsRepository
import io.teslasync.shared.core.data.repo.channelsKey
import io.teslasync.shared.core.data.repo.filterWebhookChannels
import io.teslasync.shared.core.data.repo.webhookTestBody
import io.teslasync.shared.core.net.defaultApiJson
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Language-neutral golden vectors locking the non-trivial, client-side derivations ported from the
 * web `useNotificationChannels` domain (web/src/api/hooks/useNotificationChannels.ts) so the
 * Windows C# port and the KMP core cannot drift (ADR-004):
 *
 *  1. [webhookTestBody] — the web `useTestWebhookChannel` body builder (a key is attached ONLY
 *     when its value is non-null AND `trim() !== ''`, and the VERBATIM/untrimmed value is sent;
 *     an all-blank pair sends no body at all).
 *  2. [filterWebhookChannels] — the web `useWebhookChannels` `kind === 'webhook'` filter (order
 *     preserved; only webhook-kind rows survive).
 *  3. The cache/feed key builder — the web TanStack `notificationKeys.channels`.
 *  4. The [WebhookSignaturePreviewRequest] body — both fields always serialize (even an empty body
 *     string), matching the web `JSON.stringify({ secret, body })`.
 *
 * The same vectors are mirrored verbatim in apps/shared/core/spec/notification-channels-golden.json
 * — the shared source of truth the C# port consumes. Fixtures are inlined here to stay within this
 * slice's allowed file scope.
 */
class NotificationChannelsGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- webhook-test body builder ------------------------------------------------

    @Serializable
    private data class TestBodyRow(
        val name: String,
        val title: String? = null,
        val message: String? = null,
        val expected: Map<String, String>,
    )

    @Test
    fun webhookTestBodyMatchesGolden() {
        val rows: List<TestBodyRow> = json.decodeFromString(TEST_BODY_GOLDEN)
        assertTrue(
            rows.map { it.name }.containsAll(
                listOf("empty", "blankTitle", "titleOnly", "messageOnly", "both", "untrimmed"),
            ),
        )
        for (row in rows) {
            val built: JsonObject = webhookTestBody(row.title, row.message)
            val expected = json.parseToJsonElement(json.encodeToString(row.expected)) as JsonObject
            assertEquals(expected, built, "webhookTestBody('${row.name}')")
        }
    }

    @Test
    fun emptyBodyMeansNoPayload() {
        // The repository sends NO body when the built object is empty (web: attaches no body/header
        // unless at least one field is present).
        assertTrue(webhookTestBody(null, null).isEmpty())
        assertTrue(webhookTestBody("   ", "\t").isEmpty())
    }

    // ---- webhook-kind filter ------------------------------------------------------

    @Test
    fun filterKeepsOnlyWebhookKindInOrder() {
        val channels =
            defaultApiJson.decodeFromString(
                ListSerializer(NotificationChannel.serializer()),
                CHANNELS_GOLDEN,
            )
        val webhooks = filterWebhookChannels(channels)
        assertEquals(listOf(2L, 5L), webhooks.map { it.id }, "only webhook-kind ids, in order")
        assertEquals(listOf("primary", "backup"), webhooks.map { it.name })
        // The decoded webhook rows carry their kind-specific fields.
        assertEquals("https://primary.example", webhooks.first().url)
    }

    // ---- cache/feed key + preview body --------------------------------------------

    @Test
    fun cacheKeyMatchesGolden() {
        assertEquals("channels", channelsKey())
    }

    @Test
    fun previewRequestAlwaysSerializesBothFields() {
        val body =
            defaultApiJson.encodeToString(
                WebhookSignaturePreviewRequest.serializer(),
                WebhookSignaturePreviewRequest(secret = "s3cret", body = ""),
            )
        val root = json.parseToJsonElement(body) as JsonObject
        assertTrue(root.containsKey("secret"), "secret always present")
        assertTrue(root.containsKey("body"), "body always present even when empty")
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertEquals("NotificationChannelsRepository", NotificationChannelsRepository::class.simpleName)
    }

    private companion object {
        val TEST_BODY_GOLDEN =
            """
            [
              { "name": "empty",       "expected": {} },
              { "name": "blankTitle",  "title": "   ", "expected": {} },
              { "name": "titleOnly",   "title": "Hi",  "expected": { "title": "Hi" } },
              { "name": "messageOnly", "message": "Yo", "expected": { "message": "Yo" } },
              { "name": "both",        "title": "T", "message": "M", "expected": { "title": "T", "message": "M" } },
              { "name": "untrimmed",   "title": "  Hi  ", "expected": { "title": "  Hi  " } }
            ]
            """.trimIndent()

        val CHANNELS_GOLDEN =
            """
            [
              { "kind": "discord", "id": 1, "name": "ops", "webhook_url": "https://d" },
              { "kind": "webhook", "id": 2, "name": "primary", "url": "https://primary.example", "method": "POST" },
              { "kind": "slack",   "id": 3, "name": "team", "webhook_url": "https://s" },
              { "kind": "email",   "id": 4, "name": "alerts", "smtp_host": "mail", "smtp_port": 587 },
              { "kind": "webhook", "id": 5, "name": "backup", "url": "https://backup.example", "method": "PUT" },
              { "kind": "ntfy",    "id": 6, "name": "phone", "server_url": "https://ntfy.sh", "topic": "t" }
            ]
            """.trimIndent()
    }
}
