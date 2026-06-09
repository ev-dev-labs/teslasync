using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="OverviewTab"/> view — the native port of the
/// web OverviewTab's data wiring (the <c>useFleetAnalytics</c> query that AnalyticsPage passes in as
/// <c>data</c>, plus <c>useTranslation</c> and <c>useUnits</c>). It consumes the cache-then-network
/// <see cref="IOverviewTabSource"/>, projects each snapshot through <see cref="OverviewTabProjection"/> with
/// the active units, and exposes the mutually-exclusive <see cref="State"/> plus the header freshness flags
/// so the view is a thin renderer. Unlike a metric widget, the content states keep the four panels visible
/// even when an individual series is empty (the web shows per-section <c>EmptyState</c>s), so only a
/// non-object analytics body collapses to the surface-level empty state. Drive it from one confinement (the
/// UI thread); it is not internally synchronised.
/// </summary>
public sealed class OverviewTabViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IOverviewTabSource _source;
    private readonly ILocalizer _localizer;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<OverviewData>? _last;
    private bool _disposed;

    private OverviewTabState _state = OverviewTabState.Loading;
    private OverviewTabDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and units.</summary>
    public OverviewTabViewModel(IOverviewTabSource source, ILocalizer localizer, UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _display = OverviewTabProjection.Project(OverviewData.Empty, _units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public OverviewTabState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the three charts + the quick links).</summary>
    public OverviewTabDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the error surface + chip).</summary>
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

    /// <summary>Localized error message shown in the error / offline surfaces.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when the current snapshot carries at least one non-empty series.</summary>
    public bool HasData => _last?.Value?.HasAny ?? false;

    /// <summary>Localized surface-level empty message (no analytics object at all).</summary>
    public string EmptyMessage => _localizer.GetString("analytics.overview.noData", "No analytics data available");

    /// <summary>Localized stale-chip label.</summary>
    public string StaleLabel => _localizer.GetString("analytics.overview.stale", "Showing cached data");

    /// <summary>Localized offline-chip label.</summary>
    public string OfflineLabel => _localizer.GetString("analytics.overview.offline", "Offline — showing cached data");

    /// <summary>Localized retry affordance label.</summary>
    public string RetryLabel => _localizer.GetString("analytics.overview.retry", "Retry");

    /// <summary>The user's unit preference; reassigning re-projects the current snapshot in the new units.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_units == value)
            {
                return;
            }

            _units = value;
            Raise(nameof(Units));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasContent())
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

    /// <summary>Retry after a failure — re-runs the load from the top.</summary>
    public Task RetryAsync() => LoadAsync();

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

    private bool HasContent() =>
        _state is OverviewTabState.Loaded or OverviewTabState.Stale or OverviewTabState.Offline;

    private void Apply(RepositoryResult<OverviewData> result)
    {
        _last = result;
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent())
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false);
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
        OverviewData data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error = null,
        bool offline = false)
    {
        // Content always renders when an analytics object exists; empty series surface per-section empties.
        Display = OverviewTabProjection.Project(data, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? OverviewTabState.Offline : stale ? OverviewTabState.Stale : OverviewTabState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last && last.Value is not null)
        {
            Apply(last);
        }
        else
        {
            Display = OverviewTabProjection.Project(OverviewData.Empty, _units, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = OverviewTabState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = OverviewTabProjection.Project(OverviewData.Empty, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = OverviewTabState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = OverviewTabState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "analytics.overview.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "analytics.overview.error.offline",
            _ => "analytics.overview.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view analytics",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached analytics",
            _ => "Couldn't load analytics",
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
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
