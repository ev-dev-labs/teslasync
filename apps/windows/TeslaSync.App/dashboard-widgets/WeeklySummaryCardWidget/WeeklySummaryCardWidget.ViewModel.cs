using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="WeeklySummaryViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed weekly-digest snapshots for
/// <c>GET /vehicles/{vehicleID}/weekly-digest</c> — the native analogue of the web <c>useWeeklyDigest</c> hook
/// composed with <c>useVehicles</c>. The view never performs HTTP itself; the concrete
/// <see cref="WeeklySummarySource"/> (or a test fake) drives this.
/// </summary>
public interface IWeeklySummarySource
{
    /// <summary>Stream the cache-then-network weekly-digest snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<WeeklyDigest>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Weekly Summary surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/analytics.ts (<c>weekly-summary-card</c>). The dashboard grid
/// system binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class WeeklySummaryRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "weekly-summary-card";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "analytics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "WeeklySummaryCardWidget";

    /// <summary>Default footprint: 2 columns × 2 rows.</summary>
    public static WeeklySummarySize DefaultSize => new(2, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static WeeklySummarySize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static WeeklySummarySize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Weekly Summary").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.weeklySummary.title", "Weekly Summary");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.weeklySummary.description",
            "This week vs last week: total miles, kWh, cost, efficiency");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(WeeklySummarySize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static WeeklySummarySize Clamp(WeeklySummarySize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Weekly Summary surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a distance, cost, efficiency value or
/// vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class WeeklySummaryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public WeeklySummaryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WeeklySummaryCardWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WeeklySummaryRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="WeeklySummaryCardWidget"/> view — the native port
/// of the web <c>WeeklySummaryCardWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx). It consumes the cache-then-network
/// <see cref="IWeeklySummarySource"/>, projects each snapshot through <see cref="WeeklySummaryProjection"/>
/// with the active units + currency, and exposes the mutually-exclusive <see cref="State"/> plus the header
/// freshness flags so the view is a thin renderer. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class WeeklySummaryViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IWeeklySummarySource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private WeeklySummarySize _size;
    private UnitPref _units;
    private string _currencySymbol;
    private CancellationTokenSource? _cts;
    private RepositoryResult<WeeklyDigest>? _last;
    private bool _disposed;

    private WeeklySummaryState _state = WeeklySummaryState.Loading;
    private WeeklySummaryDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint, units and currency.</summary>
    /// <param name="source">The cache-then-network weekly-digest source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint.</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="currencySymbol">The currency symbol for the cost tile; defaults to "$" when null.</param>
    /// <param name="clock">Test clock for the "now" timestamp; defaults to the system clock.</param>
    public WeeklySummaryViewModel(
        IWeeklySummarySource source,
        ILocalizer localizer,
        WeeklySummarySize size,
        UnitPref? units = null,
        string? currencySymbol = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _units = units ?? UnitPref.Metric;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = WeeklySummaryProjection.Project(WeeklyDigest.Empty, _size, _units, _currencySymbol, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public WeeklySummaryState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (stat tiles, inline metrics, compact number).</summary>
    public WeeklySummaryDisplay Display
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

    /// <summary>True when this-week metrics are being shown (web truthy <c>metrics</c>).</summary>
    public bool HasData =>
        _state is WeeklySummaryState.Loaded or WeeklySummaryState.Stale or WeeklySummaryState.Offline;

    /// <summary>Localized widget title (web <c>widget.weeklySummary.title</c>).</summary>
    public string Title => WeeklySummaryRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.weeklySummary.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.weeklySummary.noData", "No weekly data");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public WeeklySummarySize Size
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

    /// <summary>The user's unit preference; reassigning re-projects the current snapshot in the new units.</summary>
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

    /// <summary>The currency symbol used for the cost tile; reassigning re-projects.</summary>
    public string CurrencySymbol
    {
        get => _currencySymbol;
        set
        {
            string resolved = string.IsNullOrWhiteSpace(value) ? "$" : value;
            if (_currencySymbol == resolved)
            {
                return;
            }

            _currencySymbol = resolved;
            Raise(nameof(CurrencySymbol));
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
        _state is WeeklySummaryState.Loaded or WeeklySummaryState.Stale or WeeklySummaryState.Offline;

    private void Apply(RepositoryResult<WeeklyDigest> result)
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
        WeeklyDigest digest,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = WeeklySummaryProjection.Project(digest, _size, _units, _currencySymbol, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? WeeklySummaryState.Offline
            : stale ? WeeklySummaryState.Stale : WeeklySummaryState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = WeeklySummaryProjection.Project(WeeklyDigest.Empty, _size, _units, _currencySymbol, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = WeeklySummaryState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = WeeklySummaryProjection.Project(WeeklyDigest.Empty, _size, _units, _currencySymbol, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = WeeklySummaryState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = WeeklySummaryState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.weeklySummary.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.weeklySummary.error.offline",
            _ => "widget.weeklySummary.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view your weekly summary",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached summary",
            _ => "Couldn't load the weekly summary",
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
