using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DriveOverviewChart"/> view — the native port of
/// the web Drive-Overview chart (web/src/features/driving/components/drive-detail/DriveOverviewChart.tsx).
/// The web component is a pure child of the Drive-Detail page; the native surface binds its own
/// cache-then-network <see cref="IDriveOverviewChartSource"/>, projects each snapshot through
/// <see cref="DriveOverviewChartProjection"/> in the user's units, applies the web empty gate (a trace of one
/// sample or fewer renders the friendly "No telemetry data available" placeholder), and exposes the
/// mutually-exclusive <see cref="State"/> plus the header freshness flags so the view is a thin renderer.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class DriveOverviewChartViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDriveOverviewChartSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private IReadOnlyList<DriveOverviewSample> _lastSamples = Array.Empty<DriveOverviewSample>();
    private bool _disposed;

    private UnitPref _units;
    private DriveOverviewChartState _state = DriveOverviewChartState.Loading;
    private DriveOverviewChartDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) unit preference.</summary>
    /// <param name="source">The cache-then-network drive-telemetry source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    public DriveOverviewChartViewModel(
        IDriveOverviewChartSource source,
        ILocalizer localizer,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _display = DriveOverviewChartProjection.Empty(_units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public DriveOverviewChartState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (chart + rich legend).</summary>
    public DriveOverviewChartDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>The user's unit preference; reassigning re-projects the chart + legend in the new units.</summary>
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
            if (HasContent())
            {
                Display = DriveOverviewChartProjection.Project(_lastSamples, _units, _localizer);
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

    /// <summary>True when there is a plottable trace (web <c>chartData.length &gt; 1</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized surface title (web "Drive Overview").</summary>
    public string Title => DriveOverviewChartRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web "No telemetry data available").</summary>
    public string EmptyMessage =>
        _localizer.GetString("driveDetail.noChartData", "No telemetry data available");

    /// <summary>Localized loading announcement for the skeleton live region.</summary>
    public string LoadingLabel => _localizer.GetString("common.loading", "Loading");

    /// <summary>Localized retry-button label.</summary>
    public string RetryLabel => _localizer.GetString("common.retry", "Retry");

    /// <summary>Localized error-surface title.</summary>
    public string ErrorTitle =>
        _localizer.GetString("driveDetail.driveChart.errorTitle", "Couldn't load drive telemetry");

    /// <summary>Localized refresh-button Narrator label.</summary>
    public string RefreshLabel =>
        _localizer.GetString("driveDetail.driveChart.refresh", "Refresh drive overview");

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
        _state is DriveOverviewChartState.Loaded or DriveOverviewChartState.Stale or DriveOverviewChartState.Offline;

    private void Apply(RepositoryResult<IReadOnlyList<DriveOverviewSample>> result)
    {
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
        IReadOnlyList<DriveOverviewSample> samples,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = DriveOverviewChartProjection.Project(samples, _units, _localizer);

        // Web parity: chartData.length > 1 gates the chart; a shorter trace renders the empty placeholder
        // regardless of freshness.
        if (!display.HasData)
        {
            SetEmpty(fetchedAt);
            return;
        }

        _lastSamples = samples;
        Display = display;
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? DriveOverviewChartState.Offline
            : stale ? DriveOverviewChartState.Stale : DriveOverviewChartState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = DriveOverviewChartState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _lastSamples = Array.Empty<DriveOverviewSample>();
        Display = DriveOverviewChartProjection.Empty(_units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = DriveOverviewChartState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = DriveOverviewChartState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "driveDetail.driveChart.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "driveDetail.driveChart.error.offline",
            _ => "driveDetail.driveChart.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view drive telemetry",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached drive telemetry",
            _ => "Couldn't load drive telemetry",
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
