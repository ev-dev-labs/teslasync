using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="RangeBarViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed vehicle range states for <c>GET /vehicles/{vehicleID}/state</c> — the
/// native analogue of the web <c>useVehicles</c> + <c>useVehicleState</c> hook composition (vehicle resolution
/// included). The view never performs HTTP itself; the concrete <see cref="RangeBarSource"/> (or a test fake)
/// drives this.
/// </summary>
public interface IRangeBarSource
{
    /// <summary>Stream the cache-then-network vehicle-range snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<VehicleRangeState>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Range Bar surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/battery.ts (<c>range-bar</c>). The dashboard grid system binds
/// this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class RangeBarRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "range-bar";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "battery";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "RangeBarWidget";

    /// <summary>Default footprint: 2 columns × 2 rows (web registry <c>defaultSize</c>).</summary>
    public static RangeBarSize DefaultSize => new(2, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows (web registry <c>minSize</c>).</summary>
    public static RangeBarSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows (web registry <c>maxSize</c>).</summary>
    public static RangeBarSize MaxSize => new(4, 40);

    /// <summary>Localized registry display name (web registry "Range Bar").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.rangeBar.name", "Range Bar");
    }

    /// <summary>Localized registry description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.rangeBar.description",
            "Horizontal bar showing rated, ideal, and estimated range with EPA comparison");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(RangeBarSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static RangeBarSize Clamp(RangeBarSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Range Bar surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a range figure, VIN or vehicle id — so a diagnostics
/// line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class RangeBarDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public RangeBarDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RangeBarWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RangeBarRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RangeBarWidget"/> view — the native port of the
/// web <c>RangeBarWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/RangeBarWidget.tsx). It consumes the cache-then-network
/// <see cref="IRangeBarSource"/>, projects each state through <see cref="RangeBarProjection"/> with the active
/// units, applies the web <c>hasData</c> gate (a state whose rated and ideal range are both zero renders the
/// friendly empty state), and exposes the mutually-exclusive <see cref="State"/> plus the header freshness
/// flags so the view is a thin renderer. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class RangeBarViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IRangeBarSource _source;
    private readonly ILocalizer _localizer;

    private RangeBarSize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<VehicleRangeState>? _last;
    private bool _disposed;

    private RangeBarState _state = RangeBarState.Loading;
    private RangeBarDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and units.</summary>
    /// <param name="source">The cache-then-network range source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (drives the compact branch).</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    public RangeBarViewModel(IRangeBarSource source, ILocalizer localizer, RangeBarSize size, UnitPref? units = null)
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
    public RangeBarState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready range model (null until a state with data resolves).</summary>
    public RangeBarDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
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

    /// <summary>True when a range has resolved and the bars are renderable (web <c>hasData</c> truthy).</summary>
    public bool HasData => _display is not null;

    /// <summary>Localized widget header title (web <c>widget.rangeBar</c> "Range").</summary>
    public string Title => _localizer.GetString("widget.rangeBar", "Range");

    /// <summary>Localized empty-state message (web <c>widget.noRange</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noRange", "No range data");

    /// <summary>The widget footprint; reassigning re-projects the current state for the new layout.</summary>
    public RangeBarSize Size
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
    /// visible (otherwise keeps the bars while refreshing), and folds every emission into <see cref="State"/>
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
        _state is RangeBarState.Loaded or RangeBarState.Stale or RangeBarState.Offline;

    private void Apply(RepositoryResult<VehicleRangeState> result)
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
        VehicleRangeState state,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = RangeBarProjection.Project(state, _size, _units, _localizer);

        // Web parity: hasData = state != null && (rated > 0 || ideal > 0) — a zero-range state renders the
        // empty surface regardless of freshness.
        if (!display.HasData)
        {
            SetEmpty(fetchedAt);
            return;
        }

        Display = display;
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? RangeBarState.Offline : stale ? RangeBarState.Stale : RangeBarState.Loaded;
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
        State = RangeBarState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = RangeBarState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = RangeBarState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.rangeBar.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.rangeBar.error.offline",
            _ => "widget.rangeBar.error",
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
