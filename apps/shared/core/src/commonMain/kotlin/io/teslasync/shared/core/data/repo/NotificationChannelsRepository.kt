package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notificationchannels.WebhookSignaturePreviewResult
import io.teslasync.shared.core.presentation.notificationchannels.WebhookTestResult
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The S7 data port for the NotificationChannels webhook surface — the cross-platform analogue of
 * the web `useNotificationChannels` hook domain (web/src/api/hooks/useNotificationChannels.ts,
 * which re-exports the channel list read from web/src/api/hooks/useNotifications.ts). Every native
 * NotificationChannels surface (Android/Apple via KMP, Windows via the C# port) reaches the
 * backend exclusively through this interface, so a single fake stands in for the whole domain in
 * the S8 state-holder tests.
 *
 * The single read streams a cache-then-network [Resource] (ADR-013): the cached channel list
 * first for an instant cold start, then the refreshed list, cached under [channelsKey] (mirroring
 * the web TanStack `notificationKeys.channels` query key). The webhook-kind derivation
 * ([filterWebhookChannels], the web `useWebhookChannels` `kind === 'webhook'` filter) and the
 * invalidate-on-mutation behaviour are S8 concerns, NOT this port's.
 *
 * The two mutations are non-throwing suspend [Result]s; they call the API directly and DO NOT
 * touch the durable cache and DO NOT invalidate anything (the web `useTestWebhookChannel` and
 * `useWebhookSignaturePreview` mutations invalidate no query keys — the page renders their
 * structured result inline). The webhook-test endpoint answers HTTP 200 even on receiver failure,
 * so a non-2xx receiver is a successful [Result] carrying a `success == false` [WebhookTestResult],
 * never a request failure. Values are SI on the wire (no unit-bearing fields here); display
 * formatting is the render boundary's job (S5).
 */
public interface NotificationChannelsRepository {
    /**
     * `GET /notifications` — the full notification-channel list (web `useNotificationChannels`,
     * `safeArray`-guarded). The webhook section derives its rows from this list via
     * [filterWebhookChannels]; the list is the single feed the invalidate action refreshes.
     */
    public fun channels(): Flow<Resource<List<NotificationChannel>>>

    /**
     * `POST /notifications/{id}/webhook-test` — fires a structured test event through the
     * HMAC-aware delivery path (web `useTestWebhookChannel`). [title]/[message] are sent only when
     * present AND non-blank (see [webhookTestBody]); an all-blank pair sends NO body so the server
     * picks its defaults. Returns the structured result even for a non-2xx receiver (the endpoint
     * is HTTP 200 in every delivery outcome).
     */
    public suspend fun testWebhookChannel(
        id: Long,
        title: String? = null,
        message: String? = null,
    ): Result<WebhookTestResult>

    /**
     * `POST /notifications/webhooks/preview-signature` — computes the `X-TeslaSync-Signature`
     * for a `(secret, body)` pair (web `useWebhookSignaturePreview`). A pure utility: no DB touch,
     * no cache interaction. An empty secret is rejected 400 server-side.
     */
    public suspend fun previewWebhookSignature(
        secret: String,
        body: String,
    ): Result<WebhookSignaturePreviewResult>
}

/**
 * Cache/feed key for the notification-channel list — the web `notificationKeys.channels`
 * (`['notification-channels']`). Locked by golden vectors shared with the C# port.
 */
public fun channelsKey(): String = "channels"

/**
 * The webhook-kind filter ported from the web `useWebhookChannels`
 * (`list.filter(ch => ch.kind === 'webhook')`): keeps only [NotificationChannel.Webhook] rows,
 * preserving source order. A pure function of its input — locked by golden vectors so the C# and
 * KMP ports cannot drift (ADR-004).
 */
public fun filterWebhookChannels(channels: List<NotificationChannel>): List<NotificationChannel.Webhook> =
    channels.filterIsInstance<NotificationChannel.Webhook>()

/**
 * Builds the `POST /notifications/{id}/webhook-test` body — the exact port of the web
 * `useTestWebhookChannel` mutationFn: a key is included ONLY when its value is non-null AND its
 * trimmed form is non-empty, and the VERBATIM (untrimmed) value is written (web assigns the raw
 * `title`/`message`, guarding only on `trim() !== ''`). An empty object means "send no body" so
 * the server applies its defaults. A pure function of its inputs — locked by golden vectors so
 * the C# and KMP ports cannot drift (ADR-004).
 */
public fun webhookTestBody(
    title: String?,
    message: String?,
): JsonObject {
    val fields = linkedMapOf<String, JsonPrimitive>()
    if (title != null && title.trim().isNotEmpty()) fields["title"] = JsonPrimitive(title)
    if (message != null && message.trim().isNotEmpty()) fields["message"] = JsonPrimitive(message)
    return JsonObject(fields)
}
