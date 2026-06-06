namespace TeslaSync.App.Core.DataDisplay;

/// <summary>
/// Health of the live-data pipeline (the SSE/MQTT/polling transport) surfaced by
/// <c>TsLiveIndicator</c>. NOT to be confused with <see cref="FreshnessStatus"/>,
/// which reflects the age of a single data point. Mirrors the web
/// <c>useLiveConnection</c> states.
/// </summary>
public enum LiveConnectionState
{
    /// <summary>Wire is up and receiving messages.</summary>
    Connected,

    /// <summary>Transport is re-establishing.</summary>
    Reconnecting,

    /// <summary>Transport is down.</summary>
    Disconnected,

    /// <summary>Connection state has not been determined yet.</summary>
    Unknown,
}

/// <summary>Presentation mapping for <see cref="LiveConnectionState"/>.</summary>
public static class LiveConnectionPresentation
{
    /// <summary>Token brush key for the live state dot/text.</summary>
    public static string AccentBrushKey(LiveConnectionState state) => state switch
    {
        LiveConnectionState.Connected => "TsColorSuccessBrush",
        LiveConnectionState.Reconnecting => "TsColorWarningBrush",
        LiveConnectionState.Disconnected => "TsColorDangerBrush",
        _ => "TsColorTextMutedBrush",
    };

    /// <summary>Default English label for the live state.</summary>
    public static string DefaultLabel(LiveConnectionState state) => state switch
    {
        LiveConnectionState.Connected => "Live",
        LiveConnectionState.Reconnecting => "Reconnecting\u2026",
        LiveConnectionState.Disconnected => "Offline",
        _ => "Unknown",
    };

    /// <summary>True when the indicator should spin/animate (reconnecting).</summary>
    public static bool ShouldAnimate(LiveConnectionState state) => state == LiveConnectionState.Reconnecting;
}
