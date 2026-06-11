using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AIVampireDrainExplanation"/> view — the native port
/// of the web component body (web/src/components/ai/AIVampireDrainExplanation.tsx) composed with its
/// <c>AIFeatureCard</c> + <c>useAiStream</c> render contract. It mirrors three web behaviours exactly: the
/// <c>withAiFeature</c> gate (<see cref="IsGateOpen"/>); the <c>haveInputs</c> guard (<see cref="CanStart"/> = a
/// resolved <c>vehicle_id &gt; 0</c>, the lookback window being optional); and the <c>useAiStream</c> lifecycle
/// (<see cref="State"/> idle → streaming → done / error, with a duplicate <see cref="Start"/> a no-op and a
/// cancel returning to idle). The view binds the projected labels and flags and never performs HTTP. Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AIVampireDrainExplanationViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiVampireDrainStreamTransport _transport;
    private readonly ILocalizer _localizer;
    private readonly bool _isGateOpen;

    private long? _vehicleId;
    private long? _lookbackDays;
    private AiVampireDrainStreamState _state = AiVampireDrainStreamState.Idle;
    private string _narrationText = string.Empty;
    private string _errorMessage = string.Empty;
    private AiVampireDrainErrorReason _errorReason = AiVampireDrainErrorReason.Unknown;

    private CancellationTokenSource? _cts;
    private bool _running;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over its streaming transport (P1/S8 seam), the AI feature gate, the i18n facade and
    /// the optional in-scope vehicle id + lookback horizon. Throws when the surface's feature id is not in the
    /// canonical AI feature registry — the native analogue of <c>withAiFeature</c> rejecting an unknown id at
    /// module load.
    /// </summary>
    public AIVampireDrainExplanationViewModel(
        IAiVampireDrainStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        long? vehicleId = null,
        long? lookbackDays = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!AIVampireDrainExplanationRegistration.IsRegisteredFeature(
                AIVampireDrainExplanationRegistration.FeatureId))
        {
            throw new InvalidOperationException(
                $"Unknown AI feature id '{AIVampireDrainExplanationRegistration.FeatureId}'. " +
                "Add it to the AI feature registry (web/src/ai/features.ts) and regenerate.");
        }

        _transport = transport;
        _localizer = localizer;
        _vehicleId = vehicleId;
        _lookbackDays = lookbackDays;
        _isGateOpen = gate.IsEnabled(AIVampireDrainExplanationRegistration.FeatureId);
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
            Raise(nameof(CanStart));
            Raise(nameof(IsActionEnabled));
        }
    }

    /// <summary>
    /// The optional lookback-day horizon to narrate (web <c>lookbackDays</c> prop). It does not affect
    /// <see cref="CanStart"/> — the backend applies its canonical 30-day default when omitted — but the parent
    /// page can keep the AI window in sync with the chart by reassigning it before a run.
    /// </summary>
    public long? LookbackDays
    {
        get => _lookbackDays;
        set
        {
            if (_lookbackDays == value)
            {
                return;
            }

            _lookbackDays = value;
            Raise(nameof(LookbackDays));
        }
    }

    /// <summary>The current stream lifecycle state (web <c>stream.state</c>).</summary>
    public AiVampireDrainStreamState State
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
    public bool IsStreaming => _state == AiVampireDrainStreamState.Streaming;

    /// <summary>
    /// True when the surface has the inputs it needs to fire the stream — a resolved <c>vehicle_id &gt; 0</c>
    /// (web <c>haveInputs = Number.isFinite(numericVehicleId) &amp;&amp; numericVehicleId &gt; 0</c>). The
    /// lookback window is optional and never gates the action.
    /// </summary>
    public bool CanStart => _vehicleId is > 0;

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
        _state is AiVampireDrainStreamState.Streaming or AiVampireDrainStreamState.Done or AiVampireDrainStreamState.Error;

    /// <summary>
    /// True while the stream is open but no text has arrived yet — the thinking indicator shows (web
    /// <c>text.length === 0 &amp;&amp; state === 'streaming'</c>).
    /// </summary>
    public bool IsThinking => IsStreaming && _narrationText.Length == 0;

    /// <summary>True when the stream ended in failure (web <c>state === 'error'</c>).</summary>
    public bool IsError => _state == AiVampireDrainStreamState.Error;

    /// <summary>True when the failure was a connectivity fault — drives the offline message rather than the generic error.</summary>
    public bool IsOffline => _state == AiVampireDrainStreamState.Error && _errorReason == AiVampireDrainErrorReason.Network;

    /// <summary>The localized card title (web <c>vampireDrain.aiNarrative.title</c>).</summary>
    public string Title => _localizer.GetString(
        AIVampireDrainExplanationRegistration.TitleKey,
        AIVampireDrainExplanationRegistration.TitleFallback);

    /// <summary>The localized card description (web <c>vampireDrain.aiNarrative.description</c>).</summary>
    public string Description => _localizer.GetString(
        AIVampireDrainExplanationRegistration.DescriptionKey,
        AIVampireDrainExplanationRegistration.DescriptionFallback);

    /// <summary>The localized per-feature action verb (web <c>vampireDrain.aiNarrative.generateButton</c>).</summary>
    public string ButtonLabel => _localizer.GetString(
        AIVampireDrainExplanationRegistration.ButtonLabelKey,
        AIVampireDrainExplanationRegistration.ButtonLabelFallback);

    /// <summary>The localized badge text (web <c>vampireDrain.aiNarrative.badge</c>).</summary>
    public string BadgeLabel => _localizer.GetString(
        AIVampireDrainExplanationRegistration.BadgeKey,
        AIVampireDrainExplanationRegistration.BadgeFallback);

    /// <summary>The universal idle CTA label (web <c>helix.askHelix</c>).</summary>
    public string AskHelixLabel => _localizer.GetString(
        AIVampireDrainExplanationRegistration.AskHelixKey,
        AIVampireDrainExplanationRegistration.AskHelixFallback);

    /// <summary>The streaming button label (web <c>helix.thinking</c>).</summary>
    public string ThinkingLabel => _localizer.GetString(
        AIVampireDrainExplanationRegistration.ThinkingKey,
        AIVampireDrainExplanationRegistration.ThinkingFallback);

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

            if (_errorReason == AiVampireDrainErrorReason.Network)
            {
                return _localizer.GetString(
                    AIVampireDrainExplanationRegistration.OfflineKey,
                    AIVampireDrainExplanationRegistration.OfflineFallback);
            }

            var label = _localizer.GetString(
                AIVampireDrainExplanationRegistration.ErrorLabelKey,
                AIVampireDrainExplanationRegistration.ErrorLabelFallback);
            var message = _errorMessage.Length > 0
                ? _errorMessage
                : _localizer.GetString(
                    AIVampireDrainExplanationRegistration.ErrorUnknownKey,
                    AIVampireDrainExplanationRegistration.ErrorUnknownFallback);
            return string.Concat(label, " ", message);
        }
    }

    /// <summary>
    /// Fire the narration stream (web <c>stream.start()</c>) as a detached task — the view's click handler.
    /// A duplicate call while streaming, a call with no resolved vehicle, or a call on a gated-off surface is a
    /// no-op (web button <c>disabled</c> + <c>runningRef</c> guard).
    /// </summary>
    public void Start() => _ = StartAsync();

    /// <summary>
    /// Run one narration stream and fold every event into <see cref="State"/> / <see cref="NarrationText"/> —
    /// the awaitable core of <see cref="Start"/> (exposed for headless tests). Idempotent while a stream is in
    /// flight; cancelling returns the surface to <see cref="AiVampireDrainStreamState.Idle"/>.
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

        NarrationText = string.Empty;
        _errorMessage = string.Empty;
        _errorReason = AiVampireDrainErrorReason.Unknown;
        State = AiVampireDrainStreamState.Streaming;

        var request = new AiVampireDrainRequest(_vehicleId ?? 0, _lookbackDays);
        try
        {
            await foreach (var ev in _transport.StreamAsync(request, cts.Token).ConfigureAwait(false))
            {
                Apply(ev);
            }

            // web: if the loop ends without a terminal event while still streaming, mark done.
            if (_state == AiVampireDrainStreamState.Streaming)
            {
                State = AiVampireDrainStreamState.Done;
            }
        }
        catch (OperationCanceledException)
        {
            // web abort path: a cancelled in-flight stream returns to idle.
            if (_state == AiVampireDrainStreamState.Streaming)
            {
                State = AiVampireDrainStreamState.Idle;
            }
        }
        catch (Exception ex)
        {
            // The transport surfaces failures as Error events; an unexpected throw still ends in the error
            // surface rather than leaving the card stuck in streaming.
            _errorMessage = ex.Message;
            _errorReason = AiVampireDrainErrorReason.Unknown;
            State = AiVampireDrainStreamState.Error;
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

    private void Apply(AiVampireDrainStreamEvent ev)
    {
        switch (ev.Kind)
        {
            case AiVampireDrainEventKind.Delta:
                NarrationText = string.Concat(_narrationText, ev.Text);
                if (_state != AiVampireDrainStreamState.Streaming)
                {
                    State = AiVampireDrainStreamState.Streaming;
                }

                break;

            case AiVampireDrainEventKind.ConfirmRequest:
                State = AiVampireDrainStreamState.PausedConfirm;
                break;

            case AiVampireDrainEventKind.Done:
                State = AiVampireDrainStreamState.Done;
                break;

            case AiVampireDrainEventKind.Error:
                _errorMessage = ev.Message;
                _errorReason = ev.ErrorReason;
                Raise(nameof(DisplayErrorText));
                State = AiVampireDrainStreamState.Error;
                break;

            case AiVampireDrainEventKind.ToolCall:
            case AiVampireDrainEventKind.ToolResult:
            default:
                // Tool frames update no visible state for this narration surface (web onEvent no-op).
                break;
        }
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
