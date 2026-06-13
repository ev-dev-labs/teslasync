using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemDiagnostics;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>DiagnosticPage</c> view — the native port of the web page's data
/// flow (web/src/features/system/pages/DiagnosticPage.tsx). It runs the operator-initiated diagnostic through the
/// injected <see cref="IDiagnosticRunner"/> (web <c>useRunDiagnostic</c>) and projects the result through
/// <see cref="DiagnosticProjection"/> so the view is a thin renderer. Mirroring the web page it never runs on mount;
/// <see cref="RunAsync"/> is fired only by the Run / Re-run affordance. It surfaces the three web data states
/// (loading / empty / success) plus the layered failure panel; observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class DiagnosticPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDiagnosticRunner _runner;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly DiagnosticDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private DiagnosticReport? _report;
    private bool _isRunning;
    private bool _hasError;
    private string? _errorDetail;

    private DiagnosticState _state = DiagnosticState.Empty;
    private DiagnosticDisplay _display;

    /// <summary>Creates the holder over its runner, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="runner">The diagnostic-run data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DiagnosticPageViewModel(
        IDiagnosticRunner runner,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        DiagnosticDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(runner);
        ArgumentNullException.ThrowIfNull(localizer);

        _runner = runner;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new DiagnosticDiagnostics();
        _display = DiagnosticProjection.Project(BuildModel(), _localizer, _clock());
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / success).</summary>
    public DiagnosticState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public DiagnosticDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a diagnostic run is in flight (web <c>isPending</c>).</summary>
    public bool IsRunning
    {
        get => _isRunning;
        private set => Set(ref _isRunning, value);
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run (or re-run) the aggregated diagnostic — the web <c>handleRun</c> path. Clears the prior report and any
    /// error, shows the busy spinner, then resolves the report on success or surfaces the failure panel on error. The
    /// Run affordance stays available throughout so the operator can retry.
    /// </summary>
    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        _report = null;
        _hasError = false;
        _errorDetail = null;
        IsRunning = true;
        Reproject();

        DiagnosticReport? report = null;
        bool failed = false;
        string? detail = null;

        try
        {
            report = await _runner.RunAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer run (or disposed) — drop this result silently.
            return;
        }
        catch (ApiException ex)
        {
            failed = true;
            detail = ex.Message;
        }
        catch (Exception ex)
        {
            failed = true;
            detail = ex.Message;
        }

        _report = report;
        _hasError = failed;
        _errorDetail = detail;
        IsRunning = false;
        Reproject();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _cts);
    }

    private DiagnosticModel BuildModel() => new(
        HasReport: _report is not null,
        Report: _report,
        IsRunning: _isRunning,
        HasError: _hasError,
        ErrorDetail: _errorDetail);

    private void Reproject()
    {
        var display = DiagnosticProjection.Project(BuildModel(), _localizer, _clock());
        Display = display;
        State = display.State;
    }

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? slot, CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref slot, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private static void Cancel(ref CancellationTokenSource? slot)
    {
        var cts = Interlocked.Exchange(ref slot, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
