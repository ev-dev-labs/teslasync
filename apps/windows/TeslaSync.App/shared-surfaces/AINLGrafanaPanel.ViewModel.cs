using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AINLGrafanaPanel"/> view — the native port of the
/// web component body (web/src/components/ai/AINLGrafanaPanel.tsx) composed with its <c>AIFeatureCard</c> +
/// <c>useAiStream</c> render contract. It mirrors the web behaviours exactly: the <c>withAiFeature</c> gate
/// (<see cref="IsGateOpen"/>); the <c>canDraft</c> guard (<see cref="CanStart"/> = a non-blank
/// <see cref="Prompt"/>, the surface's only input — there is no vehicle scope, the body is just
/// <c>{ prompt }</c>); the <c>useAiStream</c> lifecycle (<see cref="State"/> idle → streaming → done / error,
/// duplicate <see cref="Start"/> a no-op, cancel → idle); the <c>tool_result</c> capture of the typed
/// <c>draft_grafana_panel</c> envelope into <see cref="Draft"/> (only a <c>status === 'ok'</c> envelope is
/// captured, so the apply action only ever offers a validator-accepted panel); and the propose-only
/// <see cref="Apply"/> handoff (<c>onApply</c>) that NEVER pushes the panel to Grafana — it hands the typed
/// draft to the parent's editor (web <c>canApply = !!draft &amp;&amp; !isStreaming</c>). The view binds the
/// projected labels and flags and never performs HTTP. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class AINLGrafanaPanelViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiGrafanaDraftStreamTransport _transport;
    private readonly ILocalizer _localizer;
    private readonly Action<GrafanaPanelDraft>? _onApply;
    private readonly bool _isGateOpen;

    private string _prompt = string.Empty;
    private AiGrafanaDraftStreamState _state = AiGrafanaDraftStreamState.Idle;
    private string _assistantText = string.Empty;
    private GrafanaPanelDraft? _draft;
    private string _errorMessage = string.Empty;
    private AiGrafanaDraftErrorReason _errorReason = AiGrafanaDraftErrorReason.Unknown;

    private CancellationTokenSource? _cts;
    private bool _running;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over its streaming transport (P1/S8 seam), the AI feature gate, the i18n facade and
    /// the optional propose-only apply callback. Throws when the surface's feature id is not in the canonical AI
    /// feature registry — the native analogue of <c>withAiFeature</c> rejecting an unknown id at module load.
    /// </summary>
    public AINLGrafanaPanelViewModel(
        IAiGrafanaDraftStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        Action<GrafanaPanelDraft>? onApply = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!AINLGrafanaPanelRegistration.IsRegisteredFeature(AINLGrafanaPanelRegistration.FeatureId))
        {
            throw new InvalidOperationException(
                $"Unknown AI feature id '{AINLGrafanaPanelRegistration.FeatureId}'. " +
                "Add it to the AI feature registry (web/src/ai/features.ts) and regenerate.");
        }

        _transport = transport;
        _localizer = localizer;
        _onApply = onApply;
        _isGateOpen = gate.IsEnabled(AINLGrafanaPanelRegistration.FeatureId);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// True when the AI feature is enabled (web <c>useAiEnabled</c>). When false the whole surface renders
    /// nothing — the native analogue of <c>withAiFeature</c> returning <see langword="null"/>.
    /// </summary>
    public bool IsGateOpen => _isGateOpen;

    /// <summary>
    /// The free-form prompt (web local <c>prompt</c> state, bound to the textarea). Reassigning re-evaluates
    /// <see cref="CanStart"/> (web <c>hasPrompt = prompt.trim().length &gt; 0</c>).
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
    public AiGrafanaDraftStreamState State
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
            Raise(nameof(IsApplyEnabled));
            Raise(nameof(DisplayErrorText));
        }
    }

    /// <summary>The accumulated streamed assistant text (web <c>stream.text</c>, fed to the output panel).</summary>
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

    /// <summary>
    /// The captured proposal (web local <c>draft</c> state), set from a successful <c>draft_grafana_panel</c>
    /// <c>tool_result</c> and cleared on each new run. <see langword="null"/> hides the apply action.
    /// </summary>
    public GrafanaPanelDraft? Draft
    {
        get => _draft;
        private set
        {
            if (ReferenceEquals(_draft, value))
            {
                return;
            }

            _draft = value;
            Raise(nameof(Draft));
            Raise(nameof(HasDraft));
            Raise(nameof(DraftPanelTitle));
            Raise(nameof(IsApplyEnabled));
        }
    }

    /// <summary>True while the SSE stream is open (web <c>stream.state === 'streaming'</c>).</summary>
    public bool IsStreaming => _state == AiGrafanaDraftStreamState.Streaming;

    /// <summary>
    /// True when the surface has the input it needs to fire the stream — a non-blank prompt (web
    /// <c>hasPrompt = prompt.trim().length &gt; 0</c>; the AIFeatureCard receives <c>canStart={hasPrompt}</c>).
    /// </summary>
    public bool CanStart => _prompt.Trim().Length > 0;

    /// <summary>
    /// True when the action button is interactive — the prompt is present and no stream is in flight (web
    /// <c>canDraft = !isStreaming &amp;&amp; hasPrompt</c> / card <c>disabled={!canStart || streaming}</c>).
    /// </summary>
    public bool IsActionEnabled => CanStart && !IsStreaming;

    /// <summary>
    /// True once a stream has run (or is running) — the output panel is shown (web <c>AiOutputPanel</c>
    /// <c>hasAnything = text.length &gt; 0 || state ∈ {streaming, error, done}</c>); idle with no text hides it.
    /// </summary>
    public bool HasOutput =>
        _assistantText.Length > 0 ||
        _state is AiGrafanaDraftStreamState.Streaming or AiGrafanaDraftStreamState.Done or AiGrafanaDraftStreamState.Error;

    /// <summary>
    /// True while the stream is open but no text has arrived yet — the thinking indicator shows (web
    /// <c>text.length === 0 &amp;&amp; state === 'streaming'</c>).
    /// </summary>
    public bool IsThinking => IsStreaming && _assistantText.Length == 0;

    /// <summary>True when the stream ended in failure (web <c>state === 'error'</c>).</summary>
    public bool IsError => _state == AiGrafanaDraftStreamState.Error;

    /// <summary>True when the failure was a connectivity fault — drives the offline message rather than the generic error.</summary>
    public bool IsOffline => _state == AiGrafanaDraftStreamState.Error && _errorReason == AiGrafanaDraftErrorReason.Network;

    /// <summary>True when a proposal has been captured (web <c>draft &amp;&amp; ...</c>).</summary>
    public bool HasDraft => _draft is not null;

    /// <summary>
    /// The captured proposal's panel title (web <c>draft.panel.title</c>); empty when no draft. Exposed for the
    /// apply tooltip / accessibility context; the web view itself surfaces only the apply button.
    /// </summary>
    public string DraftPanelTitle => _draft?.Panel.Title ?? string.Empty;

    /// <summary>
    /// True when the apply action is enabled — a proposal is captured and no stream is in flight (web
    /// <c>canApply = !!draft &amp;&amp; !isStreaming</c>). Because only a <c>status === 'ok'</c> envelope is ever
    /// captured, an enabled apply always corresponds to a validator-accepted panel.
    /// </summary>
    public bool IsApplyEnabled => _draft is not null && !IsStreaming;

    /// <summary>The localized card title (web <c>powerGrafana.aiDrafter.title</c>).</summary>
    public string Title => _localizer.GetString(
        AINLGrafanaPanelRegistration.TitleKey,
        AINLGrafanaPanelRegistration.TitleFallback);

    /// <summary>The localized card description (web <c>powerGrafana.aiDrafter.description</c>).</summary>
    public string Description => _localizer.GetString(
        AINLGrafanaPanelRegistration.DescriptionKey,
        AINLGrafanaPanelRegistration.DescriptionFallback);

    /// <summary>The localized per-feature action verb (web <c>powerGrafana.aiDrafter.button</c>).</summary>
    public string DraftButtonLabel => _localizer.GetString(
        AINLGrafanaPanelRegistration.DraftButtonKey,
        AINLGrafanaPanelRegistration.DraftButtonFallback);

    /// <summary>The localized badge text (web <c>powerGrafana.aiDrafter.badge</c>).</summary>
    public string BadgeLabel => _localizer.GetString(
        AINLGrafanaPanelRegistration.BadgeKey,
        AINLGrafanaPanelRegistration.BadgeFallback);

    /// <summary>The localized prompt placeholder (web <c>powerGrafana.aiDrafter.promptPlaceholder</c>).</summary>
    public string PromptPlaceholder => _localizer.GetString(
        AINLGrafanaPanelRegistration.PromptPlaceholderKey,
        AINLGrafanaPanelRegistration.PromptPlaceholderFallback);

    /// <summary>The localized prompt accessible name (web <c>powerGrafana.aiDrafter.promptLabel</c>).</summary>
    public string PromptLabel => _localizer.GetString(
        AINLGrafanaPanelRegistration.PromptLabelKey,
        AINLGrafanaPanelRegistration.PromptLabelFallback);

    /// <summary>The universal idle CTA label (web <c>helix.askHelix</c>).</summary>
    public string AskHelixLabel => _localizer.GetString(
        AINLGrafanaPanelRegistration.AskHelixKey,
        AINLGrafanaPanelRegistration.AskHelixFallback);

    /// <summary>The streaming button label (web <c>helix.thinking</c>).</summary>
    public string ThinkingLabel => _localizer.GetString(
        AINLGrafanaPanelRegistration.ThinkingKey,
        AINLGrafanaPanelRegistration.ThinkingFallback);

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
        string.Concat(AskHelixLabel, " \u00b7 ", DraftButtonLabel);

    /// <summary>The localized apply-to-editor action label (web <c>powerGrafana.aiDrafter.applyButton</c>).</summary>
    public string ApplyButtonLabel => _localizer.GetString(
        AINLGrafanaPanelRegistration.ApplyButtonKey,
        AINLGrafanaPanelRegistration.ApplyButtonFallback);

    /// <summary>The localized apply tooltip (web <c>powerGrafana.aiDrafter.applyTooltip</c>).</summary>
    public string ApplyTooltip => _localizer.GetString(
        AINLGrafanaPanelRegistration.ApplyTooltipKey,
        AINLGrafanaPanelRegistration.ApplyTooltipFallback);

    /// <summary>
    /// The inline error copy shown in the output panel — the offline message for a connectivity fault, else
    /// the "Helix error: &lt;message&gt;" composition (web <c>helix.errorLabel</c> + <c>error ?? errorUnknown</c>).
    /// </summary>
    public string DisplayErrorText
    {
        get
        {
            if (!IsError)
            {
                return string.Empty;
            }

            if (_errorReason == AiGrafanaDraftErrorReason.Network)
            {
                return _localizer.GetString(
                    AINLGrafanaPanelRegistration.OfflineKey,
                    AINLGrafanaPanelRegistration.OfflineFallback);
            }

            var label = _localizer.GetString(
                AINLGrafanaPanelRegistration.ErrorLabelKey,
                AINLGrafanaPanelRegistration.ErrorLabelFallback);
            var message = _errorMessage.Length > 0
                ? _errorMessage
                : _localizer.GetString(
                    AINLGrafanaPanelRegistration.ErrorUnknownKey,
                    AINLGrafanaPanelRegistration.ErrorUnknownFallback);
            return string.Concat(label, " ", message);
        }
    }

    /// <summary>
    /// Fire the draft stream (web <c>handleDraft</c> → <c>stream.start()</c>) as a detached task — the view's
    /// click handler. A duplicate call while streaming, a call with a blank prompt, or a call on a gated-off
    /// surface is a no-op (web button <c>disabled</c> + <c>canDraft</c> guard). Clears any prior draft first.
    /// </summary>
    public void Start() => _ = StartAsync();

    /// <summary>
    /// Run one draft stream and fold every event into <see cref="State"/> / <see cref="AssistantText"/> /
    /// <see cref="Draft"/> — the awaitable core of <see cref="Start"/> (exposed for headless tests). Idempotent
    /// while a stream is in flight; cancelling returns the surface to <see cref="AiGrafanaDraftStreamState.Idle"/>.
    /// </summary>
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

        // web handleDraft: reset the prior proposal before each run (setDraft(null); stream.start()).
        Draft = null;
        AssistantText = string.Empty;
        _errorMessage = string.Empty;
        _errorReason = AiGrafanaDraftErrorReason.Unknown;
        State = AiGrafanaDraftStreamState.Streaming;

        var request = new AiGrafanaDraftRequest(_prompt.Trim());
        try
        {
            await foreach (var ev in _transport.StreamAsync(request, cts.Token).ConfigureAwait(false))
            {
                Apply(ev);
            }

            // web: if the loop ends without a terminal event while still streaming, mark done. A paused-confirm
            // is NOT promoted — the server intentionally closes after confirm_request.
            if (_state == AiGrafanaDraftStreamState.Streaming)
            {
                State = AiGrafanaDraftStreamState.Done;
            }
        }
        catch (OperationCanceledException)
        {
            // web abort path: a cancelled in-flight stream returns to idle.
            if (_state == AiGrafanaDraftStreamState.Streaming)
            {
                State = AiGrafanaDraftStreamState.Idle;
            }
        }
        catch (Exception ex)
        {
            // The transport surfaces failures as Error events; an unexpected throw still ends in the error
            // surface rather than leaving the card stuck in streaming.
            _errorMessage = ex.Message;
            _errorReason = AiGrafanaDraftErrorReason.Unknown;
            State = AiGrafanaDraftStreamState.Error;
        }
        finally
        {
            _running = false;
        }
    }

    /// <summary>
    /// Hand the captured proposal to the parent editor via the <c>onApply</c> callback (web <c>handleApply</c>).
    /// A no-op unless a proposal is captured and no stream is in flight — the surface NEVER pushes the panel to
    /// Grafana; the baseline manual editor's "Copy to clipboard" remains the sole export path (ADR-015
    /// propose-only).
    /// </summary>
    public void Apply()
    {
        if (IsApplyEnabled && _draft is { } captured)
        {
            _onApply?.Invoke(captured);
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

    private void Apply(AiGrafanaDraftStreamEvent ev)
    {
        switch (ev.Kind)
        {
            case AiGrafanaDraftEventKind.Delta:
                AssistantText = string.Concat(_assistantText, ev.Text);
                if (_state != AiGrafanaDraftStreamState.Streaming)
                {
                    State = AiGrafanaDraftStreamState.Streaming;
                }

                break;

            case AiGrafanaDraftEventKind.ToolResult:
                CaptureDraft(ev);
                break;

            case AiGrafanaDraftEventKind.ConfirmRequest:
                State = AiGrafanaDraftStreamState.PausedConfirm;
                break;

            case AiGrafanaDraftEventKind.Done:
                State = AiGrafanaDraftStreamState.Done;
                break;

            case AiGrafanaDraftEventKind.Error:
                _errorMessage = ev.Message;
                _errorReason = ev.ErrorReason;
                Raise(nameof(DisplayErrorText));
                State = AiGrafanaDraftStreamState.Error;
                break;

            case AiGrafanaDraftEventKind.ToolCall:
            default:
                // tool_call frames update no visible state for this surface (web onEvent no-op).
                break;
        }
    }

    private void CaptureDraft(AiGrafanaDraftStreamEvent ev)
    {
        // web onEvent: only the draft tool's successful, well-formed, status==='ok' envelope is captured;
        // anything else (a different tool, ok=false, malformed, or status!=='ok') is ignored so a bad draft
        // never reaches the editor.
        if (!ev.ToolOk ||
            !string.Equals(ev.ToolName, AINLGrafanaPanelRegistration.DraftToolName, StringComparison.Ordinal) ||
            ev.ToolData is not { } envelope)
        {
            return;
        }

        if (GrafanaPanelDraft.TryParse(envelope, out var draft) && draft is not null)
        {
            Draft = draft;
        }
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
