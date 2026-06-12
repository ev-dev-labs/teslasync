using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Maps;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The map-config seam the <c>MapTileLayer</c> view-model binds through (P1/S8) — the native analogue of the
/// TanStack Query result the web <c>MapTileLayer</c> consumes (web/src/components/maps/MapTileLayer.tsx L54-69,
/// <c>useQuery(['map-config'], getMapConfig, staleTime: 5m)</c>). It exposes the current
/// <see cref="MapTileLayerSnapshot"/>, raises <see cref="Changed"/> whenever it moves, and offers a
/// <see cref="Refresh"/> trigger (web <c>query.refetch()</c>). The view never reads a query or performs HTTP
/// itself. The production binding is <see cref="RepositoryMapTileLayerSource"/> over a cache-then-network stream;
/// <see cref="StaticMapTileLayerSource"/> stands in for headless hosts and unit tests.
/// </summary>
public interface IMapTileLayerSource
{
    /// <summary>The current snapshot (web query <c>data</c> projected onto the active style).</summary>
    MapTileLayerSnapshot Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;

    /// <summary>Trigger a manual refresh of the map configuration (web <c>query.refetch()</c>).</summary>
    void Refresh();
}

/// <summary>
/// An <see cref="IMapTileLayerSource"/> with an explicit, caller-set snapshot and a counted <see cref="Refresh"/>
/// — the headless / unit-test default. It lets the projection and view-model be exercised for every state
/// (loading / ready / empty / error / stale / offline) and the refresh forwarding without a repository or a UI
/// host.
/// </summary>
public sealed class StaticMapTileLayerSource : IMapTileLayerSource
{
    private MapTileLayerSnapshot _current;

    /// <summary>Creates a source over an initial snapshot.</summary>
    /// <param name="current">The initial snapshot.</param>
    public StaticMapTileLayerSource(MapTileLayerSnapshot current)
    {
        ArgumentNullException.ThrowIfNull(current);
        _current = current;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public MapTileLayerSnapshot Current => _current;

    /// <summary>The number of times <see cref="Refresh"/> has been invoked (for refresh-forwarding assertions).</summary>
    public int RefreshCount { get; private set; }

    /// <summary>Move the snapshot and raise <see cref="Changed"/> (the web query result re-resolving).</summary>
    /// <param name="snapshot">The new snapshot.</param>
    public void Set(MapTileLayerSnapshot snapshot)
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
/// The production <see cref="IMapTileLayerSource"/> — binds the surface to a cache-then-network repository stream
/// of <see cref="MapConfig"/>, the native analogue of the web <c>useQuery(['map-config'], getMapConfig)</c> wiring
/// (web/src/components/maps/MapTileLayer.tsx L54-69). The composition root supplies a stream factory (e.g.
/// <c>ct =&gt; settingsRepository.StreamMapConfigAsync(ct)</c>); each <see cref="RepositoryResult{T}"/> emission is
/// projected to a <see cref="MapTileLayerSnapshot"/> for the active <see cref="MapStyleKind"/> via
/// <see cref="MapTileLayerSnapshot.FromRepositoryResult"/> and surfaced through <see cref="Current"/> /
/// <see cref="Changed"/>. <see cref="SetStyle"/> re-projects the last emission onto a new base-map style (the web
/// <c>style</c> prop changing) without re-fetching; <see cref="Refresh"/> re-runs the stream. A monotonic
/// generation guard discards emissions from a superseded run so the latest refresh wins. WinUI-free so it is
/// unit-tested against an in-memory stream without a UI host.
/// </summary>
public sealed class RepositoryMapTileLayerSource : IMapTileLayerSource, IDisposable
{
    private readonly Func<CancellationToken, IAsyncEnumerable<RepositoryResult<MapConfig>>> _stream;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _gate = new();
    private RepositoryResult<MapConfig> _lastResult = RepositoryResult<MapConfig>.Loading();
    private MapStyleKind _style;
    private int _generation;
    private bool _disposed;

    /// <summary>Creates the source over a repository stream factory and the initial base-map style.</summary>
    /// <param name="stream">
    /// The cache-then-network stream factory (web query function), e.g.
    /// <c>ct =&gt; settingsRepository.StreamMapConfigAsync(ct)</c>.
    /// </param>
    /// <param name="style">The initial base-map style (the web <c>style</c> prop; defaults to dark).</param>
    /// <param name="autoStart">Whether to begin the first stream immediately (defaults to true).</param>
    public RepositoryMapTileLayerSource(
        Func<CancellationToken, IAsyncEnumerable<RepositoryResult<MapConfig>>> stream,
        MapStyleKind style = MapStyleKind.Dark,
        bool autoStart = true)
    {
        ArgumentNullException.ThrowIfNull(stream);
        _stream = stream;
        _style = style;

        if (autoStart)
        {
            Refresh();
        }
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public MapTileLayerSnapshot Current
    {
        get
        {
            lock (_gate)
            {
                return MapTileLayerSnapshot.FromRepositoryResult(_lastResult, _style);
            }
        }
    }

    /// <summary>The active base-map style (the web <c>style</c> prop).</summary>
    public MapStyleKind Style
    {
        get
        {
            lock (_gate)
            {
                return _style;
            }
        }
    }

    /// <summary>Re-project the last emission onto a new base-map style (the web <c>style</c> prop changing).</summary>
    /// <param name="style">The new base-map style.</param>
    public void SetStyle(MapStyleKind style)
    {
        lock (_gate)
        {
            if (_style == style)
            {
                return;
            }

            _style = style;
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }

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

                Update(result);
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

    private void Update(RepositoryResult<MapConfig> result)
    {
        lock (_gate)
        {
            if (_lastResult == result)
            {
                return;
            }

            _lastResult = result;
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }
}
