using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <c>AIDriveCoaching</c> view — the native composition of the
/// web InnerSection + <c>useAiStream</c> (web/src/components/ai/AIDriveCoaching.tsx, web/src/hooks/useAiStream.ts).
/// It evaluates the AI-feature gate once (the <c>withAiFeature</c> visibility decision), projects the localized
/// card labels, and drives the per-drive coaching SSE stream through the injected <see cref="IAiCoachTransport"/>
/// seam: <see cref="Start"/> opens the stream, accumulates <c>delta</c> text into <see cref="Text"/>, pauses on a
/// <c>confirm_request</c>, captures the structured <see cref="Limit"/> on a rate-limited <c>error</c> frame, and
/// settles to <see cref="AiCoachStreamState.Done"/> / <see cref="AiCoachStreamState.Error"/>. It performs no HTTP
/// and references no view framework, so every transition is asserted headlessly. Drive it from one confinement
/// (the UI thread); change notifications may be raised from the stream's background continuation, and marshalling
/// onto the UI thread is the mounted view's responsibility (mirroring how React reconciles the hook's setState).
/// </summary>
public sealed class AiDriveCoachingViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiCoachTransport _transport;
    private readonly string? _driveId;

    private AiCoachStreamState _state = AiCoachStreamState.Idle;
    private string _text = string.Empty;
    private string? _error;
    private AiCoachLimitInfo? _limit;

    private CancellationTokenSource? _cts;
    private Task? _runTask;
    private bool _running;
    private bool _disposed;

    /// <summary>Creates the holder over its transport, gate, localizer and the (optional) drive id.</summary>
    /// <param name="transport">The SSE transport seam (web <c>fetch</c>); the view never opens it directly.</param>
    /// <param name="gate">The AI-feature gate (web <c>withAiFeature</c> / <c>useAiEnabled</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="driveId">
    /// The drive id surfaced by the parent page (web <c>useParams</c>, <c>string | undefined</c>). When absent the
    /// surface still renders but the action stays disabled (web <c>canStart = !!driveId</c>).
    /// </param>
    public AiDriveCoachingViewModel(
        IAiCoachTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        string? driveId)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        _transport = transport;
        _driveId = driveId;
        Display = AIDriveCoachingProjection.Project(localizer);
        IsGateOpen = gate.IsEnabled(AIDriveCoachingRegistration.FeatureId);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, localized card labels (web InnerSection + AIFeatureCard copy).</summary>
    public AIDriveCoachingDisplay Display { get; }

    /// <summary>
    /// Whether the AI-feature gate is open (web <c>useAiEnabled('drive-coaching')</c>). When false the mounted
    /// view collapses to nothing, the native analogue of the <c>withAiFeature</c> HOC returning <c>null</c>.
    /// </summary>
    public bool IsGateOpen { get; }

    /// <summary>Whether the action can fire (web <c>canStart = !!driveId</c>).</summary>
    public bool CanStart => !string.IsNullOrEmpty(_driveId);

    /// <summary>The stream lifecycle state (web <c>state</c>).</summary>
    public AiCoachStreamState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The accumulated <c>delta</c> narrative text (web <c>text</c>).</summary>
    public string Text
    {
        get => _text;
        private set => Set(ref _text, value);
    }

    /// <summary>The error message when <see cref="State"/> is <see cref="AiCoachStreamState.Error"/>, else null (web <c>error</c>).</summary>
    public string? Error
    {
        get => _error;
        private set => Set(ref _error, value);
    }

    /// <summary>The structured rate-limit / cost-cap info from the last terminal error, or null (web <c>limit</c>).</summary>
    public AiCoachLimitInfo? Limit
    {
        get => _limit;
        private set => Set(ref _limit, value);
    }

    /// <summary>True while a stream is open (web <c>state === 'streaming'</c>).</summary>
    public bool IsStreaming => State == AiCoachStreamState.Streaming;

    /// <summary>The visible CTA text: the streaming label while in flight, else the universal Helix CTA.</summary>
    public string ButtonText => IsStreaming ? Display.ThinkingLabel : Display.AskHelixLabel;

    /// <summary>Whether the action button is enabled (web <c>disabled = !canStart || streaming</c>, inverted).</summary>
    public bool ButtonEnabled => CanStart && !IsStreaming;

    /// <summary>True when the streaming thinking-skeleton should show (streaming, no text yet) (web AiOutputPanel).</summary>
    public bool ShowThinking => IsStreaming && _text.Length == 0;

    /// <summary>True when accumulated narrative text should render (web AiOutputPanel).</summary>
    public bool ShowText => _text.Length > 0;

    /// <summary>True when the error surface should render (web AiOutputPanel error branch).</summary>
    public bool ShowError => State == AiCoachStreamState.Error;

    /// <summary>
    /// Open the coaching stream (web <c>start()</c>). A no-op while already streaming or when the action cannot
    /// fire (no drive id), mirroring the disabled button. Resets the accumulated text, error and limit, then
    /// consumes the transport on a background flow.
    /// </summary>
    public void Start()
    {
        if (_disposed || _running || !CanStart)
        {
            return;
        }

        _running = true;
        State = AiCoachStreamState.Streaming;
        Text = string.Empty;
        Error = null;
        Limit = null;

        var cts = new CancellationTokenSource();
        _cts = cts;
        _runTask = RunAsync(cts.Token);
    }

    /// <summary>The in-flight stream task, or null when no stream has started — a deterministic test seam.</summary>
    internal Task? PendingStream => _runTask;

    /// <summary>Abort the in-flight stream (web <c>cancel()</c>); a cancelled stream settles back to idle.</summary>
    public void Cancel()
    {
        var cts = _cts;
        _cts = null;
        if (cts is not null)
        {
            cts.Cancel();
            cts.Dispose();
        }

        _running = false;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel();
        GC.SuppressFinalize(this);
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        var parser = new SseFrameParser();
        try
        {
            await foreach (var chunk in _transport.OpenAsync(_driveId!, cancellationToken).ConfigureAwait(false))
            {
                foreach (var frame in parser.Feed(chunk))
                {
                    var typed = AiCoachStreamParser.ParseFrame(frame);
                    if (typed is not null)
                    {
                        HandleEvent(typed);
                    }
                }
            }

            // web: setState(cur => cur === 'streaming' ? 'done' : cur) — a clean close without a terminal frame
            // still settles the lifecycle; a confirm-pause or prior error is preserved.
            if (State == AiCoachStreamState.Streaming)
            {
                State = AiCoachStreamState.Done;
            }
        }
        catch (OperationCanceledException)
        {
            // web AbortError path: a user-cancelled stream returns to idle, never error.
            if (State == AiCoachStreamState.Streaming)
            {
                State = AiCoachStreamState.Idle;
            }
        }
        catch (HttpRequestException ex)
        {
            FinalizeError(ex.Message);
        }
        catch (IOException ex)
        {
            FinalizeError(ex.Message);
        }
        finally
        {
            _running = false;
        }
    }

    private void HandleEvent(AiCoachStreamEvent typed)
    {
        switch (typed.Kind)
        {
            case AiCoachEventKind.Delta:
                Text = _text + typed.Text;
                break;
            case AiCoachEventKind.ConfirmRequest:
                State = AiCoachStreamState.PausedConfirm;
                break;
            case AiCoachEventKind.Done:
                State = AiCoachStreamState.Done;
                break;
            case AiCoachEventKind.Error:
                // web F9: capture the structured limit fields only when the error frame carried a reason; a plain
                // error frame yields no limit and the generic error surface is shown.
                if (typed.Reason is not null)
                {
                    Limit = new AiCoachLimitInfo(
                        Reason: typed.Reason,
                        RetryAfterS: typed.RetryAfterS ?? 0,
                        BannerLevel: typed.BannerLevel ?? string.Empty,
                        BaselineAvailable: typed.BaselineAvailable ?? true,
                        Message: typed.Message);
                }

                FinalizeError(typed.Message);
                break;
            case AiCoachEventKind.ToolCall:
            case AiCoachEventKind.ToolResult:
            default:
                // tool_call / tool_result advance the caller's transcript in the web hook; the coaching surface's
                // onEvent is a no-op, so there is no internal state change here.
                break;
        }
    }

    private void FinalizeError(string message)
    {
        Error = message;
        State = AiCoachStreamState.Error;
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        return true;
    }
}
