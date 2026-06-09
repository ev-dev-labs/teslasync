using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// Canonical registry metadata for the Watch Summary surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/vehicle.ts (<c>watch-summary</c>). The dashboard grid system
/// binds this surface with the same <see cref="Id"/> and honours the same size constraints (default 1×2,
/// min 1×2, max 2×40).
/// </summary>
public static class WatchSummaryRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "watch-summary";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "vehicle";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "WatchSummaryWidget";

    /// <summary>Default footprint: 1 column × 2 rows.</summary>
    public static WatchSummarySize DefaultSize => new(1, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static WatchSummarySize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 2 columns × 40 rows.</summary>
    public static WatchSummarySize MaxSize => new(2, 40);

    /// <summary>Localized registry display name (web registry "Watch Summary").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.watchSummary", "Watch Summary");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.watchSummary.description",
            "Apple Watch-style compact view: battery, range, state, lock status");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(WatchSummarySize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static WatchSummarySize Clamp(WatchSummarySize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Watch Summary surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a state-of-charge, range, cabin
/// temperature, lock state, VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class WatchSummaryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public WatchSummaryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WatchSummaryWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WatchSummaryRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="WatchSummaryWidget"/> view — the native port of
/// the web <c>WatchSummaryWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/WatchSummaryWidget.tsx). It consumes the cache-then-network
/// <see cref="IWatchSummarySource"/>, projects each settled reading through <see cref="WatchSummaryProjection"/>
/// with the active units, and exposes the mutually-exclusive <see cref="State"/> plus the header freshness
/// flags so the view is a thin renderer. A surface with a resolved summary always renders content (web
/// <c>hasData ? content : EmptyState</c>); the source collapses a no-data response to
/// <see cref="WatchSummaryState.Empty"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class WatchSummaryViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IWatchSummarySource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private WatchSummarySize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<WatchSummaryReading>? _last;
    private bool _disposed;

    private WatchSummaryState _state = WatchSummaryState.Loading;
    private WatchSummaryDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint, units and clock.</summary>
    public WatchSummaryViewModel(
        IWatchSummarySource source,
        ILocalizer localizer,
        WatchSummarySize size,
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
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public WatchSummaryState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready watch display (null until a summary resolves).</summary>
    public WatchSummaryDisplay? Display
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

    /// <summary>True while a background refresh is in flight (freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the freshness error chip).</summary>
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

    /// <summary>Localized message describing the most recent failure (for the offline chip tooltip).</summary>
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

    /// <summary>True when a watch summary has resolved and content is renderable (web truthy <c>hasData</c>).</summary>
    public bool HasData =>
        _state is WatchSummaryState.Loaded or WatchSummaryState.Stale or WatchSummaryState.Offline;

    /// <summary>Localized widget title shown in the standard header (web <c>widget.watchSummary</c>).</summary>
    public string Title => _localizer.GetString("widget.watchSummary", "Watch Summary");

    /// <summary>Localized empty-state message (web <c>widget.noWatchData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noWatchData", "No watch data");

    /// <summary>The widget footprint; reassigning re-projects the current reading for the new layout.</summary>
    public WatchSummarySize Size
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

    /// <summary>The user's unit preference; reassigning re-projects the current reading in the new units.</summary>
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
        _state is WatchSummaryState.Loaded or WatchSummaryState.Stale or WatchSummaryState.Offline;

    private void Apply(RepositoryResult<WatchSummaryReading> result)
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
        WatchSummaryReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = WatchSummaryProjection.Project(reading, _size, _units, _localizer, _clock());
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? WatchSummaryState.Offline
            : stale ? WatchSummaryState.Stale : WatchSummaryState.Loaded;
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
        State = WatchSummaryState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = WatchSummaryState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Display = null;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = WatchSummaryState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.watchSummary.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.watchSummary.error.offline",
            _ => "widget.watchSummary.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view your watch summary",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached watch summary",
            _ => "Couldn't load watch summary",
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
