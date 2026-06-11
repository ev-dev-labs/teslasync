using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AIStateMachineDebuggerNarrator"/> view — the native
/// port of the web component body (web/src/components/ai/AIStateMachineDebuggerNarrator.tsx) composed with its
/// <c>AIFeatureCard</c> + <c>useAiStream</c> render contract. It mirrors three web behaviours exactly: the
/// <c>withAiFeature</c> gate (<see cref="IsGateOpen"/>); the <c>haveScope</c> guard (<see cref="CanStart"/> =
/// a resolved <c>vehicle_id &gt; 0</c> AND <c>from_unix &gt; 0</c> AND <c>to_unix &gt; from_unix</c>, with the
/// <see cref="EmptyHint"/> shown while the triple is incomplete); and the <c>useAiStream</c> lifecycle
/// (<see cref="State"/> idle → streaming → done / error, with a duplicate <see cref="Start"/> a no-op and a
/// cancel returning to idle). The view binds the projected labels and flags and never performs HTTP. Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AIStateMachineDebuggerNarratorViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFsmNarrateStreamTransport _transport;
    private readonly ILocalizer _localizer;
    private readonly bool _isGateOpen;

    private long? _vehicleId;
    private long? _fromUnix;
    private long? _toUnix;
    private FsmNarrateStreamState _state = FsmNarrateStreamState.Idle;
    private string _narrationText = string.Empty;
    private string _errorMessage = string.Empty;
    private FsmNarrateErrorReason _errorReason = FsmNarrateErrorReason.Unknown;

    private CancellationTokenSource? _cts;
    private bool _running;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over its streaming transport (P1/S8 seam), the AI feature gate, the i18n facade and
    /// the optional in-scope narration window. Throws when the surface's feature id is not in the canonical AI
    /// feature registry — the native analogue of <c>withAiFeature</c> rejecting an unknown id at module load.
    /// </summary>
    /// <param name="transport">The SSE narration transport (web <c>fetch</c>); the view never opens it directly.</param>
    /// <param name="gate">The AI-feature gate (web <c>withAiFeature</c> / <c>useAiEnabled</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The in-scope vehicle id (web <c>vehicleId</c> prop); absent keeps the action disabled.</param>
    /// <param name="fromUnix">The inclusive window start in Unix seconds (web <c>fromUnix</c> prop).</param>
    /// <param name="toUnix">The inclusive window end in Unix seconds (web <c>toUnix</c> prop).</param>
    public AIStateMachineDebuggerNarratorViewModel(
        IFsmNarrateStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        long? vehicleId = null,
        long? fromUnix = null,
        long? toUnix = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!AIStateMachineDebuggerNarratorRegistration.IsRegisteredFeature(
                AIStateMachineDebuggerNarratorRegistration.FeatureId))
        {
            throw new InvalidOperationException(
                $"Unknown AI feature id '{AIStateMachineDebuggerNarratorRegistration.FeatureId}'. " +
                "Add it to the AI feature registry (web/src/ai/features.ts) and regenerate.");
        }

        _transport = transport;
        _localizer = localizer;
        _vehicleId = vehicleId;
        _fromUnix = fromUnix;
        _toUnix = toUnix;
        _isGateOpen = gate.IsEnabled(AIStateMachineDebuggerNarratorRegistration.FeatureId);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// True when the AI feature is enabled (web <c>useAiEnabled</c>). When false the whole surface renders
    /// nothing — the native analogue of <c>withAiFeature</c> returning <see langword="null"/>.
    /// </summary>
    public bool IsGateOpen => _isGateOpen;

    /// <summary>The in-scope vehicle id (web <c>vehicleId</c> prop); reassigning re-evaluates <see cref="CanStart"/>.</summary>
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
            RaiseScopeDerived();
        }
    }

    /// <summary>The inclusive window start in Unix seconds (web <c>fromUnix</c> prop); reassigning re-evaluates <see cref="CanStart"/>.</summary>
    public long? FromUnix
    {
        get => _fromUnix;
        set
        {
            if (_fromUnix == value)
            {
                return;
            }

            _fromUnix = value;
            Raise(nameof(FromUnix));
            RaiseScopeDerived();
        }
    }

    /// <summary>The inclusive window end in Unix seconds (web <c>toUnix</c> prop); reassigning re-evaluates <see cref="CanStart"/>.</summary>
    public long? ToUnix
    {
        get => _toUnix;
        set
        {
            if (_toUnix == value)
            {
                return;
            }

            _toUnix = value;
            Raise(nameof(ToUnix));
            RaiseScopeDerived();
        }
    }

    /// <summary>The current stream lifecycle state (web <c>stream.state</c>).</summary>
    public FsmNarrateStreamState State
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

    /// <summary>The accumulated streamed narration text (web <c>stream.text</c>).</summary>
    public string NarrationText
    {
        get => _narrationText;
        private set
        {
            if (string.Equals(_narrationText, value, StringComparison.Ordinal))
            {
                return;
            }

            _narrationText = value;
            Raise(nameof(NarrationText));
            Raise(nameof(IsThinking));
            Raise(nameof(HasOutput));
        }
    }

    /// <summary>True while the SSE stream is open (web <c>stream.state === 'streaming'</c>).</summary>
    public bool IsStreaming => _state == FsmNarrateStreamState.Streaming;

    /// <summary>
    /// True when the surface has the inputs it needs to fire the stream — a resolved <c>vehicle_id &gt; 0</c>,
    /// a positive <c>from_unix</c>, and a <c>to_unix</c> strictly after it (web
    /// <c>haveScope = vehicleId &gt; 0 &amp;&amp; fromUnix &gt; 0 &amp;&amp; toUnix &gt; fromUnix</c>).
    /// </summary>
    public bool CanStart =>
        _vehicleId is > 0 &&
        _fromUnix is > 0 &&
        _toUnix is { } to &&
        _fromUnix is { } from &&
        to > from;

    /// <summary>
    /// True when the empty-state hint should show — the parent has not supplied a valid (vehicle, window)
    /// triple yet (web AIFeatureCard <c>!canStart &amp;&amp; emptyHint</c>).
    /// </summary>
    public bool ShowEmptyHint => !CanStart;

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
        _narrationText.Length > 0 ||
        _state is FsmNarrateStreamState.Streaming or FsmNarrateStreamState.Done or FsmNarrateStreamState.Error;

    /// <summary>
    /// True while the stream is open but no text has arrived yet — the thinking indicator shows (web
    /// <c>text.length === 0 &amp;&amp; state === 'streaming'</c>).
    /// </summary>
    public bool IsThinking => IsStreaming && _narrationText.Length == 0;

    /// <summary>True when the stream ended in failure (web <c>state === 'error'</c>).</summary>
    public bool IsError => _state == FsmNarrateStreamState.Error;

    /// <summary>True when the failure was a connectivity fault — drives the offline message rather than the generic error.</summary>
    public bool IsOffline => _state == FsmNarrateStreamState.Error && _errorReason == FsmNarrateErrorReason.Network;

    /// <summary>The localized card title (web <c>stateMachineDebugger.aiNarrator.title</c>).</summary>
    public string Title => _localizer.GetString(
        AIStateMachineDebuggerNarratorRegistration.TitleKey,
        AIStateMachineDebuggerNarratorRegistration.TitleFallback);

    /// <summary>The localized card description (web <c>stateMachineDebugger.aiNarrator.description</c>).</summary>
    public string Description => _localizer.GetString(
        AIStateMachineDebuggerNarratorRegistration.DescriptionKey,
        AIStateMachineDebuggerNarratorRegistration.DescriptionFallback);

    /// <summary>The localized per-feature action verb (web <c>stateMachineDebugger.aiNarrator.button</c>).</summary>
    public string ButtonLabel => _localizer.GetString(
        AIStateMachineDebuggerNarratorRegistration.ButtonLabelKey,
        AIStateMachineDebuggerNarratorRegistration.ButtonLabelFallback);

    /// <summary>The localized badge text (web <c>stateMachineDebugger.aiNarrator.badge</c>).</summary>
    public string BadgeLabel => _localizer.GetString(
        AIStateMachineDebuggerNarratorRegistration.BadgeKey,
        AIStateMachineDebuggerNarratorRegistration.BadgeFallback);

    /// <summary>The localized empty-state hint (web <c>stateMachineDebugger.aiNarrator.emptyHint</c>).</summary>
    public string EmptyHint => _localizer.GetString(
        AIStateMachineDebuggerNarratorRegistration.EmptyHintKey,
        AIStateMachineDebuggerNarratorRegistration.EmptyHintFallback);

    /// <summary>The universal idle CTA label (web <c>helix.askHelix</c>).</summary>
    public string AskHelixLabel => _localizer.GetString(
        AIStateMachineDebuggerNarratorRegistration.AskHelixKey,
        AIStateMachineDebuggerNarratorRegistration.AskHelixFallback);

    /// <summary>The streaming button label (web <c>helix.thinking</c>).</summary>
    public string ThinkingLabel => _localizer.GetString(
        AIStateMachineDebuggerNarratorRegistration.ThinkingKey,
        AIStateMachineDebuggerNarratorRegistration.ThinkingFallback);

    /// <summary>The retry affordance label on the error surface (mirrors the shared QueryError retry).</summary>
    public string RetryLabel => _localizer.GetString(
        AIStateMachineDebuggerNarratorRegistration.RetryKey,
        AIStateMachineDebuggerNarratorRegistration.RetryFallback);

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

            if (_errorReason == FsmNarrateErrorReason.Network)
            {
                return _localizer.GetString(
                    AIStateMachineDebuggerNarratorRegistration.OfflineKey,
                    AIStateMachineDebuggerNarratorRegistration.OfflineFallback);
            }

            var label = _localizer.GetString(
                AIStateMachineDebuggerNarratorRegistration.ErrorLabelKey,
                AIStateMachineDebuggerNarratorRegistration.ErrorLabelFallback);
            var message = _errorMessage.Length > 0
                ? _errorMessage
                : _localizer.GetString(
                    AIStateMachineDebuggerNarratorRegistration.ErrorUnknownKey,
                    AIStateMachineDebuggerNarratorRegistration.ErrorUnknownFallback);
            return string.Concat(label, " ", message);
        }
    }

    /// <summary>Set the full (vehicle, window) scope in one update (the parent page's selector change).</summary>
    /// <param name="vehicleId">The in-scope vehicle id.</param>
    /// <param name="fromUnix">The inclusive window start in Unix seconds.</param>
    /// <param name="toUnix">The inclusive window end in Unix seconds.</param>
    public void SetScope(long? vehicleId, long? fromUnix, long? toUnix)
    {
        bool changed = _vehicleId != vehicleId || _fromUnix != fromUnix || _toUnix != toUnix;
        if (!changed)
        {
            return;
        }

        _vehicleId = vehicleId;
        _fromUnix = fromUnix;
        _toUnix = toUnix;
        Raise(nameof(VehicleId));
        Raise(nameof(FromUnix));
        Raise(nameof(ToUnix));
        RaiseScopeDerived();
    }

    /// <summary>
    /// Fire the narration stream (web <c>stream.start()</c>) as a detached task — the view's click handler. A
    /// duplicate call while streaming, a call without a complete scope, or a call on a gated-off surface is a
    /// no-op (web button <c>disabled</c> + <c>runningRef</c> guard).
    /// </summary>
    public void Start() => _ = StartAsync();

    /// <summary>
    /// Run one narration stream and fold every event into <see cref="State"/> / <see cref="NarrationText"/> —
    /// the awaitable core of <see cref="Start"/> (exposed for headless tests). Idempotent while a stream is in
    /// flight; cancelling returns the surface to <see cref="FsmNarrateStreamState.Idle"/>.
    /// </summary>
    /// <param name="cancellationToken">Links an external cancellation into the stream's lifetime.</param>
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

        NarrationText = string.Empty;
        _errorMessage = string.Empty;
        _errorReason = FsmNarrateErrorReason.Unknown;
        State = FsmNarrateStreamState.Streaming;

        // CanStart guarantees the triple is present and valid; the backend binds it per-request and refuses any
        // LLM-supplied tuple outside it.
        var request = new FsmNarrateRequest(_vehicleId!.Value, _fromUnix!.Value, _toUnix!.Value);
        try
        {
            await foreach (var ev in _transport.StreamAsync(request, cts.Token).ConfigureAwait(false))
            {
                Apply(ev);
            }

            // web: if the loop ends without a terminal event while still streaming, mark done.
            if (_state == FsmNarrateStreamState.Streaming)
            {
                State = FsmNarrateStreamState.Done;
            }
        }
        catch (OperationCanceledException)
        {
            // web abort path: a cancelled in-flight stream returns to idle.
            if (_state == FsmNarrateStreamState.Streaming)
            {
                State = FsmNarrateStreamState.Idle;
            }
        }
        catch (Exception ex)
        {
            // The transport surfaces failures as Error events; an unexpected throw still ends in the error
            // surface rather than leaving the card stuck in streaming.
            _errorMessage = ex.Message;
            _errorReason = FsmNarrateErrorReason.Unknown;
            State = FsmNarrateStreamState.Error;
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

    private void Apply(FsmNarrateStreamEvent ev)
    {
        switch (ev.Kind)
        {
            case FsmNarrateEventKind.Delta:
                NarrationText = string.Concat(_narrationText, ev.Text);
                if (_state != FsmNarrateStreamState.Streaming)
                {
                    State = FsmNarrateStreamState.Streaming;
                }

                break;

            case FsmNarrateEventKind.ConfirmRequest:
                State = FsmNarrateStreamState.PausedConfirm;
                break;

            case FsmNarrateEventKind.Done:
                State = FsmNarrateStreamState.Done;
                break;

            case FsmNarrateEventKind.Error:
                _errorMessage = ev.Message;
                _errorReason = ev.ErrorReason;
                Raise(nameof(DisplayErrorText));
                State = FsmNarrateStreamState.Error;
                break;

            case FsmNarrateEventKind.ToolCall:
            case FsmNarrateEventKind.ToolResult:
            default:
                // Tool frames update no visible state for this narration surface (web onEvent no-op).
                break;
        }
    }

    private void RaiseScopeDerived()
    {
        Raise(nameof(CanStart));
        Raise(nameof(ShowEmptyHint));
        Raise(nameof(IsActionEnabled));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
