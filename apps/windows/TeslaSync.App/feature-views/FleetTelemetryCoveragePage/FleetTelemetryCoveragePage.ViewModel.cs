using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>FleetTelemetryCoveragePage</c> view — the native port of the web
/// page's data flow (web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx). It reads the routing snapshot through
/// the injected <see cref="IFleetTelemetryCoverageFeed"/> (web <c>useFleetTelemetryCoverage</c>), owns the client-side
/// filter text (web <c>filter</c> useState — purely in-memory, never a refetch), and projects the result through
/// <see cref="FleetTelemetryCoverageProjection"/> so the view is a thin renderer. It surfaces the web data states
/// (loading / empty / filter-empty / success / error) plus an in-flight flag; observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class FleetTelemetryCoveragePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFleetTelemetryCoverageFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly FleetTelemetryCoverageDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private FleetTelemetryCoverageSnapshot _snapshot = FleetTelemetryCoverageSnapshot.Empty;
    private bool _hasData;
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private string _filter = string.Empty;

    private FleetTelemetryCoverageState _state = FleetTelemetryCoverageState.Loading;
    private FleetTelemetryCoverageDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) diagnostics.</summary>
    /// <param name="feed">The coverage data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FleetTelemetryCoveragePageViewModel(
        IFleetTelemetryCoverageFeed feed,
        ILocalizer localizer,
        FleetTelemetryCoverageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new FleetTelemetryCoverageDiagnostics();
        _display = FleetTelemetryCoverageProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / success / error).</summary>
    public FleetTelemetryCoverageState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public FleetTelemetryCoverageDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The current client-side filter text (web <c>filter</c>).</summary>
    public string Filter => _filter;

    /// <summary>The localized page title (web <c>coverage.pageTitle</c>).</summary>
    public string Title => FleetTelemetryCoverageRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the coverage load.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasData)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var snapshot = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _snapshot = snapshot;
            _hasData = true;
            _hasError = false;
            _errorDetail = null;
            _loading = false;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception ex)
        {
            // web error: surface the generic failure panel; the per-category section falls back to its empty branch.
            _hasError = true;
            _errorDetail = ex.Message;
            _snapshot = FleetTelemetryCoverageSnapshot.Empty;
            _loading = false;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the routing snapshot (web query refetch / the header Refresh button).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Set the client-side filter (web <c>setFilter</c> / the filter input's onChange). Purely in-memory: re-projects
    /// the already-loaded snapshot without a refetch, exactly as the web <c>useMemo</c> derivations do.
    /// </summary>
    public void SetFilter(string filter)
    {
        var next = filter ?? string.Empty;
        if (string.Equals(_filter, next, StringComparison.Ordinal))
        {
            return;
        }

        _filter = next;
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

    private FleetTelemetryCoverageModel BuildModel() => new(
        Snapshot: _snapshot,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        Filter: _filter);

    private void Reproject()
    {
        var display = FleetTelemetryCoverageProjection.Project(BuildModel(), _localizer);
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
