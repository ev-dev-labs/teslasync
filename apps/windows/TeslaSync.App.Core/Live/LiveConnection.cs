using TeslaSync.App.Core.DataDisplay;

namespace TeslaSync.App.Core.Live;

/// <summary>
/// The lifecycle of a foreground SSE subscription, surfaced by <see cref="ISseClient"/>
/// alongside the typed event stream. Mirrors the cross-platform live contract the shared
/// Kotlin <c>Connection</c> enum exposes and the web <c>sseManager</c>/<c>useLiveConnection</c>
/// pair:
/// <list type="bullet">
///   <item><see cref="Connecting"/> — the first attempt has not yet produced a frame.</item>
///   <item><see cref="Open"/> — a frame (or heartbeat) arrived; the stream is live and fresh.</item>
///   <item><see cref="Reconnecting"/> — the transport dropped and a backoff-reconnect is in flight.</item>
///   <item><see cref="Stale"/> — the stream is open but no event/heartbeat arrived within the
///     freshness window (ADR-013, two minutes). The stream is NOT dropped — last-known values
///     remain valid but are flagged stale.</item>
///   <item><see cref="Paused"/> — the app moved to the background; the connection is intentionally
///     suspended and will resume on foreground.</item>
///   <item><see cref="AuthRequired"/> — a <c>401</c> could not be recovered by a single refresh;
///     the user must re-authenticate before the stream can resume.</item>
///   <item><see cref="Closed"/> — the subscription's consumer cancelled, or the stream ended with
///     reconnect disabled.</item>
/// </list>
/// </summary>
public enum LiveConnection
{
    /// <summary>First connection attempt has not yet produced a frame.</summary>
    Connecting,

    /// <summary>A frame or heartbeat has arrived; the stream is live and fresh.</summary>
    Open,

    /// <summary>The transport dropped; a backoff-reconnect is in flight.</summary>
    Reconnecting,

    /// <summary>Open but silent past the freshness window — last values stay valid, flagged stale.</summary>
    Stale,

    /// <summary>Suspended because the app is in the background; resumes on foreground.</summary>
    Paused,

    /// <summary>A <c>401</c> survived a single refresh; re-authentication is required.</summary>
    AuthRequired,

    /// <summary>The consumer cancelled, or the stream ended with reconnect disabled.</summary>
    Closed,
}

/// <summary>
/// Projects the SSE-specific <see cref="LiveConnection"/> onto the UI-facing
/// <see cref="LiveConnectionState"/> consumed by <c>TsLiveIndicator</c>, so the live pill and
/// the stale-data banner can bind to the SSE client without knowing its internal taxonomy.
/// </summary>
public static class LiveConnectionMapping
{
    /// <summary>Maps a transport lifecycle to the indicator's coarse health state.</summary>
    public static LiveConnectionState ToIndicatorState(LiveConnection connection) => connection switch
    {
        LiveConnection.Open => LiveConnectionState.Connected,
        LiveConnection.Stale => LiveConnectionState.Connected,
        LiveConnection.Connecting => LiveConnectionState.Reconnecting,
        LiveConnection.Reconnecting => LiveConnectionState.Reconnecting,
        LiveConnection.Paused => LiveConnectionState.Disconnected,
        LiveConnection.AuthRequired => LiveConnectionState.Disconnected,
        LiveConnection.Closed => LiveConnectionState.Disconnected,
        _ => LiveConnectionState.Unknown,
    };

    /// <summary>True while the stream is delivering or actively trying to deliver data.</summary>
    public static bool IsLive(LiveConnection connection) =>
        connection is LiveConnection.Open or LiveConnection.Stale;

    /// <summary>True when the <c>TsLiveStaleDataBanner</c> should be shown for this state.</summary>
    public static bool ShouldShowStaleBanner(LiveConnection connection) =>
        connection is LiveConnection.Stale;
}
