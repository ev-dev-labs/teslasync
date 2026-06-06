using System.Text.Json;

namespace TeslaSync.App.Core.Live;

/// <summary>
/// A typed live event decoded from the backend <c>/api/v1/events</c> SSE stream. The
/// taxonomy mirrors the named events the Go <c>EventHub</c> emits
/// (<c>internal/api/sse/handler.go</c>) and the web consumers in <c>sseManager.ts</c> /
/// <c>api/sseClient.ts</c>. The client-synthetic "disconnected" signal is intentionally NOT a
/// <see cref="LiveEvent"/>; it is represented through <see cref="LiveConnection"/> state instead.
///
/// <para><see cref="Id"/> carries the SSE <c>id:</c> field of the originating frame when present
/// so callers (and the reconnect machinery) can resume with <c>Last-Event-ID</c>.</para>
/// </summary>
public abstract record LiveEvent
{
    private LiveEvent(string? id) => Id = id;

    /// <summary>The SSE <c>id:</c> of the frame this event was decoded from, or <see langword="null"/>.</summary>
    public string? Id { get; }

    /// <summary><c>event: connected</c> — first frame, carrying the server-assigned client id.</summary>
    public sealed record Connected(string ClientId, string? FrameId) : LiveEvent(FrameId);

    /// <summary><c>event: heartbeat</c> — periodic keep-alive carrying the server time.</summary>
    public sealed record Heartbeat(string? Time, string? FrameId) : LiveEvent(FrameId);

    /// <summary><c>event: vehicle_update</c> — batched signal/state map for a vehicle.</summary>
    public sealed record VehicleUpdate(JsonElement Data, string? FrameId) : LiveEvent(FrameId);

    /// <summary><c>event: alert</c> — a fired alert-rule payload.</summary>
    public sealed record Alert(JsonElement Data, string? FrameId) : LiveEvent(FrameId);

    /// <summary><c>event: export_status</c> — progress for an export job.</summary>
    public sealed record ExportStatus(JsonElement Data, string? FrameId) : LiveEvent(FrameId);

    /// <summary><c>event: achievement_unlocked</c> — a lifetime achievement transition.</summary>
    public sealed record AchievementUnlocked(JsonElement Data, string? FrameId) : LiveEvent(FrameId);

    /// <summary><c>event: signal_change</c> — a single typed live-signal update.</summary>
    public sealed record Signal(SignalEnvelope Envelope, string? FrameId) : LiveEvent(FrameId);

    /// <summary>
    /// Any other (or malformed-but-named) event. Carries the raw event name and the undecoded
    /// <c>data:</c> payload so nothing is silently dropped.
    /// </summary>
    public sealed record Unknown(string Event, string Data, string? FrameId) : LiveEvent(FrameId);
}

/// <summary>
/// Compact discriminator for a typed signal value, mirroring the <c>SignalKind</c> union in
/// <c>web/src/api/sseClient.ts</c>. Resolved from <c>protomodel.ValueKind</c> (either the
/// long-form name or the integer enum) at decode time.
/// </summary>
public enum SignalKind
{
    /// <summary>An unresolved or compound kind.</summary>
    Unknown,

    /// <summary>A textual value.</summary>
    String,

    /// <summary>A boolean value.</summary>
    Bool,

    /// <summary>An integral value (folds into <see cref="SignalValue.Number"/>).</summary>
    Int,

    /// <summary>A floating-point value (folds into <see cref="SignalValue.Number"/>).</summary>
    Float,

    /// <summary>An RFC3339 / ISO-8601 timestamp value.</summary>
    Time,
}

/// <summary>
/// Discriminated typed primitive carried by a <see cref="SignalEnvelope"/>. The integer/float
/// distinction collapses into <see cref="Number"/> because both decode to the same runtime
/// <see cref="double"/>, exactly as the web client folds them into <c>number</c>.
/// </summary>
public abstract record SignalValue
{
    private SignalValue()
    {
    }

    /// <summary>A numeric value (integer or float).</summary>
    public sealed record Number(double Value) : SignalValue;

    /// <summary>A textual value.</summary>
    public sealed record Text(string Value) : SignalValue;

    /// <summary>A boolean value.</summary>
    public sealed record Flag(bool Value) : SignalValue;

    /// <summary>A timestamp value (raw RFC3339 / ISO-8601 string).</summary>
    public sealed record Instant(string Value) : SignalValue;

    /// <summary>An explicit null / missing typed value.</summary>
    public sealed record Null : SignalValue;
}

/// <summary>
/// Typed <c>signal_change</c> envelope mirroring
/// <c>internal/api/sse/handler.go::SignalChangeEvent</c> and the web <c>SignalEnvelope</c>.
/// <see cref="Timestamp"/> is the raw RFC3339 / ISO-8601 string the backend serialises
/// <c>time.Time</c> as; callers parse it only when needed.
/// </summary>
public sealed record SignalEnvelope(
    long VehicleId,
    string Field,
    SignalKind Kind,
    SignalValue Value,
    string Timestamp);
