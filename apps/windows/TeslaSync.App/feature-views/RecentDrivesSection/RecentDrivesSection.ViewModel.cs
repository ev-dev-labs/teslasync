using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RecentDrivesSection"/> view — the native port of
/// the web Recent-Drives section
/// (web/src/features/vehicles/components/vehicle-detail/RecentDrivesSection.tsx). The web component is a pure
/// child of the Vehicle-Detail page that receives an already-resolved <c>drives</c> array; the native surface
/// binds its own cache-then-network <see cref="IRecentDrivesSectionSource"/> and projects each snapshot
/// through <see cref="RecentDrivesSectionProjection"/> in the user's units, exposing the mutually-exclusive
/// <see cref="State"/> plus the header freshness flags so the view is a thin renderer. It owns the Distance
/// sort and the current page (the web <c>DataTable</c> sortable column + pagination); toggling either, or
/// changing <see cref="Units"/>, re-projects the cached drives without a re-fetch. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class RecentDrivesSectionViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IRecentDrivesSectionSource _source;
    private readonly ILocalizer _localizer;
    private readonly TableSortState _sort = new();

    private CancellationTokenSource? _cts;
    private IReadOnlyList<RecentDriveSample> _samples = Array.Empty<RecentDriveSample>();
    private bool _hasContent;
    private DateTimeOffset? _contentFetchedAt;
    private bool _contentStale;
    private bool _contentOffline;
    private RepositoryError? _contentError;
    private bool _disposed;

    private UnitPref _units;
    private int _page = 1;
    private int _pageSize = RecentDrivesSectionProjection.DefaultPageSize;
    private RecentDrivesSectionState _state = RecentDrivesSectionState.Loading;
    private RecentDrivesSectionDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) units.</summary>
    /// <param name="source">The cache-then-network drive-list source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    public RecentDrivesSectionViewModel(
        IRecentDrivesSectionSource source,
        ILocalizer localizer,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _display = RecentDrivesSectionProjection.Empty(_units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public RecentDrivesSectionState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the chrome + the current page of drive rows).</summary>
    public RecentDrivesSectionDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
            Raise(nameof(DriveCount));
        }
    }

    /// <summary>The user's unit preference; reassigning re-projects the Distance column in the new units.</summary>
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
            if (_hasContent)
            {
                RecomputeContent();
            }
            else
            {
                Display = RecentDrivesSectionProjection.Empty(_units, _localizer);
            }
        }
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

    /// <summary>True when the last load failed with no cache (drives the error surface + header chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error / offline message shown in the error surface or offline chip.</summary>
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

    /// <summary>True when the drive list carries at least one drive (web non-empty <c>drives</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>The number of drives in the resolved list (web <c>drives.length</c>).</summary>
    public int DriveCount => _display.DriveCount;

    /// <summary>Localized surface title (web "Recent Drives").</summary>
    public string Title => RecentDrivesSectionRegistration.Name(_localizer);

    /// <summary>Localized "View all" affordance label (web <c>common.viewAll</c>).</summary>
    public string ViewAllLabel => _localizer.GetString("common.viewAll", "View all");

    /// <summary>Localized empty-state message (web <c>common.noDrives</c>).</summary>
    public string EmptyMessage => _localizer.GetString("common.noDrives", "No drives recorded yet");

    /// <summary>Localized loading announcement for the skeleton live region.</summary>
    public string LoadingLabel => _localizer.GetString("common.loading", "Loading");

    /// <summary>Localized retry-button label.</summary>
    public string RetryLabel => _localizer.GetString("common.retry", "Retry");

    /// <summary>Localized error-surface title.</summary>
    public string ErrorTitle =>
        _localizer.GetString("vehicles.recentDrives.errorTitle", "Couldn't load recent drives");

    /// <summary>Localized refresh-button Narrator label.</summary>
    public string RefreshLabel =>
        _localizer.GetString("vehicles.recentDrives.refresh", "Refresh recent drives");

    /// <summary>Localized stale freshness-chip label.</summary>
    public string StaleChip => _localizer.GetString("common.stale", "Stale");

    /// <summary>Localized offline freshness-chip label.</summary>
    public string OfflineChip => _localizer.GetString("common.offline", "Offline");

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
        if (!_hasContent)
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

    /// <summary>
    /// Toggle the Distance-column sort (web <c>DataTable</c> sortable header): none → ascending → descending →
    /// none. Resets to the first page and re-projects the cached drives without a re-fetch.
    /// </summary>
    public void ToggleDistanceSort()
    {
        _sort.Toggle(RecentDrivesSectionProjection.DistanceColumnKey);
        _page = 1;
        if (_hasContent)
        {
            RecomputeContent();
        }
        else
        {
            Display = RecentDrivesSectionProjection.Empty(_units, _localizer);
        }
    }

    /// <summary>Navigate to the 1-based <paramref name="page"/> (web pagination); the projection clamps it.</summary>
    public void GoToPage(int page)
    {
        if (_page == page)
        {
            return;
        }

        _page = page;
        if (_hasContent)
        {
            RecomputeContent();
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

    private void Apply(RepositoryResult<IReadOnlyList<RecentDriveSample>> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!_hasContent)
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplyContent(result.Value!, result.FetchedAt, result.IsStale, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyContent(result.Value!, result.FetchedAt, result.IsStale, fetching: true, offline: false, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyContent(result.Value!, result.FetchedAt, stale: false, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyContent(result.Value!, result.FetchedAt, stale: true, fetching: false, offline: true, error: result.Error);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyContent(
        IReadOnlyList<RecentDriveSample> samples,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline,
        RepositoryError? error)
    {
        _samples = samples;
        _hasContent = true;
        _contentFetchedAt = fetchedAt;
        _contentStale = stale;
        _contentOffline = offline;
        _contentError = error;
        IsFetching = fetching;
        RecomputeContent();
    }

    private void RecomputeContent()
    {
        var display = RecentDrivesSectionProjection.Project(_samples, _units, _localizer, _sort, _page, _pageSize);
        _page = display.Page; // adopt the clamped page
        Display = display;
        UpdatedAt = _contentFetchedAt;

        // Web parity: an empty drive list renders the friendly empty surface regardless of freshness.
        if (!display.HasData)
        {
            IsStale = false;
            IsError = false;
            ErrorMessage = null;
            State = RecentDrivesSectionState.Empty;
            return;
        }

        IsStale = _contentStale || _contentOffline;
        IsError = false;
        ErrorMessage = _contentOffline ? ErrorTextFor(_contentError) : null;
        State = _contentOffline
            ? RecentDrivesSectionState.Offline
            : _contentStale ? RecentDrivesSectionState.Stale : RecentDrivesSectionState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = RecentDrivesSectionState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _samples = Array.Empty<RecentDriveSample>();
        _hasContent = false;
        _contentFetchedAt = fetchedAt;
        _contentStale = false;
        _contentOffline = false;
        _contentError = null;
        Display = RecentDrivesSectionProjection.Empty(_units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = RecentDrivesSectionState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = RecentDrivesSectionState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "vehicles.recentDrives.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "vehicles.recentDrives.error.offline",
            _ => "vehicles.recentDrives.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view recent drives",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached drives",
            _ => "Couldn't load recent drives",
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
