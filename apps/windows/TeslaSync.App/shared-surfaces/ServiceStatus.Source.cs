using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Lifecycle;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The connection-state seam the <c>ServiceStatusBanner</c> binds through (P1/S8) — the native analogue of the
/// web resilience connection subscription the banner consumes via <c>getConnectionStatus()</c> /
/// <c>onStatusChange()</c> (web/src/lib/resilience.ts L51-70, used by ServiceStatus.tsx L8-14). It exposes the
/// current <see cref="ServiceStatusConnectionSnapshot"/> and raises <see cref="Changed"/> whenever the device
/// moves online/offline. The view never reads connectivity itself — it binds to this seam. The production binding
/// is <see cref="NetworkServiceStatusConnectionSource"/> over the P2-core <see cref="INetworkAvailability"/>
/// seam; <see cref="StaticServiceStatusConnectionSource"/> stands in for headless hosts and unit tests.
/// </summary>
public interface IServiceStatusConnectionSource
{
    /// <summary>The current connection snapshot (web <c>connStatus</c>).</summary>
    ServiceStatusConnectionSnapshot Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="IServiceStatusConnectionSource"/> with an explicit, caller-set snapshot — the headless /
/// unit-test default. <see cref="Set"/> moves the snapshot and raises <see cref="Changed"/> so the banner
/// projection and view-model can be exercised in both the online (collapsed) and offline (shown) states without
/// a connectivity host.
/// </summary>
public sealed class StaticServiceStatusConnectionSource : IServiceStatusConnectionSource
{
    private ServiceStatusConnectionSnapshot _current;

    /// <summary>Creates a source over an initial connection snapshot.</summary>
    /// <param name="current">The initial connection snapshot.</param>
    public StaticServiceStatusConnectionSource(ServiceStatusConnectionSnapshot current)
    {
        ArgumentNullException.ThrowIfNull(current);
        _current = current;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public ServiceStatusConnectionSnapshot Current => _current;

    /// <summary>Move the snapshot and raise <see cref="Changed"/> (the device going online/offline).</summary>
    /// <param name="snapshot">The new connection snapshot.</param>
    public void Set(ServiceStatusConnectionSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        _current = snapshot;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="IServiceStatusConnectionSource"/> — adapts the P2-core
/// <see cref="INetworkAvailability"/> lifecycle seam (the WinUI host's
/// <c>Windows.Networking.Connectivity</c> bridge) into the banner's connection snapshot, the native analogue of
/// the web <c>window 'online'/'offline'</c> listeners that drive <c>getConnectionStatus()</c>
/// (web/src/lib/resilience.ts L51-70). It subscribes once to
/// <see cref="INetworkAvailability.AvailabilityChanged"/> and re-publishes it as <see cref="Changed"/>; the
/// snapshot is derived live from <see cref="INetworkAvailability.IsOnline"/>. WinUI-free so it is unit-tested
/// against a controllable fake availability.
/// </summary>
public sealed class NetworkServiceStatusConnectionSource : IServiceStatusConnectionSource, IDisposable
{
    private readonly INetworkAvailability _availability;
    private bool _disposed;

    /// <summary>Creates the source over the network-availability seam.</summary>
    /// <param name="availability">The P2-core connectivity seam (web online/offline listeners).</param>
    public NetworkServiceStatusConnectionSource(INetworkAvailability availability)
    {
        ArgumentNullException.ThrowIfNull(availability);
        _availability = availability;
        _availability.AvailabilityChanged += OnAvailabilityChanged;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public ServiceStatusConnectionSnapshot Current =>
        _availability.IsOnline ? ServiceStatusConnectionSnapshot.Online : ServiceStatusConnectionSnapshot.Offline;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _availability.AvailabilityChanged -= OnAvailabilityChanged;
        GC.SuppressFinalize(this);
    }

    private void OnAvailabilityChanged(bool online) => Changed?.Invoke(this, EventArgs.Empty);
}

/// <summary>
/// The system-health seam the <c>SystemHealthDot</c> binds through (P1/S8) — the native analogue of the TanStack
/// Query result the web <c>SystemHealthDot</c> consumes (web/src/components/data-display/ServiceStatus.tsx
/// L45-52, <c>useQuery(['system-status'], fetchSystemStatus, refetchInterval: 60s)</c>). It exposes the current
/// <see cref="ServiceStatusHealthSnapshot"/>, raises <see cref="Changed"/> whenever it moves, and offers a
/// <see cref="Refresh"/> trigger (web <c>query.refetch()</c> / the 60-second poll). The view never reads a query
/// or performs HTTP itself. The production binding is <see cref="RepositoryServiceStatusHealthSource"/> over a
/// cache-then-network stream; <see cref="StaticServiceStatusHealthSource"/> stands in for headless hosts and
/// unit tests.
/// </summary>
public interface IServiceStatusHealthSource
{
    /// <summary>The current system-health snapshot (web query <c>data</c>).</summary>
    ServiceStatusHealthSnapshot Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;

    /// <summary>Trigger a manual refresh (web <c>query.refetch()</c> / the 60-second poll tick).</summary>
    void Refresh();
}

/// <summary>
/// An <see cref="IServiceStatusHealthSource"/> with an explicit, caller-set snapshot and a counted
/// <see cref="Refresh"/> — the headless / unit-test default. It lets the dot projection and view-model be
/// exercised for every health state (unknown / healthy / degraded / unhealthy) and the refresh forwarding
/// without a repository or a UI host.
/// </summary>
public sealed class StaticServiceStatusHealthSource : IServiceStatusHealthSource
{
    private ServiceStatusHealthSnapshot _current;

    /// <summary>Creates a source over an initial health snapshot.</summary>
    /// <param name="current">The initial health snapshot.</param>
    public StaticServiceStatusHealthSource(ServiceStatusHealthSnapshot current)
    {
        ArgumentNullException.ThrowIfNull(current);
        _current = current;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public ServiceStatusHealthSnapshot Current => _current;

    /// <summary>The number of times <see cref="Refresh"/> has been invoked (for refresh-forwarding assertions).</summary>
    public int RefreshCount { get; private set; }

    /// <summary>Move the snapshot and raise <see cref="Changed"/> (the web query result re-resolving).</summary>
    /// <param name="snapshot">The new health snapshot.</param>
    public void Set(ServiceStatusHealthSnapshot snapshot)
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
/// The production <see cref="IServiceStatusHealthSource"/> — binds the dot to a cache-then-network repository
/// stream, the native analogue of the web <c>useQuery(['system-status'], fetchSystemStatus)</c> wiring
/// (web/src/components/data-display/ServiceStatus.tsx L45-52). The composition root supplies a stream factory
/// (e.g. <c>ct =&gt; systemRepository.StreamStatusAsync(ct)</c>); each <see cref="RepositoryResult{T}"/> emission
/// is projected to a <see cref="ServiceStatusHealthSnapshot"/> via
/// <see cref="ServiceStatusHealthSnapshot.FromRepositoryResult"/> and surfaced through <see cref="Current"/> /
/// <see cref="Changed"/>. <see cref="Refresh"/> re-runs the stream (the 60-second poll); a monotonic generation
/// guard discards emissions from a superseded run so the latest refresh wins. WinUI-free so it is unit-tested
/// against an in-memory stream without a UI host.
/// </summary>
public sealed class RepositoryServiceStatusHealthSource : IServiceStatusHealthSource, IDisposable
{
    private readonly Func<CancellationToken, IAsyncEnumerable<RepositoryResult<ServiceStatusReadModel>>> _stream;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _gate = new();
    private ServiceStatusHealthSnapshot _current = ServiceStatusHealthSnapshot.None;
    private int _generation;
    private bool _disposed;

    /// <summary>Creates the source over a repository stream factory.</summary>
    /// <param name="stream">
    /// The cache-then-network stream factory (web query function), e.g.
    /// <c>ct =&gt; systemRepository.StreamStatusAsync(ct)</c>.
    /// </param>
    /// <param name="autoStart">Whether to begin the first stream immediately (defaults to true).</param>
    public RepositoryServiceStatusHealthSource(
        Func<CancellationToken, IAsyncEnumerable<RepositoryResult<ServiceStatusReadModel>>> stream,
        bool autoStart = true)
    {
        ArgumentNullException.ThrowIfNull(stream);
        _stream = stream;

        if (autoStart)
        {
            Refresh();
        }
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public ServiceStatusHealthSnapshot Current
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

                Update(ServiceStatusHealthSnapshot.FromRepositoryResult(result));
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

    private void Update(ServiceStatusHealthSnapshot snapshot)
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
