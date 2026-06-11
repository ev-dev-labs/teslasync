using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Live;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The live-connection seam the <c>LiveStaleDataBanner</c> surface binds through (P1/S8 state-holder layer) — the
/// native analogue of the web <c>useLiveConnection()</c> hook the web <c>&lt;LiveStaleDataBanner&gt;</c> consumes
/// (web/src/hooks/useLiveConnection.ts). The web banner only reads the coarse <c>status</c>, so this seam exposes
/// just the current <see cref="LiveConnectionState"/> and raises <see cref="Changed"/> whenever the pipeline health
/// moves, letting the bound <see cref="LiveStaleDataBannerViewModel"/> re-evaluate the threshold without polling.
/// The view never opens a stream or performs I/O itself; it observes this seam. The production binding is
/// <see cref="MonitorLiveStaleDataBannerSource"/> over the Core <see cref="LiveConnectionMonitor"/>;
/// <see cref="StaticLiveStaleDataBannerSource"/> stands in for headless hosts, previews and unit tests.
/// </summary>
public interface ILiveStaleDataBannerSource
{
    /// <summary>The current coarse live-pipeline health (web <c>useLiveConnection().status</c>).</summary>
    LiveConnectionState Status { get; }

    /// <summary>Raised whenever <see cref="Status"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="ILiveStaleDataBannerSource"/> with an explicit, caller-set status — the headless / preview /
/// unit-test default. It lets the evaluator and view-model be exercised for every connection state (and the
/// disconnect → reconnect transitions that arm and clear the banner) without a live stream or a UI host.
/// <see cref="Set"/> moves the status, raising <see cref="Changed"/> (the web hook re-resolving as the wire moves).
/// </summary>
public sealed class StaticLiveStaleDataBannerSource : ILiveStaleDataBannerSource
{
    private LiveConnectionState _status;

    /// <summary>Creates a source over an initial status (defaults to <see cref="LiveConnectionState.Unknown"/>, the brand-new-load state).</summary>
    /// <param name="status">The initial coarse live-pipeline health.</param>
    public StaticLiveStaleDataBannerSource(LiveConnectionState status = LiveConnectionState.Unknown) => _status = status;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public LiveConnectionState Status => _status;

    /// <summary>Move the status and raise <see cref="Changed"/> (the web hook re-resolving).</summary>
    /// <param name="status">The new coarse live-pipeline health.</param>
    public void Set(LiveConnectionState status)
    {
        _status = status;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="ILiveStaleDataBannerSource"/> — binds the banner to the Core
/// <see cref="LiveConnectionMonitor"/>, the native analogue of the web <c>useLiveConnection()</c> subscribing to the
/// singleton <c>sseManager</c>. Each monitor <see cref="LiveConnectionMonitor.Changed"/> emission (raised when the
/// transport lifecycle moves or the freshness watchdog folds an open-but-silent stream to
/// <see cref="LiveConnection.Stale"/>) has its <see cref="LiveConnectionSnapshot.EffectiveState"/> mapped to the
/// coarse UI-facing <see cref="LiveConnectionState"/> via the shared <see cref="LiveConnectionMapping.ToIndicatorState"/>
/// — exactly the projection the companion <c>LiveIndicator</c> uses, so the banner's notion of "disconnected"
/// matches the pill. The monitor raises on a background loop, so the status is guarded by a lock; the view marshals
/// the <see cref="Changed"/> notification onto the UI thread. WinUI-free so it is unit-tested against an in-memory
/// monitor without a UI host. <see cref="Dispose"/> detaches from the monitor.
/// </summary>
public sealed class MonitorLiveStaleDataBannerSource : ILiveStaleDataBannerSource, IDisposable
{
    private readonly LiveConnectionMonitor _monitor;
    private readonly object _gate = new();
    private LiveConnectionState _status;
    private bool _disposed;

    /// <summary>Creates the source over the Core live-connection monitor and seeds the current status.</summary>
    /// <param name="monitor">The Core monitor the SSE subscription drives (web <c>sseManager</c>).</param>
    public MonitorLiveStaleDataBannerSource(LiveConnectionMonitor monitor)
    {
        ArgumentNullException.ThrowIfNull(monitor);
        _monitor = monitor;
        _status = LiveConnectionMapping.ToIndicatorState(monitor.Snapshot().EffectiveState);
        _monitor.Changed += OnMonitorChanged;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public LiveConnectionState Status
    {
        get
        {
            lock (_gate)
            {
                return _status;
            }
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _monitor.Changed -= OnMonitorChanged;
        GC.SuppressFinalize(this);
    }

    private void OnMonitorChanged(LiveConnectionSnapshot snapshot)
    {
        var next = LiveConnectionMapping.ToIndicatorState(snapshot.EffectiveState);
        lock (_gate)
        {
            if (_status == next)
            {
                return;
            }

            _status = next;
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }
}
