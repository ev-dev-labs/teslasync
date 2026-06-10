using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="RangeEstimateViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed vehicle range readings for <c>GET /vehicles/{vehicleID}/state</c> —
/// the native analogue of the web <c>useVehicles</c> + <c>useVehicleState</c> hook composition (vehicle
/// resolution included). The view never performs HTTP itself; the concrete <see cref="RangeEstimateSource"/>
/// (or a test fake) drives this.
/// </summary>
public interface IRangeEstimateSource
{
    /// <summary>Stream the cache-then-network vehicle-range snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<RangeEstimateReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Range Estimate surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/battery.ts (<c>range-estimate</c>). The dashboard grid system
/// binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class RangeEstimateRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "range-estimate";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "battery";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "RangeEstimateWidget";

    /// <summary>Default footprint: 1 column × 2 rows (web registry <c>defaultSize</c>).</summary>
    public static RangeEstimateSize DefaultSize => new(1, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows (web registry <c>minSize</c>).</summary>
    public static RangeEstimateSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 2 columns × 40 rows (web registry <c>maxSize</c>).</summary>
    public static RangeEstimateSize MaxSize => new(2, 40);

    /// <summary>Localized registry display name (web registry "Range Estimate").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.rangeEstimate.name", "Range Estimate");
    }

    /// <summary>Localized registry description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.rangeEstimate.description", "Rated, ideal, and estimated range");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(RangeEstimateSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static RangeEstimateSize Clamp(RangeEstimateSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Range Estimate surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a range figure, VIN or vehicle id — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class RangeEstimateDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public RangeEstimateDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RangeEstimateWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RangeEstimateRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RangeEstimateWidget"/> view — the native port of
/// the web <c>RangeEstimateWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/RangeEstimateWidget.tsx). It consumes the cache-then-network
/// <see cref="IRangeEstimateSource"/>, projects each reading through <see cref="RangeEstimateProjection"/> with
/// the active units, and exposes the mutually-exclusive <see cref="State"/> plus the header freshness flags so
/// the view is a thin renderer. A surface with a resolved state always renders the readouts (web
/// <c>state ? readouts : empty</c>, even for a zero-range state); the engine collapses a stateless response to
/// <see cref="RangeEstimateState.Empty"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class RangeEstimateViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IRangeEstimateSource _source;
    private readonly ILocalizer _localizer;

    private RangeEstimateSize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<RangeEstimateReading>? _last;
    private bool _disposed;

    private RangeEstimateState _state = RangeEstimateState.Loading;
    private RangeEstimateDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and units.</summary>
    /// <param name="source">The cache-then-network range source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry-bound; the composition is layout-invariant).</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    public RangeEstimateViewModel(IRangeEstimateSource source, ILocalizer localizer, RangeEstimateSize size, UnitPref? units = null)
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
    public RangeEstimateState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready range model (null until a state resolves).</summary>
    public RangeEstimateDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasState));
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

    /// <summary>True when a vehicle state has resolved and the readouts are renderable (web <c>state</c> truthy).</summary>
    public bool HasState => _display is not null;

    /// <summary>Localized widget accessible title (web registry "Range Estimate").</summary>
    public string Title => RangeEstimateRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.noRange</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noRange", "No range data");

    /// <summary>The widget footprint. The web composition is layout-invariant, so this only stores the size.</summary>
    public RangeEstimateSize Size
    {
        get => _size;
        set => Set(ref _size, value);
    }

    /// <summary>The user's unit preference; reassigning re-projects the current state in the new units.</summary>
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
    /// visible (otherwise keeps the readouts while refreshing), and folds every emission into
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
        _state is RangeEstimateState.Loaded or RangeEstimateState.Stale or RangeEstimateState.Offline;

    private void Apply(RepositoryResult<RangeEstimateReading> result)
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
        RangeEstimateReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = RangeEstimateProjection.Project(reading, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? RangeEstimateState.Offline : stale ? RangeEstimateState.Stale : RangeEstimateState.Loaded;
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
        State = RangeEstimateState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = RangeEstimateState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = RangeEstimateState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.rangeEstimate.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.rangeEstimate.error.offline",
            _ => "widget.rangeEstimate.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view range",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached range",
            _ => "Couldn't load range",
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
