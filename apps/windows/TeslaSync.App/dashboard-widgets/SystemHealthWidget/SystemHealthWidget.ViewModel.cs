using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="SystemHealthViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of merged system-health readings — the native analogue of the web
/// <c>useSystemHealth</c> + <c>useDBStats</c> + <c>useConnectionPool</c> hook composition
/// (web/src/features/dashboard/widgets/SystemHealthWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="SystemHealthSource"/> (or a test fake) drives this.
/// </summary>
public interface ISystemHealthSource
{
    /// <summary>Stream the cache-then-network merged system-health readings, newest first.</summary>
    IAsyncEnumerable<RepositoryResult<SystemHealthReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the System Health surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/system.ts (<c>system-health</c>). The dashboard grid system
/// binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class SystemHealthRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "system-health";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "system";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SystemHealthWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static SystemHealthSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static SystemHealthSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static SystemHealthSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "System Health").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.systemHealth.title", "System Health");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.systemHealth.description",
            "Server health: DB, MQTT, Tesla API status, memory, connections");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(SystemHealthSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static SystemHealthSize Clamp(SystemHealthSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the System Health surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a status, size, or count — so a
/// diagnostics line can never leak operational data. Thread-safe.
/// </summary>
public sealed class SystemHealthDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SystemHealthDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SystemHealthWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SystemHealthRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SystemHealthWidget"/> view — the native port of the
/// web <c>SystemHealthWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/SystemHealthWidget.tsx). It consumes the cache-then-network
/// <see cref="ISystemHealthSource"/> (a combine of the health / db-stats / pool reads), projects each merged
/// reading through <see cref="SystemHealthProjection"/> for the active footprint, and exposes the
/// mutually-exclusive <see cref="State"/> plus the health-driven freshness flags so the view is a thin
/// renderer. A reading whose health slice is present renders the body (web <c>hasData</c>); the source collapses
/// a reading with no health to <see cref="SystemHealthState.Empty"/> and a health hard-failure to
/// <see cref="SystemHealthState.Error"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class SystemHealthViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISystemHealthSource _source;
    private readonly ILocalizer _localizer;

    private SystemHealthSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<SystemHealthReading>? _last;
    private bool _disposed;

    private SystemHealthState _state = SystemHealthState.Loading;
    private SystemHealthDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and footprint.</summary>
    /// <param name="source">The cache-then-network merged system-health source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact / standard layout).</param>
    public SystemHealthViewModel(ISystemHealthSource source, ILocalizer localizer, SystemHealthSize size)
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
    public SystemHealthState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready body model (null until a reading resolves, or on the empty surface).</summary>
    public SystemHealthDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip (web <c>health.dataUpdatedAt</c>).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a health refresh is in flight (web <c>health.isFetching</c>; freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the health read failed (web <c>health.isError</c>; drives the error chip / surface).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown body is backed by a health read older than the freshness window (web <c>health.isStale</c>).</summary>
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

    /// <summary>True when the health read resolved and the body is renderable (web <c>hasData</c>).</summary>
    public bool HasData => _display is { HasData: true };

    /// <summary>Localized widget title (web <c>widget.systemHealth.title</c> "System Health").</summary>
    public string Title => _localizer.GetString("widget.systemHealth.title", "System Health");

    /// <summary>Localized empty-state message (web <c>widget.systemHealth.noData</c> "No system health data").</summary>
    public string EmptyMessage => _localizer.GetString("widget.systemHealth.noData", "No system health data");

    /// <summary>The widget footprint. Reassigning re-projects so the compact / standard layout follows the new size.</summary>
    public SystemHealthSize Size
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
    /// visible (otherwise keeps the body while refreshing), and folds every emission into <see cref="State"/> +
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
        _state is SystemHealthState.Loaded or SystemHealthState.Stale or SystemHealthState.Offline;

    private void Apply(RepositoryResult<SystemHealthReading> result)
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
        SystemHealthReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = SystemHealthProjection.Project(reading, _size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? SystemHealthState.Offline
            : stale ? SystemHealthState.Stale : SystemHealthState.Loaded;
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
        State = SystemHealthState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = SystemHealthState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Display = null;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = SystemHealthState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.systemHealth.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.systemHealth.error.offline",
            _ => "widget.systemHealth.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view system health",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached system health",
            _ => "Couldn't load system health",
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
