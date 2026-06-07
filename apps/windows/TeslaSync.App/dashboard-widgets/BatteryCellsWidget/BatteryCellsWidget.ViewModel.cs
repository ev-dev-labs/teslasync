using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="BatteryCellsViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed battery cell summaries for
/// <c>GET /vehicles/{vehicleID}/battery/cells</c> — the native analogue of the web
/// <c>useVehicles</c> + <c>useBatteryCells</c> hook composition (vehicle resolution included). The view
/// never performs HTTP itself; the concrete <see cref="BatteryCellsSource"/> (or a test fake) drives this.
/// </summary>
public interface IBatteryCellsSource
{
    /// <summary>Stream the cache-then-network battery cell snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<BatteryCellSummary>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Battery Cells surface — the native mirror of the web registry entry
/// in web/src/features/dashboard/widgets/registry/battery.ts. The dashboard grid system binds this surface
/// with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class BatteryCellsRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "battery-cells";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "battery";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BatteryCellsWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static BatteryCellsSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 2 columns × 4 rows.</summary>
    public static BatteryCellsSize MinSize => new(2, 4);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static BatteryCellsSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Battery Cells").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.batteryCells.title", "Battery Cells");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.batteryCells.description",
            "Cell-level voltage heatmap, min/max/avg, temperature per module");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(BatteryCellsSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static BatteryCellsSize Clamp(BatteryCellsSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Battery Cells surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a voltage, temperature, VIN or
/// vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class BatteryCellsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BatteryCellsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BatteryCellsWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BatteryCellsRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="BatteryCellsWidget"/> view — the native port of
/// the web <c>BatteryCellsWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/BatteryCellsWidget.tsx). It consumes the cache-then-network
/// <see cref="IBatteryCellsSource"/>, projects each summary through <see cref="BatteryCellsProjection"/>, and
/// exposes the mutually-exclusive <see cref="State"/> plus the header freshness flags so the view is a thin
/// renderer. Unlike the count-gated widgets, a summary is always rendered when present (the web gates only on
/// <c>data</c>; the heatmap shows its own "No cell data" message when there are no bricks). Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class BatteryCellsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IBatteryCellsSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private BatteryCellsSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<BatteryCellSummary>? _last;
    private bool _disposed;

    private BatteryCellsState _state = BatteryCellsState.Loading;
    private BatteryCellsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    public BatteryCellsViewModel(
        IBatteryCellsSource source,
        ILocalizer localizer,
        BatteryCellsSize size,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = BatteryCellsProjection.Project(BatteryCellSummary.Empty, _size, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public BatteryCellsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (heatmap tiles + voltage/temperature stats).</summary>
    public BatteryCellsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasCells));
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

    /// <summary>True when the heatmap has at least one cell (web <c>cells.length &gt; 0</c>).</summary>
    public bool HasCells => _display.HasCells;

    /// <summary>Localized widget title (web <c>widget.batteryCells.title</c>).</summary>
    public string Title => BatteryCellsRegistration.Name(_localizer);

    /// <summary>Localized outer empty-state message (web <c>widget.batteryCells.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.batteryCells.noData", "No battery cell data");

    /// <summary>The widget footprint; reassigning re-projects the current summary for the new layout.</summary>
    public BatteryCellsSize Size
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
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
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
        _state is BatteryCellsState.Loaded or BatteryCellsState.Stale or BatteryCellsState.Offline;

    private void Apply(RepositoryResult<BatteryCellSummary> result)
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
                ApplySummary(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplySummary(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySummary(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySummary(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySummary(
        BatteryCellSummary summary,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        // Web parity: the outer empty state is gated on `data` presence only, so a resolved summary is always
        // rendered — even an all-zero "no_data" body — and the heatmap shows its own "No cell data" message.
        Display = BatteryCellsProjection.Project(summary, _size, _localizer);

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? BatteryCellsState.Offline : stale ? BatteryCellsState.Stale : BatteryCellsState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = BatteryCellsProjection.Project(BatteryCellSummary.Empty, _size, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = BatteryCellsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = BatteryCellsProjection.Project(BatteryCellSummary.Empty, _size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = BatteryCellsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = BatteryCellsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.batteryCells.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.batteryCells.error.offline",
            _ => "widget.batteryCells.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view battery cells",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached battery cells",
            _ => "Couldn't load battery cells",
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
