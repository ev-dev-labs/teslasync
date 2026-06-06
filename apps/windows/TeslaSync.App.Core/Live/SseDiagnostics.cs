using System.Globalization;
using TeslaSync.App.Core.Auth;

namespace TeslaSync.App.Core.Live;

/// <summary>
/// An immutable, PII-safe snapshot of the live-stream diagnostics. It carries only operational
/// counters and the connection lifecycle — never a VIN, a location, a token, or a decoded
/// payload — so it can be logged or surfaced on a diagnostics page without leaking user data.
/// </summary>
public sealed record SseDiagnosticsSnapshot(
    LiveConnection State,
    int ReconnectCount,
    int ParseErrorCount,
    int AuthRefreshCount,
    long EventsReceived,
    DateTimeOffset? LastEventAt);

/// <summary>
/// Collects PII-redacted diagnostics for one <see cref="SseClient"/> subscription: the current
/// connection state, reconnect count, parse-error count, auth-refresh count, total events seen,
/// and the last-event timestamp (per the W6 spec). Every log line is passed through
/// <see cref="TokenRedaction"/> before it reaches the sink, and the counters deliberately exclude
/// any signal value, vehicle id payload, VIN, location, or token so a misrouted diagnostics line
/// can never leak credentials or personal data.
/// </summary>
public sealed class SseDiagnostics
{
    private readonly object _gate = new();
    private readonly Action<string>? _sink;
    private LiveConnection _state = LiveConnection.Closed;
    private int _reconnectCount;
    private int _parseErrorCount;
    private int _authRefreshCount;
    private long _eventsReceived;
    private DateTimeOffset? _lastEventAt;

    /// <summary>Creates the collector over an optional redacting diagnostics sink.</summary>
    public SseDiagnostics(Action<string>? sink = null) => _sink = sink;

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

    /// <summary>The number of frames that failed to decode into a typed event.</summary>
    public int ParseErrorCount
    {
        get
        {
            lock (_gate)
            {
                return _parseErrorCount;
            }
        }
    }

    /// <summary>The number of token refreshes triggered by a <c>401</c> on the stream.</summary>
    public int AuthRefreshCount
    {
        get
        {
            lock (_gate)
            {
                return _authRefreshCount;
            }
        }
    }

    /// <summary>The total number of events received across the subscription's lifetime.</summary>
    public long EventsReceived
    {
        get
        {
            lock (_gate)
            {
                return _eventsReceived;
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

    /// <summary>Records a connection-state transition and emits a redacted log line.</summary>
    public void RecordState(LiveConnection state)
    {
        lock (_gate)
        {
            _state = state;
        }

        Emit($"sse state={state}");
    }

    /// <summary>Records a reconnect attempt and returns the new reconnect count.</summary>
    public int RecordReconnect()
    {
        int count;
        lock (_gate)
        {
            count = ++_reconnectCount;
        }

        Emit($"sse reconnect attempt={count.ToString(CultureInfo.InvariantCulture)}");
        return count;
    }

    /// <summary>Records a frame parse failure (the frame degraded to <see cref="LiveEvent.Unknown"/>).</summary>
    public void RecordParseError()
    {
        int count;
        lock (_gate)
        {
            count = ++_parseErrorCount;
        }

        Emit($"sse parse_error count={count.ToString(CultureInfo.InvariantCulture)}");
    }

    /// <summary>Records a token refresh prompted by a <c>401</c> on the stream.</summary>
    public void RecordAuthRefresh()
    {
        int count;
        lock (_gate)
        {
            count = ++_authRefreshCount;
        }

        Emit($"sse auth_refresh count={count.ToString(CultureInfo.InvariantCulture)}");
    }

    /// <summary>Records that an event was received at <paramref name="at"/> (no payload is logged).</summary>
    public void RecordEvent(DateTimeOffset at)
    {
        lock (_gate)
        {
            _eventsReceived++;
            _lastEventAt = at;
        }
    }

    /// <summary>Captures an immutable, PII-safe snapshot of the current diagnostics.</summary>
    public SseDiagnosticsSnapshot Snapshot()
    {
        lock (_gate)
        {
            return new SseDiagnosticsSnapshot(
                _state,
                _reconnectCount,
                _parseErrorCount,
                _authRefreshCount,
                _eventsReceived,
                _lastEventAt);
        }
    }

    private void Emit(string line)
    {
        if (_sink is null)
        {
            return;
        }

        // Defence in depth: even though these lines carry only counters/state, redact before the
        // sink so an accidentally-formatted token can never escape.
        _sink(TokenRedaction.Redact(line));
    }
}
