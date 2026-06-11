using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The freshness state-holder seam the <c>FreshnessIndicator</c> surface binds through (P1/S8) — the native
/// analogue of the <c>timestamp</c> prop the web component receives and the <c>useIsStale</c> hook reads
/// (web/src/components/data-display/FreshnessIndicator.tsx). It exposes the current
/// <see cref="FreshnessIndicatorSnapshot"/> (the timestamp of the specific data point) and raises
/// <see cref="Changed"/> whenever that reading moves. The view never reads a query or performs HTTP itself — it
/// binds to this seam, exactly as the web component takes the timestamp as a prop. The production binding is
/// <see cref="RepositoryFreshnessIndicatorSource{T}"/> over a cache-then-network repository stream;
/// <see cref="StaticFreshnessIndicatorSource"/> stands in for headless hosts and unit tests.
/// </summary>
public interface IFreshnessIndicatorSource
{
    /// <summary>The current freshness sample (the data point's timestamp, or null for no reading).</summary>
    FreshnessIndicatorSnapshot Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="IFreshnessIndicatorSource"/> with an explicit, caller-set sample — the headless / unit-test
/// default. It lets the projection and view-model be exercised for every freshness state (fresh, stale, offline,
/// unknown) without a repository or a UI host. Call <see cref="Set"/> to move the sample (raising
/// <see cref="Changed"/>).
/// </summary>
public sealed class StaticFreshnessIndicatorSource : IFreshnessIndicatorSource
{
    private FreshnessIndicatorSnapshot _current;

    /// <summary>Creates a source over an initial sample.</summary>
    /// <param name="current">The initial freshness sample.</param>
    public StaticFreshnessIndicatorSource(FreshnessIndicatorSnapshot current)
    {
        ArgumentNullException.ThrowIfNull(current);
        _current = current;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public FreshnessIndicatorSnapshot Current => _current;

    /// <summary>Move the sample and raise <see cref="Changed"/> (the data point re-sampling).</summary>
    /// <param name="snapshot">The new freshness sample.</param>
    public void Set(FreshnessIndicatorSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        _current = snapshot;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="IFreshnessIndicatorSource"/> — binds the indicator to a cache-then-network
/// repository stream, the native wiring for "age of a specific datum". The composition root supplies a stream
/// factory (e.g. <c>ct =&gt; vehicleRepository.WatchStateAsync(vehicleId, ct)</c>) and a selector that pulls the
/// reading time out of each value (e.g. <c>state =&gt; state.GpsAsOf</c>); each
/// <see cref="RepositoryResult{T}"/> emission is projected to a <see cref="FreshnessIndicatorSnapshot"/> via
/// <see cref="FreshnessIndicatorSnapshot.FromRepositoryResult{T}"/> and surfaced through <see cref="Current"/> /
/// <see cref="Changed"/>. A monotonic generation guard discards emissions from a superseded run. The whole class
/// is WinUI-free so it is unit-tested against an in-memory stream without a UI host.
/// </summary>
/// <typeparam name="T">The repository's domain read-model type whose datum carries the reading time.</typeparam>
public sealed class RepositoryFreshnessIndicatorSource<T> : IFreshnessIndicatorSource, IDisposable
{
    private readonly Func<CancellationToken, IAsyncEnumerable<RepositoryResult<T>>> _stream;
    private readonly Func<T, DateTimeOffset?> _selectTimestamp;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _gate = new();
    private FreshnessIndicatorSnapshot _current = FreshnessIndicatorSnapshot.Empty;
    private int _generation;
    private bool _disposed;

    /// <summary>Creates the source over a repository stream factory and a reading-time selector.</summary>
    /// <param name="stream">
    /// The cache-then-network stream factory (web query function), e.g.
    /// <c>ct =&gt; vehicleRepository.WatchStateAsync(vehicleId, ct)</c>.
    /// </param>
    /// <param name="selectTimestamp">Selector that pulls the data point's own timestamp out of the latest value.</param>
    /// <param name="autoStart">Whether to begin the first stream immediately (defaults to true).</param>
    public RepositoryFreshnessIndicatorSource(
        Func<CancellationToken, IAsyncEnumerable<RepositoryResult<T>>> stream,
        Func<T, DateTimeOffset?> selectTimestamp,
        bool autoStart = true)
    {
        ArgumentNullException.ThrowIfNull(stream);
        ArgumentNullException.ThrowIfNull(selectTimestamp);
        _stream = stream;
        _selectTimestamp = selectTimestamp;

        if (autoStart)
        {
            Start();
        }
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public FreshnessIndicatorSnapshot Current
    {
        get
        {
            lock (_gate)
            {
                return _current;
            }
        }
    }

    /// <summary>Re-run the stream (the latest run wins via a monotonic generation guard).</summary>
    public void Start()
    {
        if (_disposed)
        {
            return;
        }

        var generation = Interlocked.Increment(ref _generation);
        _ = PumpAsync(generation);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _lifetime.Cancel();
        _lifetime.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task PumpAsync(int generation)
    {
        try
        {
            await foreach (var result in _stream(_lifetime.Token).ConfigureAwait(false))
            {
                if (Volatile.Read(ref _generation) != generation)
                {
                    // A newer Start superseded this run; stop applying its emissions.
                    return;
                }

                Update(FreshnessIndicatorSnapshot.FromRepositoryResult(result, _selectTimestamp));
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by Dispose (lifetime cancelled); nothing to surface.
        }
        catch (ObjectDisposedException)
        {
            // The lifetime token source was disposed mid-enumeration during Dispose; safe to ignore.
        }
    }

    private void Update(FreshnessIndicatorSnapshot snapshot)
    {
        lock (_gate)
        {
            if (_current == snapshot)
            {
                return;
            }

            _current = snapshot;
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }
}
