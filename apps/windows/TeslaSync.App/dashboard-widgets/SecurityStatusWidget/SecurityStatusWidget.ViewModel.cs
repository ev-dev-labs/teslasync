using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="SecurityStatusViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of security readings for the primary (or explicit) vehicle — the native analogue
/// of the web <c>useVehicles</c> + <c>useSecurityLatest</c> hook composition
/// (web/src/features/dashboard/widgets/SecurityStatusWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="SecurityStatusSource"/> (or a test fake) drives this.
/// </summary>
public interface ISecurityStatusSource
{
    /// <summary>Stream the cache-then-network security readings, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<SecurityStatusReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Security surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/security.ts (<c>security-status</c>). The dashboard grid system
/// binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class SecurityStatusRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "security-status";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "security";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SecurityStatusWidget";

    /// <summary>Default footprint: 1 column × 2 rows (web registry <c>defaultSize</c>).</summary>
    public static SecurityStatusSize DefaultSize => new(1, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows (web registry <c>minSize</c>).</summary>
    public static SecurityStatusSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 2 columns × 40 rows (web registry <c>maxSize</c>).</summary>
    public static SecurityStatusSize MaxSize => new(2, 40);

    /// <summary>Localized display name (web registry "Security").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.security", "Security");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.securityStatus.description",
            "Lock, sentry, doors, windows status");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(SecurityStatusSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static SecurityStatusSize Clamp(SecurityStatusSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Security surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a lock / sentry / door / window state, VIN or vehicle
/// id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class SecurityStatusDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SecurityStatusDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SecurityStatusWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SecurityStatusRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SecurityStatusWidget"/> view — the native port of
/// the web <c>SecurityStatusWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/SecurityStatusWidget.tsx). It consumes the cache-then-network
/// <see cref="ISecurityStatusSource"/>, projects each reading through <see cref="SecurityStatusProjection"/>,
/// and exposes the mutually-exclusive <see cref="State"/> plus the freshness flags so the view is a thin
/// renderer. A surface with a resolved security object always renders the four cells (web
/// <c>securityData ? … : empty</c>); the engine collapses a body with no security object to
/// <see cref="SecurityStatusState.Empty"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class SecurityStatusViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISecurityStatusSource _source;
    private readonly ILocalizer _localizer;

    private SecurityStatusSize _size;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    private SecurityStatusState _state = SecurityStatusState.Loading;
    private SecurityStatusDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and footprint.</summary>
    /// <param name="source">The cache-then-network security source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry metadata; the web renders identically at every size).</param>
    public SecurityStatusViewModel(
        ISecurityStatusSource source,
        ILocalizer localizer,
        SecurityStatusSize size)
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
    public SecurityStatusState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready cells model (null until a state resolves / when empty).</summary>
    public SecurityStatusDisplay? Display
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

    /// <summary>True when a security object has resolved and the cells are renderable (web <c>securityData</c> truthy).</summary>
    public bool HasReading => _display is not null;

    /// <summary>Localized widget title (web <c>widget.security</c> "Security").</summary>
    public string Title => _localizer.GetString("widget.security", "Security");

    /// <summary>Localized empty-state message (web <c>widget.noSecurity</c> "No security data").</summary>
    public string EmptyMessage => _localizer.GetString("widget.noSecurity", "No security data");

    /// <summary>The widget footprint. The web renders identically at every size, so reassigning never re-projects.</summary>
    public SecurityStatusSize Size
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
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps the cells while refreshing), and folds every emission into <see cref="State"/>
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
        _state is SecurityStatusState.Loaded or SecurityStatusState.Stale or SecurityStatusState.Offline;

    private void Apply(RepositoryResult<SecurityStatusReading> result)
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
        SecurityStatusReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = SecurityStatusProjection.Project(reading, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? SecurityStatusState.Offline
            : stale ? SecurityStatusState.Stale : SecurityStatusState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = SecurityStatusState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = SecurityStatusState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = SecurityStatusState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.securityStatus.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.securityStatus.error.offline",
            _ => "widget.securityStatus.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view security status",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached security status",
            _ => "Couldn't load security status",
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
