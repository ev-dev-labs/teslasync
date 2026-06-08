using System.ComponentModel;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="ChargingScheduleViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of combined schedule snapshots for the primary (or explicit) vehicle — the native
/// analogue of the web <c>useVehicles</c> + <c>useVehicleState</c> + live <c>/signals/{id}/live</c> query
/// composition (web/src/features/dashboard/widgets/ChargingScheduleWidget.tsx). The view never performs HTTP
/// itself; the concrete <see cref="ChargingScheduleSource"/> (or a test fake) drives this.
/// </summary>
public interface IChargingScheduleSource
{
    /// <summary>Stream the cache-then-network schedule snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<ChargingScheduleSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Charging Schedule surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/charging.ts (<c>charging-schedule</c>). The dashboard grid system
/// binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class ChargingScheduleRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "charging-schedule";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChargingScheduleWidget";

    /// <summary>Default footprint: 2 columns × 2 rows.</summary>
    public static ChargingScheduleSize DefaultSize => new(2, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static ChargingScheduleSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static ChargingScheduleSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Charging Schedule").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.chargingSchedule.name", "Charging Schedule");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.chargingSchedule.description",
            "Shows scheduled charge time, departure time, charge limit");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(ChargingScheduleSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static ChargingScheduleSize Clamp(ChargingScheduleSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Charging Schedule surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a scheduled time, charge limit, battery
/// percent, VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class ChargingScheduleDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChargingScheduleDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargingScheduleWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargingScheduleRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ChargingScheduleWidget"/> view — the native port of
/// the web <c>ChargingScheduleWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/ChargingScheduleWidget.tsx). It consumes the cache-then-network
/// <see cref="IChargingScheduleSource"/>, projects each snapshot through <see cref="ChargingScheduleProjection"/>
/// with the active footprint, and exposes the mutually-exclusive <see cref="State"/> plus the freshness flags so
/// the view is a thin renderer. A surface whose live signals carry schedule data always renders the schedule view
/// (web <c>hasScheduleData ? … : empty</c>); the engine collapses a schedule-less response to
/// <see cref="ChargingScheduleState.Empty"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class ChargingScheduleViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IChargingScheduleSource _source;
    private readonly ILocalizer _localizer;

    private ChargingScheduleSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<ChargingScheduleSnapshot>? _last;
    private bool _disposed;

    private ChargingScheduleState _state = ChargingScheduleState.Loading;
    private ChargingScheduleDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and footprint.</summary>
    /// <param name="source">The cache-then-network schedule source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (drives the compact / tall branches).</param>
    public ChargingScheduleViewModel(
        IChargingScheduleSource source,
        ILocalizer localizer,
        ChargingScheduleSize size)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public ChargingScheduleState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready schedule model (null until a schedule resolves).</summary>
    public ChargingScheduleDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasSchedule));
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

    /// <summary>True when schedule data has resolved and the schedule view is renderable (web <c>hasScheduleData</c>).</summary>
    public bool HasSchedule => _display is not null;

    /// <summary>Localized widget title (web <c>widget.chargingSchedule.title</c> "Charging Schedule").</summary>
    public string Title => _localizer.GetString("widget.chargingSchedule.title", "Charging Schedule");

    /// <summary>Localized empty-state message (web <c>widget.chargingSchedule.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.chargingSchedule.noData", "No schedule data");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public ChargingScheduleSize Size
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

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already visible
    /// (otherwise keeps the schedule view while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. A superseding load cancels the prior one.
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
        _state is ChargingScheduleState.Loaded or ChargingScheduleState.Stale or ChargingScheduleState.Offline;

    private void Apply(RepositoryResult<ChargingScheduleSnapshot> result)
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
        ChargingScheduleSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = ChargingScheduleProjection.Project(snapshot, _size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? ChargingScheduleState.Offline
            : stale ? ChargingScheduleState.Stale : ChargingScheduleState.Loaded;
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
        State = ChargingScheduleState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = ChargingScheduleState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = ChargingScheduleState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.chargingSchedule.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.chargingSchedule.error.offline",
            _ => "widget.chargingSchedule.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view the charging schedule",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached charging schedule",
            _ => "Couldn't load the charging schedule",
        };

        return _localizer.GetString(key, fallback);
    }

    private void Set<T>(ref T field, T value, [System.Runtime.CompilerServices.CallerMemberName] string? name = null)
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
