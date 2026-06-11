using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AISmartChargeScheduleSuggestion"/> view — the
/// native port of the web component body (web/src/components/ai/AISmartChargeScheduleSuggestion.tsx) composed
/// with its <c>AIFeatureCard</c> + <c>useAiStream</c> render contract. It mirrors three web behaviours exactly:
/// the <c>withAiFeature</c> gate (<see cref="IsGateOpen"/>); the <c>haveInputs</c> guard
/// (<see cref="CanStart"/> = a resolved vehicle AND a selected rate plan, web
/// <c>canStart = !!vehicleId &amp;&amp; !!ratePlanId</c>); and the <c>useAiStream</c> lifecycle
/// (<see cref="State"/> idle → streaming → done / error, with a duplicate <see cref="Start"/> a no-op and a
/// cancel returning to idle). On start it POSTs the same body the web <c>useMemo</c> assembles (defaults +
/// <c>depart_by</c> ISO normalization). The view binds the projected labels and flags and never performs HTTP.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AISmartChargeScheduleSuggestionViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiScheduleDraftStreamTransport _transport;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly bool _isGateOpen;

    private AiScheduleDraftInputs _inputs;
    private AiScheduleStreamState _state = AiScheduleStreamState.Idle;
    private string _draftText = string.Empty;
    private string _errorMessage = string.Empty;
    private AiScheduleErrorReason _errorReason = AiScheduleErrorReason.Unknown;

    private CancellationTokenSource? _cts;
    private bool _running;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over its streaming transport (P1/S8 seam), the AI feature gate, the i18n facade, the
    /// optional schedule inputs and an optional clock used to normalize <c>depart_by</c> (defaults to
    /// <see cref="DateTimeOffset.UtcNow"/>; injected so the normalization is deterministically testable). Throws
    /// when the surface's feature id is not in the canonical AI feature registry — the native analogue of
    /// <c>withAiFeature</c> rejecting an unknown id at module load.
    /// </summary>
    public AISmartChargeScheduleSuggestionViewModel(
        IAiScheduleDraftStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        AiScheduleDraftInputs? inputs = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!AISmartChargeScheduleSuggestionRegistration.IsRegisteredFeature(
                AISmartChargeScheduleSuggestionRegistration.FeatureId))
        {
            throw new InvalidOperationException(
                $"Unknown AI feature id '{AISmartChargeScheduleSuggestionRegistration.FeatureId}'. " +
                "Add it to the AI feature registry (web/src/ai/features.ts) and regenerate.");
        }

        _transport = transport;
        _localizer = localizer;
        _clock = clock ?? (static () => DateTimeOffset.UtcNow);
        _inputs = inputs ?? new AiScheduleDraftInputs();
        _isGateOpen = gate.IsEnabled(AISmartChargeScheduleSuggestionRegistration.FeatureId);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// True when the AI feature is enabled (web <c>useAiEnabled</c>). When false the whole surface renders
    /// nothing — the native analogue of <c>withAiFeature</c> returning <see langword="null"/>.
    /// </summary>
    public bool IsGateOpen => _isGateOpen;

    /// <summary>
    /// The schedule-draft inputs (web component props); reassigning swaps the whole immutable snapshot atomically
    /// and re-evaluates <see cref="CanStart"/>. The request body is assembled from this at <see cref="Start"/>.
    /// </summary>
    public AiScheduleDraftInputs Inputs
    {
        get => _inputs;
        set
        {
            var next = value ?? new AiScheduleDraftInputs();
            if (ReferenceEquals(_inputs, next))
            {
                return;
            }

            _inputs = next;
            Raise(nameof(Inputs));
            Raise(nameof(CanStart));
            Raise(nameof(IsActionEnabled));
        }
    }

    /// <summary>The current stream lifecycle state (web <c>stream.state</c>).</summary>
    public AiScheduleStreamState State
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

    /// <summary>The accumulated streamed draft text (web <c>stream.text</c>).</summary>
    public string DraftText
    {
        get => _draftText;
        private set
        {
            if (string.Equals(_draftText, value, StringComparison.Ordinal))
            {
                return;
            }

            _draftText = value;
            Raise(nameof(DraftText));
            Raise(nameof(IsThinking));
            Raise(nameof(HasOutput));
        }
    }

    /// <summary>True while the SSE stream is open (web <c>stream.state === 'streaming'</c>).</summary>
    public bool IsStreaming => _state == AiScheduleStreamState.Streaming;

    /// <summary>
    /// True when the surface has the inputs it needs to fire the stream — a resolved vehicle AND a selected rate
    /// plan (web <c>haveInputs = !!vehicleId &amp;&amp; !!ratePlanId</c>).
    /// </summary>
    public bool CanStart => _inputs.HaveInputs;

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
        _draftText.Length > 0 ||
        _state is AiScheduleStreamState.Streaming or AiScheduleStreamState.Done or AiScheduleStreamState.Error;

    /// <summary>
    /// True while the stream is open but no text has arrived yet — the thinking indicator shows (web
    /// <c>text.length === 0 &amp;&amp; state === 'streaming'</c>).
    /// </summary>
    public bool IsThinking => IsStreaming && _draftText.Length == 0;

    /// <summary>True when the stream ended in failure (web <c>state === 'error'</c>).</summary>
    public bool IsError => _state == AiScheduleStreamState.Error;

    /// <summary>True when the failure was a connectivity fault — drives the offline message rather than the generic error.</summary>
    public bool IsOffline => _state == AiScheduleStreamState.Error && _errorReason == AiScheduleErrorReason.Network;

    /// <summary>The localized card title (web <c>chargePlanner.aiAgent.title</c>).</summary>
    public string Title => _localizer.GetString(
        AISmartChargeScheduleSuggestionRegistration.TitleKey,
        AISmartChargeScheduleSuggestionRegistration.TitleFallback);

    /// <summary>The localized card description (web <c>chargePlanner.aiAgent.description</c>).</summary>
    public string Description => _localizer.GetString(
        AISmartChargeScheduleSuggestionRegistration.DescriptionKey,
        AISmartChargeScheduleSuggestionRegistration.DescriptionFallback);

    /// <summary>The localized per-feature action verb (web <c>chargePlanner.aiAgent.generateButton</c>).</summary>
    public string ButtonLabel => _localizer.GetString(
        AISmartChargeScheduleSuggestionRegistration.ButtonLabelKey,
        AISmartChargeScheduleSuggestionRegistration.ButtonLabelFallback);

    /// <summary>The localized badge text (web <c>chargePlanner.aiAgent.badge</c>).</summary>
    public string BadgeLabel => _localizer.GetString(
        AISmartChargeScheduleSuggestionRegistration.BadgeKey,
        AISmartChargeScheduleSuggestionRegistration.BadgeFallback);

    /// <summary>The universal idle CTA label (web <c>helix.askHelix</c>).</summary>
    public string AskHelixLabel => _localizer.GetString(
        AISmartChargeScheduleSuggestionRegistration.AskHelixKey,
        AISmartChargeScheduleSuggestionRegistration.AskHelixFallback);

    /// <summary>The streaming button label (web <c>helix.thinking</c>).</summary>
    public string ThinkingLabel => _localizer.GetString(
        AISmartChargeScheduleSuggestionRegistration.ThinkingKey,
        AISmartChargeScheduleSuggestionRegistration.ThinkingFallback);

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

            if (_errorReason == AiScheduleErrorReason.Network)
            {
                return _localizer.GetString(
                    AISmartChargeScheduleSuggestionRegistration.OfflineKey,
                    AISmartChargeScheduleSuggestionRegistration.OfflineFallback);
            }

            var label = _localizer.GetString(
                AISmartChargeScheduleSuggestionRegistration.ErrorLabelKey,
                AISmartChargeScheduleSuggestionRegistration.ErrorLabelFallback);
            var message = _errorMessage.Length > 0
                ? _errorMessage
                : _localizer.GetString(
                    AISmartChargeScheduleSuggestionRegistration.ErrorUnknownKey,
                    AISmartChargeScheduleSuggestionRegistration.ErrorUnknownFallback);
            return string.Concat(label, " ", message);
        }
    }

    /// <summary>
    /// Fire the draft stream (web <c>stream.start()</c>) as a detached task — the view's click handler. A
    /// duplicate call while streaming, a call without both inputs resolved, or a call on a gated-off surface is a
    /// no-op (web button <c>disabled</c> + <c>runningRef</c> guard).
    /// </summary>
    public void Start() => _ = StartAsync();

    /// <summary>
    /// Run one draft stream and fold every event into <see cref="State"/> / <see cref="DraftText"/> — the
    /// awaitable core of <see cref="Start"/> (exposed for headless tests). Idempotent while a stream is in
    /// flight; cancelling returns the surface to <see cref="AiScheduleStreamState.Idle"/>.
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

        DraftText = string.Empty;
        _errorMessage = string.Empty;
        _errorReason = AiScheduleErrorReason.Unknown;
        State = AiScheduleStreamState.Streaming;

        var request = AiScheduleDraftRequest.FromInputs(_inputs, _clock());
        try
        {
            await foreach (var ev in _transport.StreamAsync(request, cts.Token).ConfigureAwait(false))
            {
                Apply(ev);
            }

            // web: if the loop ends without a terminal event while still streaming, mark done.
            if (_state == AiScheduleStreamState.Streaming)
            {
                State = AiScheduleStreamState.Done;
            }
        }
        catch (OperationCanceledException)
        {
            // web abort path: a cancelled in-flight stream returns to idle.
            if (_state == AiScheduleStreamState.Streaming)
            {
                State = AiScheduleStreamState.Idle;
            }
        }
        catch (Exception ex)
        {
            // The transport surfaces failures as Error events; an unexpected throw still ends in the error
            // surface rather than leaving the card stuck in streaming.
            _errorMessage = ex.Message;
            _errorReason = AiScheduleErrorReason.Unknown;
            State = AiScheduleStreamState.Error;
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

    private void Apply(AiScheduleStreamEvent ev)
    {
        switch (ev.Kind)
        {
            case AiScheduleEventKind.Delta:
                DraftText = string.Concat(_draftText, ev.Text);
                if (_state != AiScheduleStreamState.Streaming)
                {
                    State = AiScheduleStreamState.Streaming;
                }

                break;

            case AiScheduleEventKind.ConfirmRequest:
                State = AiScheduleStreamState.PausedConfirm;
                break;

            case AiScheduleEventKind.Done:
                State = AiScheduleStreamState.Done;
                break;

            case AiScheduleEventKind.Error:
                _errorMessage = ev.Message;
                _errorReason = ev.ErrorReason;
                Raise(nameof(DisplayErrorText));
                State = AiScheduleStreamState.Error;
                break;

            case AiScheduleEventKind.ToolCall:
            case AiScheduleEventKind.ToolResult:
            default:
                // Tool frames update no visible state for this draft surface (web onEvent no-op).
                break;
        }
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
