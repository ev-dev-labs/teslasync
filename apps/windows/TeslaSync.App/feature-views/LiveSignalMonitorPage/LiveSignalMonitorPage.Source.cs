using TeslaSync.App.Core.Live;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The live-stream seam the <see cref="LiveSignalMonitorPageViewModel"/> binds to (P1/S4 SSE layer) — the
/// native analogue of the web page's only data source, the single SSE subscription the tail drives
/// (web/src/features/telemetry/hooks/useLiveSignalStream.ts → <c>useRealtimeEvents</c>). It surfaces the
/// connection lifecycle (web <c>live.connected</c>) and the batched <c>vehicle_update</c> firehose
/// (web <c>onVehicleUpdate</c>); the view subscribes on mount, marshals each event onto the UI thread and
/// feeds it to the view-model. The view never opens an <see cref="ISseClient"/> itself.
/// </summary>
public interface ILiveSignalMonitorFeed
{
    /// <summary>The current SSE connection state (web <c>live.connected</c>).</summary>
    bool Connected { get; }

    /// <summary>Raised when the SSE connection state flips (open ⇄ closed/reconnecting).</summary>
    event Action<bool>? ConnectionChanged;

    /// <summary>Raised for every batched <c>vehicle_update</c> payload (web <c>onVehicleUpdate</c>).</summary>
    event Action<VehicleUpdateSnapshot>? VehicleUpdated;
}

/// <summary>
/// The default no-backend feed the parameterless (shell-registered) <see cref="LiveSignalMonitorPage"/>
/// mounts against — the local-state default mirroring the sibling W7 pages' empty feeds. It never connects
/// and never emits, so the page renders its faithful initial state: a "Disconnected" badge over the
/// "Waiting for signals…" empty tail. The live-store-backed feed (<see cref="LiveStoreSignalMonitorFeed"/>)
/// is wired separately from the shared live layer (web's TanStack/SSE wiring); this feed keeps the page
/// mountable without a stream.
/// </summary>
public sealed class EmptyLiveSignalMonitorFeed : ILiveSignalMonitorFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyLiveSignalMonitorFeed Instance { get; } = new();

    private EmptyLiveSignalMonitorFeed()
    {
    }

    /// <inheritdoc />
    public bool Connected => false;

    /// <inheritdoc />
    public event Action<bool>? ConnectionChanged
    {
        add { }
        remove { }
    }

    /// <inheritdoc />
    public event Action<VehicleUpdateSnapshot>? VehicleUpdated
    {
        add { }
        remove { }
    }
}

/// <summary>
/// The live-store-backed <see cref="ILiveSignalMonitorFeed"/> — the native data adapter for the tail. It
/// binds the layered live-state primitives (ADR-004): the L1 <see cref="LiveSignalStore"/>'s batched
/// <c>vehicle_update</c> stream (web <c>onVehicleUpdate</c>) and an optional
/// <see cref="LiveConnectionMonitor"/> whose effective state is folded to the connected/disconnected badge
/// through <see cref="LiveConnectionMapping.IsLive"/> (an open-but-stale stream still reads as connected,
/// matching the web EventSource <c>readyState</c>). It never reconstructs history from the stream; charts
/// and replay remain W5 <c>signal_log</c> responsibilities. Detach with <see cref="Dispose"/>.
/// </summary>
public sealed class LiveStoreSignalMonitorFeed : ILiveSignalMonitorFeed, IDisposable
{
    private readonly LiveSignalStore _store;
    private readonly LiveConnectionMonitor? _connection;
    private bool _connected;
    private bool _disposed;

    /// <summary>Creates the feed over the L1 live store and an optional connection monitor.</summary>
    /// <param name="store">The L1 live signal store the SSE pump writes into.</param>
    /// <param name="connection">The connection monitor driving the badge; null leaves the badge disconnected.</param>
    public LiveStoreSignalMonitorFeed(LiveSignalStore store, LiveConnectionMonitor? connection = null)
    {
        ArgumentNullException.ThrowIfNull(store);

        _store = store;
        _connection = connection;
        _store.VehicleUpdated += OnVehicleUpdated;

        if (_connection is not null)
        {
            _connection.Changed += OnConnectionChanged;
            _connected = LiveConnectionMapping.IsLive(_connection.EffectiveState);
        }
    }

    /// <inheritdoc />
    public event Action<bool>? ConnectionChanged;

    /// <inheritdoc />
    public event Action<VehicleUpdateSnapshot>? VehicleUpdated;

    /// <inheritdoc />
    public bool Connected => _connected;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _store.VehicleUpdated -= OnVehicleUpdated;
        if (_connection is not null)
        {
            _connection.Changed -= OnConnectionChanged;
        }
    }

    private void OnVehicleUpdated(VehicleUpdateSnapshot snapshot) => VehicleUpdated?.Invoke(snapshot);

    private void OnConnectionChanged(LiveConnectionSnapshot snapshot)
    {
        bool live = LiveConnectionMapping.IsLive(snapshot.EffectiveState);
        if (live == _connected)
        {
            return;
        }

        _connected = live;
        ConnectionChanged?.Invoke(live);
    }
}
