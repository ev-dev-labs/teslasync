using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <c>AIVehiclePaintPreview</c> view — the native composition
/// of the web InnerSection + <c>useAiStream</c> (web/src/components/ai/AIVehiclePaintPreview.tsx,
/// web/src/hooks/useAiStream.ts). It evaluates the AI-feature gate once (the <c>withAiFeature</c> visibility
/// decision), derives the per-vehicle request through the tested <see cref="AiPaintPreviewRequest"/> adapter
/// (the web <c>numericVehicleId</c> / <c>body</c> / <c>urlPath</c> logic), projects the localized card labels, and
/// drives the paint-preview SSE stream through the injected <see cref="IAiPaintPreviewTransport"/> seam:
/// <see cref="Start"/> opens the stream, accumulates <c>delta</c> text into <see cref="Text"/>, pauses on a
/// <c>confirm_request</c> (reproduced for lifecycle parity only — the propose-only surface never issues one),
/// captures the structured <see cref="Limit"/> on a rate-limited <c>error</c> frame, classifies a connectivity
/// fault so the view can show the offline affordance, and settles to <see cref="AiPaintPreviewStreamState.Done"/>
/// / <see cref="AiPaintPreviewStreamState.Error"/>. It performs no HTTP and references no view framework, so every
/// transition is asserted headlessly. Drive it from one confinement (the UI thread); change notifications may be
/// raised from the stream's background continuation, and marshalling onto the UI thread is the mounted view's
/// responsibility (mirroring how React reconciles the hook's setState).
/// </summary>
public sealed class AiVehiclePaintPreviewViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiPaintPreviewTransport _transport;
    private readonly AiPaintPreviewRequest _request;

    private AiPaintPreviewStreamState _state = AiPaintPreviewStreamState.Idle;
    private string _text = string.Empty;
    private string _errorMessage = string.Empty;
    private AiPaintPreviewErrorReason _errorReason = AiPaintPreviewErrorReason.Unknown;
    private AiPaintPreviewLimitInfo? _limit;

    private CancellationTokenSource? _cts;
    private Task? _runTask;
    private bool _running;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over its transport, gate, localizer and the (optional) vehicle id + style hint.
    /// </summary>
    /// <param name="transport">The SSE transport seam (web <c>fetch</c>); the view never opens it directly.</param>
    /// <param name="gate">The AI-feature gate (web <c>withAiFeature</c> / <c>useAiEnabled</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">
    /// The vehicle id surfaced by the parent VehicleDetailPage (web prop, <c>number | undefined</c>). When absent
    /// or not a positive id the surface still renders but the action stays disabled and the no-vehicle hint shows
    /// (web <c>canStart = haveInputs</c>, <c>emptyHint</c>).
    /// </param>
    /// <param name="styleHint">The optional one-word style hint (web prop); blank / whitespace is omitted from the body.</param>
    public AiVehiclePaintPreviewViewModel(
        IAiPaintPreviewTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        int? vehicleId,
        string? styleHint = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        _transport = transport;
        _request = AiPaintPreviewRequest.Create(vehicleId, styleHint);
        Display = AIVehiclePaintPreviewProjection.Project(localizer);
        IsGateOpen = gate.IsEnabled(AIVehiclePaintPreviewRegistration.FeatureId);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, localized card labels (web InnerSection + AIFeatureCard copy).</summary>
    public AIVehiclePaintPreviewDisplay Display { get; }

    /// <summary>
    /// Whether the AI-feature gate is open (web <c>useAiEnabled('vehicle-paint-preview')</c>). When false the
    /// mounted view collapses to nothing, the native analogue of the <c>withAiFeature</c> HOC returning
    /// <see langword="null"/>.
    /// </summary>
    public bool IsGateOpen { get; }

    /// <summary>Whether the action can fire (web <c>canStart = haveInputs = numericVehicleId &gt; 0</c>).</summary>
    public bool CanStart => _request.HasInputs;

    /// <summary>
    /// Whether the no-vehicle empty hint should render beneath the description (web AIFeatureCard
    /// <c>!canStart &amp;&amp; emptyHint</c>). The card always shows the title, description and action; this hint is
    /// the friendly empty affordance when the parent has not yet resolved a vehicle.
    /// </summary>
    public bool ShowEmptyHint => !CanStart;

    /// <summary>The stream lifecycle state (web <c>state</c>).</summary>
    public AiPaintPreviewStreamState State
    {
        get => _state;
        private set
        {
            if (_state == value)
            {
                return;
            }

            _state = value;
            Raise(nameof(State));
            Raise(nameof(IsStreaming));
            Raise(nameof(ButtonText));
            Raise(nameof(ButtonEnabled));
            Raise(nameof(ShowThinking));
            Raise(nameof(ShowText));
            Raise(nameof(ShowError));
            Raise(nameof(IsOffline));
            Raise(nameof(HasOutput));
            Raise(nameof(DisplayErrorText));
        }
    }

    /// <summary>The accumulated <c>delta</c> image-prompt text (web <c>text</c>).</summary>
    public string Text
    {
        get => _text;
        private set
        {
            if (string.Equals(_text, value, StringComparison.Ordinal))
            {
                return;
            }

            _text = value;
            Raise(nameof(Text));
            Raise(nameof(ShowThinking));
            Raise(nameof(ShowText));
            Raise(nameof(HasOutput));
        }
    }

    /// <summary>The error message when <see cref="State"/> is <see cref="AiPaintPreviewStreamState.Error"/>, else null (web <c>error</c>).</summary>
    public string? Error => _state == AiPaintPreviewStreamState.Error && _errorMessage.Length > 0 ? _errorMessage : null;

    /// <summary>The structured rate-limit / cost-cap info from the last terminal error, or null (web <c>limit</c>).</summary>
    public AiPaintPreviewLimitInfo? Limit => _limit;

    /// <summary>True while a stream is open (web <c>state === 'streaming'</c>).</summary>
    public bool IsStreaming => _state == AiPaintPreviewStreamState.Streaming;

    /// <summary>The visible CTA text: the streaming label while in flight, else the universal Helix CTA.</summary>
    public string ButtonText => IsStreaming ? Display.ThinkingLabel : Display.AskHelixLabel;

    /// <summary>Whether the action button is enabled (web AIFeatureCard <c>disabled = !canStart || streaming</c>, inverted).</summary>
    public bool ButtonEnabled => CanStart && !IsStreaming;

    /// <summary>
    /// True once a stream has run (or is running) — the output panel is shown (web AiOutputPanel
    /// <c>hasAnything = text.length &gt; 0 || state ∈ {streaming, error, done}</c>); idle with no text hides it so
    /// the card is the friendly ready state (header + description + action), never a blank box.
    /// </summary>
    public bool HasOutput =>
        _text.Length > 0 ||
        _state is AiPaintPreviewStreamState.Streaming
            or AiPaintPreviewStreamState.Done
            or AiPaintPreviewStreamState.Error;

    /// <summary>
    /// True while the stream is open but no text has arrived yet — the thinking skeleton shows (web AiOutputPanel
    /// <c>text.length === 0 &amp;&amp; state === 'streaming'</c>).
    /// </summary>
    public bool ShowThinking => IsStreaming && _text.Length == 0;

    /// <summary>True when accumulated image-prompt text should render (web AiOutputPanel text branch).</summary>
    public bool ShowText => _text.Length > 0;

    /// <summary>True when the error surface should render (web AiOutputPanel error branch).</summary>
    public bool ShowError => _state == AiPaintPreviewStreamState.Error;

    /// <summary>
    /// True when the failure was a connectivity fault — drives the offline message rather than the generic error.
    /// An on-demand SSE draft has no cached prior result to age, so a lost connection surfaces here as the offline
    /// branch (the native analogue of the P2 "offline" state for a cache-free surface).
    /// </summary>
    public bool IsOffline => _state == AiPaintPreviewStreamState.Error && _errorReason == AiPaintPreviewErrorReason.Network;

    /// <summary>
    /// The inline error copy shown in the output panel — the offline message for a connectivity fault, else the
    /// "Helix error: &lt;message&gt;" composition (web AiOutputPanel <c>helix.errorLabel</c> +
    /// <c>error ?? errorUnknown</c>).
    /// </summary>
    public string DisplayErrorText
    {
        get
        {
            if (!ShowError)
            {
                return string.Empty;
            }

            if (_errorReason == AiPaintPreviewErrorReason.Network)
            {
                return Display.OfflineMessage;
            }

            var message = _errorMessage.Length > 0 ? _errorMessage : Display.ErrorUnknown;
            return string.Concat(Display.ErrorLabel, " ", message);
        }
    }

    /// <summary>The in-flight stream task, or null when no stream has started — a deterministic test seam.</summary>
    internal Task? PendingStream => _runTask;

    /// <summary>
    /// Open the paint-preview stream (web <c>start()</c>). A no-op while already streaming, while paused for a
    /// confirmation, when the action cannot fire (no resolved vehicle), or on a gated-off surface — mirroring the
    /// disabled button. Resets the accumulated text, error and limit, then consumes the transport on a background
    /// flow.
    /// </summary>
    public void Start()
    {
        if (_disposed || _running || !IsGateOpen || !CanStart || _state == AiPaintPreviewStreamState.PausedConfirm)
        {
            return;
        }

        _running = true;

        var cts = new CancellationTokenSource();
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Text = string.Empty;
        _errorMessage = string.Empty;
        _errorReason = AiPaintPreviewErrorReason.Unknown;
        _limit = null;
        Raise(nameof(Error));
        Raise(nameof(Limit));
        State = AiPaintPreviewStreamState.Streaming;

        _runTask = RunAsync(cts.Token);
    }

    /// <summary>Abort the in-flight stream (web <c>cancel()</c>); a cancelled stream settles back to idle.</summary>
    public void Cancel()
    {
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
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
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        var parser = new SseFrameParser();
        try
        {
            await foreach (var chunk in _transport
                .OpenAsync(_request.EffectiveVehicleId, _request.StyleHint, cancellationToken)
                .ConfigureAwait(false))
            {
                foreach (var frame in parser.Feed(chunk))
                {
                    var typed = AiPaintPreviewStreamParser.ParseFrame(frame);
                    if (typed is not null)
                    {
                        HandleEvent(typed);
                    }
                }
            }

            // web: setState(cur => cur === 'streaming' ? 'done' : cur) — a clean close without a terminal frame
            // still settles the lifecycle; a confirm-pause or prior error is preserved.
            if (_state == AiPaintPreviewStreamState.Streaming)
            {
                State = AiPaintPreviewStreamState.Done;
            }
        }
        catch (OperationCanceledException)
        {
            // web AbortError path: a user-cancelled stream returns to idle, never error.
            if (_state == AiPaintPreviewStreamState.Streaming)
            {
                State = AiPaintPreviewStreamState.Idle;
            }
        }
        catch (HttpRequestException ex)
        {
            // A `stream_http_{status}` message is the off-mode / server-fault path; any other HttpRequestException
            // (connection refused, DNS, reset) is a connectivity fault → the offline affordance.
            var reason = ex.Message.StartsWith("stream_http_", StringComparison.Ordinal)
                ? AiPaintPreviewErrorReason.Http
                : AiPaintPreviewErrorReason.Network;
            FinalizeError(ex.Message, reason);
        }
        catch (IOException ex)
        {
            // A mid-stream read failure is a connectivity fault.
            FinalizeError(ex.Message, AiPaintPreviewErrorReason.Network);
        }
        finally
        {
            _running = false;
        }
    }

    private void HandleEvent(AiPaintPreviewStreamEvent typed)
    {
        switch (typed.Kind)
        {
            case AiPaintPreviewEventKind.Delta:
                Text = string.Concat(_text, typed.Text);
                if (_state != AiPaintPreviewStreamState.Streaming)
                {
                    State = AiPaintPreviewStreamState.Streaming;
                }

                break;

            case AiPaintPreviewEventKind.ConfirmRequest:
                State = AiPaintPreviewStreamState.PausedConfirm;
                break;

            case AiPaintPreviewEventKind.Done:
                State = AiPaintPreviewStreamState.Done;
                break;

            case AiPaintPreviewEventKind.Error:
                // web F9: capture the structured limit fields only when the error frame carried a reason; a plain
                // error frame yields no limit and the generic error surface is shown.
                if (typed.Reason is not null)
                {
                    _limit = new AiPaintPreviewLimitInfo(
                        Reason: typed.Reason,
                        RetryAfterS: typed.RetryAfterS ?? 0,
                        BannerLevel: typed.BannerLevel ?? string.Empty,
                        BaselineAvailable: typed.BaselineAvailable ?? true,
                        Message: typed.Message);
                    Raise(nameof(Limit));
                }

                FinalizeError(typed.Message, AiPaintPreviewErrorReason.Stream);
                break;

            case AiPaintPreviewEventKind.ToolCall:
            case AiPaintPreviewEventKind.ToolResult:
            default:
                // web onEvent is a deliberate no-op for the paint-preview surface: tool frames advance no visible
                // state, and AiOutputPanel renders stream.text directly.
                break;
        }
    }

    private void FinalizeError(string message, AiPaintPreviewErrorReason reason)
    {
        _errorMessage = message ?? string.Empty;
        _errorReason = reason;
        State = AiPaintPreviewStreamState.Error;
        Raise(nameof(Error));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
