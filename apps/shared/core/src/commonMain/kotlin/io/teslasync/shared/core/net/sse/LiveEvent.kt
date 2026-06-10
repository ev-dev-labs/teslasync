package io.teslasync.shared.core.net.sse

import kotlinx.serialization.json.JsonObject

/**
 * Live connection lifecycle surfaced by [SseClient] alongside the event stream.
 *
 * Mirrors the web live-pipe states (`sseManager`'s `connected`/`reconnecting` plus
 * `useLiveConnection`'s stale derivation) and the cross-platform contract the
 * Windows/Apple/Android SSE clients all expose:
 *  - [Connecting]   first connection attempt has not yet produced a frame.
 *  - [Open]         a frame (or heartbeat) has arrived; the stream is live and fresh.
 *  - [Reconnecting] the transport dropped and a backoff-reconnect is in flight.
 *  - [Stale]        the stream is open but no event/heartbeat arrived within the
 *                   freshness window (ADR-013, default 2 minutes). The stream is
 *                   NOT dropped — last-known values stay valid but flagged stale.
 *  - [Closed]       the subscription's collector cancelled, or the stream ended
 *                   with reconnect disabled.
 */
public enum class Connection {
    Connecting,
    Open,
    Reconnecting,
    Stale,
    Closed,
}

/**
 * Typed live event decoded from the backend `/api/v1/events` SSE stream.
 *
 * The taxonomy mirrors the named events the Go `EventHub` emits (see
 * `internal/api/sse/handler.go`) and the web consumers in `sseManager.ts` /
 * `api/sseClient.ts`. The client-synthetic `disconnected` signal is intentionally
 * NOT a [LiveEvent]; it is represented through [Connection] state instead.
 *
 * [id] carries the SSE `id:` field of the originating frame when present, so callers
 * (and the reconnect machinery) can resume with `Last-Event-ID`.
 */
public sealed interface LiveEvent {
    /** The SSE `id:` of the frame this event was decoded from, or `null`. */
    public val id: String?

    /** `event: connected` — first frame, carrying the server-assigned client id. */
    public data class Connected(
        val clientId: String,
        override val id: String?,
    ) : LiveEvent

    /** `event: heartbeat` — periodic keep-alive carrying the server time. */
    public data class Heartbeat(
        val time: String?,
        override val id: String?,
    ) : LiveEvent

    /** `event: vehicle_update` — batched signal/state map for a vehicle. */
    public data class VehicleUpdate(
        val data: JsonObject,
        override val id: String?,
    ) : LiveEvent

    /** `event: alert` — a fired alert-rule payload. */
    public data class Alert(
        val data: JsonObject,
        override val id: String?,
    ) : LiveEvent

    /** `event: export_status` — progress for an export job. */
    public data class ExportStatus(
        val data: JsonObject,
        override val id: String?,
    ) : LiveEvent

    /** `event: achievement_unlocked` — a lifetime achievement transition. */
    public data class AchievementUnlocked(
        val data: JsonObject,
        override val id: String?,
    ) : LiveEvent

    /** `event: signal_change` — a single typed live-signal update. */
    public data class Signal(
        val envelope: SignalEnvelope,
        override val id: String?,
    ) : LiveEvent

    /**
     * Any other (or malformed-but-named) event. Carries the raw event name and the
     * undecoded `data:` payload so nothing is silently dropped.
     */
    public data class Unknown(
        val event: String,
        val data: String,
        override val id: String?,
    ) : LiveEvent
}

/**
 * Compact discriminator for a typed signal value, mirroring the `SignalKind` union
 * in `web/src/api/sseClient.ts`. Resolved from `protomodel.ValueKind` (either the
 * long-form name or the integer enum) at decode time.
 */
public enum class SignalKind {
    String,
    Bool,
    Int,
    Float,
    Time,
    Unknown,
}

/**
 * Discriminated typed primitive carried by a [SignalEnvelope]. The integer/float
 * distinction collapses into [NumberValue] because both decode to the same runtime
 * `Double`, exactly as the web client folds them into `number`.
 */
public sealed interface SignalValue {
    public data class NumberValue(
        val value: Double,
    ) : SignalValue

    public data class StringValue(
        val value: String,
    ) : SignalValue

    public data class BoolValue(
        val value: Boolean,
    ) : SignalValue

    public data class TimeValue(
        val value: String,
    ) : SignalValue

    /** An explicit null / missing typed value. */
    public data object NullValue : SignalValue
}

/**
 * Typed `signal_change` envelope mirroring
 * `internal/api/sse/handler.go::SignalChangeEvent` and the web `SignalEnvelope`.
 *
 * [ts] is the raw RFC3339 / ISO-8601 string the backend serialises `time.Time` as;
 * callers parse it only when needed.
 */
public data class SignalEnvelope(
    val vehicleId: Long,
    val field: String,
    val kind: SignalKind,
    val value: SignalValue,
    val ts: String,
)
