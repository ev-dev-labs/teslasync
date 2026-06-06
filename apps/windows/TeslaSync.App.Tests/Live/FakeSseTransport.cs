using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Live;

namespace TeslaSync.App.Tests.Live;

/// <summary>One scripted action a <see cref="FakeSseTransport"/> performs within a connection attempt.</summary>
internal abstract record SseStep
{
    /// <summary>Emit a raw text chunk to the client's frame parser.</summary>
    public sealed record Emit(string Chunk) : SseStep;

    /// <summary>End the stream normally (the server closed the connection).</summary>
    public sealed record Complete : SseStep;

    /// <summary>Throw a transport failure so the client backs off and reconnects.</summary>
    public sealed record Fail(Exception Error) : SseStep;

    /// <summary>Reject the attempt with a <c>401</c> (an <see cref="SseUnauthorizedException"/>).</summary>
    public sealed record Unauthorized : SseStep;

    /// <summary>Hold the connection open until the consumer cancels.</summary>
    public sealed record Hang : SseStep;
}

/// <summary>
/// A scripted <see cref="ISseTransport"/> for the live-client tests. Each <see cref="OpenAsync"/>
/// call is one connection attempt; the supplied script maps the zero-based attempt index (and the
/// resume <c>Last-Event-ID</c>) to the steps that attempt should perform. The transport records
/// every <see cref="SseRequest"/> and tracks how many connections are currently open so cancellation
/// and reconnect behaviour can be asserted without a real socket.
/// </summary>
internal sealed class FakeSseTransport : ISseTransport
{
    private readonly Func<int, string?, IReadOnlyList<SseStep>> _script;
    private int _activeConnections;

    public FakeSseTransport(Func<int, string?, IReadOnlyList<SseStep>> script) => _script = script;

    public List<SseRequest> Opens { get; } = new();

    public int ActiveConnections => Volatile.Read(ref _activeConnections);

    public async IAsyncEnumerable<string> OpenAsync(
        SseRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        int attempt;
        lock (Opens)
        {
            attempt = Opens.Count;
            Opens.Add(request);
        }

        var steps = _script(attempt, request.LastEventId);
        Interlocked.Increment(ref _activeConnections);
        try
        {
            foreach (var step in steps)
            {
                switch (step)
                {
                    case SseStep.Emit emit:
                        yield return emit.Chunk;
                        break;
                    case SseStep.Complete:
                        yield break;
                    case SseStep.Fail fail:
                        throw fail.Error;
                    case SseStep.Unauthorized:
                        throw new SseUnauthorizedException();
                    case SseStep.Hang:
                        await Task.Delay(Timeout.Infinite, cancellationToken).ConfigureAwait(false);
                        break;
                }
            }
        }
        finally
        {
            Interlocked.Decrement(ref _activeConnections);
        }
    }
}

/// <summary>A controllable <see cref="IForegroundLifecycle"/> for the pause/resume tests.</summary>
internal sealed class ControllableForegroundLifecycle : IForegroundLifecycle
{
    private bool _isForeground;

    public ControllableForegroundLifecycle(bool foreground = true) => _isForeground = foreground;

    public bool IsForeground => _isForeground;

    public event Action<bool>? ForegroundChanged;

    public void Set(bool foreground)
    {
        _isForeground = foreground;
        ForegroundChanged?.Invoke(foreground);
    }
}

/// <summary>A manual, test-controlled clock so staleness transitions are deterministic.</summary>
internal sealed class ManualClock
{
    private DateTimeOffset _now;

    public ManualClock(DateTimeOffset start) => _now = start;

    public DateTimeOffset Now => _now;

    public DateTimeOffset Get() => _now;

    public void Advance(TimeSpan delta) => _now += delta;
}

/// <summary>
/// A controllable replacement for the client's <c>Delay</c> seam. Short backoff sleeps complete
/// instantly and are recorded (so capped-exponential backoff can be asserted); sleeps at or above
/// <see cref="_parkThreshold"/> — the staleness watchdog's freshness-window park — are suspended
/// until cancellation so the watchdog does not busy-spin while the rest of the test runs.
/// </summary>
internal sealed class DelayController
{
    private readonly TimeSpan _parkThreshold;
    private readonly List<TimeSpan> _recorded = new();

    public DelayController(TimeSpan parkThreshold) => _parkThreshold = parkThreshold;

    public IReadOnlyList<TimeSpan> Recorded
    {
        get
        {
            lock (_recorded)
            {
                return _recorded.ToArray();
            }
        }
    }

    public Task Delay(TimeSpan delay, CancellationToken cancellationToken)
    {
        if (delay >= _parkThreshold)
        {
            var parked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            cancellationToken.Register(() => parked.TrySetResult());
            return parked.Task;
        }

        lock (_recorded)
        {
            _recorded.Add(delay);
        }

        return Task.CompletedTask;
    }
}
