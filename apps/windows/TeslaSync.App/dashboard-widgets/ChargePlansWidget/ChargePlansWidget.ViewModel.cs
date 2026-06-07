using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="ChargePlansViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of merged charge-plan + rate-plan snapshots — the native analogue of
/// the web <c>useVehicles</c> + <c>useChargePlans</c> + <c>useRatePlans</c> hook composition. The view
/// never performs HTTP itself; the concrete <see cref="ChargePlansSource"/> (or a test fake) drives
/// this.
/// </summary>
public interface IChargePlansSource
{
    /// <summary>Stream the cache-then-network charge-plan + rate-plan snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<ChargePlansSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Charge Plans surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/charging.ts (<c>charge-plans</c>). The dashboard
/// grid system binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class ChargePlansRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "charge-plans";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChargePlansWidget";

    /// <summary>Default footprint: 2 columns × 4 rows (web registry <c>defaultSize</c>).</summary>
    public static ChargePlansSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows (web registry <c>minSize</c>).</summary>
    public static ChargePlansSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows (web registry <c>maxSize</c>).</summary>
    public static ChargePlansSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Charge Plans").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.chargePlans.title", "Charge Plans");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.chargePlans.description",
            "Active charge plan, rate schedule: peak/off-peak hours with rates");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(ChargePlansSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static ChargePlansSize Clamp(ChargePlansSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Charge Plans surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a cost, SOC figure, VIN or vehicle
/// id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class ChargePlansDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChargePlansDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargePlansWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargePlansRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ChargePlansWidget"/> view — the native port
/// of the web <c>ChargePlansWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/ChargePlansWidget.tsx). It consumes the cache-then-network
/// <see cref="IChargePlansSource"/>, projects each snapshot through <see cref="ChargePlansProjection"/>
/// with the active currency settings, and exposes the mutually-exclusive <see cref="State"/> plus the
/// header freshness flags so the view is a thin renderer. A snapshot with no plans and no rate plans
/// renders the empty state (web <c>hasData</c> gate). Drive it from one confinement (the UI thread); it
/// is not internally synchronised.
/// </summary>
public sealed class ChargePlansViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IChargePlansSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private ChargePlansSize _size;
    private ChargePlansSettings _settings;
    private CancellationTokenSource? _cts;
    private RepositoryResult<ChargePlansSnapshot>? _last;
    private bool _disposed;

    private ChargePlansState _state = ChargePlansState.Loading;
    private ChargePlansDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint, currency settings and clock.</summary>
    public ChargePlansViewModel(
        IChargePlansSource source,
        ILocalizer localizer,
        ChargePlansSize size,
        ChargePlansSettings? settings = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _settings = settings ?? ChargePlansSettings.Default;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = BuildDisplay(ChargePlansSnapshot.Empty);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public ChargePlansState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (active plan, stats, detail rows, rate plans).</summary>
    public ChargePlansDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
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

    /// <summary>Localized error message shown in the error / offline surfaces.</summary>
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

    /// <summary>True when the snapshot has a plan or rate plan to render (web <c>hasData</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized widget title (web <c>widget.chargePlans.title</c>).</summary>
    public string Title => ChargePlansRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.chargePlans.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.chargePlans.noData", "No charge plans or rate data");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public ChargePlansSize Size
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

    /// <summary>The currency preferences; reassigning re-projects the current snapshot's money fields.</summary>
    public ChargePlansSettings Settings
    {
        get => _settings;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_settings == value)
            {
                return;
            }

            _settings = value;
            Raise(nameof(Settings));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is
    /// already visible (otherwise keeps content while refreshing), and folds every emission into
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
        _state is ChargePlansState.Loaded or ChargePlansState.Stale or ChargePlansState.Offline;

    private void Apply(RepositoryResult<ChargePlansSnapshot> result)
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
        ChargePlansSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = BuildDisplay(snapshot);
        Display = display;

        if (!display.HasData)
        {
            SetEmpty(fetchedAt, keepDisplay: true);
            return;
        }

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? ChargePlansState.Offline : stale ? ChargePlansState.Stale : ChargePlansState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = BuildDisplay(ChargePlansSnapshot.Empty);
        }
    }

    private ChargePlansDisplay BuildDisplay(ChargePlansSnapshot snapshot) =>
        ChargePlansProjection.Project(snapshot, _settings, _size, _localizer, _clock());

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = ChargePlansState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt, bool keepDisplay = false)
    {
        if (!keepDisplay)
        {
            Display = BuildDisplay(ChargePlansSnapshot.Empty);
        }

        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = ChargePlansState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = ChargePlansState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.chargePlans.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.chargePlans.error.offline",
            _ => "widget.chargePlans.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view charge plans",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached charge plans",
            _ => "Couldn't load charge plans",
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
