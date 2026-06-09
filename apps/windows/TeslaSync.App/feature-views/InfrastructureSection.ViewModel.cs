using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Infrastructure;

/// <summary>
/// Canonical registry metadata for the Infrastructure feature view — the native mirror of the web
/// <c>InfrastructureSection</c> (web/src/features/admin/components/devtools/InfrastructureSection.tsx). The
/// admin/dev-tools host binds this surface under the stable <see cref="Id"/>.
/// </summary>
public static class InfrastructureSectionRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "infrastructure-section";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "InfrastructureSection";

    /// <summary>Localized section display name (web parity "Infrastructure").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("featureView.infrastructure.title", "Infrastructure");
    }
}

/// <summary>
/// PII-safe diagnostics for the Infrastructure feature view (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a topic, message, endpoint response or
/// error body — so a diagnostics line can never leak operator input or server internals. Thread-safe.
/// </summary>
public sealed class InfrastructureSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public InfrastructureSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=InfrastructureSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={InfrastructureSectionRegistration.Slug}");
    }
}

/// <summary>The background tint a tool's ResultPanel uses (web <c>bg-neon-red/5</c> / <c>green/5</c> / <c>white/[0.02]</c>).</summary>
public enum InfrastructureResultTone
{
    /// <summary>No result yet — the subtle idle surface.</summary>
    Idle,

    /// <summary>A successful result — the success-tinted surface.</summary>
    Success,

    /// <summary>An error — the danger-tinted surface.</summary>
    Error,
}

/// <summary>
/// UI-thread-free state holder backing one tool card — the native port of a single web <c>BackendTool</c>'s
/// <c>useMutation</c> (web/src/features/admin/components/devtools/BackendTool.tsx). It owns the on-demand run
/// (idle → running → succeeded/failed/offline), keeps the previous result visible while a re-run is in
/// flight (the web's persisted <c>mutation.data</c>), and exposes render-ready, already-localized strings so
/// the view is a thin renderer. Drive it from one confinement (the UI thread); it is not internally
/// synchronised. Raise <see cref="PropertyChanged"/> marshalling is the view's responsibility.
/// </summary>
public class InfrastructureToolViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IInfrastructureToolRunner _runner;
    private readonly ILocalizer _localizer;

    private InfrastructureToolStatus _status = InfrastructureToolStatus.Idle;
    private string? _resultJson;
    private string? _errorMessage;
    private int _attempts;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    /// <summary>Creates the holder over its descriptor, runner and localizer.</summary>
    public InfrastructureToolViewModel(
        InfrastructureToolDescriptor descriptor,
        IInfrastructureToolRunner runner,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        ArgumentNullException.ThrowIfNull(runner);
        ArgumentNullException.ThrowIfNull(localizer);
        Descriptor = descriptor;
        _runner = runner;
        _localizer = localizer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The static metadata for this tool.</summary>
    public InfrastructureToolDescriptor Descriptor { get; }

    /// <summary>The current mutually-exclusive card state.</summary>
    public InfrastructureToolStatus Status
    {
        get => _status;
        private set
        {
            if (_status == value)
            {
                return;
            }

            _status = value;
            Raise(nameof(Status));
            RaiseDerived();
        }
    }

    /// <summary>Localized card title (web tool title, e.g. "Db Stats").</summary>
    public string Title => _localizer.GetString(Descriptor.TitleKey, Descriptor.TitleFallback);

    /// <summary>Localized card description (web tool description).</summary>
    public string Description => _localizer.GetString(Descriptor.DescriptionKey, Descriptor.DescriptionFallback);

    /// <summary>The Segoe Fluent icon glyph for the card's accent tile.</summary>
    public string Glyph => Descriptor.Glyph;

    /// <summary>The design-token brush key the view tints the accent tile / icon with.</summary>
    public string AccentBrushKey => Descriptor.AccentBrushKey;

    /// <summary>True for the MQTT tool, which renders the topic/message inputs.</summary>
    public bool RequiresInput => Descriptor.RequiresInput;

    /// <summary>Pretty-printed JSON of the last successful result (null when there is none).</summary>
    public string? ResultJson
    {
        get => _resultJson;
        private set
        {
            if (_resultJson == value)
            {
                return;
            }

            _resultJson = value;
            Raise(nameof(ResultJson));
            Raise(nameof(HasResult));
        }
    }

    /// <summary>Localized error text shown in the ResultPanel (null when there is no error).</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set
        {
            if (_errorMessage == value)
            {
                return;
            }

            _errorMessage = value;
            Raise(nameof(ErrorMessage));
        }
    }

    /// <summary>Number of runs started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set
        {
            if (_attempts == value)
            {
                return;
            }

            _attempts = value;
            Raise(nameof(Attempts));
        }
    }

    /// <summary>True while a run is in flight (the button shows a progress ring).</summary>
    public bool IsRunning => _status == InfrastructureToolStatus.Running;

    /// <summary>True when the last run succeeded.</summary>
    public bool IsSuccess => _status == InfrastructureToolStatus.Succeeded;

    /// <summary>True when the last run failed with a server/in-band error.</summary>
    public bool IsFailed => _status == InfrastructureToolStatus.Failed;

    /// <summary>True when the last run failed because the API was unreachable.</summary>
    public bool IsOffline => _status == InfrastructureToolStatus.Offline;

    /// <summary>True when the last run failed in any way (drives the danger tint + error text).</summary>
    public bool HasError => _status is InfrastructureToolStatus.Failed or InfrastructureToolStatus.Offline;

    /// <summary>True when a JSON result is available to render and copy.</summary>
    public bool HasResult => _resultJson is not null;

    /// <summary>
    /// True once a run has settled — the web only renders the status badge when <c>mutation.data</c> exists.
    /// </summary>
    public bool ShowBadge => _status is InfrastructureToolStatus.Succeeded
        or InfrastructureToolStatus.Failed
        or InfrastructureToolStatus.Offline;

    /// <summary>Localized badge text (web "Success" / "Failed").</summary>
    public string BadgeText => IsSuccess
        ? _localizer.GetString("featureView.infrastructure.success", "Success")
        : _localizer.GetString("featureView.infrastructure.failed", "Failed");

    /// <summary>The semantic status driving the badge colour.</summary>
    public StatusKind BadgeStatus => IsSuccess ? StatusKind.Success : StatusKind.Danger;

    /// <summary>The ResultPanel background tint for the current state.</summary>
    public InfrastructureResultTone ResultTone => HasError
        ? InfrastructureResultTone.Error
        : HasResult ? InfrastructureResultTone.Success : InfrastructureResultTone.Idle;

    /// <summary>Localized idle message shown when there is no result (web "No result yet").</summary>
    public string IdleMessage => _localizer.GetString("featureView.infrastructure.noResult", "No result yet");

    /// <summary>Localized run-button label (web "Run"; the MQTT tool overrides to "Send Test").</summary>
    public virtual string RunButtonText => _localizer.GetString("featureView.infrastructure.run", "Run");

    /// <summary>The localized copy-button label (web <c>CopyButton</c>).</summary>
    public string CopyLabel => _localizer.GetString("featureView.infrastructure.copy", "Copy");

    /// <summary>The localized copy-confirmation label.</summary>
    public string CopiedLabel => _localizer.GetString("featureView.infrastructure.copied", "Copied");

    /// <summary>PII-safe Narrator announcement for the result region ("Db Stats: success", …).</summary>
    public string AutomationName =>
        InfrastructureToolProjection.AutomationName(Title, _status, StatePhrase(_status));

    /// <summary>
    /// Run the tool on demand: count the attempt, enter <see cref="InfrastructureToolStatus.Running"/> while
    /// keeping any prior result visible, and fold the settled outcome into the card state. A superseding run
    /// cancels the prior one.
    /// </summary>
    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        Status = InfrastructureToolStatus.Running;

        try
        {
            var outcome = await _runner.RunAsync(Descriptor, BuildBody(), cts.Token);
            if (!cts.Token.IsCancellationRequested)
            {
                Apply(outcome);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer run (or disposed) — drop this result silently.
        }
    }

    /// <summary>Retry after a failure — re-runs the tool from the top (web "Retry"/re-run).</summary>
    public Task RetryAsync() => RunAsync();

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

    /// <summary>The JSON request body for write tools; null for the read tools (the MQTT tool overrides).</summary>
    protected virtual object? BuildBody() => null;

    /// <summary>Raise <see cref="PropertyChanged"/> for a property.</summary>
    protected void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    private void Apply(InfrastructureToolOutcome outcome)
    {
        var status = InfrastructureToolProjection.StatusFor(outcome);
        switch (status)
        {
            case InfrastructureToolStatus.Succeeded:
                ResultJson = InfrastructureToolProjection.PrettyJson(outcome.Value!.Value);
                ErrorMessage = null;
                break;

            case InfrastructureToolStatus.Failed when outcome.Succeeded:
                // A 2xx response carrying an in-band { error } envelope — show the server's message verbatim.
                InfrastructureToolProjection.TryReadInbandError(outcome.Value!.Value, out var inband);
                ResultJson = null;
                ErrorMessage = inband ?? GenericErrorText();
                break;

            default:
                ResultJson = null;
                ErrorMessage = ErrorTextFor(outcome.ErrorKind);
                break;
        }

        Status = status;
    }

    private string GenericErrorText() =>
        _localizer.GetString("featureView.infrastructure.error", "The request failed");

    private string ErrorTextFor(RepositoryErrorKind? kind) => kind switch
    {
        RepositoryErrorKind.Unauthorized =>
            _localizer.GetString("featureView.infrastructure.error.auth", "Sign in to run this tool"),
        RepositoryErrorKind.Offline or RepositoryErrorKind.Network =>
            _localizer.GetString("featureView.infrastructure.error.offline", "You're offline — the server couldn't be reached"),
        RepositoryErrorKind.RateLimited =>
            _localizer.GetString("featureView.infrastructure.error.rateLimited", "Too many requests — please wait a moment"),
        RepositoryErrorKind.Server =>
            _localizer.GetString("featureView.infrastructure.error.server", "The server reported an error"),
        _ => GenericErrorText(),
    };

    private string StatePhrase(InfrastructureToolStatus status) => status switch
    {
        InfrastructureToolStatus.Running =>
            _localizer.GetString("featureView.infrastructure.state.running", "Running"),
        InfrastructureToolStatus.Succeeded =>
            _localizer.GetString("featureView.infrastructure.success", "Success"),
        InfrastructureToolStatus.Failed =>
            _localizer.GetString("featureView.infrastructure.failed", "Failed"),
        InfrastructureToolStatus.Offline =>
            _localizer.GetString("featureView.infrastructure.state.offline", "Offline"),
        _ => _localizer.GetString("featureView.infrastructure.state.idle", "Ready"),
    };

    private void RaiseDerived()
    {
        Raise(nameof(IsRunning));
        Raise(nameof(IsSuccess));
        Raise(nameof(IsFailed));
        Raise(nameof(IsOffline));
        Raise(nameof(HasError));
        Raise(nameof(ShowBadge));
        Raise(nameof(BadgeText));
        Raise(nameof(BadgeStatus));
        Raise(nameof(ResultTone));
        Raise(nameof(AutomationName));
    }
}

/// <summary>
/// The MQTT publish tool's state holder — the native port of the web <c>MqttTestTool</c>
/// (web/src/features/admin/components/devtools/InfrastructureSection.tsx). It adds the editable
/// <see cref="Topic"/> and <see cref="Message"/> fields and builds the <c>{ topic, message }</c> POST body
/// the web component sends to <c>/dev-tools/mqtt-test</c>.
/// </summary>
public sealed class MqttTestToolViewModel : InfrastructureToolViewModel
{
    private readonly ILocalizer _localizer;
    private string _topic = string.Empty;
    private string _message = string.Empty;

    /// <summary>Creates the MQTT tool holder.</summary>
    public MqttTestToolViewModel(
        InfrastructureToolDescriptor descriptor,
        IInfrastructureToolRunner runner,
        ILocalizer localizer)
        : base(descriptor, runner, localizer)
    {
        _localizer = localizer;
    }

    /// <summary>The MQTT topic to publish to (web <c>topic</c> input).</summary>
    public string Topic
    {
        get => _topic;
        set
        {
            value ??= string.Empty;
            if (_topic == value)
            {
                return;
            }

            _topic = value;
            Raise();
        }
    }

    /// <summary>The MQTT message payload (web <c>message</c> textarea).</summary>
    public string Message
    {
        get => _message;
        set
        {
            value ??= string.Empty;
            if (_message == value)
            {
                return;
            }

            _message = value;
            Raise();
        }
    }

    /// <summary>Localized "Topic" field label (web <c>t('Topic')</c>).</summary>
    public string TopicLabel => _localizer.GetString("featureView.infrastructure.topic", "Topic");

    /// <summary>Localized "Message" field label (web <c>t('Message')</c>).</summary>
    public string MessageLabel => _localizer.GetString("featureView.infrastructure.message", "Message");

    /// <summary>The topic input hint text (web <c>test/topic</c>).</summary>
    public string TopicHint =>
        _localizer.GetString("featureView.infrastructure.topicHint", "test/topic");

    /// <summary>The message textarea hint text (web <c>{"key": "value"}</c>).</summary>
    public string MessageHint =>
        _localizer.GetString("featureView.infrastructure.messageHint", "{\"key\": \"value\"}");

    /// <inheritdoc />
    public override string RunButtonText => _localizer.GetString("featureView.infrastructure.sendTest", "Send Test");

    /// <inheritdoc />
    protected override object? BuildBody() => new Dictionary<string, string>
    {
        ["topic"] = _topic,
        ["message"] = _message,
    };
}

/// <summary>
/// The section-level state holder — composes the five tool view-models in the exact order the web
/// <c>InfrastructureSection</c> grid lays them out and exposes the localized section title. The view binds
/// each <see cref="Tools"/> entry to one card.
/// </summary>
public sealed class InfrastructureSectionViewModel : IDisposable
{
    private readonly ILocalizer _localizer;
    private bool _disposed;

    /// <summary>Creates the section holder, building one tool view-model per catalog entry.</summary>
    public InfrastructureSectionViewModel(IInfrastructureToolRunner runner, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(runner);
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;

        Tools = InfrastructureToolDescriptor.Catalog
            .Select(descriptor => descriptor.Kind == InfrastructureToolKind.MqttTest
                ? new MqttTestToolViewModel(descriptor, runner, localizer)
                : new InfrastructureToolViewModel(descriptor, runner, localizer))
            .ToArray();
    }

    /// <summary>The five tool holders, in web layout order.</summary>
    public IReadOnlyList<InfrastructureToolViewModel> Tools { get; }

    /// <summary>Localized section title (web parity "Infrastructure").</summary>
    public string Title => InfrastructureSectionRegistration.Name(_localizer);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        foreach (var tool in Tools)
        {
            tool.Dispose();
        }
    }
}
