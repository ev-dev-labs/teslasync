namespace TeslaSync.App.SharedSurfaces.SuspenseProgressBoundarySurface;

/// <summary>
/// A global-progress listener — the native analogue of the web <c>GlobalProgressListener</c> callback
/// (<c>web/src/lib/globalProgress.ts</c>): invoked with the current busy flag and trickle value every time the
/// controller publishes (a consumer started/stopped, or the trickle advanced).
/// </summary>
/// <param name="active">Whether at least one consumer is active (web <c>activeCount &gt; 0</c>).</param>
/// <param name="progress">The current trickle value, 0 → <see cref="GlobalProgress.TrickleTarget"/>.</param>
public delegate void GlobalProgressListener(bool active, double progress);

/// <summary>
/// The global "is the app busy?" channel (P1/S8 state-holder layer) — the native port of the web
/// <c>globalProgress</c> module's public surface (<c>web/src/lib/globalProgress.ts</c>): <c>start</c> and
/// <c>subscribe</c>. It is the single shared channel a Suspense boundary (the
/// <see cref="SuspenseProgressBoundaryViewModel"/>) and any opt-in heavy mutation fire on; a top-of-window
/// progress bar subscribes to render it. The canonical implementation is <see cref="GlobalProgress"/>;
/// <see cref="NoOpGlobalProgress"/> stands in for isolated hosts. The view never touches this seam directly —
/// it binds through the view-model.
/// </summary>
public interface IGlobalProgress
{
    /// <summary>
    /// Register a consumer (web <c>start</c>). Returns the paired stop handle; dispose it (the web returned
    /// <c>stop()</c> function / effect cleanup) to release the consumer. The handle is idempotent.
    /// </summary>
    IDisposable Start();

    /// <summary>
    /// Subscribe to busy/progress changes (web <c>subscribe</c>); the current state is replayed immediately so
    /// a listener mounted while the bar is already active does not miss the active edge. Dispose the returned
    /// handle to unsubscribe.
    /// </summary>
    IDisposable Subscribe(GlobalProgressListener listener);
}

/// <summary>
/// The periodic trickle driver for <see cref="GlobalProgress"/> — the native analogue of the web
/// <c>setInterval</c> trickle loop (<c>startTrickle</c> / <c>stopTrickle</c> in
/// <c>web/src/lib/globalProgress.ts</c>). Abstracted behind an interface so the controller's asymptotic
/// advancement is unit-testable deterministically (a test pumps ticks) without a wall-clock timer.
/// </summary>
public interface IGlobalProgressTicker
{
    /// <summary>Begin invoking <paramref name="onTick"/> on the trickle interval (web <c>setInterval</c>).</summary>
    void Start(Action onTick);

    /// <summary>Stop invoking the tick callback (web <c>clearInterval</c>); safe to call when already stopped.</summary>
    void StopTicking();
}

/// <summary>
/// The canonical global progress controller — the native port of the web <c>globalProgress</c> singleton
/// (<c>web/src/lib/globalProgress.ts</c>). Like the web module it: jumps to <see cref="TrickleInitial"/> on the
/// first <see cref="Start"/>, advances <c>progress</c> asymptotically toward <see cref="TrickleTarget"/> on each
/// trickle tick (<c>progress + max(1, remaining * 0.15)</c>, never crossing the target), stacks concurrent
/// consumers (the bar stays active until the last stop), snaps <c>progress</c> + active back to 0/false when
/// the last consumer stops, and replays the current state to every new subscriber. The returned stop handle is
/// idempotent so a double-release (a host's defensive cleanup, the web StrictMode double-invoke) cannot drive
/// the consumer count below zero. Unlike the single-threaded web module the consumer count, trickle value and
/// listener set are guarded by a lock and listeners are invoked outside it, because a consumer can start/stop
/// off the UI thread; a throwing listener is swallowed so it can never break the controller or stall the timer
/// (the web publish loop swallows listener errors for the same reason).
/// </summary>
public sealed class GlobalProgress : IGlobalProgress, IDisposable
{
    /// <summary>Asymptotic ceiling the trickle approaches but never reaches without an explicit stop (web <c>TRICKLE_TARGET</c>).</summary>
    public const double TrickleTarget = 80d;

    /// <summary>Initial jump on the first <see cref="Start"/> so the bar is immediately visible (web <c>TRICKLE_INITIAL</c>).</summary>
    public const double TrickleInitial = 8d;

    /// <summary>Tick interval, in milliseconds, driving the asymptotic trickle (web <c>TRICKLE_INTERVAL_MS</c>).</summary>
    public const int TrickleIntervalMs = 120;

    // web: progress + Math.max(1, remaining * 0.15) — move 15% of the remaining gap each tick, but at least 1,
    // so the bar always advances yet never crosses the target.
    private const double TrickleStepFraction = 0.15d;
    private const double TrickleMinStep = 1d;

    private readonly object _gate = new();
    private readonly HashSet<GlobalProgressListener> _listeners = new();
    private readonly IGlobalProgressTicker _ticker;
    private int _activeCount;
    private double _progress;
    private bool _ticking;
    private bool _disposed;

    /// <summary>
    /// Creates a controller over an explicit trickle ticker (tests inject a deterministic one); defaults to a
    /// real <see cref="TimerGlobalProgressTicker"/> on the <see cref="TrickleIntervalMs"/> interval.
    /// </summary>
    public GlobalProgress(IGlobalProgressTicker? ticker = null) =>
        _ticker = ticker ?? new TimerGlobalProgressTicker(TrickleIntervalMs);

    /// <summary>
    /// The process-wide controller — the native analogue of the web module-level singleton, so every Suspense
    /// boundary and heavy mutation shares one busy channel and the bar reflects the union of all consumers.
    /// </summary>
    public static GlobalProgress Shared { get; } = new();

    /// <summary>The live consumer count (web <c>activeCount</c>).</summary>
    public int ActiveCount
    {
        get
        {
            lock (_gate)
            {
                return _activeCount;
            }
        }
    }

    /// <summary>The current trickle value, 0 → <see cref="TrickleTarget"/> (web <c>progress</c>).</summary>
    public double Progress
    {
        get
        {
            lock (_gate)
            {
                return _progress;
            }
        }
    }

    /// <summary>Whether at least one consumer is active (web <c>activeCount &gt; 0</c>).</summary>
    public bool IsActive
    {
        get
        {
            lock (_gate)
            {
                return _activeCount > 0;
            }
        }
    }

    /// <inheritdoc />
    public IDisposable Start()
    {
        GlobalProgressListener[] snapshot;
        bool active;
        double progress;
        lock (_gate)
        {
            // web: activeCount++; if (activeCount === 1) { progress = TRICKLE_INITIAL; startTrickle(); }
            _activeCount++;
            if (_activeCount == 1)
            {
                _progress = TrickleInitial;
                _ticker.Start(OnTick);
                _ticking = true;
            }

            active = _activeCount > 0;
            progress = _progress;
            snapshot = SnapshotListenersLocked();
        }

        // web start() calls publish() on every start, not only the first.
        Publish(snapshot, active, progress);
        return new Stopper(this);
    }

    /// <inheritdoc />
    public IDisposable Subscribe(GlobalProgressListener listener)
    {
        ArgumentNullException.ThrowIfNull(listener);

        bool active;
        double progress;
        lock (_gate)
        {
            _listeners.Add(listener);
            active = _activeCount > 0;
            progress = _progress;
        }

        // web subscribe replays the current state immediately so a listener mounted while the bar is already
        // active doesn't miss the active edge.
        Invoke(listener, active, progress);
        return new Subscription(this, listener);
    }

    /// <summary>An immutable snapshot of the controller state (web <c>__getGlobalProgressStateForTests</c>).</summary>
    public GlobalProgressSnapshot Snapshot()
    {
        lock (_gate)
        {
            return new GlobalProgressSnapshot(_activeCount, _progress, _listeners.Count, _ticking);
        }
    }

    /// <summary>Stop the trickle timer and release the ticker; idempotent.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        lock (_gate)
        {
            StopTickerLocked();
        }

        (_ticker as IDisposable)?.Dispose();
    }

    private void OnTick()
    {
        GlobalProgressListener[] snapshot;
        double progress;
        lock (_gate)
        {
            // web trickle callback: if (activeCount === 0) { stopTrickle(); return; }
            if (_activeCount == 0)
            {
                StopTickerLocked();
                return;
            }

            // web: if (progress >= TRICKLE_TARGET) return;
            if (_progress >= TrickleTarget)
            {
                return;
            }

            double remaining = TrickleTarget - _progress;
            _progress = Math.Min(TrickleTarget, _progress + Math.Max(TrickleMinStep, remaining * TrickleStepFraction));
            progress = _progress;
            snapshot = SnapshotListenersLocked();
        }

        Publish(snapshot, active: true, progress);
    }

    private void Stop()
    {
        GlobalProgressListener[] snapshot;
        bool publish = false;
        lock (_gate)
        {
            // web stop: activeCount = Math.max(0, activeCount - 1); if (activeCount === 0) { stopTrickle();
            // progress = 0; publish(); } — a non-last stop changes nothing observable, so it does not publish.
            _activeCount = Math.Max(0, _activeCount - 1);
            if (_activeCount == 0)
            {
                StopTickerLocked();
                _progress = 0d;
                snapshot = SnapshotListenersLocked();
                publish = true;
            }
            else
            {
                snapshot = Array.Empty<GlobalProgressListener>();
            }
        }

        if (publish)
        {
            Publish(snapshot, active: false, progress: 0d);
        }
    }

    private void Unsubscribe(GlobalProgressListener listener)
    {
        lock (_gate)
        {
            _listeners.Remove(listener);
        }
    }

    private void StopTickerLocked()
    {
        if (_ticking)
        {
            _ticker.StopTicking();
            _ticking = false;
        }
    }

    private GlobalProgressListener[] SnapshotListenersLocked()
    {
        if (_listeners.Count == 0)
        {
            return Array.Empty<GlobalProgressListener>();
        }

        var snapshot = new GlobalProgressListener[_listeners.Count];
        _listeners.CopyTo(snapshot);
        return snapshot;
    }

    private static void Publish(GlobalProgressListener[] listeners, bool active, double progress)
    {
        foreach (GlobalProgressListener listener in listeners)
        {
            Invoke(listener, active, progress);
        }
    }

    private static void Invoke(GlobalProgressListener listener, bool active, double progress)
    {
        try
        {
            listener(active, progress);
        }
        catch (Exception)
        {
            // A listener throwing must never break the controller or stall the trickle timer; the web
            // globalProgress publish loop swallows listener errors for the same reason.
        }
    }

    private sealed class Stopper(GlobalProgress owner) : IDisposable
    {
        private bool _stopped;

        public void Dispose()
        {
            // Closure-local guard mirroring the web stop()'s `stopped` flag: a double-release cannot drive the
            // consumer count below zero.
            if (_stopped)
            {
                return;
            }

            _stopped = true;
            owner.Stop();
        }
    }

    private sealed class Subscription(GlobalProgress owner, GlobalProgressListener listener) : IDisposable
    {
        private bool _disposed;

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            owner.Unsubscribe(listener);
        }
    }
}

/// <summary>
/// The real trickle ticker — the native analogue of the web <c>setInterval</c> backing the trickle loop
/// (<c>web/src/lib/globalProgress.ts</c>). Wraps a <see cref="System.Threading.Timer"/> on the configured
/// interval; the timer callback fires on a thread-pool thread, which the controller already guards for.
/// <see cref="Start"/> after <see cref="Stop"/> re-arms the same timer, and disposing releases it.
/// </summary>
public sealed class TimerGlobalProgressTicker : IGlobalProgressTicker, IDisposable
{
    private readonly object _gate = new();
    private readonly int _intervalMs;
    private Timer? _timer;
    private Action? _onTick;
    private bool _disposed;

    /// <summary>Creates a ticker firing on a <paramref name="intervalMs"/>-millisecond period.</summary>
    public TimerGlobalProgressTicker(int intervalMs)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(intervalMs);
        _intervalMs = intervalMs;
    }

    /// <inheritdoc />
    public void Start(Action onTick)
    {
        ArgumentNullException.ThrowIfNull(onTick);
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _onTick = onTick;
            _timer ??= new Timer(_ => _onTick?.Invoke(), state: null, Timeout.Infinite, Timeout.Infinite);
            _timer.Change(_intervalMs, _intervalMs);
        }
    }

    /// <inheritdoc />
    public void StopTicking()
    {
        lock (_gate)
        {
            _timer?.Change(Timeout.Infinite, Timeout.Infinite);
        }
    }

    /// <summary>Release the underlying timer; idempotent.</summary>
    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _timer?.Dispose();
            _timer = null;
            _onTick = null;
        }
    }
}

/// <summary>
/// The inert progress channel used by isolated hosts — the native robustness analogue of
/// <see cref="NoOpGlobalProgress"/>'s announcer sibling (<c>NoOpAnnouncer</c> in the VisuallyHidden surface).
/// <see cref="Start"/> returns an already-inert handle and <see cref="Subscribe"/> replays the permanently
/// idle state, so a host that binds the channel with no shared controller degrades gracefully instead of
/// driving a real bar.
/// </summary>
public sealed class NoOpGlobalProgress : IGlobalProgress
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpGlobalProgress Instance { get; } = new();

    private NoOpGlobalProgress()
    {
    }

    /// <inheritdoc />
    public IDisposable Start() => NoOpDisposable.Instance;

    /// <inheritdoc />
    public IDisposable Subscribe(GlobalProgressListener listener)
    {
        ArgumentNullException.ThrowIfNull(listener);

        // Replay the permanently idle state, matching the canonical controller's immediate replay contract.
        listener(false, 0d);
        return NoOpDisposable.Instance;
    }

    private sealed class NoOpDisposable : IDisposable
    {
        public static NoOpDisposable Instance { get; } = new();

        private NoOpDisposable()
        {
        }

        public void Dispose()
        {
            // Nothing was started or subscribed.
        }
    }
}
