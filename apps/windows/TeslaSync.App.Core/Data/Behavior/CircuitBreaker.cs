namespace TeslaSync.App.Core.Data.Behavior;

/// <summary>The three states of the <see cref="CircuitBreaker"/>.</summary>
public enum CircuitState
{
    /// <summary>Requests flow normally.</summary>
    Closed,

    /// <summary>The circuit has tripped; requests are short-circuited until the cooldown elapses.</summary>
    Open,

    /// <summary>A single trial request is allowed to probe recovery.</summary>
    HalfOpen,
}

/// <summary>
/// A small thread-safe circuit breaker that trips after a run of consecutive failures
/// and rejects calls for a cooldown window, then allows a single half-open probe. It
/// keeps a flaky/unreachable API from being hammered. A clock delegate makes the
/// cooldown deterministically testable.
/// </summary>
public sealed class CircuitBreaker
{
    private readonly int _failureThreshold;
    private readonly TimeSpan _openDuration;
    private readonly Func<DateTimeOffset> _clock;
    private readonly object _sync = new();

    private int _consecutiveFailures;
    private CircuitState _state = CircuitState.Closed;
    private DateTimeOffset _openedAt;

    /// <summary>Creates a breaker that opens after <paramref name="failureThreshold"/> failures.</summary>
    public CircuitBreaker(
        int failureThreshold = 5,
        TimeSpan? openDuration = null,
        Func<DateTimeOffset>? clock = null)
    {
        _failureThreshold = Math.Max(1, failureThreshold);
        _openDuration = openDuration ?? TimeSpan.FromSeconds(30);
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <summary>The current breaker state (transitions Open → HalfOpen lazily on read).</summary>
    public CircuitState State
    {
        get
        {
            lock (_sync)
            {
                return EvaluateState();
            }
        }
    }

    /// <summary>Returns <see langword="true"/> if a request may proceed right now.</summary>
    public bool Allow()
    {
        lock (_sync)
        {
            return EvaluateState() != CircuitState.Open;
        }
    }

    /// <summary>Records a successful call, closing the circuit.</summary>
    public void RecordSuccess()
    {
        lock (_sync)
        {
            _consecutiveFailures = 0;
            _state = CircuitState.Closed;
        }
    }

    /// <summary>Records a failed call, tripping the circuit once the threshold is reached.</summary>
    public void RecordFailure()
    {
        lock (_sync)
        {
            _consecutiveFailures++;
            if (_state == CircuitState.HalfOpen || _consecutiveFailures >= _failureThreshold)
            {
                _state = CircuitState.Open;
                _openedAt = _clock();
            }
        }
    }

    private CircuitState EvaluateState()
    {
        if (_state == CircuitState.Open && _clock() - _openedAt >= _openDuration)
        {
            _state = CircuitState.HalfOpen;
        }

        return _state;
    }
}
