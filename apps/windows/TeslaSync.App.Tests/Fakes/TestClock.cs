namespace TeslaSync.App.Tests.Fakes;

/// <summary>
/// A deterministic, manually-advanced clock for the <c>Func&lt;DateTimeOffset&gt;</c> seam the Core
/// components inject (live freshness, push/notification diagnostics, cache TTL, circuit breaker).
/// Reusable across the W9 suite so no test depends on wall-clock time and every time-based assertion
/// is exact.
/// </summary>
internal sealed class TestClock
{
    private DateTimeOffset _now;

    /// <summary>Creates a clock starting at <paramref name="start"/> (defaults to the Unix epoch).</summary>
    public TestClock(DateTimeOffset? start = null) =>
        _now = start ?? DateTimeOffset.UnixEpoch;

    /// <summary>The current instant.</summary>
    public DateTimeOffset Now => _now;

    /// <summary>The clock as the <c>Func&lt;DateTimeOffset&gt;</c> the Core seam consumes.</summary>
    public Func<DateTimeOffset> Func => () => _now;

    /// <summary>Advances the clock by <paramref name="by"/> and returns the new instant.</summary>
    public DateTimeOffset Advance(TimeSpan by)
    {
        _now = _now.Add(by);
        return _now;
    }

    /// <summary>Jumps the clock to an absolute <paramref name="instant"/>.</summary>
    public void Set(DateTimeOffset instant) => _now = instant;
}
