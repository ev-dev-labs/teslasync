using TeslaSync.App.Core.Live;

namespace TeslaSync.App.Core.Lifecycle;

/// <summary>
/// The headless coordinator that turns window foreground/background and connectivity changes into the
/// app's <see cref="AppLifecycleState"/> and fans the transitions out to registered
/// <see cref="ILifecycleListener"/>s (P2/W8-0002). It is the one place that sequences "pause live +
/// flush state" on suspend and "re-validate before resume" on return, so the cache, live and auth
/// tiers stay coordinated without each wiring its own window hooks.
///
/// <para><b>No duplicate streams / no stale-as-live.</b> The coordinator consumes the very same
/// <see cref="IForegroundLifecycle"/> instance the <see cref="SseClient"/> consumes, so a
/// foreground transition drives exactly one pause/resume in the live client — the coordinator never
/// opens a second stream. On <see cref="AppLifecycleState.Resuming"/> it notifies listeners to
/// re-validate; because a resumed-but-silent stream is reported <c>Stale</c> by the existing freshness
/// window, paused data is never presented as live until a fresh event arrives.</para>
///
/// <para>The type is UI-framework-free and fully unit-tested with fakes; the WinUI host
/// (<c>WindowsLifecycleHost</c>) only supplies the window/network adapters and installs the
/// process crash handlers that call <see cref="NotifyFatalError"/>.</para>
/// </summary>
public sealed class LifecycleCoordinator : IDisposable
{
    private readonly IForegroundLifecycle _foreground;
    private readonly INetworkAvailability _network;
    private readonly Func<DateTimeOffset> _clock;
    private readonly List<ILifecycleListener> _listeners = new();
    private readonly object _gate = new();

    private AppLifecycleState _state = AppLifecycleState.Launching;
    private bool _isOnline;
    private DateTimeOffset? _lastResumedAt;
    private bool _disposed;

    /// <summary>Creates the coordinator over the window foreground seam and the network seam.</summary>
    public LifecycleCoordinator(
        IForegroundLifecycle foreground,
        INetworkAvailability? network = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(foreground);
        _foreground = foreground;
        _network = network ?? AlwaysOnline.Instance;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _isOnline = _network.IsOnline;

        _foreground.ForegroundChanged += OnForegroundChanged;
        _network.AvailabilityChanged += OnNetworkChanged;
    }

    /// <summary>Raised on every committed lifecycle phase change with the new state.</summary>
    public event Action<AppLifecycleState>? StateChanged;

    /// <summary>The current lifecycle phase.</summary>
    public AppLifecycleState State
    {
        get
        {
            lock (_gate)
            {
                return _state;
            }
        }
    }

    /// <summary>The last observed connectivity.</summary>
    public bool IsOnline
    {
        get
        {
            lock (_gate)
            {
                return _isOnline;
            }
        }
    }

    /// <summary>The wall-clock time of the most recent foreground resume, or <see langword="null"/>.</summary>
    public DateTimeOffset? LastResumedAt
    {
        get
        {
            lock (_gate)
            {
                return _lastResumedAt;
            }
        }
    }

    /// <summary>Registers <paramref name="listener"/> for lifecycle/network/persist callbacks.</summary>
    public void AddListener(ILifecycleListener listener)
    {
        ArgumentNullException.ThrowIfNull(listener);
        lock (_gate)
        {
            if (!_listeners.Contains(listener))
            {
                _listeners.Add(listener);
            }
        }
    }

    /// <summary>Removes a previously-registered listener.</summary>
    public void RemoveListener(ILifecycleListener listener)
    {
        ArgumentNullException.ThrowIfNull(listener);
        lock (_gate)
        {
            _listeners.Remove(listener);
        }
    }

    /// <summary>Completes launch activation: moves <see cref="AppLifecycleState.Launching"/> to Running.</summary>
    public void MarkLaunched()
    {
        if (TrySetState(from: AppLifecycleState.Launching, to: AppLifecycleState.Running, out var previous))
        {
            RaiseStateChanged(previous, AppLifecycleState.Running);
        }
    }

    /// <summary>
    /// Requests an immediate crash-safe persist on every listener (e.g. shell window closing). Use
    /// <see cref="NotifyFatalError"/> for the unhandled-exception path.
    /// </summary>
    public void RequestShutdownPersist(LifecycleShutdownReason reason = LifecycleShutdownReason.WindowClosing) =>
        PersistForShutdown(reason);

    /// <summary>
    /// Persists all listeners for a fatal, process-ending error. Idempotent and exception-safe so it is
    /// safe to call from an unhandled-exception handler.
    /// </summary>
    public void NotifyFatalError() => PersistForShutdown(LifecycleShutdownReason.FatalError);

    private void OnForegroundChanged(bool foreground)
    {
        if (foreground)
        {
            Resume();
        }
        else
        {
            Suspend();
        }
    }

    private void Suspend()
    {
        if (!TrySetState(from: AppLifecycleState.Running, to: AppLifecycleState.Suspending, out _))
        {
            return;
        }

        RaiseStateChanged(AppLifecycleState.Running, AppLifecycleState.Suspending);

        // Flush + pause while transitioning to the background (the windowed "suspend").
        PersistForShutdown(LifecycleShutdownReason.Suspend);

        if (TrySetState(from: AppLifecycleState.Suspending, to: AppLifecycleState.Suspended, out _))
        {
            RaiseStateChanged(AppLifecycleState.Suspending, AppLifecycleState.Suspended);
        }
    }

    private void Resume()
    {
        bool transitioned;
        lock (_gate)
        {
            transitioned = _state is AppLifecycleState.Suspended or AppLifecycleState.Suspending;
            if (transitioned)
            {
                _state = AppLifecycleState.Resuming;
                _lastResumedAt = _clock();
            }
        }

        if (!transitioned)
        {
            return;
        }

        // Resuming first so listeners re-validate freshness (no stale-as-live) before going live again.
        RaiseStateChanged(AppLifecycleState.Suspended, AppLifecycleState.Resuming);

        if (TrySetState(from: AppLifecycleState.Resuming, to: AppLifecycleState.Running, out _))
        {
            RaiseStateChanged(AppLifecycleState.Resuming, AppLifecycleState.Running);
        }
    }

    private void OnNetworkChanged(bool isOnline)
    {
        lock (_gate)
        {
            if (_isOnline == isOnline)
            {
                return;
            }

            _isOnline = isOnline;
        }

        foreach (var listener in Snapshot())
        {
            SafeInvoke(() => listener.OnNetworkChanged(isOnline));
        }
    }

    private bool TrySetState(AppLifecycleState from, AppLifecycleState to, out AppLifecycleState previous)
    {
        lock (_gate)
        {
            previous = _state;
            if (_state != from)
            {
                return false;
            }

            _state = to;
            return true;
        }
    }

    private void RaiseStateChanged(AppLifecycleState previous, AppLifecycleState current)
    {
        foreach (var listener in Snapshot())
        {
            SafeInvoke(() => listener.OnLifecycleStateChanged(previous, current));
        }

        StateChanged?.Invoke(current);
    }

    private void PersistForShutdown(LifecycleShutdownReason reason)
    {
        foreach (var listener in Snapshot())
        {
            SafeInvoke(() => listener.PersistForShutdown(reason));
        }
    }

    private ILifecycleListener[] Snapshot()
    {
        lock (_gate)
        {
            return _listeners.ToArray();
        }
    }

    private static void SafeInvoke(Action action)
    {
        try
        {
            action();
        }
        catch (Exception)
        {
            // Listeners run on teardown/background paths; a participant failure must not cascade.
        }
    }

    /// <summary>Detaches the window/network event handlers.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _foreground.ForegroundChanged -= OnForegroundChanged;
        _network.AvailabilityChanged -= OnNetworkChanged;
    }
}
