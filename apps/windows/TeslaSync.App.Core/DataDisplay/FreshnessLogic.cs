using System.Globalization;

namespace TeslaSync.App.Core.DataDisplay;

/// <summary>Freshness state of a SPECIFIC data point (mirrors the web FreshnessIndicator).</summary>
public enum FreshnessStatus
{
    /// <summary>Age below the stale threshold.</summary>
    Fresh,

    /// <summary>Age between the stale and offline thresholds.</summary>
    Stale,

    /// <summary>Age at or beyond the offline threshold.</summary>
    Offline,

    /// <summary>No timestamp available.</summary>
    Unknown,
}

/// <summary>
/// Pure freshness logic backing <c>TsFreshnessIndicator</c> / <c>TsDataFreshness</c>.
/// Encodes the two-minute live-state contract: a data point older than
/// <see cref="DefaultStaleSeconds"/> (120 s) is stale, and older than
/// <see cref="DefaultOfflineSeconds"/> (600 s) is offline. Kept UI-free so the
/// thresholds are unit-tested without a render host.
/// </summary>
public static class FreshnessLogic
{
    /// <summary>Seconds before a data point is considered stale (the 2-minute contract).</summary>
    public const int DefaultStaleSeconds = 120;

    /// <summary>Seconds before a data point is considered offline.</summary>
    public const int DefaultOfflineSeconds = 600;

    /// <summary>Age in whole seconds between <paramref name="timestamp"/> and <paramref name="now"/>, floored at 0.</summary>
    public static int? ComputeAge(DateTimeOffset? timestamp, DateTimeOffset now)
    {
        if (timestamp is not { } ts)
        {
            return null;
        }

        double seconds = (now - ts).TotalSeconds;
        return (int)Math.Max(0, Math.Floor(seconds));
    }

    /// <summary>Classify an age (seconds) against the stale / offline thresholds.</summary>
    public static FreshnessStatus GetStatus(
        int? age,
        int staleThreshold = DefaultStaleSeconds,
        int offlineThreshold = DefaultOfflineSeconds)
    {
        if (age is not { } a)
        {
            return FreshnessStatus.Unknown;
        }

        if (a < staleThreshold)
        {
            return FreshnessStatus.Fresh;
        }

        if (a < offlineThreshold)
        {
            return FreshnessStatus.Stale;
        }

        return FreshnessStatus.Offline;
    }

    /// <summary>
    /// Convenience: classify a timestamp directly (computes age internally).
    /// </summary>
    public static FreshnessStatus GetStatus(
        DateTimeOffset? timestamp,
        DateTimeOffset now,
        int staleThreshold = DefaultStaleSeconds,
        int offlineThreshold = DefaultOfflineSeconds)
        => GetStatus(ComputeAge(timestamp, now), staleThreshold, offlineThreshold);

    /// <summary>True once a timestamp's age reaches the stale threshold.</summary>
    public static bool IsStale(DateTimeOffset? timestamp, DateTimeOffset now, int staleThreshold = DefaultStaleSeconds)
        => ComputeAge(timestamp, now) is { } a && a >= staleThreshold;

    /// <summary>True once a timestamp's age reaches the offline threshold.</summary>
    public static bool IsOffline(DateTimeOffset? timestamp, DateTimeOffset now, int offlineThreshold = DefaultOfflineSeconds)
        => ComputeAge(timestamp, now) is { } a && a >= offlineThreshold;

    /// <summary>
    /// Short relative-age label ("just now", "12s ago", "5m ago", "3h ago")
    /// mirroring the web <c>formatAge</c> tiers. Returns an em dash for null age.
    /// </summary>
    public static string FormatAge(int? age)
    {
        if (age is not { } a)
        {
            return "\u2014";
        }

        if (a < 10)
        {
            return "just now";
        }

        if (a < 60)
        {
            return $"{a}s ago";
        }

        if (a < 3600)
        {
            return $"{a / 60}m ago";
        }

        return $"{a / 3600}h ago";
    }

    /// <summary>
    /// Token brush key for a freshness status (Fresh→success, Stale→warning,
    /// Offline→danger, Unknown→muted). Lets the WinUI dot stay tokenized.
    /// </summary>
    public static string AccentBrushKey(FreshnessStatus status) => status switch
    {
        FreshnessStatus.Fresh => "TsColorSuccessBrush",
        FreshnessStatus.Stale => "TsColorWarningBrush",
        FreshnessStatus.Offline => "TsColorDangerBrush",
        _ => "TsColorTextMutedBrush",
    };

    /// <summary>
    /// Source-layer age formatter used by <c>TsSourceLayerBadge</c> — ms → human
    /// string ("450 ms", "3.2 s", "5 min", "1.5 h", "2.0 d"). null → null.
    /// </summary>
    public static string? FormatSourceAge(double? ms)
    {
        if (ms is not { } m || double.IsNaN(m) || double.IsInfinity(m))
        {
            return null;
        }

        var c = CultureInfo.InvariantCulture;
        if (m < 1000)
        {
            return $"{Math.Round(m).ToString("0", c)} ms";
        }

        if (m < 60_000)
        {
            return $"{(m / 1000).ToString("0.0", c)} s";
        }

        if (m < 3_600_000)
        {
            return $"{Math.Round(m / 60_000).ToString("0", c)} min";
        }

        if (m < 86_400_000)
        {
            return $"{(m / 3_600_000).ToString("0.0", c)} h";
        }

        return $"{(m / 86_400_000).ToString("0.0", c)} d";
    }
}
