using System.Text.Json.Serialization;

namespace TeslaSync.App.Core.Push;

/// <summary>
/// The body POSTed to <c>/api/v1/devices</c> to register (or upsert) this device's push channel
/// with TeslaSync (P2/W6-0002, ADR-009). The wire shape is snake_case to match the Go API's
/// <c>json</c> tags, set explicitly so it is independent of the serializer naming policy.
///
/// <para><see cref="ChannelUri"/> is the WNS push token: it is sent only over TLS to the backend and
/// is never persisted locally or logged. <see cref="DeviceId"/> is an opaque, non-PII per-install
/// identifier.</para>
/// </summary>
public sealed record DeviceRegistrationRequest(
    [property: JsonPropertyName("platform")] string Platform,
    [property: JsonPropertyName("push_provider")] string PushProvider,
    [property: JsonPropertyName("channel_uri")] string ChannelUri,
    [property: JsonPropertyName("app_version")] string AppVersion,
    [property: JsonPropertyName("locale")] string Locale,
    [property: JsonPropertyName("device_id")] string DeviceId,
    [property: JsonPropertyName("capabilities")] IReadOnlyList<string> Capabilities,
    [property: JsonPropertyName("channel_expires_at")] DateTimeOffset? ChannelExpiresAt);

/// <summary>
/// The response from a successful <c>/api/v1/devices</c> registration (ADR-009). The backend assigns
/// a <see cref="RegistrationId"/> that the client stores (non-secret) and later uses to unregister
/// the exact device session. Optional echo fields are decoded tolerantly.
/// </summary>
public sealed record DeviceRegistrationResponse(
    [property: JsonPropertyName("id")] string RegistrationId,
    [property: JsonPropertyName("platform")] string? Platform = null,
    [property: JsonPropertyName("created_at")] DateTimeOffset? CreatedAt = null,
    [property: JsonPropertyName("channel_expires_at")] DateTimeOffset? ChannelExpiresAt = null);
