using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// Canonical registry metadata for the Monthly Mileage surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/analytics.ts (<c>monthly-mileage</c>). The
/// dashboard grid system binds this surface with the same <see cref="Id"/> and honours the same size
/// constraints.
/// </summary>
public static class MonthlyMileageRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "monthly-mileage";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "analytics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "MonthlyMileageWidget";

    /// <summary>Default footprint: 2 columns × 4 rows (web registry <c>defaultSize</c>).</summary>
    public static MonthlyMileageSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 2 columns × 4 rows (web registry <c>minSize</c>).</summary>
    public static MonthlyMileageSize MinSize => new(2, 4);

    /// <summary>Maximum footprint: 4 columns × 40 rows (web registry <c>maxSize</c>).</summary>
    public static MonthlyMileageSize MaxSize => new(4, 40);

    /// <summary>Localized registry display name (web registry "Monthly Mileage").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.monthlyMileage.name", "Monthly Mileage");
    }

    /// <summary>Localized registry description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.monthlyMileage.description",
            "Bar chart of monthly driving distance over last 12 months");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(MonthlyMileageSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static MonthlyMileageSize Clamp(MonthlyMileageSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Monthly Mileage surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a distance figure, month, VIN or
/// vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class MonthlyMileageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public MonthlyMileageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MonthlyMileageWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MonthlyMileageRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="MonthlyMileageWidget"/> view — the native port
/// of the web <c>MonthlyMileageWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/MonthlyMileageWidget.tsx). It consumes the cache-then-network
/// <see cref="IMonthlyMileageSource"/>, applies the web <c>hasData</c> gate (a list with no month carrying
/// any distance renders the friendly empty state, mirroring <c>WidgetChartSummary isEmpty</c>), projects
/// the rest through <see cref="MonthlyMileageProjection"/> with the active units and reference clock, and
/// exposes the mutually-exclusive <see cref="State"/> plus the header freshness flags so the view is a thin
/// renderer. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class MonthlyMileageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IMonthlyMileageSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private MonthlyMileageSize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>? _last;
    private bool _disposed;

    private MonthlyMileageState _state = MonthlyMileageState.Loading;
    private MonthlyMileageDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint, units and clock.</summary>
    /// <param name="source">The cache-then-network monthly-mileage source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (drives the compact / wide branches).</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="clock">The reference clock for the current-month highlight; defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public MonthlyMileageViewModel(
        IMonthlyMileageSource source,
        ILocalizer localizer,
        MonthlyMileageSize size,
        UnitPref? units = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _units = units ?? UnitPref.Metric;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = MonthlyMileageProjection.Project(
            Array.Empty<MonthlyMileageBucket>(), _size, _units, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public MonthlyMileageState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (stats + bars).</summary>
    public MonthlyMileageDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
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

    /// <summary>Localized widget header title (web <c>widget.monthlyMileage.title</c> "Monthly Mileage").</summary>
    public string Title => _localizer.GetString("widget.monthlyMileage.title", "Monthly Mileage");

    /// <summary>Localized empty-state message (web <c>widget.monthlyMileage.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.monthlyMileage.noData", "No mileage data");

    /// <summary>The widget footprint; reassigning re-projects the current list for the new layout.</summary>
    public MonthlyMileageSize Size
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

    /// <summary>The user's unit preference; reassigning re-projects the current list in the new units.</summary>
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
        _state is MonthlyMileageState.Loaded or MonthlyMileageState.Stale or MonthlyMileageState.Offline;

    private void Apply(RepositoryResult<IReadOnlyList<MonthlyMileageBucket>> result)
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
        IReadOnlyList<MonthlyMileageBucket> buckets,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = MonthlyMileageProjection.Project(buckets, _size, _units, _localizer, _clock());

        // Web parity: WidgetChartSummary's isEmpty gate — no month with any distance renders the empty
        // state regardless of freshness.
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
        State = offline
            ? MonthlyMileageState.Offline
            : stale ? MonthlyMileageState.Stale : MonthlyMileageState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = MonthlyMileageProjection.Project(
                Array.Empty<MonthlyMileageBucket>(), _size, _units, _localizer, _clock());
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = MonthlyMileageState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = MonthlyMileageProjection.Project(
            Array.Empty<MonthlyMileageBucket>(), _size, _units, _localizer, _clock());
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = MonthlyMileageState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = MonthlyMileageState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.monthlyMileage.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.monthlyMileage.error.offline",
            _ => "widget.monthlyMileage.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view monthly mileage",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached monthly mileage",
            _ => "Couldn't load monthly mileage",
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
