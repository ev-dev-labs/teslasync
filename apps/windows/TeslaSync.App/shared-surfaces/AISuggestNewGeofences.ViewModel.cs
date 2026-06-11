using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AISuggestNewGeofences"/> view — the native port of
/// the web component body (web/src/components/ai/AISuggestNewGeofences.tsx) composed with its
/// <c>AIFeatureCard</c> + <c>useAiStream</c> render contract. It mirrors the web behaviours exactly: the
/// <c>withAiFeature</c> gate (<see cref="IsGateOpen"/>); the <c>canStart</c> guard (<see cref="CanStart"/> = a
/// resolved <c>location_id &gt; 0</c> and a non-<c>paused-confirm</c> stream); the <c>useAiStream</c> lifecycle
/// (<see cref="State"/> idle → streaming → done / error, duplicate <see cref="Start"/> a no-op, cancel → idle);
/// the <c>tool_result</c> capture of the typed <c>draft_geofence</c> envelope into <see cref="Draft"/>; and the
/// propose-only <see cref="Apply"/> handoff (<c>onApplyDraft</c>) that NEVER writes to the API. Changing
/// <see cref="LocationId"/> cancels any in-flight stream and clears the draft, mirroring the web cleanup
/// effect. The view binds the projected labels and flags and never performs HTTP. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AISuggestNewGeofencesViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiGeofenceDraftStreamTransport _transport;
    private readonly ILocalizer _localizer;
    private readonly Action<GeofenceDraftApplication>? _onApplyDraft;
    private readonly bool _isGateOpen;

    private long? _locationId;
    private string _currentName;
    private AiGeofenceDraftStreamState _state = AiGeofenceDraftStreamState.Idle;
    private string _assistantText = string.Empty;
    private GeofenceDraft? _draft;
    private string _errorMessage = string.Empty;
    private AiGeofenceDraftErrorReason _errorReason = AiGeofenceDraftErrorReason.Unknown;

    private CancellationTokenSource? _cts;
    private bool _running;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over its streaming transport (P1/S8 seam), the AI feature gate, the i18n facade, the
    /// optional in-scope visited-location id, the optional current address label and the optional propose-only
    /// apply callback. Throws when the surface's feature id is not in the canonical AI feature registry — the
    /// native analogue of <c>withAiFeature</c> rejecting an unknown id at module load.
    /// </summary>
    public AISuggestNewGeofencesViewModel(
        IAiGeofenceDraftStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        long? locationId = null,
        string? currentName = null,
        Action<GeofenceDraftApplication>? onApplyDraft = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!AISuggestNewGeofencesRegistration.IsRegisteredFeature(
                AISuggestNewGeofencesRegistration.FeatureId))
        {
            throw new InvalidOperationException(
                $"Unknown AI feature id '{AISuggestNewGeofencesRegistration.FeatureId}'. " +
                "Add it to the AI feature registry (web/src/ai/features.ts) and regenerate.");
        }

        _transport = transport;
        _localizer = localizer;
        _locationId = locationId;
        _currentName = currentName ?? string.Empty;
        _onApplyDraft = onApplyDraft;
        _isGateOpen = gate.IsEnabled(AISuggestNewGeofencesRegistration.FeatureId);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// True when the AI feature is enabled (web <c>useAiEnabled</c>). When false the whole surface renders
    /// nothing — the native analogue of <c>withAiFeature</c> returning <see langword="null"/>.
    /// </summary>
    public bool IsGateOpen => _isGateOpen;

    /// <summary>
    /// The in-scope visited-location id (web <c>locationId</c> prop). Reassigning re-evaluates
    /// <see cref="CanStart"/> and — mirroring the web cleanup effect keyed on <c>locationId</c> — cancels any
    /// in-flight stream and clears the captured draft so a proposal from a previously-selected location cannot
    /// bleed into the new scope.
    /// </summary>
    public long? LocationId
    {
        get => _locationId;
        set
        {
            if (_locationId == value)
            {
                return;
            }

            _locationId = value;
            Cancel();
            Draft = null;
            Raise(nameof(LocationId));
            Raise(nameof(CanStart));
            Raise(nameof(IsActionEnabled));
        }
    }

    /// <summary>
    /// The current (unnamed / coordinate-shaped) address label shown for this location in the parent (web
    /// <c>currentName</c> prop). Surfaced inside the card so the user has the original context next to the
    /// proposal; optional — the card still renders without it.
    /// </summary>
    public string CurrentName
    {
        get => _currentName;
        set
        {
            var next = value ?? string.Empty;
            if (string.Equals(_currentName, next, StringComparison.Ordinal))
            {
                return;
            }

            _currentName = next;
            Raise(nameof(CurrentName));
            Raise(nameof(HasCurrentName));
        }
    }

    /// <summary>True when a current address label is present (web <c>currentName &amp;&amp; ...</c>).</summary>
    public bool HasCurrentName => _currentName.Length > 0;

    /// <summary>The current stream lifecycle state (web <c>stream.state</c>).</summary>
    public AiGeofenceDraftStreamState State
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
    /// The captured proposal (web local <c>draft</c> state), set from a successful <c>draft_geofence</c>
    /// <c>tool_result</c> and cleared on each new run / location change. <see langword="null"/> hides the
    /// proposal panel.
    /// </summary>
    public GeofenceDraft? Draft
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
            Raise(nameof(DraftRadiusText));
            Raise(nameof(DraftValidationError));
            Raise(nameof(HasDraftValidationError));
            Raise(nameof(IsDraftRejected));
            Raise(nameof(IsApplyEnabled));
        }
    }

    /// <summary>True while the SSE stream is open (web <c>stream.state === 'streaming'</c>).</summary>
    public bool IsStreaming => _state == AiGeofenceDraftStreamState.Streaming;

    /// <summary>
    /// True when the surface has the inputs it needs to fire the stream — a resolved <c>location_id &gt; 0</c>
    /// and a stream that is not awaiting a confirmation (web
    /// <c>canStart = locationId &gt; 0 &amp;&amp; stream.state !== 'paused-confirm'</c>).
    /// </summary>
    public bool CanStart =>
        _locationId is > 0 &&
        _state != AiGeofenceDraftStreamState.PausedConfirm;

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
        _state is AiGeofenceDraftStreamState.Streaming or AiGeofenceDraftStreamState.Done or AiGeofenceDraftStreamState.Error;

    /// <summary>
    /// True while the stream is open but no text has arrived yet — the thinking indicator shows (web
    /// <c>text.length === 0 &amp;&amp; state === 'streaming'</c>).
    /// </summary>
    public bool IsThinking => IsStreaming && _assistantText.Length == 0;

    /// <summary>True when the stream ended in failure (web <c>state === 'error'</c>).</summary>
    public bool IsError => _state == AiGeofenceDraftStreamState.Error;

    /// <summary>True when the failure was a connectivity fault — drives the offline message rather than the generic error.</summary>
    public bool IsOffline => _state == AiGeofenceDraftStreamState.Error && _errorReason == AiGeofenceDraftErrorReason.Network;

    /// <summary>True when a proposal has been captured (web <c>draft &amp;&amp; ...</c>).</summary>
    public bool HasDraft => _draft is not null;

    /// <summary>The localized card title (web <c>geofences.aiSuggest.title</c>).</summary>
    public string Title => _localizer.GetString(
        AISuggestNewGeofencesRegistration.TitleKey,
        AISuggestNewGeofencesRegistration.TitleFallback);

    /// <summary>The localized card description (web <c>geofences.aiSuggest.description</c>).</summary>
    public string Description => _localizer.GetString(
        AISuggestNewGeofencesRegistration.DescriptionKey,
        AISuggestNewGeofencesRegistration.DescriptionFallback);

    /// <summary>The localized per-feature action verb (web <c>geofences.aiSuggest.suggestButton</c>).</summary>
    public string SuggestButtonLabel => _localizer.GetString(
        AISuggestNewGeofencesRegistration.SuggestButtonKey,
        AISuggestNewGeofencesRegistration.SuggestButtonFallback);

    /// <summary>The localized badge text (web <c>geofences.aiSuggest.badge</c>).</summary>
    public string BadgeLabel => _localizer.GetString(
        AISuggestNewGeofencesRegistration.BadgeKey,
        AISuggestNewGeofencesRegistration.BadgeFallback);

    /// <summary>The universal idle CTA label (shared AIFeatureCard <c>helix.askHelix</c>).</summary>
    public string AskHelixLabel => _localizer.GetString(
        AISuggestNewGeofencesRegistration.AskHelixKey,
        AISuggestNewGeofencesRegistration.AskHelixFallback);

    /// <summary>The streaming button label (shared AIFeatureCard <c>helix.thinking</c>).</summary>
    public string ThinkingLabel => _localizer.GetString(
        AISuggestNewGeofencesRegistration.ThinkingKey,
        AISuggestNewGeofencesRegistration.ThinkingFallback);

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

    /// <summary>The localized "Current label" context heading (web <c>geofences.aiSuggest.currentLabel</c>).</summary>
    public string CurrentLabel => _localizer.GetString(
        AISuggestNewGeofencesRegistration.CurrentLabelKey,
        AISuggestNewGeofencesRegistration.CurrentLabelFallback);

    /// <summary>The localized "Proposed geofence" heading (web <c>geofences.aiSuggest.proposalLabel</c>).</summary>
    public string ProposalLabel => _localizer.GetString(
        AISuggestNewGeofencesRegistration.ProposalLabelKey,
        AISuggestNewGeofencesRegistration.ProposalLabelFallback);

    /// <summary>The localized "Radius" label (web <c>geofences.aiSuggest.radiusLabel</c>).</summary>
    public string RadiusLabel => _localizer.GetString(
        AISuggestNewGeofencesRegistration.RadiusLabelKey,
        AISuggestNewGeofencesRegistration.RadiusLabelFallback);

    /// <summary>The localized apply-to-form action label (web <c>geofences.aiSuggest.applyButton</c>).</summary>
    public string ApplyButtonLabel => _localizer.GetString(
        AISuggestNewGeofencesRegistration.ApplyButtonKey,
        AISuggestNewGeofencesRegistration.ApplyButtonFallback);

    /// <summary>The localized validator-rejected message (web <c>geofences.aiSuggest.rejectedLabel</c>).</summary>
    public string RejectedLabel => _localizer.GetString(
        AISuggestNewGeofencesRegistration.RejectedLabelKey,
        AISuggestNewGeofencesRegistration.RejectedLabelFallback);

    /// <summary>The captured proposal's display name (web <c>draft.proposed_name</c>); empty when none.</summary>
    public string DraftName => _draft?.ProposedName ?? string.Empty;

    /// <summary>
    /// The "Radius: N m" summary line — the native composition of the web rounded-metres readout (web
    /// <c>{radiusLabel}: {Math.round(draft.radius_m)} m</c>). Metres are SI on the wire; the web surface shows
    /// them verbatim with no unit conversion, so the native parity port does the same.
    /// </summary>
    public string DraftRadiusText
    {
        get
        {
            if (_draft is null)
            {
                return string.Empty;
            }

            var rounded = (long)Math.Round(_draft.RadiusMeters, MidpointRounding.AwayFromZero);
            return string.Create(
                CultureInfo.InvariantCulture,
                $"{RadiusLabel}: {rounded} m");
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

            if (_errorReason == AiGeofenceDraftErrorReason.Network)
            {
                return _localizer.GetString(
                    AISuggestNewGeofencesRegistration.OfflineKey,
                    AISuggestNewGeofencesRegistration.OfflineFallback);
            }

            var label = _localizer.GetString(
                AISuggestNewGeofencesRegistration.ErrorLabelKey,
                AISuggestNewGeofencesRegistration.ErrorLabelFallback);
            var message = _errorMessage.Length > 0
                ? _errorMessage
                : _localizer.GetString(
                    AISuggestNewGeofencesRegistration.ErrorUnknownKey,
                    AISuggestNewGeofencesRegistration.ErrorUnknownFallback);
            return string.Concat(label, " ", message);
        }
    }

    /// <summary>
    /// Fire the draft stream (web <c>handleSuggest</c> → <c>stream.start()</c>) as a detached task — the view's
    /// click handler. A duplicate call while streaming, a call with no resolved location, or a call on a
    /// gated-off surface is a no-op (web button <c>disabled</c> + <c>isBusy</c> guard). Clears any prior draft
    /// first.
    /// </summary>
    public void Start() => _ = StartAsync();

    /// <summary>
    /// Run one draft stream and fold every event into <see cref="State"/> / <see cref="AssistantText"/> /
    /// <see cref="Draft"/> — the awaitable core of <see cref="Start"/> (exposed for headless tests). Idempotent
    /// while a stream is in flight; cancelling returns the surface to <see cref="AiGeofenceDraftStreamState.Idle"/>.
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
        _errorReason = AiGeofenceDraftErrorReason.Unknown;
        State = AiGeofenceDraftStreamState.Streaming;

        var request = new AiGeofenceDraftRequest(_locationId ?? 0);
        try
        {
            await foreach (var ev in _transport.StreamAsync(request, cts.Token).ConfigureAwait(false))
            {
                Apply(ev);
            }

            // web: if the loop ends without a terminal event while still streaming, mark done. Critically a
            // paused-confirm is NOT promoted — the server intentionally closes after confirm_request.
            if (_state == AiGeofenceDraftStreamState.Streaming)
            {
                State = AiGeofenceDraftStreamState.Done;
            }
        }
        catch (OperationCanceledException)
        {
            // web abort path: a cancelled in-flight stream returns to idle.
            if (_state == AiGeofenceDraftStreamState.Streaming)
            {
                State = AiGeofenceDraftStreamState.Idle;
            }
        }
        catch (Exception ex)
        {
            // The transport surfaces failures as Error events; an unexpected throw still ends in the error
            // surface rather than leaving the card stuck in streaming.
            _errorMessage = ex.Message;
            _errorReason = AiGeofenceDraftErrorReason.Unknown;
            State = AiGeofenceDraftStreamState.Error;
        }
        finally
        {
            _running = false;
        }
    }

    /// <summary>
    /// Copy the captured proposal into the baseline Add-Geofence form via the <c>onApplyDraft</c> callback (web
    /// <c>handleApply</c>). A no-op unless a proposal is captured and the validator accepted it — the surface
    /// NEVER writes to the API; the baseline Save path remains the sole write surface (propose-only contract).
    /// </summary>
    public void Apply()
    {
        if (_draft is { IsOk: true } accepted)
        {
            _onApplyDraft?.Invoke(accepted.ToApplication());
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

    private void Apply(AiGeofenceDraftStreamEvent ev)
    {
        switch (ev.Kind)
        {
            case AiGeofenceDraftEventKind.Delta:
                AssistantText = string.Concat(_assistantText, ev.Text);
                if (_state != AiGeofenceDraftStreamState.Streaming)
                {
                    State = AiGeofenceDraftStreamState.Streaming;
                }

                break;

            case AiGeofenceDraftEventKind.ToolResult:
                CaptureDraft(ev);
                break;

            case AiGeofenceDraftEventKind.ConfirmRequest:
                State = AiGeofenceDraftStreamState.PausedConfirm;
                break;

            case AiGeofenceDraftEventKind.Done:
                State = AiGeofenceDraftStreamState.Done;
                break;

            case AiGeofenceDraftEventKind.Error:
                _errorMessage = ev.Message;
                _errorReason = ev.ErrorReason;
                Raise(nameof(DisplayErrorText));
                State = AiGeofenceDraftStreamState.Error;
                break;

            case AiGeofenceDraftEventKind.ToolCall:
            default:
                // tool_call frames update no visible state for this surface (web onEvent no-op).
                break;
        }
    }

    private void CaptureDraft(AiGeofenceDraftStreamEvent ev)
    {
        // web handleEvent: only the draft tool's successful, well-formed envelope is captured; anything else
        // is ignored so a malformed or unrelated tool frame never corrupts the form.
        if (!ev.ToolOk ||
            !string.Equals(ev.ToolName, AISuggestNewGeofencesRegistration.DraftToolName, StringComparison.Ordinal) ||
            ev.ToolData is not { } envelope)
        {
            return;
        }

        if (GeofenceDraft.TryParse(envelope, out var draft) && draft is not null)
        {
            Draft = draft;
        }
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
