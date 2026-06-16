using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Live;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// One server-side log-stream subscription intent — the minimum-level threshold plus the optional grep
/// expression the web page restarts the connection on (web <c>buildLogStreamUrl</c> deps). The vehicle-id
/// filter is NOT part of this: it is applied client-side to the current buffer (web <c>vehicleFilter</c>).
/// Pure data.
/// </summary>
/// <param name="Level">The minimum severity (web <c>level</c> query param).</param>
/// <param name="Grep">The server-side regular expression (web <c>grep</c> query param); empty = none.</param>
public sealed record LogStreamRequest(LogStreamLevel Level, string Grep);

/// <summary>
/// The live-stream seam the <see cref="LiveLogsPageViewModel"/>'s view binds to (P1/S4 SSE layer) — the native
/// analogue of the web page's only data source, the single SSE subscription the tail drives
/// (web/src/api/hooks/useLogStream.ts → <c>GET /admin/logs/stream</c>). It surfaces the connection lifecycle
/// (web <c>isConnected</c> / <c>error</c>) and the parsed <c>log</c> / <c>drop</c> firehose; the view subscribes
/// on mount, marshals each event onto the UI thread and feeds it to the view-model. The view never opens an
/// <see cref="ISseTransport"/> itself. <see cref="Start"/> restarts the connection on a level/grep change (web
/// effect re-run); <see cref="StopStreaming"/> tears it down (web <c>enabled === false</c> / route-change cleanup).
/// </summary>
public interface ILiveLogFeed
{
    /// <summary>The current SSE connection state (web <c>isConnected</c>).</summary>
    bool Connected { get; }

    /// <summary>Raised when the SSE connection state flips (open ⇄ closed).</summary>
    event System.Action<bool>? ConnectionChanged;

    /// <summary>Raised for every decoded <c>log</c> frame (web <c>buildLogEvent</c> push).</summary>
    event System.Action<LogStreamEvent>? LogReceived;

    /// <summary>Raised for every server <c>drop</c> frame's count (web <c>setDrops</c>).</summary>
    event System.Action<int>? DropsReceived;

    /// <summary>Raised when the connection error changes — the message, or null to clear (web <c>setError</c>).</summary>
    event System.Action<string?>? ErrorChanged;

    /// <summary>(Re)connect with the given server-side filter; tears down any current stream first.</summary>
    void Start(LogStreamRequest request);

    /// <summary>Tear down the current stream and report disconnected (web <c>enabled === false</c>).</summary>
    void StopStreaming();
}

/// <summary>
/// The default no-backend feed the parameterless (shell-registered) <see cref="LiveLogsPage"/> mounts against —
/// the local-state default mirroring the sibling W7 pages' empty feeds (<c>EmptyLiveSignalMonitorFeed</c>). It
/// never connects and never emits, so the page renders its faithful initial state: a "Disconnected" badge over
/// the "No log events yet" empty tail. The transport-backed <see cref="SseLiveLogFeed"/> is wired separately
/// from the shared live layer (web's fetch/SSE wiring); this feed keeps the page mountable without a stream.
/// </summary>
public sealed class EmptyLiveLogFeed : ILiveLogFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyLiveLogFeed Instance { get; } = new();

    private EmptyLiveLogFeed()
    {
    }

    /// <inheritdoc />
    public bool Connected => false;

    /// <inheritdoc />
    public event System.Action<bool>? ConnectionChanged
    {
        add { }
        remove { }
    }

    /// <inheritdoc />
    public event System.Action<LogStreamEvent>? LogReceived
    {
        add { }
        remove { }
    }

    /// <inheritdoc />
    public event System.Action<int>? DropsReceived
    {
        add { }
        remove { }
    }

    /// <inheritdoc />
    public event System.Action<string?>? ErrorChanged
    {
        add { }
        remove { }
    }

    /// <inheritdoc />
    public void Start(LogStreamRequest request)
    {
    }

    /// <inheritdoc />
    public void StopStreaming()
    {
    }
}

/// <summary>
/// The transport-backed <see cref="ILiveLogFeed"/> — the native data adapter for the admin log tail. It binds
/// the P1/S4 <see cref="ISseTransport"/> (the SSE analogue of the data layer's HTTP client) to
/// <c>GET /admin/logs/stream?level=&amp;grep=</c> and reassembles the wire bytes with the shared
/// <see cref="SseFrameParser"/>, decoding each <c>log</c> frame into a <see cref="LogStreamEvent"/> and each
/// <c>drop</c> frame into a count — the exact frame handling the web hook's hand-rolled parser does
/// (web/src/api/hooks/useLogStream.ts). One connection attempt per <see cref="Start"/> (no auto-reconnect,
/// matching the web hook): a server close reports disconnected, a transport failure surfaces the error message
/// for the Reconnect affordance. Events are raised off the UI thread; the view marshals them. Detach with
/// <see cref="Dispose"/>.
/// </summary>
public sealed class SseLiveLogFeed : ILiveLogFeed, System.IDisposable
{
    private readonly ISseTransport _transport;
    private readonly System.Func<System.DateTimeOffset> _clock;
    private readonly object _gate = new();

    private CancellationTokenSource? _cts;
    private long _seq;
    private bool _connected;
    private bool _disposed;

    /// <summary>Creates the feed over the SSE transport and an optional injectable receive clock (for tests).</summary>
    /// <param name="transport">The P1/S4 SSE transport the stream opens through.</param>
    /// <param name="clock">The receive-time clock (web <c>Date.now()</c>); defaults to <see cref="System.DateTimeOffset.Now"/>.</param>
    public SseLiveLogFeed(ISseTransport transport, System.Func<System.DateTimeOffset>? clock = null)
    {
        System.ArgumentNullException.ThrowIfNull(transport);
        _transport = transport;
        _clock = clock ?? (() => System.DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public event System.Action<bool>? ConnectionChanged;

    /// <inheritdoc />
    public event System.Action<LogStreamEvent>? LogReceived;

    /// <inheritdoc />
    public event System.Action<int>? DropsReceived;

    /// <inheritdoc />
    public event System.Action<string?>? ErrorChanged;

    /// <inheritdoc />
    public bool Connected
    {
        get
        {
            lock (_gate)
            {
                return _connected;
            }
        }
    }

    /// <inheritdoc />
    public void Start(LogStreamRequest request)
    {
        System.ArgumentNullException.ThrowIfNull(request);

        CancellationTokenSource cts;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            var previous = _cts;
            cts = new CancellationTokenSource();
            _cts = cts;
            previous?.Cancel();
            previous?.Dispose();
        }

        // Clear any prior error before the fresh attempt (web setError(null)).
        ErrorChanged?.Invoke(null);
        _ = Task.Run(() => PumpAsync(request, cts.Token), CancellationToken.None);
    }

    /// <inheritdoc />
    public void StopStreaming()
    {
        lock (_gate)
        {
            _cts?.Cancel();
            _cts?.Dispose();
            _cts = null;
        }

        SetConnected(false);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _cts?.Cancel();
            _cts?.Dispose();
            _cts = null;
        }
    }

    private async Task PumpAsync(LogStreamRequest request, CancellationToken cancellationToken)
    {
        var parser = new SseFrameParser();
        bool opened = false;

        try
        {
            string path = BuildPath(request);
            var sseRequest = new SseRequest(path, null);

            await foreach (var chunk in _transport.OpenAsync(sseRequest, cancellationToken)
                .WithCancellation(cancellationToken)
                .ConfigureAwait(false))
            {
                if (!opened)
                {
                    opened = true;
                    SetConnected(true);
                }

                foreach (var frame in parser.Feed(chunk))
                {
                    HandleFrame(frame);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer Start (or Stop/Dispose) — drop silently; the new pump owns the state.
            return;
        }
        catch (System.Exception ex)
        {
            if (!cancellationToken.IsCancellationRequested)
            {
                ErrorChanged?.Invoke(ex.Message);
            }
        }
        finally
        {
            // Only the still-current pump reports the close; a superseded pump leaves the state to its successor.
            if (!cancellationToken.IsCancellationRequested)
            {
                SetConnected(false);
            }
        }
    }

    private void HandleFrame(SseFrame frame)
    {
        switch (frame.Event)
        {
            case "log":
                long seq = Interlocked.Increment(ref _seq);
                LogReceived?.Invoke(LogStreamEvent.FromPayload(seq, _clock(), frame.Data));
                break;

            case "drop":
                int count = ParseDropCount(frame.Data);
                if (count > 0)
                {
                    DropsReceived?.Invoke(count);
                }

                break;

            case "connected":
            case "heartbeat":
            default:
                // The server echoes connected/heartbeat; we already toggle Connected on the first chunk.
                break;
        }
    }

    private static int ParseDropCount(string data)
    {
        if (string.IsNullOrEmpty(data))
        {
            return 0;
        }

        try
        {
            using var doc = JsonDocument.Parse(data);
            if (doc.RootElement.ValueKind == JsonValueKind.Object
                && doc.RootElement.TryGetProperty("count", out var count)
                && count.ValueKind == JsonValueKind.Number
                && count.TryGetInt32(out int value))
            {
                return value;
            }
        }
        catch (JsonException)
        {
            // Malformed drop frame — count nothing (web tryParseJSON -> 0 branch).
        }

        return 0;
    }

    private static string BuildPath(LogStreamRequest request)
    {
        string path = $"{LiveLogsRegistration.StreamPath}?level={System.Uri.EscapeDataString(LogStreamLevels.Wire(request.Level))}";
        if (!string.IsNullOrWhiteSpace(request.Grep))
        {
            path += $"&grep={System.Uri.EscapeDataString(request.Grep)}";
        }

        return path;
    }

    private void SetConnected(bool connected)
    {
        lock (_gate)
        {
            if (_connected == connected)
            {
                return;
            }

            _connected = connected;
        }

        ConnectionChanged?.Invoke(connected);
    }
}
