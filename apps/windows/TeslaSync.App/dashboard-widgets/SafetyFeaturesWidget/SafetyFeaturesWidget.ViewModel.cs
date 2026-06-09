using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets.SafetyFeatures;

/// <summary>
/// The data port the <see cref="SafetyFeaturesViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of ADAS snapshots for the primary (or explicit) vehicle — the native analogue
/// of the web <c>useVehicles</c> + <c>useSafety</c> hook composition
/// (web/src/features/dashboard/widgets/SafetyFeaturesWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="SafetyFeaturesSource"/> (or a test fake) drives this.
/// </summary>
public interface ISafetyFeaturesSource
{
    /// <summary>Stream the cache-then-network ADAS snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<SafetySnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Safety Features surface — the native mirror of the web registry entry
/// in web/src/features/dashboard/widgets/registry/security.ts (<c>safety-features</c>). The dashboard grid
/// system binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class SafetyFeaturesRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "safety-features";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "security";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SafetyFeaturesWidget";

    /// <summary>Default footprint: 2 columns × 4 rows (web registry <c>defaultSize</c>).</summary>
    public static SafetyFeaturesSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows (web registry <c>minSize</c>).</summary>
    public static SafetyFeaturesSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows (web registry <c>maxSize</c>).</summary>
    public static SafetyFeaturesSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Safety Features").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.safety.title", "Safety Features");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.safety.description",
            "ADAS status: autopilot, collision warning, lane departure, blind spot");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(SafetyFeaturesSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static SafetyFeaturesSize Clamp(SafetyFeaturesSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Safety Features surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an ADAS field value, VIN or vehicle id —
/// so a diagnostics line can never leak which driver-assist features a vehicle has enabled. Thread-safe.
/// </summary>
public sealed class SafetyFeaturesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SafetyFeaturesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SafetyFeaturesWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SafetyFeaturesRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SafetyFeaturesWidget"/> view — the native port of
/// the web <c>SafetyFeaturesWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/SafetyFeaturesWidget.tsx). It consumes the cache-then-network
/// <see cref="ISafetyFeaturesSource"/>, projects each snapshot through <see cref="SafetyFeaturesProjection"/>
/// for the active footprint, and exposes the mutually-exclusive <see cref="State"/> plus the freshness flags
/// so the view is a thin renderer. A surface with a resolved safety object always renders the grid/count (web
/// <c>data ? … : empty</c>); the engine collapses a body with no safety object to
/// <see cref="SafetyFeaturesState.Empty"/>. Reassigning <see cref="Size"/> re-projects (the compact / grid
/// layout depends on the footprint). Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class SafetyFeaturesViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISafetyFeaturesSource _source;
    private readonly ILocalizer _localizer;

    private SafetyFeaturesSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<SafetySnapshot>? _last;
    private bool _disposed;

    private SafetyFeaturesState _state = SafetyFeaturesState.Loading;
    private SafetyFeaturesDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and footprint.</summary>
    /// <param name="source">The cache-then-network ADAS source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact / grid layout).</param>
    public SafetyFeaturesViewModel(
        ISafetyFeaturesSource source,
        ILocalizer localizer,
        SafetyFeaturesSize size)
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
    public SafetyFeaturesState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready safety model (null until a snapshot resolves / when empty).</summary>
    public SafetyFeaturesDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasSnapshot));
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

    /// <summary>True when a safety object has resolved and the grid/count are renderable (web <c>data</c> truthy).</summary>
    public bool HasSnapshot => _display is not null;

    /// <summary>Localized widget title (web <c>widget.safety.title</c> "Safety Features").</summary>
    public string Title => _localizer.GetString("widget.safety.title", "Safety Features");

    /// <summary>Localized empty-state message (web <c>widget.safety.noData</c> "No safety data").</summary>
    public string EmptyMessage => _localizer.GetString("widget.safety.noData", "No safety data");

    /// <summary>The widget footprint. Reassigning re-projects (the compact / grid layout depends on the footprint).</summary>
    public SafetyFeaturesSize Size
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
    /// visible (otherwise keeps the grid/count while refreshing), and folds every emission into
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
        _state is SafetyFeaturesState.Loaded or SafetyFeaturesState.Stale or SafetyFeaturesState.Offline;

    private void Apply(RepositoryResult<SafetySnapshot> result)
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
        SafetySnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = SafetyFeaturesProjection.Project(snapshot, _size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? SafetyFeaturesState.Offline
            : stale ? SafetyFeaturesState.Stale : SafetyFeaturesState.Loaded;
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
        State = SafetyFeaturesState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = SafetyFeaturesState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = SafetyFeaturesState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.safety.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.safety.error.offline",
            _ => "widget.safety.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view safety features",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached safety state",
            _ => "Couldn't load safety features",
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
