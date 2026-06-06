using System.Runtime.CompilerServices;
using System.Threading.Channels;
using TeslaSync.App.Core.Auth;

namespace TeslaSync.App.Core.Live;

/// <summary>
/// A live subscription returned by <see cref="ISseClient.Subscribe"/>: the observable
/// <see cref="Connection"/> state and the PII-safe <see cref="Diagnostics"/>, plus the cold
/// <see cref="ReadEventsAsync"/> event sequence. Nothing happens until the sequence is enumerated;
/// the connection opens on first read and closes when enumeration ends (or is cancelled). A
/// subscription is single-consumer — call <see cref="ISseClient.Subscribe"/> again for an
/// independent stream.
/// </summary>
public sealed class LiveSubscription
{
    private readonly Func<CancellationToken, IAsyncEnumerable<LiveEvent>> _run;

    internal LiveSubscription(
        LiveConnectionMonitor connection,
        SseDiagnostics diagnostics,
        Func<CancellationToken, IAsyncEnumerable<LiveEvent>> run)
    {
        Connection = connection;
        Diagnostics = diagnostics;
        _run = run;
    }

    /// <summary>The live connection state holder the UI binds to (folds in freshness/staleness).</summary>
    public LiveConnectionMonitor Connection { get; }

    /// <summary>The PII-redacted diagnostics for this subscription.</summary>
    public SseDiagnostics Diagnostics { get; }

    /// <summary>Opens the stream (on first enumeration) and yields typed live events until cancelled.</summary>
    public IAsyncEnumerable<LiveEvent> ReadEventsAsync(CancellationToken cancellationToken = default) =>
        _run(cancellationToken);
}

/// <summary>
/// The robust foreground Server-Sent-Events client for Windows. It streams live signal/state
/// updates from the backend <c>/api/v1/events</c> endpoint, mirroring the web
/// <c>useRealtimeEvents</c>/<c>sseManager</c> pair and the shared Kotlin <c>SseClient</c>.
/// </summary>
public interface ISseClient
{
    /// <summary>Opens a cold live subscription to <paramref name="path"/> (default <c>/events</c>).</summary>
    LiveSubscription Subscribe(string? path = null);
}

/// <summary>
/// Default <see cref="ISseClient"/>. Each <see cref="Subscribe"/> returns a cold
/// <see cref="LiveSubscription"/>; enumerating its events opens one stream via the injected
/// <see cref="ISseTransport"/>, incrementally parses frames into typed <see cref="LiveEvent"/>s,
/// and maintains a <see cref="LiveConnectionMonitor"/> with:
/// <list type="bullet">
///   <item>auto-reconnect using capped exponential backoff with jitter, resuming with
///     <c>Last-Event-ID</c>;</item>
///   <item>ADR-013 staleness detection (open-but-silent past the freshness window) that flags
///     rather than drops the stream;</item>
///   <item>a single token refresh + reconnect on <c>401</c>, surfacing
///     <see cref="LiveConnection.AuthRequired"/> if it recurs;</item>
///   <item>foreground lifecycle pause/resume so a backgrounded app stops holding the socket.</item>
/// </list>
/// All diagnostics are PII-redacted via <see cref="SseDiagnostics"/>.
/// </summary>
public sealed class SseClient : ISseClient
{
    private readonly ISseTransport _transport;
    private readonly ITokenProvider _tokenProvider;
    private readonly IForegroundLifecycle _lifecycle;
    private readonly SseClientOptions _options;
    private readonly Action<string>? _diagnosticsSink;

    /// <summary>Creates the client over its transport, auth, lifecycle and options.</summary>
    public SseClient(
        ISseTransport transport,
        ITokenProvider tokenProvider,
        IForegroundLifecycle? lifecycle = null,
        SseClientOptions? options = null,
        Action<string>? diagnosticsSink = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(tokenProvider);
        _transport = transport;
        _tokenProvider = tokenProvider;
        _lifecycle = lifecycle ?? AlwaysForeground.Instance;
        _options = options ?? new SseClientOptions();
        _diagnosticsSink = diagnosticsSink;
    }

    /// <inheritdoc />
    public LiveSubscription Subscribe(string? path = null)
    {
        string resolvedPath = string.IsNullOrEmpty(path) ? _options.Path : path!;
        var monitor = new LiveConnectionMonitor(_options.FreshnessWindow, _options.Clock);
        var diagnostics = new SseDiagnostics(_diagnosticsSink);
        return new LiveSubscription(monitor, diagnostics, ct => RunAsync(resolvedPath, monitor, diagnostics, ct));
    }

    private async IAsyncEnumerable<LiveEvent> RunAsync(
        string path,
        LiveConnectionMonitor monitor,
        SseDiagnostics diagnostics,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var channel = Channel.CreateUnbounded<LiveEvent>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = true,
        });

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var loop = Task.Run(() => ConnectionLoopAsync(path, monitor, diagnostics, channel.Writer, cts.Token), CancellationToken.None);
        var watchdog = Task.Run(() => StalenessWatchdogAsync(monitor, diagnostics, cts.Token), CancellationToken.None);

        try
        {
            while (true)
            {
                LiveEvent next;
                try
                {
                    if (!await channel.Reader.WaitToReadAsync(cancellationToken).ConfigureAwait(false))
                    {
                        break;
                    }

                    if (!channel.Reader.TryRead(out next!))
                    {
                        continue;
                    }
                }
                catch (OperationCanceledException)
                {
                    break;
                }

                yield return next;
            }
        }
        finally
        {
            cts.Cancel();
            monitor.SetState(LiveConnection.Closed);
            diagnostics.RecordState(LiveConnection.Closed);
            await SilentlyAwait(loop).ConfigureAwait(false);
            await SilentlyAwait(watchdog).ConfigureAwait(false);
        }
    }

    private async Task ConnectionLoopAsync(
        string path,
        LiveConnectionMonitor monitor,
        SseDiagnostics diagnostics,
        ChannelWriter<LiveEvent> writer,
        CancellationToken cancellationToken)
    {
        Exception? fault = null;
        try
        {
            string? lastEventId = null;
            int attempt = 0;
            bool authRetried = false;

            while (!cancellationToken.IsCancellationRequested)
            {
                if (!await WaitForForegroundAsync(monitor, diagnostics, cancellationToken).ConfigureAwait(false))
                {
                    break;
                }

                var connectingState = attempt == 0 ? LiveConnection.Connecting : LiveConnection.Reconnecting;
                monitor.SetState(connectingState);
                diagnostics.RecordState(connectingState);

                var outcome = await StreamAttemptAsync(
                    path,
                    lastEventId,
                    monitor,
                    diagnostics,
                    writer,
                    () =>
                    {
                        attempt = 0;
                        authRetried = false;
                    },
                    cancellationToken).ConfigureAwait(false);

                lastEventId = outcome.LastEventId;

                if (outcome.Kind == AttemptKind.Cancelled)
                {
                    break;
                }

                if (outcome.Kind == AttemptKind.Paused)
                {
                    // Re-gate on the next loop turn; the foreground wait resumes the stream.
                    continue;
                }

                if (outcome.Kind == AttemptKind.Unauthorized)
                {
                    if (authRetried)
                    {
                        SetTerminalState(monitor, diagnostics, LiveConnection.AuthRequired);
                        break;
                    }

                    authRetried = true;
                    diagnostics.RecordAuthRefresh();
                    if (!await RefreshTokenAsync(cancellationToken).ConfigureAwait(false))
                    {
                        SetTerminalState(monitor, diagnostics, LiveConnection.AuthRequired);
                        break;
                    }

                    // Reconnect immediately with the refreshed credential — no backoff.
                    continue;
                }

                if (!_options.Reconnect)
                {
                    break;
                }

                SetTerminalState(monitor, diagnostics, LiveConnection.Reconnecting);
                monitor.IncrementReconnect();
                diagnostics.RecordReconnect();

                try
                {
                    await _options.Delay(BackoffDelay(attempt), cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }

                attempt++;
            }
        }
        catch (Exception ex)
        {
            fault = ex;
        }
        finally
        {
            writer.TryComplete(fault);
        }
    }

    private async Task<AttemptOutcome> StreamAttemptAsync(
        string path,
        string? lastEventId,
        LiveConnectionMonitor monitor,
        SseDiagnostics diagnostics,
        ChannelWriter<LiveEvent> writer,
        Action onFrame,
        CancellationToken cancellationToken)
    {
        using var attemptCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        void OnForegroundChanged(bool foreground)
        {
            if (!foreground)
            {
                attemptCts.Cancel();
            }
        }

        _lifecycle.ForegroundChanged += OnForegroundChanged;
        var resume = new ResumeMarker(lastEventId);
        try
        {
            await PumpAsync(path, resume, monitor, diagnostics, writer, onFrame, attemptCts.Token)
                .ConfigureAwait(false);
            return new AttemptOutcome(AttemptKind.ServerClosed, resume.LastEventId);
        }
        catch (SseUnauthorizedException)
        {
            return new AttemptOutcome(AttemptKind.Unauthorized, resume.LastEventId);
        }
        catch (OperationCanceledException)
        {
            // The outer token wins: a real cancellation stops the loop; a foreground-only cancel
            // (app backgrounded) parks the loop so it can resume on return to the foreground.
            return cancellationToken.IsCancellationRequested
                ? new AttemptOutcome(AttemptKind.Cancelled, resume.LastEventId)
                : new AttemptOutcome(AttemptKind.Paused, resume.LastEventId);
        }
        catch (Exception)
        {
            // Any other transport failure falls through to the backoff-reconnect, resuming from the
            // last event id actually observed before the drop.
            return new AttemptOutcome(AttemptKind.TransportError, resume.LastEventId);
        }
        finally
        {
            _lifecycle.ForegroundChanged -= OnForegroundChanged;
        }
    }

    private async Task PumpAsync(
        string path,
        ResumeMarker resume,
        LiveConnectionMonitor monitor,
        SseDiagnostics diagnostics,
        ChannelWriter<LiveEvent> writer,
        Action onFrame,
        CancellationToken cancellationToken)
    {
        var parser = new SseFrameParser();

        await foreach (var chunk in _transport.OpenAsync(new SseRequest(path, resume.LastEventId), cancellationToken)
            .WithCancellation(cancellationToken).ConfigureAwait(false))
        {
            var frames = parser.Feed(chunk);

            // A comment-only keep-alive re-arms the freshness window without being a typed event.
            if (frames.Count == 0 && parser.LastFeedHadComment)
            {
                monitor.MarkEvent(_options.Clock());
            }

            foreach (var frame in frames)
            {
                var now = _options.Clock();
                if (frame.LastEventId is { } id)
                {
                    resume.LastEventId = id;
                }

                monitor.MarkEvent(now);
                diagnostics.RecordEvent(now);
                onFrame();

                var live = SseEventDecoder.Decode(frame, out bool parseFailed);
                if (parseFailed)
                {
                    diagnostics.RecordParseError();
                }

                await writer.WriteAsync(live, cancellationToken).ConfigureAwait(false);
            }
        }
    }

    private async Task StalenessWatchdogAsync(
        LiveConnectionMonitor monitor,
        SseDiagnostics diagnostics,
        CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var lastEventAt = monitor.LastEventAt;
                if (monitor.State != LiveConnection.Open || lastEventAt is not { } last)
                {
                    await _options.Delay(_options.FreshnessWindow, cancellationToken).ConfigureAwait(false);
                    continue;
                }

                var remaining = _options.FreshnessWindow - (_options.Clock() - last);
                if (remaining > TimeSpan.Zero)
                {
                    await _options.Delay(remaining, cancellationToken).ConfigureAwait(false);
                    continue;
                }

                var now = _options.Clock();
                bool wasStale = monitor.IsStale;
                monitor.EvaluateStaleness(now);
                if (!wasStale && monitor.EffectiveStateAt(now) == LiveConnection.Stale)
                {
                    diagnostics.RecordState(LiveConnection.Stale);
                }

                // Park until the next event re-arms the window (or the subscription closes).
                await _options.Delay(_options.FreshnessWindow, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // Subscription closed — normal shutdown.
        }
    }

    private async Task<bool> WaitForForegroundAsync(
        LiveConnectionMonitor monitor,
        SseDiagnostics diagnostics,
        CancellationToken cancellationToken)
    {
        if (_lifecycle.IsForeground)
        {
            return true;
        }

        SetTerminalState(monitor, diagnostics, LiveConnection.Paused);

        var resumed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        void OnForegroundChanged(bool foreground)
        {
            if (foreground)
            {
                resumed.TrySetResult();
            }
        }

        _lifecycle.ForegroundChanged += OnForegroundChanged;
        try
        {
            // Re-check after subscribing to avoid missing a transition that raced the handler.
            if (_lifecycle.IsForeground)
            {
                return true;
            }

            await using (cancellationToken.Register(() => resumed.TrySetCanceled(cancellationToken)).ConfigureAwait(false))
            {
                await resumed.Task.ConfigureAwait(false);
            }

            return !cancellationToken.IsCancellationRequested;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
        finally
        {
            _lifecycle.ForegroundChanged -= OnForegroundChanged;
        }
    }

    private async Task<bool> RefreshTokenAsync(CancellationToken cancellationToken)
    {
        try
        {
            var failedToken = await _tokenProvider.GetTokenAsync(cancellationToken).ConfigureAwait(false);
            return await _tokenProvider.OnUnauthorizedAsync(failedToken, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    private static void SetTerminalState(LiveConnectionMonitor monitor, SseDiagnostics diagnostics, LiveConnection state)
    {
        monitor.SetState(state);
        diagnostics.RecordState(state);
    }

    private TimeSpan BackoffDelay(int attempt)
    {
        double exponential = _options.BaseRetryDelay.TotalMilliseconds * Math.Pow(2, attempt);
        double jittered = exponential * (0.75 + (_options.Random() * 0.5));
        double capped = Math.Min(jittered, _options.MaxRetryDelay.TotalMilliseconds);
        return TimeSpan.FromMilliseconds(capped);
    }

    private static async Task SilentlyAwait(Task task)
    {
        try
        {
            await task.ConfigureAwait(false);
        }
        catch (Exception)
        {
            // Shutdown path — the loop/watchdog faults are surfaced through the event channel.
        }
    }

    private enum AttemptKind
    {
        ServerClosed,
        TransportError,
        Unauthorized,
        Paused,
        Cancelled,
    }

    private readonly record struct AttemptOutcome(AttemptKind Kind, string? LastEventId);

    /// <summary>
    /// A mutable carrier for the last-seen SSE <c>id:</c> so the resume value survives a mid-stream
    /// transport fault: <see cref="PumpAsync"/> updates it per frame and the attempt reports it on
    /// every outcome, letting a reconnect resume from the last event actually received.
    /// </summary>
    private sealed class ResumeMarker
    {
        public ResumeMarker(string? lastEventId) => LastEventId = lastEventId;

        public string? LastEventId { get; set; }
    }
}
