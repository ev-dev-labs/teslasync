using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <c>AITripPostcardShareCardImageGeneration</c> view — the
/// native composition of the web InnerSection + <c>useAiStream</c>
/// (web/src/components/ai/AITripPostcardShareCardImageGeneration.tsx, web/src/hooks/useAiStream.ts). It evaluates
/// the AI-feature gate once (the <c>withAiFeature</c> visibility decision), projects the localized card labels,
/// and mirrors three web behaviours exactly: the <c>haveInputs</c> guard (<see cref="CanStart"/> = a resolved
/// <c>trip_id &gt; 0</c>, surfaced from the parent SharingTripsPage selection); the empty-state hint shown until
/// a trip is in scope (<see cref="ShowEmptyHint"/>); and the <c>useAiStream</c> lifecycle (<see cref="Start"/>
/// opens the stream with the <c>{ trip_id, style_hint? }</c> body, accumulates <c>delta</c> text into
/// <see cref="Text"/>, pauses on a <c>confirm_request</c> — reproduced for lifecycle parity only, the propose-only
/// drafter never issues one — and settles to <see cref="AiTripPostcardStreamState.Done"/> /
/// <see cref="AiTripPostcardStreamState.Error"/>). A connectivity fault is classified so the view can show the
/// offline affordance. It performs no HTTP and references no view framework, so every transition is asserted
/// headlessly. Drive it from one confinement (the UI thread); change notifications may be raised from the
/// stream's background continuation, and marshalling onto the UI thread is the mounted view's responsibility
/// (mirroring how React reconciles the hook's setState).
/// </summary>
public sealed class AITripPostcardShareCardImageGenerationViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiTripPostcardTransport _transport;
    private readonly ILocalizer _localizer;
    private readonly bool _isGateOpen;

    private long? _tripId;
    private string? _styleHint;
    private AiTripPostcardStreamState _state = AiTripPostcardStreamState.Idle;
    private string _text = string.Empty;
    private string _errorMessage = string.Empty;
    private AiTripPostcardErrorReason _errorReason = AiTripPostcardErrorReason.Unknown;

    private CancellationTokenSource? _cts;
    private Task? _runTask;
    private bool _running;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over its transport (P1/S8 seam), the AI feature gate, the i18n facade and the optional
    /// in-scope trip + style hint. Throws when the surface's feature id is not in the canonical AI feature
    /// registry — the native analogue of <c>withAiFeature</c> rejecting an unknown id at module load.
    /// </summary>
    /// <param name="transport">The SSE transport seam (web <c>fetch</c>); the view never opens it directly.</param>
    /// <param name="gate">The AI-feature gate (web <c>withAiFeature</c> / <c>useAiEnabled</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="tripId">The in-scope trip id (web <c>tripId</c> prop); the action stays disabled until it resolves.</param>
    /// <param name="styleHint">Optional free-form style hint the user may pass to Helix (web <c>styleHint</c> prop).</param>
    public AITripPostcardShareCardImageGenerationViewModel(
        IAiTripPostcardTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        long? tripId = null,
        string? styleHint = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!AITripPostcardShareCardImageGenerationRegistration.IsRegisteredFeature(
                AITripPostcardShareCardImageGenerationRegistration.FeatureId))
        {
            throw new InvalidOperationException(
                $"Unknown AI feature id '{AITripPostcardShareCardImageGenerationRegistration.FeatureId}'. " +
                "Add it to the AI feature registry (web/src/ai/features.ts) and regenerate.");
        }

        _transport = transport;
        _localizer = localizer;
        _tripId = tripId;
        _styleHint = styleHint;
        Display = AITripPostcardShareCardImageGenerationProjection.Project(localizer);
        _isGateOpen = gate.IsEnabled(AITripPostcardShareCardImageGenerationRegistration.FeatureId);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, localized card labels (web InnerSection + AIFeatureCard copy).</summary>
    public AITripPostcardShareCardImageGenerationDisplay Display { get; }

    /// <summary>
    /// Whether the AI-feature gate is open (web <c>useAiEnabled('trip-postcard-share-card-image-generation')</c>).
    /// When false the mounted view collapses to nothing, the native analogue of the <c>withAiFeature</c> HOC
    /// returning <see langword="null"/>.
    /// </summary>
    public bool IsGateOpen => _isGateOpen;

    /// <summary>
    /// The in-scope trip id surfaced by the parent SharingTripsPage selection (web <c>tripId</c> prop);
    /// reassigning re-evaluates <see cref="CanStart"/> / <see cref="ButtonEnabled"/> / <see cref="ShowEmptyHint"/>.
    /// </summary>
    public long? TripId
    {
        get => _tripId;
        set
        {
            if (_tripId == value)
            {
                return;
            }

            _tripId = value;
            Raise(nameof(TripId));
            Raise(nameof(HaveInputs));
            Raise(nameof(CanStart));
            Raise(nameof(ButtonEnabled));
            Raise(nameof(ShowEmptyHint));
        }
    }

    /// <summary>
    /// The optional free-form style hint (web <c>styleHint</c> prop). It feeds the request body only — it never
    /// changes the button's enabled state — so reassigning raises just its own change notification.
    /// </summary>
    public string? StyleHint
    {
        get => _styleHint;
        set
        {
            if (string.Equals(_styleHint, value, StringComparison.Ordinal))
            {
                return;
            }

            _styleHint = value;
            Raise(nameof(StyleHint));
        }
    }

    /// <summary>The stream lifecycle state (web <c>stream.state</c>).</summary>
    public AiTripPostcardStreamState State
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
            Raise(nameof(ButtonEnabled));
            Raise(nameof(ButtonText));
            Raise(nameof(ShowThinking));
            Raise(nameof(ShowText));
            Raise(nameof(ShowError));
            Raise(nameof(IsOffline));
            Raise(nameof(HasOutput));
            Raise(nameof(DisplayErrorText));
        }
    }

    /// <summary>The accumulated <c>delta</c> draft text (web <c>stream.text</c>).</summary>
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

    /// <summary>
    /// True when a trip is in scope (web <c>haveInputs = numericTripId &gt; 0</c>) — the only thing that gates the
    /// action, because the handler validates <c>trip_id &gt; 0</c> and the optional style hint is never required.
    /// </summary>
    public bool HaveInputs => _tripId is > 0;

    /// <summary>True while the SSE stream is open (web <c>stream.state === 'streaming'</c>).</summary>
    public bool IsStreaming => _state == AiTripPostcardStreamState.Streaming;

    /// <summary>
    /// True when the action may fire (web <c>canStart={haveInputs}</c>): a trip must be in scope. Unlike the
    /// narrative explainer surfaces this does NOT depend on the stream state — the parent selection is the only
    /// gate, exactly as the web component computes it.
    /// </summary>
    public bool CanStart => HaveInputs;

    /// <summary>
    /// True when the action button is interactive — startable and no stream in flight (web AIFeatureCard
    /// <c>disabled = !canStart || streaming</c>, inverted). Disabled while no trip is selected and while the ring
    /// shows during a stream.
    /// </summary>
    public bool ButtonEnabled => CanStart && !IsStreaming;

    /// <summary>
    /// True when the empty-state hint should render (web AIFeatureCard <c>!canStart &amp;&amp; emptyHint</c>): no
    /// trip is selected yet, so the muted "Pick a trip from the list above to enable Helix." hint sits beneath the
    /// description and the action is disabled. The card itself always renders (never a blank box).
    /// </summary>
    public bool ShowEmptyHint => !CanStart;

    /// <summary>The visible CTA text: the streaming "thinking" copy while in flight, else the universal Helix CTA.</summary>
    public string ButtonText => IsStreaming ? Display.ThinkingLabel : Display.AskHelixLabel;

    /// <summary>
    /// True once a stream has run (or is running) — the output panel is shown (web <c>AiOutputPanel</c>
    /// <c>hasAnything = text.length &gt; 0 || state ∈ {streaming, error, done}</c>); idle with no text hides it so
    /// the card is the friendly ready state (header + description + action), never a blank box.
    /// </summary>
    public bool HasOutput =>
        _text.Length > 0 ||
        _state is AiTripPostcardStreamState.Streaming
            or AiTripPostcardStreamState.Done
            or AiTripPostcardStreamState.Error;

    /// <summary>
    /// True while the stream is open but no text has arrived yet — the thinking skeleton shows (web AiOutputPanel
    /// <c>text.length === 0 &amp;&amp; state === 'streaming'</c>).
    /// </summary>
    public bool ShowThinking => IsStreaming && _text.Length == 0;

    /// <summary>True when accumulated draft text should render (web AiOutputPanel text branch).</summary>
    public bool ShowText => _text.Length > 0;

    /// <summary>True when the error surface should render (web AiOutputPanel error branch).</summary>
    public bool ShowError => _state == AiTripPostcardStreamState.Error;

    /// <summary>
    /// True when the failure was a connectivity fault — drives the offline message rather than the generic error.
    /// An on-demand SSE draft has no cached prior result to age, so a lost connection surfaces here as the offline
    /// branch (the native analogue of the P2 "offline" state for a cache-free surface).
    /// </summary>
    public bool IsOffline => _state == AiTripPostcardStreamState.Error && _errorReason == AiTripPostcardErrorReason.Network;

    /// <summary>
    /// The inline error copy shown in the output panel — the offline message for a connectivity fault, else the
    /// "Helix error: &lt;message&gt;" composition (web AiOutputPanel <c>helix.errorLabel</c> + <c>error ?? errorUnknown</c>).
    /// </summary>
    public string DisplayErrorText
    {
        get
        {
            if (!ShowError)
            {
                return string.Empty;
            }

            if (_errorReason == AiTripPostcardErrorReason.Network)
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
    /// Open the draft stream (web <c>stream.start()</c>) as a detached task. A no-op while a stream is in flight
    /// (web <c>isBusy</c> double-submit guard / disabled button), while the gate is off, or while no trip is in
    /// scope (web disabled action when <c>!haveInputs</c>). Builds the <c>{ trip_id, style_hint? }</c> body from
    /// the current selection, resets the accumulated text and error, then consumes the transport on a background
    /// flow.
    /// </summary>
    public void Start()
    {
        if (_disposed || _running || !_isGateOpen || !HaveInputs)
        {
            return;
        }

        var request = new AiTripPostcardRequest(_tripId!.Value, _styleHint);

        _running = true;

        var cts = new CancellationTokenSource();
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Text = string.Empty;
        _errorMessage = string.Empty;
        _errorReason = AiTripPostcardErrorReason.Unknown;
        State = AiTripPostcardStreamState.Streaming;

        _runTask = RunAsync(request, cts.Token);
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

    private async Task RunAsync(AiTripPostcardRequest request, CancellationToken cancellationToken)
    {
        var parser = new SseFrameParser();
        try
        {
            await foreach (var chunk in _transport.OpenAsync(request, cancellationToken).ConfigureAwait(false))
            {
                foreach (var frame in parser.Feed(chunk))
                {
                    var typed = AiTripPostcardStreamParser.ParseFrame(frame);
                    if (typed is not null)
                    {
                        HandleEvent(typed);
                    }
                }
            }

            // web: setState(cur => cur === 'streaming' ? 'done' : cur) — a clean close without a terminal frame
            // still settles the lifecycle; a confirm-pause or prior error is preserved.
            if (_state == AiTripPostcardStreamState.Streaming)
            {
                State = AiTripPostcardStreamState.Done;
            }
        }
        catch (OperationCanceledException)
        {
            // web AbortError path: a user-cancelled stream returns to idle, never error.
            if (_state == AiTripPostcardStreamState.Streaming)
            {
                State = AiTripPostcardStreamState.Idle;
            }
        }
        catch (HttpRequestException ex)
        {
            // A `stream_http_{status}` message is the off-mode / server-fault path; any other HttpRequestException
            // (connection refused, DNS, reset) is a connectivity fault → the offline affordance.
            var reason = ex.Message.StartsWith("stream_http_", StringComparison.Ordinal)
                ? AiTripPostcardErrorReason.Http
                : AiTripPostcardErrorReason.Network;
            FinalizeError(ex.Message, reason);
        }
        catch (IOException ex)
        {
            // A mid-stream read failure is a connectivity fault.
            FinalizeError(ex.Message, AiTripPostcardErrorReason.Network);
        }
        finally
        {
            _running = false;
        }
    }

    private void HandleEvent(AiTripPostcardStreamEvent typed)
    {
        switch (typed.Kind)
        {
            case AiTripPostcardEventKind.Delta:
                Text = string.Concat(_text, typed.Text);
                if (_state != AiTripPostcardStreamState.Streaming)
                {
                    State = AiTripPostcardStreamState.Streaming;
                }

                break;

            case AiTripPostcardEventKind.ConfirmRequest:
                State = AiTripPostcardStreamState.PausedConfirm;
                break;

            case AiTripPostcardEventKind.Done:
                State = AiTripPostcardStreamState.Done;
                break;

            case AiTripPostcardEventKind.Error:
                FinalizeError(typed.Message, AiTripPostcardErrorReason.Stream);
                break;

            case AiTripPostcardEventKind.ToolCall:
            case AiTripPostcardEventKind.ToolResult:
            default:
                // web onEvent is a deliberate no-op for the propose-only drafter: tool frames advance no visible
                // state, and AiOutputPanel renders stream.text directly.
                break;
        }
    }

    private void FinalizeError(string message, AiTripPostcardErrorReason reason)
    {
        _errorMessage = message ?? string.Empty;
        _errorReason = reason;
        State = AiTripPostcardStreamState.Error;
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
