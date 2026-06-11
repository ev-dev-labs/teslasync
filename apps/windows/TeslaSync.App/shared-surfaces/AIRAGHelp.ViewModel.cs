using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AIRAGHelp"/> view — the native port of the web
/// component body (web/src/components/ai/AIRAGHelp.tsx) composed with its <c>AIFeatureCard</c> + <c>useAiStream</c>
/// render contract. It mirrors the web behaviours exactly: the <c>withAiFeature</c> gate
/// (<see cref="IsGateOpen"/>); the <c>canStart</c> guard (<see cref="CanStart"/> = a non-blank
/// <see cref="Prompt"/>, the surface's only input — there is no vehicle scope, the body is just
/// <c>{ prompt }</c>); and the <c>useAiStream</c> lifecycle (<see cref="State"/> idle → streaming → done / error,
/// duplicate <see cref="Start"/> a no-op, cancel → idle). Like the web component, whose <c>onEvent</c> is a
/// no-op, it captures nothing from individual tool frames — it accumulates the <c>delta</c> answer text into
/// <see cref="AssistantText"/> and settles on the terminal frame. The view binds the projected labels and flags
/// and never performs HTTP. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AIRAGHelpViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiHelpStreamTransport _transport;
    private readonly ILocalizer _localizer;
    private readonly bool _isGateOpen;

    private string _prompt = string.Empty;
    private AiHelpStreamState _state = AiHelpStreamState.Idle;
    private string _assistantText = string.Empty;
    private string _errorMessage = string.Empty;
    private AiHelpErrorReason _errorReason = AiHelpErrorReason.Unknown;

    private CancellationTokenSource? _cts;
    private bool _running;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over its streaming transport (P1/S8 seam), the AI feature gate and the i18n facade.
    /// Throws when the surface's feature id is not in the canonical AI feature registry — the native analogue of
    /// <c>withAiFeature</c> rejecting an unknown id at module load.
    /// </summary>
    /// <param name="transport">The cache-free SSE answer transport.</param>
    /// <param name="gate">The AI feature gate (web <c>useAiEnabled</c>); off collapses the whole surface.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public AIRAGHelpViewModel(
        IAiHelpStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!AIRAGHelpRegistration.IsRegisteredFeature(AIRAGHelpRegistration.FeatureId))
        {
            throw new InvalidOperationException(
                $"Unknown AI feature id '{AIRAGHelpRegistration.FeatureId}'. " +
                "Add it to the AI feature registry (web/src/ai/features.ts) and regenerate.");
        }

        _transport = transport;
        _localizer = localizer;
        _isGateOpen = gate.IsEnabled(AIRAGHelpRegistration.FeatureId);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// True when the AI feature is enabled (web <c>useAiEnabled</c>). When false the whole surface renders
    /// nothing — the native analogue of <c>withAiFeature</c> returning <see langword="null"/>.
    /// </summary>
    public bool IsGateOpen => _isGateOpen;

    /// <summary>
    /// The free-form question (web local <c>prompt</c> state, bound to the textarea). Reassigning re-evaluates
    /// <see cref="CanStart"/> (web <c>canStart = prompt.trim().length &gt; 0</c>).
    /// </summary>
    public string Prompt
    {
        get => _prompt;
        set
        {
            var next = value ?? string.Empty;
            if (string.Equals(_prompt, next, StringComparison.Ordinal))
            {
                return;
            }

            _prompt = next;
            Raise(nameof(Prompt));
            Raise(nameof(CanStart));
            Raise(nameof(IsActionEnabled));
        }
    }

    /// <summary>The current stream lifecycle state (web <c>stream.state</c>).</summary>
    public AiHelpStreamState State
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
            Raise(nameof(IsActionEnabled));
            Raise(nameof(IsThinking));
            Raise(nameof(IsError));
            Raise(nameof(IsOffline));
            Raise(nameof(HasOutput));
            Raise(nameof(ActionLabel));
            Raise(nameof(DisplayErrorText));
        }
    }

    /// <summary>The accumulated streamed answer text (web <c>stream.text</c>, fed to the output panel).</summary>
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
    public bool IsStreaming => _state == AiHelpStreamState.Streaming;

    /// <summary>
    /// True when the surface has the input it needs to fire the stream — a non-blank prompt (web
    /// <c>canStart={prompt.trim().length &gt; 0}</c> passed to the AIFeatureCard).
    /// </summary>
    public bool CanStart => _prompt.Trim().Length > 0;

    /// <summary>
    /// True when the action button is interactive — the prompt is present and no stream is in flight (web card
    /// <c>disabled={!canStart || streaming}</c>).
    /// </summary>
    public bool IsActionEnabled => CanStart && !IsStreaming;

    /// <summary>
    /// True once a stream has run (or is running) — the output panel is shown (web <c>AiOutputPanel</c>
    /// <c>hasAnything = text.length &gt; 0 || state ∈ {streaming, error, done}</c>); idle with no text hides it.
    /// </summary>
    public bool HasOutput =>
        _assistantText.Length > 0 ||
        _state is AiHelpStreamState.Streaming or AiHelpStreamState.Done or AiHelpStreamState.Error;

    /// <summary>
    /// True while the stream is open but no text has arrived yet — the thinking indicator shows (web
    /// <c>text.length === 0 &amp;&amp; state === 'streaming'</c>).
    /// </summary>
    public bool IsThinking => IsStreaming && _assistantText.Length == 0;

    /// <summary>True when the stream ended in failure (web <c>state === 'error'</c>).</summary>
    public bool IsError => _state == AiHelpStreamState.Error;

    /// <summary>True when the failure was a connectivity fault — drives the offline message rather than the generic error.</summary>
    public bool IsOffline => _state == AiHelpStreamState.Error && _errorReason == AiHelpErrorReason.Network;

    /// <summary>The localized card title (web <c>help.aiHelp.title</c>).</summary>
    public string Title => _localizer.GetString(
        AIRAGHelpRegistration.TitleKey,
        AIRAGHelpRegistration.TitleFallback);

    /// <summary>The localized card description (web <c>help.aiHelp.description</c>).</summary>
    public string Description => _localizer.GetString(
        AIRAGHelpRegistration.DescriptionKey,
        AIRAGHelpRegistration.DescriptionFallback);

    /// <summary>The localized per-feature action verb (web <c>help.aiHelp.askButton</c>).</summary>
    public string AskButtonLabel => _localizer.GetString(
        AIRAGHelpRegistration.AskButtonKey,
        AIRAGHelpRegistration.AskButtonFallback);

    /// <summary>The localized badge text (web <c>help.aiHelp.badge</c>).</summary>
    public string BadgeLabel => _localizer.GetString(
        AIRAGHelpRegistration.BadgeKey,
        AIRAGHelpRegistration.BadgeFallback);

    /// <summary>The localized prompt placeholder (web <c>help.aiHelp.placeholder</c>).</summary>
    public string PromptPlaceholder => _localizer.GetString(
        AIRAGHelpRegistration.PromptPlaceholderKey,
        AIRAGHelpRegistration.PromptPlaceholderFallback);

    /// <summary>The localized prompt accessible name (native a11y label).</summary>
    public string PromptLabel => _localizer.GetString(
        AIRAGHelpRegistration.PromptLabelKey,
        AIRAGHelpRegistration.PromptLabelFallback);

    /// <summary>The universal idle CTA label (web <c>helix.askHelix</c>).</summary>
    public string AskHelixLabel => _localizer.GetString(
        AIRAGHelpRegistration.AskHelixKey,
        AIRAGHelpRegistration.AskHelixFallback);

    /// <summary>The streaming button label (web <c>helix.thinking</c>).</summary>
    public string ThinkingLabel => _localizer.GetString(
        AIRAGHelpRegistration.ThinkingKey,
        AIRAGHelpRegistration.ThinkingFallback);

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
        string.Concat(AskHelixLabel, " \u00b7 ", AskButtonLabel);

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

            if (_errorReason == AiHelpErrorReason.Network)
            {
                return _localizer.GetString(
                    AIRAGHelpRegistration.OfflineKey,
                    AIRAGHelpRegistration.OfflineFallback);
            }

            var label = _localizer.GetString(
                AIRAGHelpRegistration.ErrorLabelKey,
                AIRAGHelpRegistration.ErrorLabelFallback);
            var message = _errorMessage.Length > 0
                ? _errorMessage
                : _localizer.GetString(
                    AIRAGHelpRegistration.ErrorUnknownKey,
                    AIRAGHelpRegistration.ErrorUnknownFallback);
            return string.Concat(label, " ", message);
        }
    }

    /// <summary>
    /// Fire the help stream (web <c>handleAsk</c> → <c>stream.start()</c>) as a detached task — the view's click
    /// handler. A duplicate call while streaming, a call with a blank prompt, or a call on a gated-off surface is
    /// a no-op (web button <c>disabled</c> + <c>canStart</c> guard).
    /// </summary>
    public void Start() => _ = StartAsync();

    /// <summary>
    /// Run one help stream and fold every event into <see cref="State"/> / <see cref="AssistantText"/> — the
    /// awaitable core of <see cref="Start"/> (exposed for headless tests). Idempotent while a stream is in
    /// flight; cancelling returns the surface to <see cref="AiHelpStreamState.Idle"/>.
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

        // web start(): reset the prior answer/error before each run (setText(''); setError(null)).
        AssistantText = string.Empty;
        _errorMessage = string.Empty;
        _errorReason = AiHelpErrorReason.Unknown;
        State = AiHelpStreamState.Streaming;

        var request = new AiHelpRequest(_prompt.Trim());
        try
        {
            await foreach (var ev in _transport.StreamAsync(request, cts.Token).ConfigureAwait(false))
            {
                Apply(ev);
            }

            // web: if the loop ends without a terminal event while still streaming, mark done. A paused-confirm
            // is NOT promoted — the server intentionally closes after confirm_request.
            if (_state == AiHelpStreamState.Streaming)
            {
                State = AiHelpStreamState.Done;
            }
        }
        catch (OperationCanceledException)
        {
            // web abort path: a cancelled in-flight stream returns to idle.
            if (_state == AiHelpStreamState.Streaming)
            {
                State = AiHelpStreamState.Idle;
            }
        }
        catch (Exception ex)
        {
            // The transport surfaces failures as Error events; an unexpected throw still ends in the error
            // surface rather than leaving the card stuck in streaming.
            _errorMessage = ex.Message;
            _errorReason = AiHelpErrorReason.Unknown;
            State = AiHelpStreamState.Error;
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

    private void Apply(AiHelpStreamEvent ev)
    {
        switch (ev.Kind)
        {
            case AiHelpEventKind.Delta:
                AssistantText = string.Concat(_assistantText, ev.Text);
                if (_state != AiHelpStreamState.Streaming)
                {
                    State = AiHelpStreamState.Streaming;
                }

                break;

            case AiHelpEventKind.ConfirmRequest:
                State = AiHelpStreamState.PausedConfirm;
                break;

            case AiHelpEventKind.Done:
                State = AiHelpStreamState.Done;
                break;

            case AiHelpEventKind.Error:
                _errorMessage = ev.Message;
                _errorReason = ev.ErrorReason;
                Raise(nameof(DisplayErrorText));
                State = AiHelpStreamState.Error;
                break;

            case AiHelpEventKind.ToolCall:
            case AiHelpEventKind.ToolResult:
            default:
                // tool_call / tool_result frames update no visible state for this surface (web onEvent no-op).
                break;
        }
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
