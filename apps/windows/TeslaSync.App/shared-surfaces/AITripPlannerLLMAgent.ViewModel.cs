using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <c>AITripPlannerLLMAgent</c> view — the native composition
/// of the web InnerSection + <c>useAiStream</c> (web/src/components/ai/AITripPlannerLLMAgent.tsx,
/// web/src/hooks/useAiStream.ts). It evaluates the AI-feature gate once (the <c>withAiFeature</c> visibility
/// decision), projects the localized card labels, builds the draft request body from the parent-supplied inputs
/// (the web <c>useMemo</c> body), and drives the draft SSE stream through the injected
/// <see cref="IAiTripPlannerTransport"/> seam: <see cref="Start"/> opens the stream, accumulates <c>delta</c>
/// text into <see cref="Text"/>, pauses on a <c>confirm_request</c>, captures the structured <see cref="Limit"/>
/// on a rate-limited <c>error</c> frame, and settles to <see cref="AiTripPlanStreamState.Done"/> /
/// <see cref="AiTripPlanStreamState.Error"/>. It performs no HTTP and references no view framework, so every
/// transition is asserted headlessly. Drive it from one confinement (the UI thread); change notifications may be
/// raised from the stream's background continuation, and marshalling onto the UI thread is the mounted view's
/// responsibility (mirroring how React reconciles the hook's setState).
/// </summary>
public sealed class AiTripPlannerLLMAgentViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiTripPlannerTransport _transport;
    private readonly AiTripPlannerInputs _inputs;
    private readonly AiTripPlanRequest _request;

    private AiTripPlanStreamState _state = AiTripPlanStreamState.Idle;
    private string _text = string.Empty;
    private string? _error;
    private AiTripPlanLimitInfo? _limit;

    private CancellationTokenSource? _cts;
    private Task? _runTask;
    private bool _running;
    private bool _disposed;

    /// <summary>Creates the holder over its transport, gate, localizer and the parent-supplied inputs.</summary>
    /// <param name="transport">The SSE transport seam (web <c>fetch</c>); the view never opens it directly.</param>
    /// <param name="gate">The AI-feature gate (web <c>withAiFeature</c> / <c>useAiEnabled</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="inputs">
    /// The trip-planner inputs surfaced by the parent page (web InnerSection props). The draft body is built from
    /// them with the web default substitutions; the action stays disabled until a vehicle id plus both endpoints
    /// are present (web <c>canStart = !!vehicleId &amp;&amp; origin != null &amp;&amp; destination != null</c>).
    /// </param>
    public AiTripPlannerLLMAgentViewModel(
        IAiTripPlannerTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        AiTripPlannerInputs inputs)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(inputs);

        _transport = transport;
        _inputs = inputs;
        _request = AiTripPlanRequest.Build(inputs);
        Display = AITripPlannerLLMAgentProjection.Project(localizer);
        IsGateOpen = gate.IsEnabled(AITripPlannerLLMAgentRegistration.FeatureId);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, localized card labels (web InnerSection + AIFeatureCard copy).</summary>
    public AITripPlannerLLMAgentDisplay Display { get; }

    /// <summary>
    /// Whether the AI-feature gate is open (web <c>useAiEnabled('trip-planner-llm-agent')</c>). When false the
    /// mounted view collapses to nothing, the native analogue of the <c>withAiFeature</c> HOC returning
    /// <c>null</c>.
    /// </summary>
    public bool IsGateOpen { get; }

    /// <summary>The draft request body posted on <see cref="Start"/> (web <c>useMemo</c> body) — a test seam.</summary>
    public AiTripPlanRequest Request => _request;

    /// <summary>
    /// Whether the action can fire (web <c>canStart = !!vehicleId &amp;&amp; origin != null &amp;&amp;
    /// destination != null</c>). A vehicle id is required (the page's string id, non-empty) along with both
    /// corridor endpoints.
    /// </summary>
    public bool CanStart =>
        !string.IsNullOrEmpty(_inputs.VehicleId) && _inputs.Origin is not null && _inputs.Destination is not null;

    /// <summary>The stream lifecycle state (web <c>state</c>).</summary>
    public AiTripPlanStreamState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The accumulated <c>delta</c> plan text (web <c>text</c>).</summary>
    public string Text
    {
        get => _text;
        private set => Set(ref _text, value);
    }

    /// <summary>The error message when <see cref="State"/> is <see cref="AiTripPlanStreamState.Error"/>, else null (web <c>error</c>).</summary>
    public string? Error
    {
        get => _error;
        private set => Set(ref _error, value);
    }

    /// <summary>The structured rate-limit / cost-cap info from the last terminal error, or null (web <c>limit</c>).</summary>
    public AiTripPlanLimitInfo? Limit
    {
        get => _limit;
        private set => Set(ref _limit, value);
    }

    /// <summary>True while a stream is open (web <c>state === 'streaming'</c>).</summary>
    public bool IsStreaming => State == AiTripPlanStreamState.Streaming;

    /// <summary>The visible CTA text: the streaming label while in flight, else the universal Helix CTA.</summary>
    public string ButtonText => IsStreaming ? Display.ThinkingLabel : Display.AskHelixLabel;

    /// <summary>Whether the action button is enabled (web <c>disabled = !canStart || streaming</c>, inverted).</summary>
    public bool ButtonEnabled => CanStart && !IsStreaming;

    /// <summary>True when the streaming thinking-skeleton should show (streaming, no text yet) (web AiOutputPanel).</summary>
    public bool ShowThinking => IsStreaming && _text.Length == 0;

    /// <summary>True when accumulated plan text should render (web AiOutputPanel).</summary>
    public bool ShowText => _text.Length > 0;

    /// <summary>True when the error surface should render (web AiOutputPanel error branch).</summary>
    public bool ShowError => State == AiTripPlanStreamState.Error;

    /// <summary>The in-flight stream task, or null when no stream has started — a deterministic test seam.</summary>
    internal Task? PendingStream => _runTask;

    /// <summary>
    /// Open the draft stream (web <c>start()</c>). A no-op while already streaming or when the action cannot
    /// fire (missing vehicle id or endpoints), mirroring the disabled button. Resets the accumulated text, error
    /// and limit, then consumes the transport on a background flow.
    /// </summary>
    public void Start()
    {
        if (_disposed || _running || !CanStart)
        {
            return;
        }

        _running = true;
        State = AiTripPlanStreamState.Streaming;
        Text = string.Empty;
        Error = null;
        Limit = null;

        var cts = new CancellationTokenSource();
        _cts = cts;
        _runTask = RunAsync(cts.Token);
    }

    /// <summary>Abort the in-flight stream (web <c>cancel()</c>); a cancelled stream settles back to idle.</summary>
    public void Cancel()
    {
        var cts = _cts;
        _cts = null;
        if (cts is not null)
        {
            cts.Cancel();
            cts.Dispose();
        }

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
        Cancel();
        GC.SuppressFinalize(this);
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        var parser = new SseFrameParser();
        try
        {
            await foreach (var chunk in _transport.OpenAsync(_request, cancellationToken).ConfigureAwait(false))
            {
                foreach (var frame in parser.Feed(chunk))
                {
                    var typed = AiTripPlanStreamParser.ParseFrame(frame);
                    if (typed is not null)
                    {
                        HandleEvent(typed);
                    }
                }
            }

            // web: setState(cur => cur === 'streaming' ? 'done' : cur) — a clean close without a terminal frame
            // still settles the lifecycle; a confirm-pause or prior error is preserved.
            if (State == AiTripPlanStreamState.Streaming)
            {
                State = AiTripPlanStreamState.Done;
            }
        }
        catch (OperationCanceledException)
        {
            // web AbortError path: a user-cancelled stream returns to idle, never error.
            if (State == AiTripPlanStreamState.Streaming)
            {
                State = AiTripPlanStreamState.Idle;
            }
        }
        catch (HttpRequestException ex)
        {
            FinalizeError(ex.Message);
        }
        catch (IOException ex)
        {
            FinalizeError(ex.Message);
        }
        finally
        {
            _running = false;
        }
    }

    private void HandleEvent(AiTripPlanStreamEvent typed)
    {
        switch (typed.Kind)
        {
            case AiTripPlanEventKind.Delta:
                Text = _text + typed.Text;
                break;
            case AiTripPlanEventKind.ConfirmRequest:
                State = AiTripPlanStreamState.PausedConfirm;
                break;
            case AiTripPlanEventKind.Done:
                State = AiTripPlanStreamState.Done;
                break;
            case AiTripPlanEventKind.Error:
                // web F9: capture the structured limit fields only when the error frame carried a reason; a plain
                // error frame yields no limit and the generic error surface is shown.
                if (typed.Reason is not null)
                {
                    Limit = new AiTripPlanLimitInfo(
                        Reason: typed.Reason,
                        RetryAfterS: typed.RetryAfterS ?? 0,
                        BannerLevel: typed.BannerLevel ?? string.Empty,
                        BaselineAvailable: typed.BaselineAvailable ?? true,
                        Message: typed.Message);
                }

                FinalizeError(typed.Message);
                break;
            case AiTripPlanEventKind.ToolCall:
            case AiTripPlanEventKind.ToolResult:
            default:
                // tool_call / tool_result advance the caller's transcript in the web hook; the trip-planner
                // surface's onEvent is a no-op, so there is no internal state change here.
                break;
        }
    }

    private void FinalizeError(string message)
    {
        Error = message;
        State = AiTripPlanStreamState.Error;
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        return true;
    }
}
