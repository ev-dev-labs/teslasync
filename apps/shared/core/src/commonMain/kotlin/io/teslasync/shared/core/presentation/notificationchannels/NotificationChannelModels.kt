package io.teslasync.shared.core.presentation.notificationchannels

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

/*
 * The cross-platform port of the web NotificationChannels domain types
 * (web/src/types/notifications.ts + the webhook test/preview DTOs in web/src/api/types.ts).
 * Every native NotificationChannels screen (Android/Apple via KMP, Windows via the C# port)
 * binds to these shapes through the S7 io.teslasync.shared.core.data.repo
 * .NotificationChannelsRepository and the S8 NotificationChannelsStore.
 *
 * Keys arrive snake_case from `GET /api/v1/notifications`; they are matched verbatim via
 * SerialName so the cached payload round-trips unchanged. No field is unit-bearing, so there
 * is no SI conversion at this layer — display formatting is the render boundary's job (S5).
 *
 * The channel list is a discriminated union on the wire `kind` field — exactly the web
 * `NotificationChannel` union. The discriminator is consumed by kotlinx via
 * [JsonClassDiscriminator]("kind") + each variant's [SerialName], so the union itself does NOT
 * declare a `kind` property (that would collide with the class discriminator). The web's
 * `ch.kind === 'webhook'` filter therefore becomes an `is NotificationChannel.Webhook` check.
 */

/**
 * One notification channel row — the port of the web `NotificationChannel` discriminated union
 * (web/src/types/notifications.ts). The common identity fields mirror the web
 * `NotificationChannelBase`; each variant adds the kind-specific configuration fields. Every
 * optional server field defaults so a partial payload still decodes (web `ignoreUnknownKeys`).
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("kind")
public sealed interface NotificationChannel {
    public val id: Long
    public val name: String
    public val enabled: Boolean
    public val createdAt: String
    public val updatedAt: String

    /** `discord`: posts to a Discord incoming webhook. */
    @Serializable
    @SerialName("discord")
    public data class Discord(
        override val id: Long,
        override val name: String = "",
        override val enabled: Boolean = false,
        @SerialName("created_at") override val createdAt: String = "",
        @SerialName("updated_at") override val updatedAt: String = "",
        @SerialName("webhook_url") val webhookUrl: String = "",
        val username: String? = null,
        @SerialName("avatar_url") val avatarUrl: String? = null,
    ) : NotificationChannel

    /** `slack`: posts to a Slack incoming webhook. */
    @Serializable
    @SerialName("slack")
    public data class Slack(
        override val id: Long,
        override val name: String = "",
        override val enabled: Boolean = false,
        @SerialName("created_at") override val createdAt: String = "",
        @SerialName("updated_at") override val updatedAt: String = "",
        @SerialName("webhook_url") val webhookUrl: String = "",
        val channel: String? = null,
        val username: String? = null,
    ) : NotificationChannel

    /** `telegram`: sends via a Telegram bot to a chat. */
    @Serializable
    @SerialName("telegram")
    public data class Telegram(
        override val id: Long,
        override val name: String = "",
        override val enabled: Boolean = false,
        @SerialName("created_at") override val createdAt: String = "",
        @SerialName("updated_at") override val updatedAt: String = "",
        @SerialName("bot_token") val botToken: String = "",
        @SerialName("chat_id") val chatId: String = "",
    ) : NotificationChannel

    /** `email`: delivers over SMTP. */
    @Serializable
    @SerialName("email")
    public data class Email(
        override val id: Long,
        override val name: String = "",
        override val enabled: Boolean = false,
        @SerialName("created_at") override val createdAt: String = "",
        @SerialName("updated_at") override val updatedAt: String = "",
        @SerialName("smtp_host") val smtpHost: String = "",
        @SerialName("smtp_port") val smtpPort: Int = 0,
        @SerialName("smtp_username") val smtpUsername: String = "",
        @SerialName("smtp_password") val smtpPassword: String = "",
        @SerialName("from_address") val fromAddress: String = "",
        @SerialName("to_addresses") val toAddresses: List<String> = emptyList(),
        @SerialName("use_tls") val useTls: Boolean = false,
    ) : NotificationChannel

    /** `webhook`: the HMAC-aware generic HTTP channel the webhook section targets. */
    @Serializable
    @SerialName("webhook")
    public data class Webhook(
        override val id: Long,
        override val name: String = "",
        override val enabled: Boolean = false,
        @SerialName("created_at") override val createdAt: String = "",
        @SerialName("updated_at") override val updatedAt: String = "",
        val url: String = "",
        val method: String = "",
        val headers: Map<String, String> = emptyMap(),
        @SerialName("body_template") val bodyTemplate: String = "",
    ) : NotificationChannel

    /** `ntfy`: publishes to an ntfy topic. */
    @Serializable
    @SerialName("ntfy")
    public data class Ntfy(
        override val id: Long,
        override val name: String = "",
        override val enabled: Boolean = false,
        @SerialName("created_at") override val createdAt: String = "",
        @SerialName("updated_at") override val updatedAt: String = "",
        @SerialName("server_url") val serverUrl: String = "",
        val topic: String = "",
        val priority: Int = 3,
        val username: String? = null,
        val password: String? = null,
    ) : NotificationChannel

    /** `pushover`: sends a Pushover notification. */
    @Serializable
    @SerialName("pushover")
    public data class Pushover(
        override val id: Long,
        override val name: String = "",
        override val enabled: Boolean = false,
        @SerialName("created_at") override val createdAt: String = "",
        @SerialName("updated_at") override val updatedAt: String = "",
        @SerialName("user_key") val userKey: String = "",
        @SerialName("app_token") val appToken: String = "",
        val device: String? = null,
        val priority: Int = 0,
    ) : NotificationChannel
}

/**
 * The `POST /notifications/{id}/webhook-test` result — the port of the web `WebhookTestResult`
 * (mirrors `webhookTestResponse` in internal/api/notification/channel.go). The server returns
 * this SAME shape with HTTP 200 even when the receiver fails: a transport failure carries
 * `status_code == 0` + `error`, an HTTP failure carries `status_code >= 400` + `success == false`,
 * so the holder surfaces every case uniformly without treating it as a request error.
 */
@Serializable
public data class WebhookTestResult(
    val success: Boolean = false,
    @SerialName("status_code") val statusCode: Int = 0,
    @SerialName("latency_ms") val latencyMs: Long = 0,
    @SerialName("body_preview") val bodyPreview: String? = null,
    val truncated: Boolean = false,
    val signature: String? = null,
    val error: String? = null,
)

/**
 * The `POST /notifications/webhooks/preview-signature` request body — the port of the web
 * `WebhookSignaturePreviewRequest`. Both fields are required and always serialize; an empty
 * `secret` is rejected 400 server-side (callers guard with a non-blank secret first).
 */
@Serializable
public data class WebhookSignaturePreviewRequest(
    val secret: String,
    val body: String,
)

/**
 * The `POST /notifications/webhooks/preview-signature` response — the port of the web
 * `WebhookSignaturePreviewResult` (`{ signature }`, a `sha256=<hex>` HMAC value).
 */
@Serializable
public data class WebhookSignaturePreviewResult(
    val signature: String = "",
)
