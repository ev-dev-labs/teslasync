using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AIGeofenceAwareAutomationSuggestions"/> view — the
/// native port of the web component body (web/src/components/ai/AIGeofenceAwareAutomationSuggestions.tsx)
/// composed with its <c>AIFeatureCard</c> + <c>useAiStream</c> render contract. It mirrors the web behaviours
/// exactly: the <c>withAiFeature</c> gate (<see cref="IsGateOpen"/>); the <c>canStart</c> guard
/// (<see cref="CanStart"/> = a resolved <c>vehicle_id &gt; 0</c>, a non-blank <see cref="Prompt"/>, and a
/// non-<c>paused-confirm</c> stream); the <c>useAiStream</c> lifecycle (<see cref="State"/> idle → streaming →
/// done / error, duplicate <see cref="Start"/> a no-op, cancel → idle); the <c>tool_result</c> capture of the
/// typed <c>draft_automation_graph</c> envelope into <see cref="Draft"/>; and the propose-only
/// <see cref="Apply"/> handoff (<c>onApplyDraft</c>) that NEVER writes to the API. Changing
/// <see cref="VehicleId"/> cancels any in-flight stream and clears the draft, mirroring the web cleanup effect.
/// The view binds the projected labels and flags and never performs HTTP. Drive it from one confinement (the
/// UI thread); it is not internally synchronised.
/// </summary>
public sealed class AIGeofenceAwareAutomationSuggestionsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiAutomationDraftStreamTransport _transport;
    private readonly ILocalizer _localizer;
    private readonly Action<GeofenceAutomationGraph>? _onApplyDraft;
    private readonly bool _isGateOpen;

    private long? _vehicleId;
    private string _prompt = string.Empty;
    private AiAutomationDraftStreamState _state = AiAutomationDraftStreamState.Idle;
    private string _assistantText = string.Empty;
    private GeofenceAutomationDraft? _draft;
    private string _errorMessage = string.Empty;
    private AiAutomationDraftErrorReason _errorReason = AiAutomationDraftErrorReason.Unknown;

    private CancellationTokenSource? _cts;
    private bool _running;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over its streaming transport (P1/S8 seam), the AI feature gate, the i18n facade, the
    /// optional in-scope vehicle id and the optional propose-only apply callback. Throws when the surface's
    /// feature id is not in the canonical AI feature registry — the native analogue of <c>withAiFeature</c>
    /// rejecting an unknown id at module load.
    /// </summary>
    public AIGeofenceAwareAutomationSuggestionsViewModel(
        IAiAutomationDraftStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        long? vehicleId = null,
        Action<GeofenceAutomationGraph>? onApplyDraft = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!AIGeofenceAwareAutomationSuggestionsRegistration.IsRegisteredFeature(
                AIGeofenceAwareAutomationSuggestionsRegistration.FeatureId))
        {
            throw new InvalidOperationException(
                $"Unknown AI feature id '{AIGeofenceAwareAutomationSuggestionsRegistration.FeatureId}'. " +
                "Add it to the AI feature registry (web/src/ai/features.ts) and regenerate.");
        }

        _transport = transport;
        _localizer = localizer;
        _vehicleId = vehicleId;
        _onApplyDraft = onApplyDraft;
        _isGateOpen = gate.IsEnabled(AIGeofenceAwareAutomationSuggestionsRegistration.FeatureId);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// True when the AI feature is enabled (web <c>useAiEnabled</c>). When false the whole surface renders
    /// nothing — the native analogue of <c>withAiFeature</c> returning <see langword="null"/>.
    /// </summary>
    public bool IsGateOpen => _isGateOpen;

    /// <summary>
    /// The in-scope vehicle id (web <c>vehicleId</c> prop). Reassigning re-evaluates <see cref="CanStart"/>
    /// and — mirroring the web cleanup effect keyed on <c>vehicleId</c> — cancels any in-flight stream and
    /// clears the captured draft so a proposal from a previously-selected vehicle cannot bleed into the new
    /// scope.
    /// </summary>
    public long? VehicleId
    {
        get => _vehicleId;
        set
        {
            if (_vehicleId == value)
            {
                return;
            }

            _vehicleId = value;
            Cancel();
            Draft = null;
            Raise(nameof(VehicleId));
            Raise(nameof(CanStart));
            Raise(nameof(IsActionEnabled));
        }
    }

    /// <summary>
    /// The free-form prompt (web local <c>prompt</c> state, bound to the textarea). Reassigning re-evaluates
    /// <see cref="CanStart"/> (web <c>prompt.trim().length &gt; 0</c>).
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
    public AiAutomationDraftStreamState State
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
    /// The captured proposal (web local <c>draft</c> state), set from a successful <c>draft_automation_graph</c>
    /// <c>tool_result</c> and cleared on each new run / vehicle change. <see langword="null"/> hides the
    /// proposal panel.
    /// </summary>
    public GeofenceAutomationDraft? Draft
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
            Raise(nameof(DraftName));
            Raise(nameof(DraftDescription));
            Raise(nameof(HasDraftDescription));
            Raise(nameof(DraftSummaryText));
            Raise(nameof(DraftValidationError));
            Raise(nameof(HasDraftValidationError));
            Raise(nameof(IsDraftRejected));
            Raise(nameof(IsApplyEnabled));
        }
    }

    /// <summary>True while the SSE stream is open (web <c>stream.state === 'streaming'</c>).</summary>
    public bool IsStreaming => _state == AiAutomationDraftStreamState.Streaming;

    /// <summary>
    /// True when the surface has the inputs it needs to fire the stream — a resolved <c>vehicle_id &gt; 0</c>,
    /// a non-blank prompt, and a stream that is not awaiting a confirmation (web
    /// <c>(vehicleId ?? 0) &gt; 0 &amp;&amp; prompt.trim().length &gt; 0 &amp;&amp; stream.state !== 'paused-confirm'</c>).
    /// </summary>
    public bool CanStart =>
        _vehicleId is > 0 &&
        _prompt.Trim().Length > 0 &&
        _state != AiAutomationDraftStreamState.PausedConfirm;

    /// <summary>
    /// True when the action button is interactive — inputs are present and no stream is in flight (web button
    /// <c>disabled={!canStart || streaming}</c>).
    /// </summary>
    public bool IsActionEnabled => CanStart && !IsStreaming;

    /// <summary>
    /// True once a stream has run (or is running) — the output panel is shown (web <c>AiOutputPanel</c>
    /// <c>hasAnything = text.length &gt; 0 || state ∈ {streaming, error, done}</c>); idle with no text hides it.
    /// </summary>
    public bool HasOutput =>
        _assistantText.Length > 0 ||
        _state is AiAutomationDraftStreamState.Streaming or AiAutomationDraftStreamState.Done or AiAutomationDraftStreamState.Error;

    /// <summary>
    /// True while the stream is open but no text has arrived yet — the thinking indicator shows (web
    /// <c>text.length === 0 &amp;&amp; state === 'streaming'</c>).
    /// </summary>
    public bool IsThinking => IsStreaming && _assistantText.Length == 0;

    /// <summary>True when the stream ended in failure (web <c>state === 'error'</c>).</summary>
    public bool IsError => _state == AiAutomationDraftStreamState.Error;

    /// <summary>True when the failure was a connectivity fault — drives the offline message rather than the generic error.</summary>
    public bool IsOffline => _state == AiAutomationDraftStreamState.Error && _errorReason == AiAutomationDraftErrorReason.Network;

    /// <summary>True when a proposal has been captured (web <c>draft &amp;&amp; ...</c>).</summary>
    public bool HasDraft => _draft is not null;

    /// <summary>The localized card title (web <c>automations.builder.aiGeofenceAware.title</c>).</summary>
    public string Title => _localizer.GetString(
        AIGeofenceAwareAutomationSuggestionsRegistration.TitleKey,
        AIGeofenceAwareAutomationSuggestionsRegistration.TitleFallback);

    /// <summary>The localized card description (web <c>automations.builder.aiGeofenceAware.description</c>).</summary>
    public string Description => _localizer.GetString(
        AIGeofenceAwareAutomationSuggestionsRegistration.DescriptionKey,
        AIGeofenceAwareAutomationSuggestionsRegistration.DescriptionFallback);

    /// <summary>The localized per-feature action verb (web <c>automations.builder.aiGeofenceAware.suggestButton</c>).</summary>
    public string SuggestButtonLabel => _localizer.GetString(
        AIGeofenceAwareAutomationSuggestionsRegistration.SuggestButtonKey,
        AIGeofenceAwareAutomationSuggestionsRegistration.SuggestButtonFallback);

    /// <summary>The localized badge text (web <c>automations.builder.aiGeofenceAware.badge</c>).</summary>
    public string BadgeLabel => _localizer.GetString(
        AIGeofenceAwareAutomationSuggestionsRegistration.BadgeKey,
        AIGeofenceAwareAutomationSuggestionsRegistration.BadgeFallback);

    /// <summary>The localized prompt placeholder (web <c>automations.builder.aiGeofenceAware.placeholder</c>).</summary>
    public string PlaceholderText => _localizer.GetString(
        AIGeofenceAwareAutomationSuggestionsRegistration.PlaceholderKey,
        AIGeofenceAwareAutomationSuggestionsRegistration.PlaceholderFallback);

    /// <summary>The universal idle CTA label (web <c>helix.askHelix</c>).</summary>
    public string AskHelixLabel => _localizer.GetString(
        AIGeofenceAwareAutomationSuggestionsRegistration.AskHelixKey,
        AIGeofenceAwareAutomationSuggestionsRegistration.AskHelixFallback);

    /// <summary>The streaming button label (web <c>helix.thinking</c>).</summary>
    public string ThinkingLabel => _localizer.GetString(
        AIGeofenceAwareAutomationSuggestionsRegistration.ThinkingKey,
        AIGeofenceAwareAutomationSuggestionsRegistration.ThinkingFallback);

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
        string.Concat(AskHelixLabel, " \u00b7 ", SuggestButtonLabel);

    /// <summary>The localized "Proposed automation" heading (web <c>automations.builder.aiGeofenceAware.proposalLabel</c>).</summary>
    public string ProposalLabel => _localizer.GetString(
        AIGeofenceAwareAutomationSuggestionsRegistration.ProposalLabelKey,
        AIGeofenceAwareAutomationSuggestionsRegistration.ProposalLabelFallback);

    /// <summary>The localized apply-to-form action label (web <c>automations.builder.aiGeofenceAware.applyButton</c>).</summary>
    public string ApplyButtonLabel => _localizer.GetString(
        AIGeofenceAwareAutomationSuggestionsRegistration.ApplyButtonKey,
        AIGeofenceAwareAutomationSuggestionsRegistration.ApplyButtonFallback);

    /// <summary>The localized validator-rejected message (web <c>automations.builder.aiGeofenceAware.rejectedLabel</c>).</summary>
    public string RejectedLabel => _localizer.GetString(
        AIGeofenceAwareAutomationSuggestionsRegistration.RejectedLabelKey,
        AIGeofenceAwareAutomationSuggestionsRegistration.RejectedLabelFallback);

    /// <summary>
    /// The captured proposal's display name — its name, or the localized "(unnamed)" fallback when blank
    /// (web <c>draft.draft.name || t('...unnamed')</c>).
    /// </summary>
    public string DraftName
    {
        get
        {
            if (_draft is null)
            {
                return string.Empty;
            }

            return _draft.Graph.Name.Length > 0
                ? _draft.Graph.Name
                : _localizer.GetString(
                    AIGeofenceAwareAutomationSuggestionsRegistration.UnnamedKey,
                    AIGeofenceAwareAutomationSuggestionsRegistration.UnnamedFallback);
        }
    }

    /// <summary>The captured proposal's description (web <c>draft.draft.description</c>); empty when none.</summary>
    public string DraftDescription => _draft?.Graph.Description ?? string.Empty;

    /// <summary>True when the captured proposal carries a non-empty description (web <c>draft.draft.description &amp;&amp; ...</c>).</summary>
    public bool HasDraftDescription => DraftDescription.Length > 0;

    /// <summary>
    /// The "Triggers: N · Conditions: M · Actions: K" summary line — the native composition of the web step
    /// counts (web <c>triggers.length · conditions.length · actions.length</c>) using the localized labels.
    /// </summary>
    public string DraftSummaryText
    {
        get
        {
            if (_draft is null)
            {
                return string.Empty;
            }

            var triggers = _localizer.GetString(
                AIGeofenceAwareAutomationSuggestionsRegistration.TriggersLabelKey,
                AIGeofenceAwareAutomationSuggestionsRegistration.TriggersLabelFallback);
            var conditions = _localizer.GetString(
                AIGeofenceAwareAutomationSuggestionsRegistration.ConditionsLabelKey,
                AIGeofenceAwareAutomationSuggestionsRegistration.ConditionsLabelFallback);
            var actions = _localizer.GetString(
                AIGeofenceAwareAutomationSuggestionsRegistration.ActionsLabelKey,
                AIGeofenceAwareAutomationSuggestionsRegistration.ActionsLabelFallback);

            return string.Create(
                CultureInfo.InvariantCulture,
                $"{triggers}: {_draft.Graph.Triggers.Count} \u00b7 {conditions}: {_draft.Graph.Conditions.Count} \u00b7 {actions}: {_draft.Graph.Actions.Count}");
        }
    }

    /// <summary>The captured proposal's validation error (web <c>draft.validation_error</c>); empty when none.</summary>
    public string DraftValidationError => _draft?.ValidationError ?? string.Empty;

    /// <summary>True when the captured proposal carries a validation-error message (web <c>draft.validation_error &amp;&amp; ...</c>).</summary>
    public bool HasDraftValidationError => DraftValidationError.Length > 0;

    /// <summary>True when the captured proposal was rejected by the validator (web <c>draft.status !== 'ok'</c>).</summary>
    public bool IsDraftRejected => _draft is not null && !_draft.IsOk;

    /// <summary>
    /// True when the apply action is enabled — a proposal is captured and the validator accepted it (web apply
    /// button <c>disabled={draft.status !== 'ok'}</c>).
    /// </summary>
    public bool IsApplyEnabled => _draft is { IsOk: true };

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

            if (_errorReason == AiAutomationDraftErrorReason.Network)
            {
                return _localizer.GetString(
                    AIGeofenceAwareAutomationSuggestionsRegistration.OfflineKey,
                    AIGeofenceAwareAutomationSuggestionsRegistration.OfflineFallback);
            }

            var label = _localizer.GetString(
                AIGeofenceAwareAutomationSuggestionsRegistration.ErrorLabelKey,
                AIGeofenceAwareAutomationSuggestionsRegistration.ErrorLabelFallback);
            var message = _errorMessage.Length > 0
                ? _errorMessage
                : _localizer.GetString(
                    AIGeofenceAwareAutomationSuggestionsRegistration.ErrorUnknownKey,
                    AIGeofenceAwareAutomationSuggestionsRegistration.ErrorUnknownFallback);
            return string.Concat(label, " ", message);
        }
    }

    /// <summary>
    /// Fire the draft stream (web <c>handleSuggest</c> → <c>stream.start()</c>) as a detached task — the view's
    /// click handler. A duplicate call while streaming, a call with missing inputs, or a call on a gated-off
    /// surface is a no-op (web button <c>disabled</c> + <c>isBusy</c> guard). Clears any prior draft first.
    /// </summary>
    public void Start() => _ = StartAsync();

    /// <summary>
    /// Run one draft stream and fold every event into <see cref="State"/> / <see cref="AssistantText"/> /
    /// <see cref="Draft"/> — the awaitable core of <see cref="Start"/> (exposed for headless tests). Idempotent
    /// while a stream is in flight; cancelling returns the surface to <see cref="AiAutomationDraftStreamState.Idle"/>.
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

        // web handleSuggest: reset the prior proposal before each run.
        Draft = null;
        AssistantText = string.Empty;
        _errorMessage = string.Empty;
        _errorReason = AiAutomationDraftErrorReason.Unknown;
        State = AiAutomationDraftStreamState.Streaming;

        var request = new AiAutomationDraftRequest(_vehicleId ?? 0, _prompt);
        try
        {
            await foreach (var ev in _transport.StreamAsync(request, cts.Token).ConfigureAwait(false))
            {
                Apply(ev);
            }

            // web: if the loop ends without a terminal event while still streaming, mark done. Critically a
            // paused-confirm is NOT promoted — the server intentionally closes after confirm_request.
            if (_state == AiAutomationDraftStreamState.Streaming)
            {
                State = AiAutomationDraftStreamState.Done;
            }
        }
        catch (OperationCanceledException)
        {
            // web abort path: a cancelled in-flight stream returns to idle.
            if (_state == AiAutomationDraftStreamState.Streaming)
            {
                State = AiAutomationDraftStreamState.Idle;
            }
        }
        catch (Exception ex)
        {
            // The transport surfaces failures as Error events; an unexpected throw still ends in the error
            // surface rather than leaving the card stuck in streaming.
            _errorMessage = ex.Message;
            _errorReason = AiAutomationDraftErrorReason.Unknown;
            State = AiAutomationDraftStreamState.Error;
        }
        finally
        {
            _running = false;
        }
    }

    /// <summary>
    /// Copy the captured proposal into the baseline form via the <c>onApplyDraft</c> callback (web
    /// <c>handleApply</c>). A no-op unless a proposal is captured and the validator accepted it — the surface
    /// NEVER writes to the API; the baseline Save path remains the sole write surface (ADR-015 propose-only).
    /// </summary>
    public void Apply()
    {
        if (_draft is { IsOk: true } accepted)
        {
            _onApplyDraft?.Invoke(accepted.Graph);
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

    private void Apply(AiAutomationDraftStreamEvent ev)
    {
        switch (ev.Kind)
        {
            case AiAutomationDraftEventKind.Delta:
                AssistantText = string.Concat(_assistantText, ev.Text);
                if (_state != AiAutomationDraftStreamState.Streaming)
                {
                    State = AiAutomationDraftStreamState.Streaming;
                }

                break;

            case AiAutomationDraftEventKind.ToolResult:
                CaptureDraft(ev);
                break;

            case AiAutomationDraftEventKind.ConfirmRequest:
                State = AiAutomationDraftStreamState.PausedConfirm;
                break;

            case AiAutomationDraftEventKind.Done:
                State = AiAutomationDraftStreamState.Done;
                break;

            case AiAutomationDraftEventKind.Error:
                _errorMessage = ev.Message;
                _errorReason = ev.ErrorReason;
                Raise(nameof(DisplayErrorText));
                State = AiAutomationDraftStreamState.Error;
                break;

            case AiAutomationDraftEventKind.ToolCall:
            default:
                // tool_call frames update no visible state for this surface (web onEvent no-op).
                break;
        }
    }

    private void CaptureDraft(AiAutomationDraftStreamEvent ev)
    {
        // web handleEvent: only the draft tool's successful, well-formed envelope is captured; anything else
        // is ignored so a malformed or unrelated tool frame never corrupts the form.
        if (!ev.ToolOk ||
            !string.Equals(ev.ToolName, AIGeofenceAwareAutomationSuggestionsRegistration.DraftToolName, StringComparison.Ordinal) ||
            ev.ToolData is not { } envelope)
        {
            return;
        }

        if (GeofenceAutomationDraft.TryParse(envelope, out var draft) && draft is not null)
        {
            Draft = draft;
        }
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
