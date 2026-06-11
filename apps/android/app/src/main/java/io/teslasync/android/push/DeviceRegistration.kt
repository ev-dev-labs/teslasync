package io.teslasync.android.push

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The body POSTed to `/api/v1/devices` to register (or upsert) this device's push channel with
 * TeslaSync (P3/A6, ADR-009). The wire shape is snake_case to match the Go API's `json` tags.
 *
 * [channelUri] is the FCM token: it is sent only over TLS to the backend and is never persisted
 * locally or logged. [deviceId] is an opaque, non-PII per-install identifier. [channelExpiresAt] is
 * null for the FCM transport (FCM tokens have no fixed expiry).
 */
@Serializable
data class DeviceRegistrationRequest(
    @SerialName("platform") val platform: String,
    @SerialName("push_provider") val pushProvider: String,
    @SerialName("channel_uri") val channelUri: String,
    @SerialName("app_version") val appVersion: String,
    @SerialName("locale") val locale: String,
    @SerialName("device_id") val deviceId: String,
    @SerialName("capabilities") val capabilities: List<String>,
    @SerialName("channel_expires_at") val channelExpiresAt: String? = null,
)

/**
 * The response from a successful `/api/v1/devices` registration (ADR-009). The backend assigns an
 * [id] that the client stores (non-secret) and later uses to unregister the exact device session.
 * Optional echo fields are decoded tolerantly (default to null so a partial payload still decodes).
 */
@Serializable
data class DeviceRegistrationResponse(
    @SerialName("id") val id: String,
    @SerialName("platform") val platform: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("channel_expires_at") val channelExpiresAt: String? = null,
)
