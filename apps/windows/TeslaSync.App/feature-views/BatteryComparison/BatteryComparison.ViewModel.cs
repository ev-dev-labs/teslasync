using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.BatteryComparison;

/// <summary>
/// UI-thread-free state holder backing the WinUI fleet-battery view — the native port of the web
/// <c>BatteryComparison</c>'s data composition
/// (web/src/features/vehicles/components/BatteryComparison.tsx). It consumes the cache-then-network
/// <see cref="IBatteryComparisonSource"/>, projects each snapshot through
/// <see cref="BatteryComparisonProjection"/> with the active units, and exposes the mutually-exclusive
/// <see cref="State"/> plus the header freshness flags so the view is a thin renderer. The web component
/// returns null when there are no bars; here that resolves to the visible <see cref="BatteryComparisonState.Empty"/>
/// surface instead. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class BatteryComparisonViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IBatteryComparisonSource _source;
    private readonly ILocalizer _localizer;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<BatteryComparisonData>? _last;
    private bool _disposed;

    private BatteryComparisonState _state = BatteryComparisonState.Loading;
    private BatteryComparisonDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and units.</summary>
    public BatteryComparisonViewModel(IBatteryComparisonSource source, ILocalizer localizer, UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _display = BatteryComparisonProjection.Project(BatteryComparisonData.Empty, _units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public BatteryComparisonState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the battery bars).</summary>
    public BatteryComparisonDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
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

    /// <summary>True when the last load failed (drives the error surface + header chip).</summary>
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

    /// <summary>True when the snapshot has at least one battery bar to show.</summary>
    public bool HasData => _display.HasRows;

    /// <summary>Localized surface title used for the control's accessible name.</summary>
    public string Title => _localizer.GetString("vehicles.fleet.batteryStatus", "Fleet Battery Status");

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
        _state is BatteryComparisonState.Loaded
            or BatteryComparisonState.Stale
            or BatteryComparisonState.Offline;

    private void Apply(RepositoryResult<BatteryComparisonData> result)
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
                ApplySnapshot(
                    result.Value ?? BatteryComparisonData.Empty,
                    result.FetchedAt,
                    stale: true,
                    fetching: false,
                    offline: true,
                    error: result.Error);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        BatteryComparisonData data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline = false,
        RepositoryError? error = null)
    {
        Display = BatteryComparisonProjection.Project(data, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? BatteryComparisonState.Offline
            : stale ? BatteryComparisonState.Stale : BatteryComparisonState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = BatteryComparisonProjection.Project(BatteryComparisonData.Empty, _units, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = BatteryComparisonState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = BatteryComparisonProjection.Project(BatteryComparisonData.Empty, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = BatteryComparisonState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = BatteryComparisonState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "vehicles.batteryComparison.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "vehicles.batteryComparison.error.offline",
            _ => "vehicles.batteryComparison.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view fleet battery status",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached battery status",
            _ => "Couldn't load fleet battery status",
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
