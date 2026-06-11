using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <c>AISafetySettingExplainer</c> view — the native
/// composition of the web InnerSection + <c>useAiStream</c> (web/src/components/ai/AISafetySettingExplainer.tsx,
/// web/src/hooks/useAiStream.ts). It evaluates the AI-feature gate once (the <c>withAiFeature</c> visibility
/// decision), projects the localized card labels, and drives the settings-safety narration SSE stream through the
/// injected <see cref="IAiSafetyExplainTransport"/> seam: <see cref="Start"/> opens the stream, accumulates
/// <c>delta</c> text into <see cref="Text"/>, pauses on a <c>confirm_request</c> (reproduced for lifecycle parity
/// only — the narrative explainer never issues one), and settles to <see cref="AiSafetyExplainStreamState.Done"/>
/// / <see cref="AiSafetyExplainStreamState.Error"/>. A connectivity fault is classified so the view can show the
/// offline affordance. It performs no HTTP and references no view framework, so every transition is asserted
/// headlessly. Drive it from one confinement (the UI thread); change notifications may be raised from the
/// stream's background continuation, and marshalling onto the UI thread is the mounted view's responsibility
/// (mirroring how React reconciles the hook's setState).
/// </summary>
public sealed class AiSafetySettingExplainerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiSafetyExplainTransport _transport;
    private readonly ILocalizer _localizer;
    private readonly bool _isGateOpen;

    private AiSafetyExplainStreamState _state = AiSafetyExplainStreamState.Idle;
    private string _text = string.Empty;
    private string _errorMessage = string.Empty;
    private AiSafetyExplainErrorReason _errorReason = AiSafetyExplainErrorReason.Unknown;

    private CancellationTokenSource? _cts;
    private Task? _runTask;
    private bool _running;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over its transport (P1/S8 seam), the AI feature gate and the i18n facade. Throws when
    /// the surface's feature id is not in the canonical AI feature registry — the native analogue of
    /// <c>withAiFeature</c> rejecting an unknown id at module load.
    /// </summary>
    /// <param name="transport">The SSE transport seam (web <c>fetch</c>); the view never opens it directly.</param>
    /// <param name="gate">The AI-feature gate (web <c>withAiFeature</c> / <c>useAiEnabled</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public AiSafetySettingExplainerViewModel(
        IAiSafetyExplainTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!AISafetySettingExplainerRegistration.IsRegisteredFeature(
                AISafetySettingExplainerRegistration.FeatureId))
        {
            throw new InvalidOperationException(
                $"Unknown AI feature id '{AISafetySettingExplainerRegistration.FeatureId}'. " +
                "Add it to the AI feature registry (web/src/ai/features.ts) and regenerate.");
        }

        _transport = transport;
        _localizer = localizer;
        Display = AISafetySettingExplainerProjection.Project(localizer);
        _isGateOpen = gate.IsEnabled(AISafetySettingExplainerRegistration.FeatureId);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, localized card labels (web InnerSection + AIFeatureCard copy).</summary>
    public AISafetySettingExplainerDisplay Display { get; }

    /// <summary>
    /// Whether the AI-feature gate is open (web <c>useAiEnabled('safety-setting-explainer')</c>). When false the
    /// mounted view collapses to nothing, the native analogue of the <c>withAiFeature</c> HOC returning
    /// <see langword="null"/>.
    /// </summary>
    public bool IsGateOpen => _isGateOpen;

    /// <summary>The stream lifecycle state (web <c>stream.state</c>).</summary>
    public AiSafetyExplainStreamState State
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
            Raise(nameof(ButtonEnabled));
            Raise(nameof(ButtonText));
            Raise(nameof(ShowThinking));
            Raise(nameof(ShowError));
            Raise(nameof(IsOffline));
            Raise(nameof(HasOutput));
            Raise(nameof(DisplayErrorText));
        }
    }

    /// <summary>The accumulated <c>delta</c> narration text (web <c>stream.text</c>).</summary>
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

    /// <summary>True while the SSE stream is open (web <c>stream.state === 'streaming'</c>).</summary>
    public bool IsStreaming => _state == AiSafetyExplainStreamState.Streaming;

    /// <summary>
    /// True when the action may fire (web <c>canStart={stream.state !== 'paused-confirm'}</c>). The explainer
    /// needs no inputs — one click yields one short summary of the install's current safety toggles — so the only
    /// thing that blocks a (re)start is an outstanding confirmation pause.
    /// </summary>
    public bool CanStart => _state != AiSafetyExplainStreamState.PausedConfirm;

    /// <summary>
    /// True when the action button is interactive — startable and no stream in flight (web AIFeatureCard
    /// <c>disabled = !canStart || streaming</c>, inverted). Disabled while streaming (the ring shows) and while
    /// paused for a confirmation.
    /// </summary>
    public bool ButtonEnabled => CanStart && !IsStreaming;

    /// <summary>The visible CTA text: the streaming "thinking" copy while in flight, else the universal Helix CTA.</summary>
    public string ButtonText => IsStreaming ? Display.ThinkingLabel : Display.AskHelixLabel;

    /// <summary>
    /// True once a stream has run (or is running) — the output panel is shown (web <c>AiOutputPanel</c>
    /// <c>hasAnything = text.length &gt; 0 || state ∈ {streaming, error, done}</c>); idle with no text hides it so
    /// the card is the friendly ready state (header + description + action), never a blank box.
    /// </summary>
    public bool HasOutput =>
        _text.Length > 0 ||
        _state is AiSafetyExplainStreamState.Streaming
            or AiSafetyExplainStreamState.Done
            or AiSafetyExplainStreamState.Error;

    /// <summary>
    /// True while the stream is open but no text has arrived yet — the thinking skeleton shows (web AiOutputPanel
    /// <c>text.length === 0 &amp;&amp; state === 'streaming'</c>).
    /// </summary>
    public bool ShowThinking => IsStreaming && _text.Length == 0;

    /// <summary>True when accumulated narration text should render (web AiOutputPanel text branch).</summary>
    public bool ShowText => _text.Length > 0;

    /// <summary>True when the error surface should render (web AiOutputPanel error branch).</summary>
    public bool ShowError => _state == AiSafetyExplainStreamState.Error;

    /// <summary>
    /// True when the failure was a connectivity fault — drives the offline message rather than the generic error.
    /// An on-demand SSE narration has no cached prior result to age, so a lost connection surfaces here as the
    /// offline branch (the native analogue of the P2 "offline" state for a cache-free surface).
    /// </summary>
    public bool IsOffline => _state == AiSafetyExplainStreamState.Error && _errorReason == AiSafetyExplainErrorReason.Network;

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

            if (_errorReason == AiSafetyExplainErrorReason.Network)
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
    /// Open the narration stream (web <c>handleExplain</c> → <c>stream.start()</c>) as a detached task. A no-op
    /// while a stream is in flight or while paused for a confirmation (web <c>isBusy</c> double-submit guard /
    /// disabled button), or on a gated-off surface. Resets the accumulated text and error, then consumes the
    /// transport on a background flow.
    /// </summary>
    public void Start()
    {
        if (_disposed || _running || !_isGateOpen || _state == AiSafetyExplainStreamState.PausedConfirm)
        {
            return;
        }

        _running = true;

        var cts = new CancellationTokenSource();
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Text = string.Empty;
        _errorMessage = string.Empty;
        _errorReason = AiSafetyExplainErrorReason.Unknown;
        State = AiSafetyExplainStreamState.Streaming;

        _runTask = RunAsync(cts.Token);
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

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        var parser = new SseFrameParser();
        try
        {
            await foreach (var chunk in _transport.OpenAsync(cancellationToken).ConfigureAwait(false))
            {
                foreach (var frame in parser.Feed(chunk))
                {
                    var typed = AiSafetyExplainStreamParser.ParseFrame(frame);
                    if (typed is not null)
                    {
                        HandleEvent(typed);
                    }
                }
            }

            // web: setState(cur => cur === 'streaming' ? 'done' : cur) — a clean close without a terminal frame
            // still settles the lifecycle; a confirm-pause or prior error is preserved.
            if (_state == AiSafetyExplainStreamState.Streaming)
            {
                State = AiSafetyExplainStreamState.Done;
            }
        }
        catch (OperationCanceledException)
        {
            // web AbortError path: a user-cancelled stream returns to idle, never error.
            if (_state == AiSafetyExplainStreamState.Streaming)
            {
                State = AiSafetyExplainStreamState.Idle;
            }
        }
        catch (HttpRequestException ex)
        {
            // A `stream_http_{status}` message is the off-mode / server-fault path; any other HttpRequestException
            // (connection refused, DNS, reset) is a connectivity fault → the offline affordance.
            var reason = ex.Message.StartsWith("stream_http_", StringComparison.Ordinal)
                ? AiSafetyExplainErrorReason.Http
                : AiSafetyExplainErrorReason.Network;
            FinalizeError(ex.Message, reason);
        }
        catch (IOException ex)
        {
            // A mid-stream read failure is a connectivity fault.
            FinalizeError(ex.Message, AiSafetyExplainErrorReason.Network);
        }
        finally
        {
            _running = false;
        }
    }

    private void HandleEvent(AiSafetyExplainStreamEvent typed)
    {
        switch (typed.Kind)
        {
            case AiSafetyExplainEventKind.Delta:
                Text = string.Concat(_text, typed.Text);
                if (_state != AiSafetyExplainStreamState.Streaming)
                {
                    State = AiSafetyExplainStreamState.Streaming;
                }

                break;

            case AiSafetyExplainEventKind.ConfirmRequest:
                State = AiSafetyExplainStreamState.PausedConfirm;
                break;

            case AiSafetyExplainEventKind.Done:
                State = AiSafetyExplainStreamState.Done;
                break;

            case AiSafetyExplainEventKind.Error:
                FinalizeError(typed.Message, AiSafetyExplainErrorReason.Stream);
                break;

            case AiSafetyExplainEventKind.ToolCall:
            case AiSafetyExplainEventKind.ToolResult:
            default:
                // web onEvent is a deliberate no-op for the narrative explainer: tool frames advance no visible
                // state, and AiOutputPanel renders stream.text directly.
                break;
        }
    }

    private void FinalizeError(string message, AiSafetyExplainErrorReason reason)
    {
        _errorMessage = message ?? string.Empty;
        _errorReason = reason;
        State = AiSafetyExplainStreamState.Error;
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
