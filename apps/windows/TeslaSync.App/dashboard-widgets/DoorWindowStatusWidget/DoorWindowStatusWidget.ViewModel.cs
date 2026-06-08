using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="DoorWindowStatusViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of door/window readings for the primary (or explicit) vehicle — the native
/// analogue of the web <c>useVehicles</c> + <c>useSecurityLatest</c> hook composition
/// (web/src/features/dashboard/widgets/DoorWindowStatusWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="DoorWindowStatusSource"/> (or a test fake) drives this.
/// </summary>
public interface IDoorWindowStatusSource
{
    /// <summary>Stream the cache-then-network door/window readings, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<DoorWindowReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Door &amp; Window Status surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/security.ts (<c>door-window-status</c>). The dashboard
/// grid system binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class DoorWindowStatusRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "door-window-status";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "security";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DoorWindowStatusWidget";

    /// <summary>Default footprint: 2 columns × 2 rows (web registry <c>defaultSize</c>).</summary>
    public static DoorWindowStatusSize DefaultSize => new(2, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows (web registry <c>minSize</c>).</summary>
    public static DoorWindowStatusSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows (web registry <c>maxSize</c>).</summary>
    public static DoorWindowStatusSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Door &amp; Window Status").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.doorWindow.title", "Door & Window Status");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.doorWindow.description",
            "Grid showing 4 doors + 4 windows with open/closed/partial badges");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(DoorWindowStatusSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static DoorWindowStatusSize Clamp(DoorWindowStatusSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Door &amp; Window Status surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a door / window state, VIN or vehicle id —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class DoorWindowStatusDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DoorWindowStatusDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DoorWindowStatusWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DoorWindowStatusRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DoorWindowStatusWidget"/> view — the native port of
/// the web <c>DoorWindowStatusWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/DoorWindowStatusWidget.tsx). It consumes the cache-then-network
/// <see cref="IDoorWindowStatusSource"/>, projects each reading through <see cref="DoorWindowStatusProjection"/>
/// for the active footprint, and exposes the mutually-exclusive <see cref="State"/> plus the freshness flags so
/// the view is a thin renderer. A surface with a resolved security object always renders the grid/badges (web
/// <c>securityData ? … : empty</c>); the engine collapses a body with no security object to
/// <see cref="DoorWindowStatusState.Empty"/>. Reassigning <see cref="Size"/> re-projects (the compact / grid
/// layout depends on the footprint). Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class DoorWindowStatusViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDoorWindowStatusSource _source;
    private readonly ILocalizer _localizer;

    private DoorWindowStatusSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<DoorWindowReading>? _last;
    private bool _disposed;

    private DoorWindowStatusState _state = DoorWindowStatusState.Loading;
    private DoorWindowStatusDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and footprint.</summary>
    /// <param name="source">The cache-then-network door/window source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact / grid layout).</param>
    public DoorWindowStatusViewModel(
        IDoorWindowStatusSource source,
        ILocalizer localizer,
        DoorWindowStatusSize size)
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
    public DoorWindowStatusState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready door/window model (null until a state resolves / when empty).</summary>
    public DoorWindowStatusDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasReading));
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

    /// <summary>True when the shown reading is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the error / offline surface.</summary>
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

    /// <summary>True when a security object has resolved and the grid/badges are renderable (web <c>securityData</c> truthy).</summary>
    public bool HasReading => _display is not null;

    /// <summary>Localized widget title (web <c>widget.doorWindow.title</c> "Door &amp; Window Status").</summary>
    public string Title => _localizer.GetString("widget.doorWindow.title", "Door & Window Status");

    /// <summary>Localized empty-state message (web <c>widget.doorWindow.noData</c> "No door/window data").</summary>
    public string EmptyMessage => _localizer.GetString("widget.doorWindow.noData", "No door/window data");

    /// <summary>The widget footprint. Reassigning re-projects (the compact / grid layout depends on the footprint).</summary>
    public DoorWindowStatusSize Size
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
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps the grid/badges while refreshing), and folds every emission into
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
        _state is DoorWindowStatusState.Loaded or DoorWindowStatusState.Stale or DoorWindowStatusState.Offline;

    private void Apply(RepositoryResult<DoorWindowReading> result)
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
                ApplyReading(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyReading(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyReading(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyReading(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyReading(
        DoorWindowReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = DoorWindowStatusProjection.Project(reading, _size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? DoorWindowStatusState.Offline
            : stale ? DoorWindowStatusState.Stale : DoorWindowStatusState.Loaded;
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
        State = DoorWindowStatusState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = DoorWindowStatusState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = DoorWindowStatusState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.doorWindow.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.doorWindow.error.offline",
            _ => "widget.doorWindow.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view door & window status",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached status",
            _ => "Couldn't load door & window status",
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
