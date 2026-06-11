using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The source-layer state-holder seam the <c>SourceLayerBadge</c> surface binds through (P1/S8) — the native
/// analogue of the <c>source</c> / <c>ageMs</c> props the web component receives
/// (web/src/components/data-display/SourceLayerBadge.tsx). It exposes the current
/// <see cref="SourceLayerBadgeSnapshot"/> (the layered live-state origin of a signal value) and raises
/// <see cref="Changed"/> whenever that origin moves. The view never reads a query or performs HTTP itself — it
/// binds to this seam, exactly as the web component takes its inputs as props. The production binding is
/// <see cref="RepositorySourceLayerBadgeSource{T}"/> over a cache-then-network repository stream;
/// <see cref="StaticSourceLayerBadgeSource"/> stands in for headless hosts and unit tests.
/// </summary>
public interface ISourceLayerBadgeSource
{
    /// <summary>The current badge sample (the value's source layer + optional age), or <see cref="SourceLayerBadgeSnapshot.Empty"/>.</summary>
    SourceLayerBadgeSnapshot Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="ISourceLayerBadgeSource"/> with an explicit, caller-set sample — the headless / unit-test
/// default. It lets the projection and view-model be exercised for every layer (L1, L2, LOG, STALE, unknown) and
/// age without a repository or a UI host. Call <see cref="Set"/> to move the sample (raising <see cref="Changed"/>).
/// </summary>
public sealed class StaticSourceLayerBadgeSource : ISourceLayerBadgeSource
{
    private SourceLayerBadgeSnapshot _current;

    /// <summary>Creates a source over an initial sample.</summary>
    /// <param name="current">The initial badge sample.</param>
    public StaticSourceLayerBadgeSource(SourceLayerBadgeSnapshot current)
    {
        ArgumentNullException.ThrowIfNull(current);
        _current = current;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public SourceLayerBadgeSnapshot Current => _current;

    /// <summary>Move the sample and raise <see cref="Changed"/> (the value's source layer changing).</summary>
    /// <param name="snapshot">The new badge sample.</param>
    public void Set(SourceLayerBadgeSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        _current = snapshot;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="ISourceLayerBadgeSource"/> — binds the badge to a cache-then-network repository
/// stream, the native wiring for "where did this signal value come from". The composition root supplies a stream
/// factory (e.g. <c>ct =&gt; signalRepository.WatchValueAsync(vehicleId, signalName, ct)</c>), a selector that
/// pulls the source-layer string out of each value (e.g. <c>v =&gt; v.SourceLayer</c>) and an optional age
/// selector (e.g. <c>v =&gt; v.AgeMs</c>); each <see cref="RepositoryResult{T}"/> emission is projected to a
/// <see cref="SourceLayerBadgeSnapshot"/> via <see cref="SourceLayerBadgeSnapshot.FromRepositoryResult{T}"/> and
/// surfaced through <see cref="Current"/> / <see cref="Changed"/>. A monotonic generation guard discards
/// emissions from a superseded run. The whole class is WinUI-free so it is unit-tested against an in-memory
/// stream without a UI host.
/// </summary>
/// <typeparam name="T">The repository's domain read-model type whose value carries the source metadata.</typeparam>
public sealed class RepositorySourceLayerBadgeSource<T> : ISourceLayerBadgeSource, IDisposable
{
    private readonly Func<CancellationToken, IAsyncEnumerable<RepositoryResult<T>>> _stream;
    private readonly Func<T, string?> _selectSource;
    private readonly Func<T, double?>? _selectAgeMs;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _gate = new();
    private SourceLayerBadgeSnapshot _current = SourceLayerBadgeSnapshot.Empty;
    private int _generation;
    private bool _disposed;

    /// <summary>Creates the source over a repository stream factory, a source-layer selector and an optional age selector.</summary>
    /// <param name="stream">
    /// The cache-then-network stream factory (web query function), e.g.
    /// <c>ct =&gt; signalRepository.WatchValueAsync(vehicleId, signalName, ct)</c>.
    /// </param>
    /// <param name="selectSource">Selector that pulls the wire source-layer string out of the latest value.</param>
    /// <param name="selectAgeMs">Optional selector that pulls the value age (ms) out of the latest value.</param>
    /// <param name="autoStart">Whether to begin the first stream immediately (defaults to true).</param>
    public RepositorySourceLayerBadgeSource(
        Func<CancellationToken, IAsyncEnumerable<RepositoryResult<T>>> stream,
        Func<T, string?> selectSource,
        Func<T, double?>? selectAgeMs = null,
        bool autoStart = true)
    {
        ArgumentNullException.ThrowIfNull(stream);
        ArgumentNullException.ThrowIfNull(selectSource);
        _stream = stream;
        _selectSource = selectSource;
        _selectAgeMs = selectAgeMs;

        if (autoStart)
        {
            Start();
        }
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public SourceLayerBadgeSnapshot Current
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

                Update(SourceLayerBadgeSnapshot.FromRepositoryResult(result, _selectSource, _selectAgeMs));
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

    private void Update(SourceLayerBadgeSnapshot snapshot)
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
