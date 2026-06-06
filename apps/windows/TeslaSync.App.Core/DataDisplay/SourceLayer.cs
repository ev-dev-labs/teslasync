namespace TeslaSync.App.Core.DataDisplay;

/// <summary>
/// Layered live-state source of a signal value, surfaced by <c>TsSourceLayerBadge</c>
/// (port of the web <c>SourceLayerBadge</c>). Distinguishes the L1 in-process store,
/// the L2 Redis hot cache, the durable signal_log replay path, and the stale tier
/// (Redis-backed value older than the 2-minute freshness window).
/// </summary>
public enum SourceLayer
{
    /// <summary>Fresh value from the local in-process SignalStore (hot path).</summary>
    L1,

    /// <summary>Value from the Redis cross-pod cache (legacy unknown-freshness entry).</summary>
    L2,

    /// <summary>Replayed from signal_log (durable history).</summary>
    Log,

    /// <summary>Redis-backed value older than the 2-minute freshness window.</summary>
    Stale,

    /// <summary>Source layer unknown.</summary>
    Unknown,
}

/// <summary>Presentation tokens for a <see cref="SourceLayer"/>.</summary>
/// <param name="Layer">The source layer.</param>
/// <param name="Label">Compact badge glyph/label.</param>
/// <param name="AccentBrushKey">Token brush key for the badge tint.</param>
/// <param name="Description">English tooltip describing the layer.</param>
public readonly record struct SourceLayerTokens(SourceLayer Layer, string Label, string AccentBrushKey, string Description);

/// <summary>Source-layer parsing + token lookup (port of web <c>SourceLayerBadge</c>).</summary>
public static class SourceLayers
{
    /// <summary>Parse a wire source string ("l1"/"l2"/"log"/"stale") to the enum.</summary>
    public static SourceLayer Parse(string? source) => (source ?? string.Empty).Trim().ToLowerInvariant() switch
    {
        "l1" => SourceLayer.L1,
        "l2" => SourceLayer.L2,
        "log" => SourceLayer.Log,
        "stale" => SourceLayer.Stale,
        _ => SourceLayer.Unknown,
    };

    /// <summary>Look up presentation tokens for a source layer.</summary>
    public static SourceLayerTokens Tokens(SourceLayer layer) => layer switch
    {
        SourceLayer.L1 => new(layer, "L1", "TsColorSuccessBrush", "Read from the in-process SignalStore (hot path, freshest)."),
        SourceLayer.L2 => new(layer, "L2", "TsColorInfoBrush", "Read from Redis cross-pod cache (legacy entry; freshness unknown)."),
        SourceLayer.Log => new(layer, "LOG", "TsColorTextSecondaryBrush", "Replayed from signal_log (durable history)."),
        SourceLayer.Stale => new(layer, "STALE", "TsColorWarningBrush", "Redis-backed value older than the 2-minute freshness window."),
        _ => new(SourceLayer.Unknown, "\u2014", "TsColorTextMutedBrush", "Source layer unknown."),
    };

    /// <summary>Convenience: parse a wire string straight to its tokens.</summary>
    public static SourceLayerTokens TokensFor(string? source) => Tokens(Parse(source));
}
