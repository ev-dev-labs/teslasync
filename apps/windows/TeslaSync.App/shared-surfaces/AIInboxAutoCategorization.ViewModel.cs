using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Payload for <see cref="AIInboxAutoCategorizationViewModel.CategoriesApplied"/> — the deduplicated, ascending
/// union of every proposed bucket's <c>rule_ids</c> the user chose to copy into the inbox filter (web
/// <c>onApplyCategories(ruleIds)</c>). The surface never writes to the API; the host merges these ids into the
/// canonical URL-backed inbox filter.
/// </summary>
public sealed class InboxCategoriesAppliedEventArgs : EventArgs
{
    /// <summary>Creates the args over the chosen rule-id set.</summary>
    public InboxCategoriesAppliedEventArgs(IReadOnlyList<long> ruleIds) =>
        RuleIds = ruleIds ?? Array.Empty<long>();

    /// <summary>The deduplicated, ascending rule-id set to apply as a filter.</summary>
    public IReadOnlyList<long> RuleIds { get; }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AIInboxAutoCategorization"/> view — the native port
/// of the web component body (web/src/components/ai/AIInboxAutoCategorization.tsx) composed with its
/// <c>AIFeatureCard</c> + <c>useAiStream</c> render contract. It mirrors the web behaviours exactly: the
/// <c>withAiFeature</c> gate (<see cref="IsGateOpen"/>); the <c>useAiStream</c> lifecycle (<see cref="State"/>
/// idle → streaming → done / error, with a duplicate <see cref="StartCategorize"/> a no-op and a cancel
/// returning to idle); the captured <c>draft_alert_categories</c> proposal (<see cref="Proposal"/>); the
/// <c>canStart = state !== 'paused-confirm'</c> guard; and the apply-as-filter action that emits the
/// deduplicated <see cref="AllRuleIds"/> union (web <c>onApplyCategories</c>). Changing any scope input
/// (vehicle, window, severities, rule ids) cancels the in-flight stream and clears the stale proposal (web
/// cleanup effect). The view binds the projected labels and flags and never performs HTTP. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AIInboxAutoCategorizationViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiInboxCategorizationStreamTransport _transport;
    private readonly ILocalizer _localizer;
    private readonly bool _isGateOpen;

    private long? _vehicleId;
    private int? _windowDays;
    private IReadOnlyList<string> _severities = Array.Empty<string>();
    private IReadOnlyList<long> _ruleIds = Array.Empty<long>();

    private InboxCategorizationStreamState _state = InboxCategorizationStreamState.Idle;
    private string _outputText = string.Empty;
    private string _errorMessage = string.Empty;
    private InboxCategorizationErrorReason _errorReason = InboxCategorizationErrorReason.Unknown;
    private IReadOnlyList<CategoryBucket> _proposal = Array.Empty<CategoryBucket>();

    private CancellationTokenSource? _cts;
    private bool _running;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over its streaming transport (P1/S8 seam), the AI feature gate, the i18n facade, an
    /// optional apply callback (web <c>onApplyCategories</c> prop) and the optional initial scope inputs. Throws
    /// when the surface's feature id is not in the canonical AI feature registry — the native analogue of
    /// <c>withAiFeature</c> rejecting an unknown id at module load.
    /// </summary>
    public AIInboxAutoCategorizationViewModel(
        IAiInboxCategorizationStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        Action<IReadOnlyList<long>>? onApplyCategories = null,
        long? vehicleId = null,
        int? windowDays = null,
        IReadOnlyList<string>? severities = null,
        IReadOnlyList<long>? ruleIds = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!AIInboxAutoCategorizationRegistration.IsRegisteredFeature(
                AIInboxAutoCategorizationRegistration.FeatureId))
        {
            throw new InvalidOperationException(
                $"Unknown AI feature id '{AIInboxAutoCategorizationRegistration.FeatureId}'. " +
                "Add it to the AI feature registry (web/src/ai/features.ts) and regenerate.");
        }

        _transport = transport;
        _localizer = localizer;
        _vehicleId = vehicleId;
        _windowDays = windowDays;
        _severities = severities is { Count: > 0 } ? severities.ToArray() : Array.Empty<string>();
        _ruleIds = ruleIds is { Count: > 0 } ? ruleIds.ToArray() : Array.Empty<long>();
        _isGateOpen = gate.IsEnabled(AIInboxAutoCategorizationRegistration.FeatureId);

        if (onApplyCategories is not null)
        {
            CategoriesApplied += (_, e) => onApplyCategories(e.RuleIds);
        }
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// Raised when the user applies the proposed categories as a filter (web <c>onApplyCategories</c>); the args
    /// carry the deduplicated ascending <see cref="AllRuleIds"/> union. Never raised with an empty set.
    /// </summary>
    public event EventHandler<InboxCategoriesAppliedEventArgs>? CategoriesApplied;

    /// <summary>
    /// True when the AI feature is enabled (web <c>useAiEnabled</c>). When false the whole surface renders
    /// nothing — the native analogue of <c>withAiFeature</c> returning <see langword="null"/>.
    /// </summary>
    public bool IsGateOpen => _isGateOpen;

    /// <summary>The optional vehicle scope (web <c>vehicleId</c> prop); reassigning cancels + clears the proposal.</summary>
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
            Raise(nameof(VehicleId));
            ResetForScopeChange();
        }
    }

    /// <summary>The optional inbox window in days (web <c>windowDays</c> prop); reassigning cancels + clears the proposal.</summary>
    public int? WindowDays
    {
        get => _windowDays;
        set
        {
            if (_windowDays == value)
            {
                return;
            }

            _windowDays = value;
            Raise(nameof(WindowDays));
            ResetForScopeChange();
        }
    }

    /// <summary>The optional severity filter (web <c>severities</c> prop); reassigning cancels + clears the proposal.</summary>
    public IReadOnlyList<string> Severities
    {
        get => _severities;
        set
        {
            var next = value is { Count: > 0 } ? value.ToArray() : Array.Empty<string>();
            if (SameSequence(_severities, next))
            {
                return;
            }

            _severities = next;
            Raise(nameof(Severities));
            ResetForScopeChange();
        }
    }

    /// <summary>The optional rule filter (web <c>ruleIds</c> prop); reassigning cancels + clears the proposal.</summary>
    public IReadOnlyList<long> RuleIds
    {
        get => _ruleIds;
        set
        {
            var next = value is { Count: > 0 } ? value.ToArray() : Array.Empty<long>();
            if (SameSequence(_ruleIds, next))
            {
                return;
            }

            _ruleIds = next;
            Raise(nameof(RuleIds));
            ResetForScopeChange();
        }
    }

    /// <summary>The current stream lifecycle state (web <c>stream.state</c>).</summary>
    public InboxCategorizationStreamState State
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
            Raise(nameof(IsBusy));
            Raise(nameof(CanStart));
            Raise(nameof(IsActionEnabled));
            Raise(nameof(IsThinking));
            Raise(nameof(IsError));
            Raise(nameof(IsOffline));
            Raise(nameof(HasOutput));
            Raise(nameof(ShowEmptyState));
            Raise(nameof(ShowOutputPanel));
            Raise(nameof(ActionLabel));
            Raise(nameof(ApplyEnabled));
            Raise(nameof(DisplayErrorText));
        }
    }

    /// <summary>The accumulated streamed narration text (web <c>stream.text</c>); the LLM's spoken explanation.</summary>
    public string OutputText
    {
        get => _outputText;
        private set
        {
            if (string.Equals(_outputText, value, StringComparison.Ordinal))
            {
                return;
            }

            _outputText = value;
            Raise(nameof(OutputText));
            Raise(nameof(IsThinking));
            Raise(nameof(HasOutput));
            Raise(nameof(ShowEmptyState));
            Raise(nameof(ShowOutputPanel));
        }
    }

    /// <summary>The captured, reviewed category proposal (web <c>proposal</c> state); empty until a tool result arrives.</summary>
    public IReadOnlyList<CategoryBucket> Proposal
    {
        get => _proposal;
        private set
        {
            _proposal = value ?? Array.Empty<CategoryBucket>();
            Raise(nameof(Proposal));
            Raise(nameof(HasProposal));
            Raise(nameof(AllRuleIds));
            Raise(nameof(ApplyEnabled));
            Raise(nameof(ShowEmptyState));
            Raise(nameof(ShowOutputPanel));
        }
    }

    /// <summary>True while the SSE stream is open (web <c>stream.state === 'streaming'</c>).</summary>
    public bool IsStreaming => _state == InboxCategorizationStreamState.Streaming;

    /// <summary>True while a stream is in flight or paused for confirmation (web <c>isBusy</c>).</summary>
    public bool IsBusy =>
        _state is InboxCategorizationStreamState.Streaming or InboxCategorizationStreamState.PausedConfirm;

    /// <summary>
    /// True when the categorize action may fire — anything but the paused-confirm state (web
    /// <c>canStart={stream.state !== 'paused-confirm'}</c>). The inbox surface needs no required input.
    /// </summary>
    public bool CanStart => _state != InboxCategorizationStreamState.PausedConfirm;

    /// <summary>
    /// True when the action button is interactive — startable and no stream open (web button
    /// <c>disabled={!canStart || streaming}</c>).
    /// </summary>
    public bool IsActionEnabled => CanStart && !IsStreaming;

    /// <summary>
    /// True once a stream has run (or is running) — the output panel is shown (web <c>AiOutputPanel</c>
    /// <c>hasAnything = text.length &gt; 0 || state ∈ {streaming, error, done}</c>); idle with no text hides it.
    /// </summary>
    public bool HasOutput =>
        _outputText.Length > 0 ||
        _state is InboxCategorizationStreamState.Streaming or InboxCategorizationStreamState.Done or InboxCategorizationStreamState.Error;

    /// <summary>
    /// True while the stream is open but no text has arrived yet — the thinking indicator shows (web
    /// <c>text.length === 0 &amp;&amp; state === 'streaming'</c>).
    /// </summary>
    public bool IsThinking => IsStreaming && _outputText.Length == 0;

    /// <summary>True when the stream ended in failure (web <c>state === 'error'</c>).</summary>
    public bool IsError => _state == InboxCategorizationStreamState.Error;

    /// <summary>True when the failure was a connectivity fault — drives the offline message rather than the generic error.</summary>
    public bool IsOffline => _state == InboxCategorizationStreamState.Error && _errorReason == InboxCategorizationErrorReason.Network;

    /// <summary>
    /// True when a completed run produced neither narration nor a proposal — the friendly empty state (so the
    /// output panel is never a blank box, per the P2 state matrix).
    /// </summary>
    public bool ShowEmptyState =>
        _state == InboxCategorizationStreamState.Done && _outputText.Length == 0 && !HasProposal;

    /// <summary>
    /// True when the streamed-output panel has meaningful content to show — an error, the thinking indicator,
    /// accumulated narration, or the friendly empty caption. Unlike the web <c>AiOutputPanel.hasAnything</c>
    /// (which renders an empty box on a text-less <c>done</c>), this hides the panel when the captured proposal
    /// is the run's only output, so the surface never shows a blank box.
    /// </summary>
    public bool ShowOutputPanel => IsError || IsThinking || _outputText.Length > 0 || ShowEmptyState;

    /// <summary>True when a non-empty proposal has been captured (web <c>proposal &amp;&amp; proposal.length &gt; 0</c>).</summary>
    public bool HasProposal => _proposal.Count > 0;

    /// <summary>
    /// The deduplicated, ascending union of every proposed bucket's rule ids — the canonical baseline-narrowing
    /// set (web <c>allRuleIds</c>). Empty when no proposal carries rule ids.
    /// </summary>
    public IReadOnlyList<long> AllRuleIds
    {
        get
        {
            if (_proposal.Count == 0)
            {
                return Array.Empty<long>();
            }

            var seen = new SortedSet<long>();
            foreach (var bucket in _proposal)
            {
                foreach (var id in bucket.RuleIds)
                {
                    seen.Add(id);
                }
            }

            return seen.Count > 0 ? seen.ToArray() : Array.Empty<long>();
        }
    }

    /// <summary>
    /// True when the apply-as-filter button is interactive — there is at least one rule id to apply and no
    /// stream is in flight (web <c>applyDisabled = allRuleIds.length === 0 || isBusy</c>, negated).
    /// </summary>
    public bool ApplyEnabled => AllRuleIds.Count > 0 && !IsBusy;

    /// <summary>The localized card title (web <c>notifications.inbox.aiCategorize.title</c>).</summary>
    public string Title => _localizer.GetString(
        AIInboxAutoCategorizationRegistration.TitleKey,
        AIInboxAutoCategorizationRegistration.TitleFallback);

    /// <summary>The localized card description (web <c>notifications.inbox.aiCategorize.description</c>).</summary>
    public string Description => _localizer.GetString(
        AIInboxAutoCategorizationRegistration.DescriptionKey,
        AIInboxAutoCategorizationRegistration.DescriptionFallback);

    /// <summary>The localized per-feature action verb (web <c>notifications.inbox.aiCategorize.suggestButton</c>).</summary>
    public string SuggestButtonLabel => _localizer.GetString(
        AIInboxAutoCategorizationRegistration.SuggestButtonKey,
        AIInboxAutoCategorizationRegistration.SuggestButtonFallback);

    /// <summary>The localized badge text (web <c>notifications.inbox.aiCategorize.badge</c>).</summary>
    public string BadgeLabel => _localizer.GetString(
        AIInboxAutoCategorizationRegistration.BadgeKey,
        AIInboxAutoCategorizationRegistration.BadgeFallback);

    /// <summary>The localized apply-as-filter button label (web <c>notifications.inbox.aiCategorize.applyButton</c>).</summary>
    public string ApplyLabel => _localizer.GetString(
        AIInboxAutoCategorizationRegistration.ApplyButtonKey,
        AIInboxAutoCategorizationRegistration.ApplyButtonFallback);

    /// <summary>The localized proposal preview label (web <c>notifications.inbox.aiCategorize.previewLabel</c>).</summary>
    public string PreviewLabel => _localizer.GetString(
        AIInboxAutoCategorizationRegistration.PreviewLabelKey,
        AIInboxAutoCategorizationRegistration.PreviewLabelFallback);

    /// <summary>The universal idle CTA label (web <c>helix.askHelix</c>).</summary>
    public string AskHelixLabel => _localizer.GetString(
        AIInboxAutoCategorizationRegistration.AskHelixKey,
        AIInboxAutoCategorizationRegistration.AskHelixFallback);

    /// <summary>The streaming button label (web <c>helix.thinking</c>).</summary>
    public string ThinkingLabel => _localizer.GetString(
        AIInboxAutoCategorizationRegistration.ThinkingKey,
        AIInboxAutoCategorizationRegistration.ThinkingFallback);

    /// <summary>The friendly empty-state caption shown when a run proposes nothing.</summary>
    public string EmptyStateText => _localizer.GetString(
        AIInboxAutoCategorizationRegistration.EmptyKey,
        AIInboxAutoCategorizationRegistration.EmptyFallback);

    /// <summary>
    /// The action button's visible label — the streaming "thinking" copy while in flight, otherwise the
    /// universal "Ask Helix" CTA (web AIFeatureCard <c>{isStreaming ? thinking : askHelix}</c>).
    /// </summary>
    public string ActionLabel => IsStreaming ? ThinkingLabel : AskHelixLabel;

    /// <summary>
    /// The action button's accessible name — "Ask Helix · &lt;verb&gt;" (web button
    /// <c>aria-label={`${askHelixLabel} · ${buttonLabel}`}</c>).
    /// </summary>
    public string ActionAutomationName =>
        string.Concat(AskHelixLabel, " \u00b7 ", SuggestButtonLabel);

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

            if (_errorReason == InboxCategorizationErrorReason.Network)
            {
                return _localizer.GetString(
                    AIInboxAutoCategorizationRegistration.OfflineKey,
                    AIInboxAutoCategorizationRegistration.OfflineFallback);
            }

            var label = _localizer.GetString(
                AIInboxAutoCategorizationRegistration.ErrorLabelKey,
                AIInboxAutoCategorizationRegistration.ErrorLabelFallback);
            var message = _errorMessage.Length > 0
                ? _errorMessage
                : _localizer.GetString(
                    AIInboxAutoCategorizationRegistration.ErrorUnknownKey,
                    AIInboxAutoCategorizationRegistration.ErrorUnknownFallback);
            return string.Concat(label, " ", message);
        }
    }

    /// <summary>
    /// Fire the categorization stream (web <c>handleCategorize</c>) as a detached task — the view's suggest-button
    /// click handler. A duplicate call while busy, or a call on a gated-off surface, is a no-op.
    /// </summary>
    public void StartCategorize() => _ = StartCategorizeAsync();

    /// <summary>
    /// Run one categorization stream and fold every event into <see cref="State"/> / <see cref="OutputText"/> /
    /// <see cref="Proposal"/> — the awaitable core of <see cref="StartCategorize"/> (exposed for headless tests).
    /// Idempotent while a stream is in flight; cancelling returns the surface to
    /// <see cref="InboxCategorizationStreamState.Idle"/>.
    /// </summary>
    public async Task StartCategorizeAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed || _running || !_isGateOpen || _state == InboxCategorizationStreamState.PausedConfirm)
        {
            return;
        }

        _running = true;

        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        // web handleCategorize: setProposal(null); stream.start() (which clears text).
        Proposal = Array.Empty<CategoryBucket>();
        OutputText = string.Empty;
        _errorMessage = string.Empty;
        _errorReason = InboxCategorizationErrorReason.Unknown;
        State = InboxCategorizationStreamState.Streaming;

        var request = InboxCategorizationRequest.Create(_vehicleId, _windowDays, _severities, _ruleIds);
        try
        {
            await foreach (var ev in _transport.StreamAsync(request, cts.Token).ConfigureAwait(false))
            {
                Apply(ev);
            }

            // web: if the loop ends without a terminal event while still streaming, mark done.
            if (_state == InboxCategorizationStreamState.Streaming)
            {
                State = InboxCategorizationStreamState.Done;
            }
        }
        catch (OperationCanceledException)
        {
            // web abort path: a cancelled in-flight stream returns to idle.
            if (_state == InboxCategorizationStreamState.Streaming)
            {
                State = InboxCategorizationStreamState.Idle;
            }
        }
        catch (Exception ex)
        {
            // The transport surfaces failures as Error events; an unexpected throw still ends in the error
            // surface rather than leaving the card stuck in streaming.
            _errorMessage = ex.Message;
            _errorReason = InboxCategorizationErrorReason.Unknown;
            State = InboxCategorizationStreamState.Error;
        }
        finally
        {
            _running = false;
        }
    }

    /// <summary>
    /// Apply the captured proposal as an inbox filter (web <c>handleApply</c>): raise
    /// <see cref="CategoriesApplied"/> with the deduplicated <see cref="AllRuleIds"/> union. A no-op when there
    /// is nothing to apply or a stream is in flight (web <c>applyDisabled</c> guard).
    /// </summary>
    public void ApplyCategories()
    {
        if (IsBusy)
        {
            return;
        }

        var ruleIds = AllRuleIds;
        if (ruleIds.Count == 0)
        {
            return;
        }

        CategoriesApplied?.Invoke(this, new InboxCategoriesAppliedEventArgs(ruleIds));
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

    private void Apply(InboxCategorizationStreamEvent ev)
    {
        switch (ev.Kind)
        {
            case InboxCategorizationEventKind.Delta:
                OutputText = string.Concat(_outputText, ev.Text);
                if (_state != InboxCategorizationStreamState.Streaming)
                {
                    State = InboxCategorizationStreamState.Streaming;
                }

                break;

            case InboxCategorizationEventKind.ToolResult:
                // web onEvent: capture only the draft_alert_categories envelope when ok.
                if (ev.ToolOk &&
                    string.Equals(ev.ToolName, AIInboxAutoCategorizationRegistration.CategoriesToolName, StringComparison.Ordinal))
                {
                    var buckets = CategoryBucketParser.Parse(ev.ToolData);
                    if (buckets.Count > 0)
                    {
                        Proposal = buckets;
                    }
                }

                break;

            case InboxCategorizationEventKind.ConfirmRequest:
                State = InboxCategorizationStreamState.PausedConfirm;
                break;

            case InboxCategorizationEventKind.Done:
                State = InboxCategorizationStreamState.Done;
                break;

            case InboxCategorizationEventKind.Error:
                _errorMessage = ev.Message;
                _errorReason = ev.ErrorReason;
                Raise(nameof(DisplayErrorText));
                State = InboxCategorizationStreamState.Error;
                break;

            case InboxCategorizationEventKind.ToolCall:
            default:
                // Tool-call frames update no visible state for this surface (web onEvent no-op).
                break;
        }
    }

    private void ResetForScopeChange()
    {
        // web cleanup effect on scope change: cancel() + setProposal(null). We additionally clear the stale
        // narration / error so a proposal from a previous filter cannot bleed into the new scope's view.
        Cancel();
        Proposal = Array.Empty<CategoryBucket>();
        OutputText = string.Empty;
        _errorMessage = string.Empty;
        _errorReason = InboxCategorizationErrorReason.Unknown;
        State = InboxCategorizationStreamState.Idle;
    }

    private static bool SameSequence<T>(IReadOnlyList<T> a, IReadOnlyList<T> b)
    {
        if (a.Count != b.Count)
        {
            return false;
        }

        var comparer = EqualityComparer<T>.Default;
        for (var i = 0; i < a.Count; i++)
        {
            if (!comparer.Equals(a[i], b[i]))
            {
                return false;
            }
        }

        return true;
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
