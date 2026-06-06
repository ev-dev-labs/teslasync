namespace TeslaSync.App.Core.Live;

/// <summary>
/// An immutable snapshot of the live connection for binding. <see cref="State"/> is the raw
/// transport lifecycle; <see cref="EffectiveState"/> additionally folds in the freshness window
/// (an <see cref="LiveConnection.Open"/> stream that has been silent past the window reads back as
/// <see cref="LiveConnection.Stale"/>). <see cref="IsStale"/> drives the stale-data banner.
/// </summary>
public sealed record LiveConnectionSnapshot(
    LiveConnection State,
    LiveConnection EffectiveState,
    DateTimeOffset? LastEventAt,
    int ReconnectCount,
    bool IsStale);

/// <summary>
/// The observable state holder a <see cref="SseClient"/> subscription drives and the W2
/// data-display freshness/live components bind to. It owns the raw transport
/// <see cref="LiveConnection"/> and the last-event timestamp, and derives the effective state by
/// applying the ADR-013 two-minute freshness window: a stream that is open but silent past the
/// window reports <see cref="LiveConnection.Stale"/> without being dropped.
///
/// <para>Staleness is a pure function of the last-event time and an injected clock, so it can be
/// asserted deterministically in tests; the client also raises <see cref="Changed"/> when a
/// watchdog observes the transition so the UI updates without polling.</para>
/// </summary>
public sealed class LiveConnectionMonitor
{
    private readonly object _gate = new();
    private readonly Func<DateTimeOffset> _clock;
    private LiveConnection _state = LiveConnection.Closed;
    private DateTimeOffset? _lastEventAt;
    private int _reconnectCount;

    /// <summary>Creates the monitor with a freshness window and an optional injectable clock.</summary>
    public LiveConnectionMonitor(TimeSpan freshnessWindow, Func<DateTimeOffset>? clock = null)
    {
        if (freshnessWindow <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(freshnessWindow), "The freshness window must be positive.");
        }

        FreshnessWindow = freshnessWindow;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <summary>Raised on every observable change so a view-model can refresh the live chrome.</summary>
    public event Action<LiveConnectionSnapshot>? Changed;

    /// <summary>The freshness window after which an open-but-silent stream is flagged stale.</summary>
    public TimeSpan FreshnessWindow { get; }

    /// <summary>The raw transport lifecycle (before the freshness window is applied).</summary>
    public LiveConnection State
    {
        get
        {
            lock (_gate)
            {
                return _state;
            }
        }
    }

    /// <summary>The wall-clock time of the most recent event/heartbeat, or <see langword="null"/>.</summary>
    public DateTimeOffset? LastEventAt
    {
        get
        {
            lock (_gate)
            {
                return _lastEventAt;
            }
        }
    }

    /// <summary>The number of reconnect attempts observed so far.</summary>
    public int ReconnectCount
    {
        get
        {
            lock (_gate)
            {
                return _reconnectCount;
            }
        }
    }

    /// <summary>The effective state against the monitor's clock (folds in staleness).</summary>
    public LiveConnection EffectiveState => EffectiveStateAt(_clock());

    /// <summary>True when an open stream has been silent past the freshness window.</summary>
    public bool IsStale => EffectiveState == LiveConnection.Stale;

    /// <summary>The effective state at an explicit <paramref name="now"/> (folds in staleness).</summary>
    public LiveConnection EffectiveStateAt(DateTimeOffset now)
    {
        lock (_gate)
        {
            return ComputeEffective(now);
        }
    }

    /// <summary>Captures an immutable snapshot at an explicit <paramref name="now"/>.</summary>
    public LiveConnectionSnapshot SnapshotAt(DateTimeOffset now)
    {
        lock (_gate)
        {
            var effective = ComputeEffective(now);
            return new LiveConnectionSnapshot(
                _state,
                effective,
                _lastEventAt,
                _reconnectCount,
                effective == LiveConnection.Stale);
        }
    }

    /// <summary>Captures an immutable snapshot against the monitor's clock.</summary>
    public LiveConnectionSnapshot Snapshot() => SnapshotAt(_clock());

    /// <summary>Sets the raw transport state, raising <see cref="Changed"/> when it differs.</summary>
    internal void SetState(LiveConnection state)
    {
        bool changed;
        lock (_gate)
        {
            changed = _state != state;
            _state = state;
        }

        if (changed)
        {
            RaiseChanged();
        }
    }

    /// <summary>Marks that an event arrived at <paramref name="at"/>, moving the stream to open.</summary>
    internal void MarkEvent(DateTimeOffset at)
    {
        lock (_gate)
        {
            _lastEventAt = at;
            _state = LiveConnection.Open;
        }

        RaiseChanged();
    }

    /// <summary>Increments the reconnect counter and returns the new value.</summary>
    internal int IncrementReconnect()
    {
        int count;
        lock (_gate)
        {
            count = ++_reconnectCount;
        }

        RaiseChanged();
        return count;
    }

    /// <summary>Re-evaluates staleness against <paramref name="now"/>, raising <see cref="Changed"/> on a transition.</summary>
    internal void EvaluateStaleness(DateTimeOffset now)
    {
        bool transitioned;
        lock (_gate)
        {
            transitioned = _state == LiveConnection.Open && ComputeEffective(now) == LiveConnection.Stale;
        }

        if (transitioned)
        {
            RaiseChanged(now);
        }
    }

    private LiveConnection ComputeEffective(DateTimeOffset now)
    {
        if (_state == LiveConnection.Open && _lastEventAt is { } last && now - last >= FreshnessWindow)
        {
            return LiveConnection.Stale;
        }

        return _state;
    }

    private void RaiseChanged() => RaiseChanged(_clock());

    private void RaiseChanged(DateTimeOffset now) => Changed?.Invoke(SnapshotAt(now));
}
