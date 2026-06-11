using TeslaSync.App.Core.Live;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The live-connection seam the <c>LiveIndicator</c> surface binds through (P1/S8 state-holder layer) — the
/// native analogue of the web <c>useLiveConnection()</c> hook the web <c>&lt;LiveIndicator&gt;</c> consumes
/// (web/src/hooks/useLiveConnection.ts). It exposes the current <see cref="LiveIndicatorSnapshot"/> (the web
/// <c>{ status, lastMessageAt }</c> return) and raises <see cref="Changed"/> whenever the pipeline health moves,
/// so the bound <see cref="LiveIndicatorViewModel"/> re-projects without polling — exactly as the web hook
/// re-renders its consumers off the <c>sseManager</c> lifecycle. The view never opens a stream or performs I/O
/// itself; it observes this seam. The production binding is <see cref="MonitorLiveIndicatorSource"/> over the
/// Core <see cref="LiveConnectionMonitor"/>; <see cref="StaticLiveIndicatorSource"/> stands in for headless hosts,
/// previews and unit tests.
/// </summary>
public interface ILiveIndicatorSource
{
    /// <summary>The current live-pipeline read (web <c>useLiveConnection()</c> return).</summary>
    LiveIndicatorSnapshot Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="ILiveIndicatorSource"/> with an explicit, caller-set snapshot — the headless / preview / unit-test
/// default. It lets the projection and view-model be exercised for every connection state without a live stream or
/// a UI host. Call <see cref="Set"/> to move the snapshot, raising <see cref="Changed"/> (the web hook re-resolving
/// as the wire state changes).
/// </summary>
public sealed class StaticLiveIndicatorSource : ILiveIndicatorSource
{
    private LiveIndicatorSnapshot _current;

    /// <summary>Creates a source over an initial snapshot (defaults to <see cref="LiveIndicatorSnapshot.Unknown"/>).</summary>
    /// <param name="current">The initial live-pipeline read.</param>
    public StaticLiveIndicatorSource(LiveIndicatorSnapshot? current = null)
    {
        _current = current ?? LiveIndicatorSnapshot.Unknown;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public LiveIndicatorSnapshot Current => _current;

    /// <summary>Move the snapshot and raise <see cref="Changed"/> (the web hook re-resolving).</summary>
    /// <param name="snapshot">The new live-pipeline read.</param>
    public void Set(LiveIndicatorSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        _current = snapshot;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="ILiveIndicatorSource"/> — binds the indicator to the Core
/// <see cref="LiveConnectionMonitor"/>, the native analogue of the web <c>useLiveConnection()</c> subscribing to
/// the singleton <c>sseManager</c>. Each monitor <see cref="LiveConnectionMonitor.Changed"/> emission (raised when
/// the transport lifecycle moves or the freshness watchdog folds an open-but-silent stream to
/// <see cref="LiveConnection.Stale"/>) is projected to a <see cref="LiveIndicatorSnapshot"/> via
/// <see cref="LiveIndicatorSnapshot.FromConnection"/> and surfaced through <see cref="Current"/> /
/// <see cref="Changed"/>. The monitor raises on a background loop, so the snapshot is guarded by a lock; the view
/// marshals the <see cref="Changed"/> notification onto the UI thread. WinUI-free so it is unit-tested against an
/// in-memory monitor without a UI host. <see cref="Dispose"/> detaches from the monitor.
/// </summary>
public sealed class MonitorLiveIndicatorSource : ILiveIndicatorSource, IDisposable
{
    private readonly LiveConnectionMonitor _monitor;
    private readonly object _gate = new();
    private LiveIndicatorSnapshot _current;
    private bool _disposed;

    /// <summary>Creates the source over the Core live-connection monitor and seeds the current snapshot.</summary>
    /// <param name="monitor">The Core monitor the SSE subscription drives (web <c>sseManager</c>).</param>
    public MonitorLiveIndicatorSource(LiveConnectionMonitor monitor)
    {
        ArgumentNullException.ThrowIfNull(monitor);
        _monitor = monitor;
        _current = LiveIndicatorSnapshot.FromConnection(monitor.Snapshot());
        _monitor.Changed += OnMonitorChanged;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public LiveIndicatorSnapshot Current
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
        var next = LiveIndicatorSnapshot.FromConnection(snapshot);
        lock (_gate)
        {
            if (_current == next)
            {
                return;
            }

            _current = next;
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }
}
