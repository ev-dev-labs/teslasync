using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="DigitalTwinViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of merged twin readings for the primary (or explicit) vehicle — the native
/// analogue of the web <c>useVehicles</c> + <c>useVehicleState</c> + <c>useSecurityLatest</c> +
/// <c>useChargingTelemetryLatest</c> hook composition
/// (web/src/features/dashboard/widgets/DigitalTwinWidget.tsx). The view never performs HTTP itself; the concrete
/// <see cref="DigitalTwinSource"/> (or a test fake) drives this.
/// </summary>
public interface IDigitalTwinSource
{
    /// <summary>Stream the cache-then-network merged twin readings, newest first.</summary>
    IAsyncEnumerable<RepositoryResult<DigitalTwinReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Digital Twin surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/vehicle.ts (<c>vehicle-twin</c>). The dashboard grid system binds
/// this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class DigitalTwinRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "vehicle-twin";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "vehicle";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DigitalTwinWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static DigitalTwinSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 2 columns × 4 rows.</summary>
    public static DigitalTwinSize MinSize => new(2, 4);

    /// <summary>Maximum footprint: 3 columns × 40 rows.</summary>
    public static DigitalTwinSize MaxSize => new(3, 40);

    /// <summary>Localized display name (web registry "Digital Twin").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.digitalTwin", "Digital Twin");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.digitalTwin.description",
            "Visual car state: doors, windows, lights");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(DigitalTwinSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static DigitalTwinSize Clamp(DigitalTwinSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Digital Twin surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a door / window / lock / charge state, VIN or vehicle
/// id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class DigitalTwinDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DigitalTwinDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DigitalTwinWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DigitalTwinRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DigitalTwinWidget"/> view — the native port of the
/// web <c>DigitalTwinWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/DigitalTwinWidget.tsx). It consumes the cache-then-network
/// <see cref="IDigitalTwinSource"/>, projects each merged reading through <see cref="DigitalTwinProjection"/> at
/// the active footprint, and exposes the mutually-exclusive <see cref="State"/> plus the freshness flags so the
/// view is a thin renderer. A resolved reading always renders the twin (web parity: the twin shows whenever a
/// vehicle exists); the source collapses a missing vehicle to <see cref="DigitalTwinState.Empty"/> and a total
/// read failure to <see cref="DigitalTwinState.Error"/>. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class DigitalTwinViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDigitalTwinSource _source;
    private readonly ILocalizer _localizer;

    private DigitalTwinSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<DigitalTwinReading>? _last;
    private bool _disposed;

    private DigitalTwinState _state = DigitalTwinState.Loading;
    private DigitalTwinDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and footprint.</summary>
    /// <param name="source">The cache-then-network twin source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry metadata; only the twin glyph size depends on it).</param>
    public DigitalTwinViewModel(IDigitalTwinSource source, ILocalizer localizer, DigitalTwinSize size)
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
    public DigitalTwinState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready twin model (null until a reading resolves, or on the empty surface).</summary>
    public DigitalTwinDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasTwin));
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

    /// <summary>True when the primary read failed (drives the error chip + freshness colour).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown twin is older than the freshness window.</summary>
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

    /// <summary>True when a twin reading has resolved and the twin is renderable (web <c>vehicle</c> truthy).</summary>
    public bool HasTwin => _display is not null;

    /// <summary>Localized widget title (web registry "Digital Twin").</summary>
    public string Title => _localizer.GetString("widget.digitalTwin", "Digital Twin");

    /// <summary>Localized empty-state message (web <c>widget.noVehicle</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noVehicle", "No vehicle data");

    /// <summary>Localized "Open" action label (web <c>widget.open</c>).</summary>
    public string OpenLabel => _localizer.GetString("widget.open", "Open");

    /// <summary>The widget footprint; reassigning re-projects the twin glyph size.</summary>
    public DigitalTwinSize Size
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
    /// (otherwise keeps the twin while refreshing), and folds every emission into <see cref="State"/> +
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
        _state is DigitalTwinState.Loaded or DigitalTwinState.Stale or DigitalTwinState.Offline;

    private void Apply(RepositoryResult<DigitalTwinReading> result)
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
        DigitalTwinReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = DigitalTwinProjection.Project(reading, _size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? DigitalTwinState.Offline
            : stale ? DigitalTwinState.Stale : DigitalTwinState.Loaded;
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
        State = DigitalTwinState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = DigitalTwinState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = DigitalTwinState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.digitalTwin.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.digitalTwin.error.offline",
            _ => "widget.digitalTwin.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view vehicle state",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last known vehicle state",
            _ => "Couldn't load vehicle state",
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
