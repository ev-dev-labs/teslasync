using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The freshness state-holder seam the <c>DataFreshness</c> surface binds through (P1/S8) — the native analogue
/// of the TanStack Query result the web <c>&lt;DataFreshnessAuto&gt;</c> consumes
/// (web/src/components/data-display/DataFreshness.tsx). It exposes the current <see cref="DataFreshnessSnapshot"/>
/// (the web <c>isFetching</c> / <c>isStale</c> / <c>isError</c> / <c>dataUpdatedAt</c>), whether a manual refresh
/// is offered (web <c>refetchable</c> / the presence of <c>onRefresh</c>) and a <see cref="Refresh"/> trigger
/// (web <c>query.refetch()</c>), raising <see cref="Changed"/> whenever the snapshot moves. The view never reads
/// a query or performs HTTP itself — it binds to this seam, exactly as the web component takes the query result
/// as a prop. The production binding is <see cref="RepositoryDataFreshnessSource{T}"/> over a cache-then-network
/// repository stream; <see cref="StaticDataFreshnessSource"/> stands in for headless hosts and unit tests.
/// </summary>
public interface IDataFreshnessSource
{
    /// <summary>The current freshness snapshot (web query <c>isFetching</c>/<c>isStale</c>/<c>isError</c>/<c>dataUpdatedAt</c>).</summary>
    DataFreshnessSnapshot Current { get; }

    /// <summary>Whether the chip offers a manual refresh affordance (web <c>refetchable</c> / <c>onRefresh</c> present).</summary>
    bool CanRefresh { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;

    /// <summary>Trigger a manual refresh (web <c>query.refetch()</c>). A no-op when refresh is not offered.</summary>
    void Refresh();
}

/// <summary>
/// An <see cref="IDataFreshnessSource"/> with an explicit, caller-set snapshot and a counted
/// <see cref="Refresh"/> — the headless / unit-test default. It lets the projection and view-model be exercised
/// for every freshness state (and the refresh gating) without a repository or a UI host. Call <see cref="Set"/>
/// to move the snapshot (raising <see cref="Changed"/>); <see cref="Refresh"/> increments
/// <see cref="RefreshCount"/> and raises <see cref="Changed"/> so a test can assert the surface forwarded a
/// refresh request.
/// </summary>
public sealed class StaticDataFreshnessSource : IDataFreshnessSource
{
    private DataFreshnessSnapshot _current;

    /// <summary>Creates a source over an initial snapshot and whether it offers a refresh affordance.</summary>
    /// <param name="current">The initial freshness snapshot.</param>
    /// <param name="canRefresh">Whether the chip offers a manual refresh (web <c>refetchable</c>); defaults to true.</param>
    public StaticDataFreshnessSource(DataFreshnessSnapshot current, bool canRefresh = true)
    {
        ArgumentNullException.ThrowIfNull(current);
        _current = current;
        CanRefresh = canRefresh;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public DataFreshnessSnapshot Current => _current;

    /// <inheritdoc />
    public bool CanRefresh { get; }

    /// <summary>The number of times <see cref="Refresh"/> has been invoked (for refresh-gating assertions).</summary>
    public int RefreshCount { get; private set; }

    /// <summary>Move the snapshot and raise <see cref="Changed"/> (the web query result re-resolving).</summary>
    /// <param name="snapshot">The new freshness snapshot.</param>
    public void Set(DataFreshnessSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        _current = snapshot;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void Refresh()
    {
        RefreshCount++;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="IDataFreshnessSource"/> — binds the chip to a cache-then-network repository stream,
/// the native analogue of the web <c>&lt;DataFreshnessAuto query={useChargingHistory(...)} /&gt;</c> wiring
/// (web/src/components/data-display/DataFreshness.tsx). The composition root supplies a stream factory (e.g.
/// <c>ct =&gt; chargingRepository.ListSessionsAsync(vehicleId, ct)</c>); each <see cref="RepositoryResult{T}"/>
/// emission is projected to a <see cref="DataFreshnessSnapshot"/> via
/// <see cref="DataFreshnessSnapshot.FromRepositoryResult{T}"/> (honouring the optional
/// <c>forceStaleAfterMs</c> window) and surfaced through <see cref="Current"/> / <see cref="Changed"/>.
/// <see cref="Refresh"/> re-runs the stream; a monotonic generation guard discards emissions from a superseded
/// run so the latest refresh wins. The whole class is WinUI-free so it is unit-tested against an in-memory
/// stream without a UI host.
/// </summary>
/// <typeparam name="T">The repository's domain read-model type (e.g. the charging-session list).</typeparam>
public sealed class RepositoryDataFreshnessSource<T> : IDataFreshnessSource, IDisposable
{
    private readonly Func<CancellationToken, IAsyncEnumerable<RepositoryResult<T>>> _stream;
    private readonly Func<DateTimeOffset> _clock;
    private readonly double? _forceStaleAfterMs;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _gate = new();
    private DataFreshnessSnapshot _current = DataFreshnessSnapshot.Loading;
    private int _generation;
    private bool _disposed;

    /// <summary>Creates the source over a repository stream factory.</summary>
    /// <param name="stream">
    /// The cache-then-network stream factory (web query function), e.g.
    /// <c>ct =&gt; chargingRepository.ListSessionsAsync(vehicleId, ct)</c>.
    /// </param>
    /// <param name="clock">The clock the freshness window is measured against; defaults to <see cref="DateTimeOffset.Now"/>.</param>
    /// <param name="forceStaleAfterMs">Optional staleness window in milliseconds (web <c>forceStaleAfterMs</c>).</param>
    /// <param name="autoStart">Whether to begin the first stream immediately (defaults to true).</param>
    public RepositoryDataFreshnessSource(
        Func<CancellationToken, IAsyncEnumerable<RepositoryResult<T>>> stream,
        Func<DateTimeOffset>? clock = null,
        double? forceStaleAfterMs = null,
        bool autoStart = true)
    {
        ArgumentNullException.ThrowIfNull(stream);
        _stream = stream;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _forceStaleAfterMs = forceStaleAfterMs;

        if (autoStart)
        {
            Refresh();
        }
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public DataFreshnessSnapshot Current
    {
        get
        {
            lock (_gate)
            {
                return _current;
            }
        }
    }

    /// <inheritdoc />
    public bool CanRefresh => true;

    /// <inheritdoc />
    public void Refresh()
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
                    // A newer Refresh superseded this run; stop applying its emissions.
                    return;
                }

                Update(DataFreshnessSnapshot.FromRepositoryResult(result, _clock(), _forceStaleAfterMs));
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

    private void Update(DataFreshnessSnapshot snapshot)
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
