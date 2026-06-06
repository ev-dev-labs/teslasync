using TeslaSync.App.Core.DataDisplay;

namespace TeslaSync.App.Core.Data.Behavior;

/// <summary>
/// The cache-then-network freshness boundary. Reuses the app-wide two-minute
/// live-state contract encoded in <see cref="FreshnessLogic"/> so cached rows past
/// <see cref="LiveStaleSeconds"/> are flagged stale (and the UI can show a refreshing
/// affordance) without re-deriving the threshold.
/// </summary>
public static class CacheFreshness
{
    /// <summary>Seconds after which a cached live value is considered stale (the 2-minute contract).</summary>
    public const int LiveStaleSeconds = FreshnessLogic.DefaultStaleSeconds;

    /// <summary>True once the cached payload at <paramref name="fetchedAt"/> is past the stale window.</summary>
    public static bool IsStale(DateTimeOffset fetchedAt, DateTimeOffset now, int staleSeconds = LiveStaleSeconds) =>
        FreshnessLogic.IsStale(fetchedAt, now, staleSeconds);

    /// <summary>The age in whole seconds of a cached payload, floored at zero.</summary>
    public static int Age(DateTimeOffset fetchedAt, DateTimeOffset now) =>
        FreshnessLogic.ComputeAge(fetchedAt, now) ?? 0;
}
