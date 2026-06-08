using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="DriveScoreViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed fleet-efficiency snapshots for <c>GET /analytics/fleet</c> — the
/// native analogue of the web <c>useFleetAnalytics(7)</c> hook. The view never performs HTTP itself; the
/// concrete <see cref="DriveScoreSource"/> (or a test fake) drives this.
/// </summary>
public interface IDriveScoreSource
{
    /// <summary>Stream the cache-then-network efficiency snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<FleetEfficiency>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Driving Score surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/driving.ts (<c>drive-score</c>). The dashboard
/// grid system binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class DriveScoreRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "drive-score";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "driving";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DriveScoreWidget";

    /// <summary>The trailing window the surface requests, mirroring the web <c>useFleetAnalytics(7)</c>.</summary>
    public const int DefaultDays = 7;

    /// <summary>Default footprint: 1 column × 2 rows.</summary>
    public static DriveScoreSize DefaultSize => new(1, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static DriveScoreSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 2 columns × 40 rows.</summary>
    public static DriveScoreSize MaxSize => new(2, 40);

    /// <summary>Localized display name (web registry "Driving Score").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.driveScore.title", "Driving Score");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.driveScore.description", "Weekly efficiency and driving score");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(DriveScoreSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static DriveScoreSize Clamp(DriveScoreSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Driving Score surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a score, efficiency, VIN or vehicle
/// id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class DriveScoreDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DriveScoreDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DriveScoreWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DriveScoreRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DriveScoreWidget"/> view — the native port of
/// the web <c>DriveScoreWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/DriveScoreWidget.tsx). It consumes the cache-then-network
/// <see cref="IDriveScoreSource"/>, projects each snapshot through <see cref="DriveScoreProjection"/> with
/// the active distance unit, and exposes the mutually-exclusive <see cref="State"/> plus the header
/// freshness flags so the view is a thin renderer. A snapshot with a positive efficiency renders the
/// gauge (web <c>analytics ? gauge : empty</c>); a snapshot with none collapses to
/// <see cref="DriveScoreState.Empty"/>. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class DriveScoreViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDriveScoreSource _source;
    private readonly ILocalizer _localizer;

    private DriveScoreSize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<FleetEfficiency>? _last;
    private bool _disposed;

    private DriveScoreState _state = DriveScoreState.Loading;
    private DriveScoreDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and distance unit.</summary>
    public DriveScoreViewModel(IDriveScoreSource source, ILocalizer localizer, DriveScoreSize size, UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _units = units ?? UnitPref.Metric;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public DriveScoreState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready gauge model (null until a positive-efficiency snapshot resolves).</summary>
    public DriveScoreDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasScore));
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

    /// <summary>True when the last load failed (drives the error surface + freshness chip).</summary>
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

    /// <summary>Localized error message shown in the error surface.</summary>
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

    /// <summary>True when a positive-efficiency snapshot has resolved and the gauge is renderable.</summary>
    public bool HasScore => _display is not null;

    /// <summary>Localized widget title (web registry "Driving Score").</summary>
    public string Title => DriveScoreRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.noScore</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noScore", "No data yet");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public DriveScoreSize Size
    {
        get => _size;
        set
        {
            if (_size == value)
            {
                return;
            }

            _size = value;
            Raise(nameof(Size));
            Reproject();
        }
    }

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
    /// visible (otherwise keeps the gauge while refreshing), and folds every emission into
    /// <see cref="State"/> + <see cref="Display"/>. A superseding load cancels the prior one.
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
        _state is DriveScoreState.Loaded or DriveScoreState.Stale or DriveScoreState.Offline;

    private void Apply(RepositoryResult<FleetEfficiency> result)
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
        FleetEfficiency efficiency,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        if (!efficiency.HasScore)
        {
            // Web parity: with no efficiency there is no score to render -> the "No data yet" surface.
            SetEmpty(fetchedAt);
            return;
        }

        Display = DriveScoreProjection.Project(efficiency, _size, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? DriveScoreState.Offline : stale ? DriveScoreState.Stale : DriveScoreState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = DriveScoreState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = DriveScoreState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = DriveScoreState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.driveScore.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.driveScore.error.offline",
            _ => "widget.driveScore.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view your driving score",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached driving score",
            _ => "Couldn't load driving score",
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
