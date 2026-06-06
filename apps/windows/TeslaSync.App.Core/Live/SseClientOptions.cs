using TeslaSync.App.Core.DataDisplay;

namespace TeslaSync.App.Core.Live;

/// <summary>
/// Immutable configuration for an <see cref="SseClient"/>. The clock, delay and jitter seams are
/// injectable so reconnect/backoff and staleness can be driven deterministically in tests without
/// touching the wall clock.
/// </summary>
public sealed class SseClientOptions
{
    /// <summary>The default backend SSE path consumed when <see cref="ISseClient.Subscribe"/> is given none.</summary>
    public const string DefaultPath = "/events";

    /// <summary>The default SSE path (the transport adds the <c>/api/v1</c> prefix).</summary>
    public string Path { get; init; } = DefaultPath;

    /// <summary>
    /// Silence (no event/heartbeat) after which an open stream is flagged
    /// <see cref="LiveConnection.Stale"/> — ADR-013's two-minute contract by default.
    /// </summary>
    public TimeSpan FreshnessWindow { get; init; } = TimeSpan.FromSeconds(FreshnessLogic.DefaultStaleSeconds);

    /// <summary>Whether to backoff-reconnect after a drop/close. When false the stream ends on the first disconnect.</summary>
    public bool Reconnect { get; init; } = true;

    /// <summary>The first-reconnect backoff base; it doubles per attempt up to <see cref="MaxRetryDelay"/>.</summary>
    public TimeSpan BaseRetryDelay { get; init; } = TimeSpan.FromSeconds(1);

    /// <summary>The upper bound for a single backoff sleep.</summary>
    public TimeSpan MaxRetryDelay { get; init; } = TimeSpan.FromSeconds(30);

    /// <summary>The monotonic clock seam for staleness; injected as virtual time in tests.</summary>
    public Func<DateTimeOffset> Clock { get; init; } = () => DateTimeOffset.UtcNow;

    /// <summary>The backoff/watchdog sleep seam; injected as a no-op (or controllable) delay in tests.</summary>
    public Func<TimeSpan, CancellationToken, Task> Delay { get; init; } = Task.Delay;

    /// <summary>The jitter source in <c>[0,1)</c>; injectable for deterministic tests.</summary>
    public Func<double> Random { get; init; } = System.Random.Shared.NextDouble;
}
