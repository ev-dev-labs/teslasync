using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="CostAnalysisPage"/> view — the native port of the
/// web Cost Analysis page's data flow (web/src/features/charging/pages/CostAnalysisPage.tsx). It consumes the
/// cache-then-network <see cref="ICostAnalysisSessionsSource"/> (the native <c>useChargingSessionsPaginated</c>
/// hook), folds each charging-session snapshot through <see cref="CostAnalysisAggregator"/> into the four
/// presentational chart models the section stack threads into its chart children, and exposes the
/// mutually-exclusive <see cref="State"/> plus the freshness flags so the view is a thin renderer. The web
/// page gates the whole layout: <c>isLoading → skeleton</c>, <c>!sessions || length === 0 → empty</c>, else
/// the section stack; this holder reproduces that exactly, collapsing a session-less snapshot to
/// <see cref="CostAnalysisState.Empty"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class CostAnalysisPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ICostAnalysisSessionsSource _source;
    private readonly ILocalizer _localizer;
    private readonly CostAnalysisDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private CostAnalysisState _state = CostAnalysisState.Loading;
    private CostAnalysisCharts _charts = CostAnalysisCharts.Empty;
    private int _sessionCount;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;

    /// <summary>Creates the holder over its data source, localizer, diagnostics and an injectable clock.</summary>
    /// <param name="source">The cache-then-network charging-sessions port (native <c>useChargingSessionsPaginated</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">Injectable clock for deterministic freshness in tests.</param>
    public CostAnalysisPageViewModel(
        ICostAnalysisSessionsSource source,
        ILocalizer localizer,
        CostAnalysisDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new CostAnalysisDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);
        Display = CostAnalysisProjection.Project(localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / loaded / empty / error / stale / offline).</summary>
    public CostAnalysisState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The page chrome strings (title / subtitle / empty title / empty message) — i18n-resolved once.</summary>
    public CostAnalysisDisplay Display { get; }

    /// <summary>The four projected chart models the section stack feeds its presentational chart children.</summary>
    public CostAnalysisCharts Charts
    {
        get => _charts;
        private set => Set(ref _charts, value);
    }

    /// <summary>The number of charging sessions in the current snapshot (drives the empty gate).</summary>
    public int SessionCount
    {
        get => _sessionCount;
        private set => Set(ref _sessionCount, value);
    }

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (header chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed with no cached snapshot (drives the error banner).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the error banner.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>The localized page title (web <c>costAnalysis.title</c>).</summary>
    public string Title => Display.Title;

    /// <summary>The localized page subtitle (web <c>costAnalysis.subtitle</c>).</summary>
    public string Subtitle => Display.Subtitle;

    /// <summary>True for the states where the full section stack is rendered (web success branch).</summary>
    public bool HasContent =>
        _state is CostAnalysisState.Loaded or CostAnalysisState.Stale or CostAnalysisState.Offline;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run a cache-then-network load: shows the skeleton only when nothing is already visible (otherwise keeps
    /// content while refreshing), and folds every emission into <see cref="State"/> + <see cref="Charts"/>. A
    /// superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        if (!HasContent)
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _source.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Refresh the current snapshot (web auto-refetch / manual refresh).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

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
    }

    private void Apply(RepositoryResult<IReadOnlyList<CostAnalysisSession>> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent)
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        IReadOnlyList<CostAnalysisSession> sessions,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        // Web parity: the page renders the section stack only when `sessions.length > 0`; a session-less
        // snapshot collapses to the page-level empty state (the web `if (!sessions || length === 0)` gate).
        if (sessions.Count == 0)
        {
            SetEmpty(fetchedAt);
            return;
        }

        SessionCount = sessions.Count;
        Charts = CostAnalysisAggregator.Build(sessions);
        UpdatedAt = fetchedAt ?? _clock();
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? CostAnalysisState.Offline
            : stale ? CostAnalysisState.Stale : CostAnalysisState.Loaded;
    }

    private void SetLoading()
    {
        IsFetching = true;
        IsError = false;
        ErrorMessage = null;
        State = CostAnalysisState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        SessionCount = 0;
        Charts = CostAnalysisCharts.Empty;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = CostAnalysisState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = CostAnalysisState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "costAnalysis.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "costAnalysis.error.offline",
            _ => "error.loadFailed",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view your cost analysis",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached cost analysis",
            _ => "Failed to load data",
        };

        return _localizer.GetString(key, fallback);
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
