using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AIWatchFaceNLResponse"/> view — the native port of
/// the web component body (web/src/components/ai/AIWatchFaceNLResponse.tsx) composed with its
/// <c>AIFeatureCard</c> + <c>useAiStream</c> render contract. It mirrors the web behaviours exactly: the
/// <c>withAiFeature</c> gate (<see cref="IsGateOpen"/>); the <c>canStart</c> guard
/// (<see cref="CanStart"/> = the trimmed <see cref="Message"/> is within the
/// <see cref="AIWatchFaceNLResponseRegistration.MaxMessageChars"/> cap AND the stream is not paused for a
/// tool-confirmation — an EMPTY question is allowed because the backend applies a deterministic glance-summary
/// default); and the <c>useAiStream</c> lifecycle (<see cref="State"/> idle → streaming → done / error,
/// duplicate <see cref="Start"/> a no-op, cancel → idle). Like the web component, whose <c>onEvent</c> is a
/// no-op, it captures nothing from individual tool frames — it accumulates the <c>delta</c> narration text into
/// <see cref="AssistantText"/> and settles on the terminal frame. The view binds the projected labels and flags
/// and never performs HTTP. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AIWatchFaceNLResponseViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiWatchStreamTransport _transport;
    private readonly ILocalizer _localizer;
    private readonly bool _isGateOpen;

    private string _message = string.Empty;
    private AiWatchStreamState _state = AiWatchStreamState.Idle;
    private string _assistantText = string.Empty;
    private string _errorMessage = string.Empty;
    private AiWatchErrorReason _errorReason = AiWatchErrorReason.Unknown;

    private CancellationTokenSource? _cts;
    private bool _running;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over its streaming transport (P1/S8 seam), the AI feature gate and the i18n facade.
    /// Throws when the surface's feature id is not in the canonical AI feature registry — the native analogue of
    /// <c>withAiFeature</c> rejecting an unknown id at module load.
    /// </summary>
    /// <param name="transport">The cache-free SSE narration transport.</param>
    /// <param name="gate">The AI feature gate (web <c>useAiEnabled</c>); off collapses the whole surface.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public AIWatchFaceNLResponseViewModel(
        IAiWatchStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!AIWatchFaceNLResponseRegistration.IsRegisteredFeature(AIWatchFaceNLResponseRegistration.FeatureId))
        {
            throw new InvalidOperationException(
                $"Unknown AI feature id '{AIWatchFaceNLResponseRegistration.FeatureId}'. " +
                "Add it to the AI feature registry (web/src/ai/features.ts) and regenerate.");
        }

        _transport = transport;
        _localizer = localizer;
        _isGateOpen = gate.IsEnabled(AIWatchFaceNLResponseRegistration.FeatureId);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// True when the AI feature is enabled (web <c>useAiEnabled</c>). When false the whole surface renders
    /// nothing — the native analogue of <c>withAiFeature</c> returning <see langword="null"/>.
    /// </summary>
    public bool IsGateOpen => _isGateOpen;

    /// <summary>
    /// The free-form glance-style question (web local <c>message</c> state, bound to the textarea). Reassigning
    /// re-evaluates <see cref="CanStart"/> (web <c>canStart</c> via <c>messageWithinCap</c>).
    /// </summary>
    public string Message
    {
        get => _message;
        set
        {
            var next = value ?? string.Empty;
            if (string.Equals(_message, next, StringComparison.Ordinal))
            {
                return;
            }

            _message = next;
            Raise(nameof(Message));
            Raise(nameof(MessageWithinCap));
            Raise(nameof(CanStart));
            Raise(nameof(IsActionEnabled));
        }
    }

    /// <summary>The current stream lifecycle state (web <c>stream.state</c>).</summary>
    public AiWatchStreamState State
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
            Raise(nameof(CanStart));
            Raise(nameof(IsActionEnabled));
            Raise(nameof(IsThinking));
            Raise(nameof(IsError));
            Raise(nameof(IsOffline));
            Raise(nameof(HasOutput));
            Raise(nameof(ActionLabel));
            Raise(nameof(DisplayErrorText));
        }
    }

    /// <summary>The accumulated streamed narration text (web <c>stream.text</c>, fed to the output panel).</summary>
    public string AssistantText
    {
        get => _assistantText;
        private set
        {
            if (string.Equals(_assistantText, value, StringComparison.Ordinal))
            {
                return;
            }

            _assistantText = value;
            Raise(nameof(AssistantText));
            Raise(nameof(IsThinking));
            Raise(nameof(HasOutput));
        }
    }

    /// <summary>True while the SSE stream is open (web <c>stream.state === 'streaming'</c>).</summary>
    public bool IsStreaming => _state == AiWatchStreamState.Streaming;

    /// <summary>
    /// True when the trimmed question fits within the backend cap (web
    /// <c>messageWithinCap = trimmedMessage.length &lt;= MaxMessageChars</c>). An empty question is within the
    /// cap — the textarea also hard-caps input at the same length.
    /// </summary>
    public bool MessageWithinCap =>
        _message.Trim().Length <= AIWatchFaceNLResponseRegistration.MaxMessageChars;

    /// <summary>
    /// True when the surface may fire the stream — the question is within the cap AND the stream is not paused
    /// for a tool confirmation (web <c>canStart = messageWithinCap &amp;&amp; stream.state !== 'paused-confirm'</c>).
    /// An empty question is allowed; the backend applies its default glance-summary prompt.
    /// </summary>
    public bool CanStart => MessageWithinCap && _state != AiWatchStreamState.PausedConfirm;

    /// <summary>
    /// True when the action button is interactive — <see cref="CanStart"/> and no stream in flight (web card
    /// <c>disabled={!canStart || streaming}</c>).
    /// </summary>
    public bool IsActionEnabled => CanStart && !IsStreaming;

    /// <summary>
    /// True once a stream has run (or is running) — the output panel is shown (web <c>AiOutputPanel</c>
    /// <c>hasAnything = text.length &gt; 0 || state ∈ {streaming, error, done}</c>); idle with no text hides it.
    /// </summary>
    public bool HasOutput =>
        _assistantText.Length > 0 ||
        _state is AiWatchStreamState.Streaming or AiWatchStreamState.Done or AiWatchStreamState.Error;

    /// <summary>
    /// True while the stream is open but no text has arrived yet — the thinking indicator shows (web
    /// <c>text.length === 0 &amp;&amp; state === 'streaming'</c>).
    /// </summary>
    public bool IsThinking => IsStreaming && _assistantText.Length == 0;

    /// <summary>True when the stream ended in failure (web <c>state === 'error'</c>).</summary>
    public bool IsError => _state == AiWatchStreamState.Error;

    /// <summary>True when the failure was a connectivity fault — drives the offline message rather than the generic error.</summary>
    public bool IsOffline => _state == AiWatchStreamState.Error && _errorReason == AiWatchErrorReason.Network;

    /// <summary>The localized card title (web <c>watchFaceNL.title</c>).</summary>
    public string Title => _localizer.GetString(
        AIWatchFaceNLResponseRegistration.TitleKey,
        AIWatchFaceNLResponseRegistration.TitleFallback);

    /// <summary>The localized card description (web <c>watchFaceNL.description</c>).</summary>
    public string Description => _localizer.GetString(
        AIWatchFaceNLResponseRegistration.DescriptionKey,
        AIWatchFaceNLResponseRegistration.DescriptionFallback);

    /// <summary>The localized per-feature action verb (web <c>watchFaceNL.button</c>).</summary>
    public string ButtonLabel => _localizer.GetString(
        AIWatchFaceNLResponseRegistration.ButtonKey,
        AIWatchFaceNLResponseRegistration.ButtonFallback);

    /// <summary>The localized badge text (web <c>watchFaceNL.badge</c>).</summary>
    public string BadgeLabel => _localizer.GetString(
        AIWatchFaceNLResponseRegistration.BadgeKey,
        AIWatchFaceNLResponseRegistration.BadgeFallback);

    /// <summary>The localized question placeholder (web <c>watchFaceNL.placeholder</c>).</summary>
    public string Placeholder => _localizer.GetString(
        AIWatchFaceNLResponseRegistration.PlaceholderKey,
        AIWatchFaceNLResponseRegistration.PlaceholderFallback);

    /// <summary>The localized question accessible name (web textarea <c>aria-label</c>, <c>watchFaceNL.inputLabel</c>).</summary>
    public string InputLabel => _localizer.GetString(
        AIWatchFaceNLResponseRegistration.InputLabelKey,
        AIWatchFaceNLResponseRegistration.InputLabelFallback);

    /// <summary>The universal idle CTA label (web <c>helix.askHelix</c>).</summary>
    public string AskHelixLabel => _localizer.GetString(
        AIWatchFaceNLResponseRegistration.AskHelixKey,
        AIWatchFaceNLResponseRegistration.AskHelixFallback);

    /// <summary>The streaming button label (web <c>helix.thinking</c>).</summary>
    public string ThinkingLabel => _localizer.GetString(
        AIWatchFaceNLResponseRegistration.ThinkingKey,
        AIWatchFaceNLResponseRegistration.ThinkingFallback);

    /// <summary>
    /// The button's visible label — the streaming "thinking" copy while in flight, otherwise the universal
    /// "Ask Helix" CTA (web <c>{isStreaming ? &lt;AIThinkingDots/&gt; : askHelixLabel}</c>).
    /// </summary>
    public string ActionLabel => IsStreaming ? ThinkingLabel : AskHelixLabel;

    /// <summary>
    /// The button's accessible name — "Ask Helix · &lt;verb&gt;" (web button
    /// <c>aria-label={`${askHelixLabel} · ${buttonLabel}`}</c>).
    /// </summary>
    public string ActionAutomationName =>
        string.Concat(AskHelixLabel, " \u00b7 ", ButtonLabel);

    /// <summary>
    /// The inline error copy shown in the output panel — the offline message for a connectivity fault, else the
    /// "Helix error: &lt;message&gt;" composition (web <c>helix.errorLabel</c> + <c>error ?? errorUnknown</c>).
    /// </summary>
    public string DisplayErrorText
    {
        get
        {
            if (!IsError)
            {
                return string.Empty;
            }

            if (_errorReason == AiWatchErrorReason.Network)
            {
                return _localizer.GetString(
                    AIWatchFaceNLResponseRegistration.OfflineKey,
                    AIWatchFaceNLResponseRegistration.OfflineFallback);
            }

            var label = _localizer.GetString(
                AIWatchFaceNLResponseRegistration.ErrorLabelKey,
                AIWatchFaceNLResponseRegistration.ErrorLabelFallback);
            var message = _errorMessage.Length > 0
                ? _errorMessage
                : _localizer.GetString(
                    AIWatchFaceNLResponseRegistration.ErrorUnknownKey,
                    AIWatchFaceNLResponseRegistration.ErrorUnknownFallback);
            return string.Concat(label, " ", message);
        }
    }

    /// <summary>
    /// Fire the watch stream (web Ask button → <c>stream.start()</c>) as a detached task — the view's click
    /// handler. A duplicate call while streaming, a call that would exceed the cap, a call while paused for a
    /// tool confirmation, or a call on a gated-off surface is a no-op (web button <c>disabled</c> +
    /// <c>canStart</c> guard).
    /// </summary>
    public void Start() => _ = StartAsync();

    /// <summary>
    /// Run one watch stream and fold every event into <see cref="State"/> / <see cref="AssistantText"/> — the
    /// awaitable core of <see cref="Start"/> (exposed for headless tests). Idempotent while a stream is in
    /// flight; cancelling returns the surface to <see cref="AiWatchStreamState.Idle"/>.
    /// </summary>
    /// <param name="cancellationToken">Cancels the run (linked into the stream's abort token).</param>
    /// <returns>A task that completes when the stream settles.</returns>
    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed || _running || !_isGateOpen || !CanStart)
        {
            return;
        }

        _running = true;

        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        // web start(): reset the prior narration/error before each run (setText(''); setError(null)).
        AssistantText = string.Empty;
        _errorMessage = string.Empty;
        _errorReason = AiWatchErrorReason.Unknown;
        State = AiWatchStreamState.Streaming;

        // web body: send the trimmed question, or null (omitted → {}) for an empty field so the backend applies
        // its deterministic glance-summary default prompt.
        var trimmed = _message.Trim();
        var request = new AiWatchRequest(trimmed.Length > 0 ? trimmed : null);
        try
        {
            await foreach (var ev in _transport.StreamAsync(request, cts.Token).ConfigureAwait(false))
            {
                Apply(ev);
            }

            // web: if the loop ends without a terminal event while still streaming, mark done. A paused-confirm
            // is NOT promoted — the server intentionally closes after confirm_request.
            if (_state == AiWatchStreamState.Streaming)
            {
                State = AiWatchStreamState.Done;
            }
        }
        catch (OperationCanceledException)
        {
            // web abort path: a cancelled in-flight stream returns to idle.
            if (_state == AiWatchStreamState.Streaming)
            {
                State = AiWatchStreamState.Idle;
            }
        }
        catch (Exception ex)
        {
            // The transport surfaces failures as Error events; an unexpected throw still ends in the error
            // surface rather than leaving the card stuck in streaming.
            _errorMessage = ex.Message;
            _errorReason = AiWatchErrorReason.Unknown;
            State = AiWatchStreamState.Error;
        }
        finally
        {
            _running = false;
        }
    }

    /// <summary>Abort the in-flight stream (web <c>stream.cancel()</c>); the lifecycle returns to idle.</summary>
    public void Cancel()
    {
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
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

    private void Apply(AiWatchStreamEvent ev)
    {
        switch (ev.Kind)
        {
            case AiWatchEventKind.Delta:
                AssistantText = string.Concat(_assistantText, ev.Text);
                if (_state != AiWatchStreamState.Streaming)
                {
                    State = AiWatchStreamState.Streaming;
                }

                break;

            case AiWatchEventKind.ConfirmRequest:
                State = AiWatchStreamState.PausedConfirm;
                break;

            case AiWatchEventKind.Done:
                State = AiWatchStreamState.Done;
                break;

            case AiWatchEventKind.Error:
                _errorMessage = ev.Message;
                _errorReason = ev.ErrorReason;
                Raise(nameof(DisplayErrorText));
                State = AiWatchStreamState.Error;
                break;

            case AiWatchEventKind.ToolCall:
            case AiWatchEventKind.ToolResult:
            default:
                // tool_call / tool_result frames update no visible state for this surface (web onEvent no-op).
                break;
        }
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
