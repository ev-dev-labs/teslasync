using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Canonical metadata for the BackendTool surface — the native anchor for the web component at
/// web/src/features/admin/components/devtools/BackendTool.tsx. The diagnostics slug is the stable surface
/// name emitted with the <c>view.opened</c> event.
/// </summary>
public static class BackendToolRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "BackendTool";
}

/// <summary>
/// PII-safe diagnostics for the BackendTool surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the endpoint, the request body, the
/// response payload or the run outcome — so a diagnostics line can never leak fleet data or an operator
/// action. Thread-safe.
/// </summary>
public sealed class BackendToolDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BackendToolDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BackendTool</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BackendToolRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="BackendTool"/> view — the native port of the web
/// <c>BackendTool</c>'s hook composition (web/src/features/admin/components/devtools/BackendTool.tsx). It
/// fires the descriptor's dev-tools run through the <see cref="IBackendToolRunner"/> mutation port (web
/// <c>useMutation</c>), tracks the mutually-exclusive <see cref="State"/> (idle → running → success/failed),
/// and resolves every one of the component's own labels (web <c>t('Run')</c>, <c>t('Success')</c>,
/// <c>t('Failed')</c>, plus the result-panel idle line and the copy affordance) through the i18n facade. The
/// card title and description are already-localized strings carried on the descriptor, mirroring the web
/// boundary where they arrive as props. The view is a thin renderer over these properties. Drive it from one
/// confinement; it raises <see cref="PropertyChanged"/> from whatever thread the run resumes on, and the view
/// marshals the render onto the UI thread.
/// </summary>
public sealed class BackendToolViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IBackendToolRunner _runner;
    private readonly ILocalizer _localizer;
    private readonly BackendToolDescriptor _descriptor;

    private BackendToolState _state = BackendToolState.Idle;
    private string? _resultJson;
    private string? _resultError;
    private string? _lastAnnouncement;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    /// <summary>Creates the holder over its mutation runner, localizer and descriptor.</summary>
    /// <param name="runner">The mutation port (web <c>useMutation</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="descriptor">The card configuration (web props).</param>
    public BackendToolViewModel(IBackendToolRunner runner, ILocalizer localizer, BackendToolDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(runner);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(descriptor);
        _runner = runner;
        _localizer = localizer;
        _descriptor = descriptor;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public BackendToolState State
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
            Raise(nameof(IsRunning));
            Raise(nameof(IsIdle));
            Raise(nameof(HasResult));
            Raise(nameof(ShowBadge));
            Raise(nameof(IsSuccess));
            Raise(nameof(BadgeStatus));
            Raise(nameof(BadgeText));
            Raise(nameof(CanRun));
            Raise(nameof(HasResultData));
            Raise(nameof(ShowResultIdle));
            Raise(nameof(ResultTrayStatus));
        }
    }

    /// <summary>Header glyph (web Lucide icon → Segoe Fluent code point).</summary>
    public string Glyph => _descriptor.Glyph;

    /// <summary>Semantic accent token key for the header glyph tint.</summary>
    public string AccentBrushKey => _descriptor.AccentBrushKey;

    /// <summary>Localized card title (web <c>title</c> prop).</summary>
    public string Title => _descriptor.Title;

    /// <summary>Localized card description (web <c>description</c> prop).</summary>
    public string Description => _descriptor.Description;

    /// <summary>True while the run is in flight — the Run button spins and disables (web <c>isPending</c>).</summary>
    public bool IsRunning => _state == BackendToolState.Running;

    /// <summary>True before any run has settled (the initial card surface).</summary>
    public bool IsIdle => _state == BackendToolState.Idle;

    /// <summary>True once a run has settled (success or failure) — the badge + result tray are shown.</summary>
    public bool HasResult => _state is BackendToolState.Success or BackendToolState.Failed;

    /// <summary>True when the settled run succeeded.</summary>
    public bool IsSuccess => _state == BackendToolState.Success;

    /// <summary>Whether the outcome badge is shown (web <c>{mutation.data &amp;&amp; &lt;Badge/&gt;}</c>).</summary>
    public bool ShowBadge => HasResult;

    /// <summary>The semantic status for the outcome badge (web <c>variant={error ? 'danger' : 'success'}</c>).</summary>
    public StatusKind BadgeStatus => _state == BackendToolState.Failed ? StatusKind.Danger : StatusKind.Success;

    /// <summary>The outcome badge label (web <c>{error ? t('Failed') : t('Success')}</c>).</summary>
    public string BadgeText => _state == BackendToolState.Failed ? FailedLabel : SuccessLabel;

    /// <summary>The pretty-printed JSON payload of a successful run, or null.</summary>
    public string? ResultJson => _resultJson;

    /// <summary>The failure message of a failed run, or null (a non-string server error has no message).</summary>
    public string? ResultError => _resultError;

    /// <summary>True when a successful run produced a JSON payload to show + copy.</summary>
    public bool HasResultData => _state == BackendToolState.Success && _resultJson is not null;

    /// <summary>
    /// True when the result tray shows the idle line (web <c>ResultPanel</c> "No result yet"): before any run,
    /// or after a failure that carried no string message.
    /// </summary>
    public bool ShowResultIdle => !HasResultData && _resultError is null;

    /// <summary>The semantic tint for the result tray (success / danger / neutral idle).</summary>
    public StatusKind ResultTrayStatus => _state switch
    {
        BackendToolState.Success => StatusKind.Success,
        BackendToolState.Failed when _resultError is not null => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>True when a run can be started now (no run is in flight).</summary>
    public bool CanRun => _state != BackendToolState.Running;

    /// <summary>The last settled-run message surfaced to the accessibility live region (null until a run settles).</summary>
    public string? LastAnnouncement
    {
        get => _lastAnnouncement;
        private set
        {
            if (string.Equals(_lastAnnouncement, value, StringComparison.Ordinal))
            {
                return;
            }

            _lastAnnouncement = value;
            Raise(nameof(LastAnnouncement));
        }
    }

    /// <summary>Localized Run button label (web <c>t('Run')</c>).</summary>
    public string RunLabel => _localizer.GetString("devtools.backendTool.run", "Run");

    /// <summary>Localized Run button Narrator name, scoped to this tool.</summary>
    public string RunActionName => string.Format(
        CultureInfo.CurrentCulture,
        _localizer.GetString("devtools.backendTool.runName", "Run {0}"),
        Title);

    /// <summary>Localized running-state Narrator announcement.</summary>
    public string RunningLabel => string.Format(
        CultureInfo.CurrentCulture,
        _localizer.GetString("devtools.backendTool.running", "Running {0}"),
        Title);

    /// <summary>Localized success badge label (web <c>t('Success')</c>).</summary>
    public string SuccessLabel => _localizer.GetString("devtools.backendTool.success", "Success");

    /// <summary>Localized failure badge label (web <c>t('Failed')</c>).</summary>
    public string FailedLabel => _localizer.GetString("devtools.backendTool.failed", "Failed");

    /// <summary>Localized result-tray title (the card title, web <c>ResultPanel title={title}</c>).</summary>
    public string ResultTitle => Title;

    /// <summary>Localized idle result line (web <c>ResultPanel</c> "No result yet").</summary>
    public string NoResultLabel => _localizer.GetString("devtools.backendTool.noResult", "No result yet");

    /// <summary>Localized copy affordance idle label (web <c>CopyButton</c>).</summary>
    public string CopyLabel => _localizer.GetString("devtools.backendTool.copy", "Copy");

    /// <summary>Localized copy affordance confirmation label (web <c>CopyButton</c>).</summary>
    public string CopiedLabel => _localizer.GetString("devtools.backendTool.copied", "Copied");

    /// <summary>
    /// Fire the backend run — the native port of the web <c>mutation.mutate()</c>: no-ops while a run is in
    /// flight (the web button is disabled by <c>isPending</c>), marks the surface running (button spins,
    /// previous result clears), drives the descriptor through the mutation port, and folds the settled outcome
    /// into <see cref="State"/> + the result tray, announcing the outcome to the accessibility live region. A
    /// superseding run (or disposal) cancels the prior one and is dropped silently.
    /// </summary>
    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        if (_state == BackendToolState.Running || _disposed)
        {
            return;
        }

        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        _resultJson = null;
        _resultError = null;
        LastAnnouncement = null;
        State = BackendToolState.Running;

        try
        {
            var outcome = await _runner.RunAsync(_descriptor, cts.Token).ConfigureAwait(false);
            ApplyOutcome(outcome);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer run (or disposed) — drop this emission silently.
        }
        finally
        {
            if (ReferenceEquals(Volatile.Read(ref _cts), cts))
            {
                Interlocked.CompareExchange(ref _cts, null, cts);
                cts.Dispose();
            }
        }
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

    private void ApplyOutcome(BackendToolOutcome outcome)
    {
        if (outcome.Ok && outcome.Data is { } data)
        {
            _resultJson = BackendToolFormat.PrettyPrint(data);
            _resultError = null;
            State = BackendToolState.Success;
        }
        else
        {
            _resultJson = null;
            _resultError = outcome.Error;
            State = BackendToolState.Failed;
        }

        Raise(nameof(ResultJson));
        Raise(nameof(ResultError));
        Raise(nameof(HasResultData));
        Raise(nameof(ShowResultIdle));
        LastAnnouncement = $"{Title}: {BadgeText}";
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
