using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets.VehicleSpecs;

/// <summary>
/// The data port the <see cref="VehicleSpecsViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of combined specs / options / config snapshots for the primary (or explicit)
/// vehicle — the native analogue of the web <c>useVehicles</c> + <c>useVehicleSpecs</c> +
/// <c>useVehicleOptions</c> + <c>useVehicleConfigLatest</c> hook composition
/// (web/src/features/dashboard/widgets/VehicleSpecsWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="VehicleSpecsSource"/> (or a test fake) drives this.
/// </summary>
public interface IVehicleSpecsSource
{
    /// <summary>Stream the cache-then-network configuration-reference snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<VehicleSpecsSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Vehicle Specs surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/vehicle.ts (id <c>vehicle-specs</c>). The dashboard grid system
/// binds this surface with the same <see cref="Id"/> and honours the same size constraints. The generated
/// OpenAPI operation ids are centralized here so a single test asserts they resolve against the generated
/// endpoint table (catching contract drift at build/test time rather than at runtime).
/// </summary>
public static class VehicleSpecsRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "vehicle-specs";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "vehicle";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "VehicleSpecsWidget";

    /// <summary>Generated operation id for the vehicle specs read (web <c>useVehicleSpecs</c>).</summary>
    public const string SpecsOperationId = "get_api_v1_vehicles_vehicleID_specs";

    /// <summary>Generated operation id for the vehicle options read (web <c>useVehicleOptions</c>).</summary>
    public const string OptionsOperationId = "get_api_v1_vehicles_vehicleID_options";

    /// <summary>Generated operation id for the latest vehicle config (web <c>useVehicleConfigLatest</c>).</summary>
    public const string ConfigOperationId = "get_api_v1_vehicle_config_latest";

    /// <summary>Path-parameter name in the specs / options endpoint templates.</summary>
    public const string VehiclePathParam = "vehicleID";

    /// <summary>Query-parameter name scoping the latest-config read to the vehicle (snake_case, per the Go API).</summary>
    public const string VehicleQueryParam = "vehicle_id";

    /// <summary>Default footprint: 2 columns × 4 rows (web registry <c>defaultSize</c>).</summary>
    public static VehicleSpecsSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows (web registry <c>minSize</c>).</summary>
    public static VehicleSpecsSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows (web registry <c>maxSize</c>).</summary>
    public static VehicleSpecsSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Vehicle Specs", shared with the widget title key).</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.vehicleSpecs", "Vehicle Specs");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.vehicleSpecs.description",
            "Configuration reference: model, trim, paint, wheels, options");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(VehicleSpecsSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static VehicleSpecsSize Clamp(VehicleSpecsSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Vehicle Specs surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a VIN, option code, paint colour or
/// firmware version — so a diagnostics line can never leak a vehicle's configuration fingerprint. Thread-safe.
/// </summary>
public sealed class VehicleSpecsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public VehicleSpecsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehicleSpecsWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VehicleSpecsRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="VehicleSpecsWidget"/> view — the native port of
/// the web component's four-hook composition
/// (web/src/features/dashboard/widgets/VehicleSpecsWidget.tsx). It consumes the cache-then-network
/// <see cref="IVehicleSpecsSource"/>, projects each snapshot through <see cref="VehicleSpecsProjection"/> for
/// the active footprint, and exposes the mutually-exclusive <see cref="State"/> plus the freshness flags so
/// the view is a thin renderer. A surface with any of specs / options / config renders the detail card (web
/// <c>hasAnyData ? … : empty</c>); a read with none resolves to <see cref="VehicleSpecsState.Empty"/>.
/// Reassigning <see cref="Size"/> re-projects (the compact layout + option cap depend on the footprint). Drive
/// it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class VehicleSpecsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IVehicleSpecsSource _source;
    private readonly ILocalizer _localizer;

    private VehicleSpecsSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<VehicleSpecsSnapshot>? _last;
    private bool _disposed;

    private VehicleSpecsState _state = VehicleSpecsState.Loading;
    private VehicleSpecsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and footprint.</summary>
    /// <param name="source">The cache-then-network configuration-reference source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact layout + option cap).</param>
    public VehicleSpecsViewModel(
        IVehicleSpecsSource source,
        ILocalizer localizer,
        VehicleSpecsSize size)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _display = VehicleSpecsProjection.Project(VehicleSpecsSnapshot.Empty, _size, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public VehicleSpecsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the detail rows + compact readouts + gate).</summary>
    public VehicleSpecsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasAnyData));
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

    /// <summary>True when a configuration reference has resolved (web <c>hasAnyData</c>).</summary>
    public bool HasAnyData => _display.HasAnyData;

    /// <summary>Localized widget title (web <c>widget.vehicleSpecs</c> "Vehicle Specs").</summary>
    public string Title => VehicleSpecsRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.specs.noData</c> "No specs available").</summary>
    public string EmptyMessage => _localizer.GetString("widget.specs.noData", "No specs available");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public VehicleSpecsSize Size
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
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/> +
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

    /// <summary>Retry after a failure (or refresh on demand) — re-runs the load from the top.</summary>
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
        _state is VehicleSpecsState.Loaded
            or VehicleSpecsState.Empty
            or VehicleSpecsState.Stale
            or VehicleSpecsState.Offline;

    private void Apply(RepositoryResult<VehicleSpecsSnapshot> result)
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
        VehicleSpecsSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = VehicleSpecsProjection.Project(snapshot, _size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // Web parity: hasAnyData gates the body (detail card vs the "No specs available" empty state); the
        // offline / stale freshness then drives the header chip when content is present.
        State = !Display.HasAnyData
            ? VehicleSpecsState.Empty
            : offline
                ? VehicleSpecsState.Offline
                : stale
                    ? VehicleSpecsState.Stale
                    : VehicleSpecsState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = VehicleSpecsProjection.Project(VehicleSpecsSnapshot.Empty, _size, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = VehicleSpecsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = VehicleSpecsProjection.Project(VehicleSpecsSnapshot.Empty, _size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = VehicleSpecsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = VehicleSpecsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.specs.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.specs.error.offline",
            _ => "widget.specs.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view vehicle specs",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached specs",
            _ => "Couldn't load vehicle specs",
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
