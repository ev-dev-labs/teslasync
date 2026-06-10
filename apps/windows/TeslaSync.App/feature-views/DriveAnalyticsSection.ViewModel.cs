using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DriveAnalyticsSection"/> view — the native port
/// of the web Drive-Analytics section
/// (web/src/features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx). The web component is a
/// pure child of the Driving-Dynamics page; the native surface binds its own cache-then-network
/// <see cref="IDriveAnalyticsSectionSource"/>, owns the date <see cref="Range"/> (web page-level
/// <c>startDate</c> / <c>endDate</c>) and projects each snapshot through
/// <see cref="DriveAnalyticsSectionProjection"/> in the user's units, exposing the mutually-exclusive
/// <see cref="State"/> plus the header freshness flags so the view is a thin renderer. Changing the
/// <see cref="Range"/> or <see cref="Units"/> re-projects the cached drives without a re-fetch (web's
/// client-side date filter). Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class DriveAnalyticsSectionViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDriveAnalyticsSectionSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private IReadOnlyList<DriveAnalyticsSample> _samples = Array.Empty<DriveAnalyticsSample>();
    private bool _hasContent;
    private DateTimeOffset? _contentFetchedAt;
    private bool _contentStale;
    private bool _contentOffline;
    private RepositoryError? _contentError;
    private bool _disposed;

    private UnitPref _units;
    private DateRange _range;
    private DriveAnalyticsSectionState _state = DriveAnalyticsSectionState.Loading;
    private DriveAnalyticsSectionDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, (optional) units and initial range.</summary>
    /// <param name="source">The cache-then-network drive-list source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    /// <param name="range">The initial date range; defaults to the last 30 days (web page default).</param>
    public DriveAnalyticsSectionViewModel(
        IDriveAnalyticsSectionSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        DateRange? range = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _range = range ?? DefaultRange();
        _display = DriveAnalyticsSectionProjection.Empty(_range, _units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public DriveAnalyticsSectionState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the three charts + chrome).</summary>
    public DriveAnalyticsSectionDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>The user's unit preference; reassigning re-projects the charts in the new units.</summary>
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
                Display = DriveAnalyticsSectionProjection.Empty(_range, _units, _localizer);
            }
        }
    }

    /// <summary>The selected inclusive date range (web <c>startDate</c> / <c>endDate</c>); reassigning re-filters.</summary>
    public DateRange Range
    {
        get => _range;
        set
        {
            var normalized = value.Normalized();
            if (_range == normalized)
            {
                return;
            }

            _range = normalized;
            Raise(nameof(Range));
            if (_hasContent)
            {
                RecomputeContent();
            }
            else
            {
                Display = DriveAnalyticsSectionProjection.Empty(_range, _units, _localizer);
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

    /// <summary>True when at least one chart carries data (web non-empty <c>filteredDrives</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>The number of drives in the selected range (web <c>filteredDrives.length</c>).</summary>
    public int DriveCount => _display.DriveCount;

    /// <summary>Localized surface title (web "Drive Analytics").</summary>
    public string Title => DriveAnalyticsSectionRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (no drives in range).</summary>
    public string EmptyMessage => _localizer.GetString("dynamics.noData", "No drives in the selected range");

    /// <summary>Localized loading announcement for the skeleton live region.</summary>
    public string LoadingLabel => _localizer.GetString("common.loading", "Loading");

    /// <summary>Localized retry-button label.</summary>
    public string RetryLabel => _localizer.GetString("common.retry", "Retry");

    /// <summary>Localized error-surface title.</summary>
    public string ErrorTitle =>
        _localizer.GetString("dynamics.driveAnalytics.errorTitle", "Couldn't load drive analytics");

    /// <summary>Localized refresh-button Narrator label.</summary>
    public string RefreshLabel =>
        _localizer.GetString("dynamics.driveAnalytics.refresh", "Refresh drive analytics");

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

    private static DateRange DefaultRange()
    {
        var today = DateOnly.FromDateTime(DateTime.Today);
        return new DateRange(today.AddDays(-30), today);
    }

    private void Apply(RepositoryResult<IReadOnlyList<DriveAnalyticsSample>> result)
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
        IReadOnlyList<DriveAnalyticsSample> samples,
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
        var display = DriveAnalyticsSectionProjection.Project(_samples, _range, _units, _localizer);
        Display = display;
        UpdatedAt = _contentFetchedAt;

        // Web parity: a range that filters out every drive renders the friendly empty surfaces regardless of
        // freshness (no rows). Otherwise the freshness drives the stale / offline chip.
        if (!display.HasData)
        {
            IsStale = false;
            IsError = false;
            ErrorMessage = null;
            State = DriveAnalyticsSectionState.Empty;
            return;
        }

        IsStale = _contentStale || _contentOffline;
        IsError = false;
        ErrorMessage = _contentOffline ? ErrorTextFor(_contentError) : null;
        State = _contentOffline
            ? DriveAnalyticsSectionState.Offline
            : _contentStale ? DriveAnalyticsSectionState.Stale : DriveAnalyticsSectionState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = DriveAnalyticsSectionState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _samples = Array.Empty<DriveAnalyticsSample>();
        _hasContent = false;
        _contentFetchedAt = fetchedAt;
        _contentStale = false;
        _contentOffline = false;
        _contentError = null;
        Display = DriveAnalyticsSectionProjection.Empty(_range, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = DriveAnalyticsSectionState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = DriveAnalyticsSectionState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "dynamics.driveAnalytics.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "dynamics.driveAnalytics.error.offline",
            _ => "dynamics.driveAnalytics.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view drive analytics",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached drives",
            _ => "Couldn't load drive analytics",
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
