using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// Canonical registry metadata for the Recent Drives List surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/driving.ts (<c>recent-drives-list</c>). The
/// dashboard grid system binds this surface with the same <see cref="Id"/> and honours the same size
/// constraints.
/// </summary>
public static class RecentDrivesListRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "recent-drives-list";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "driving";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "RecentDrivesListWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static RecentDrivesListSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 4 rows.</summary>
    public static RecentDrivesListSize MinSize => new(1, 4);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static RecentDrivesListSize MaxSize => new(4, 40);

    /// <summary>Localized registry display name (web registry "Recent Drives List", title "Recent Drives").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.recentDrivesList", "Recent Drives");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.recentDrivesList.description",
            "Last 5-10 drives: distance, duration, efficiency, start/end locations");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(RecentDrivesListSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static RecentDrivesListSize Clamp(RecentDrivesListSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Recent Drives List surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a distance, address, SoC, vehicle id
/// or VIN — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class RecentDrivesListDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public RecentDrivesListDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RecentDrivesListWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RecentDrivesListRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RecentDrivesListWidget"/> view — the native port
/// of the web <c>RecentDrivesListWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/RecentDrivesListWidget.tsx). It consumes the cache-then-network
/// <see cref="IRecentDrivesListSource"/>, applies the web empty gate (an empty drive list renders the
/// friendly empty state, mirroring <c>items.length &gt; 0 ? … : &lt;EmptyState&gt;</c>), projects the rest
/// through <see cref="RecentDrivesListProjection"/> with the active units, and exposes the
/// mutually-exclusive <see cref="State"/> plus the header freshness flags so the view is a thin renderer.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class RecentDrivesListViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IRecentDrivesListSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private RecentDrivesListSize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<IReadOnlyList<RecentDrive>>? _last;
    private bool _disposed;

    private RecentDrivesListState _state = RecentDrivesListState.Loading;
    private RecentDrivesListDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and units.</summary>
    public RecentDrivesListViewModel(
        IRecentDrivesListSource source,
        ILocalizer localizer,
        RecentDrivesListSize size,
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
        _display = RecentDrivesListProjection.Project(Array.Empty<RecentDrive>(), _size, _units, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public RecentDrivesListState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (drive rows + flags).</summary>
    public RecentDrivesListDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasItems));
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

    /// <summary>True when the last load failed (drives the header error chip).</summary>
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

    /// <summary>True when at least one drive row is being shown (web truthy <c>items.length &gt; 0</c>).</summary>
    public bool HasItems =>
        _state is RecentDrivesListState.Loaded or RecentDrivesListState.Stale or RecentDrivesListState.Offline;

    /// <summary>Localized widget title shown in the header (web <c>widget.recentDrivesList</c>).</summary>
    public string Title => RecentDrivesListRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.noDrivesList</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noDrivesList", "No recent drives recorded");

    /// <summary>Localized "View all" action label (web <c>widget.viewAll</c>).</summary>
    public string ViewAllLabel => _localizer.GetString("widget.viewAll", "View all");

    /// <summary>The widget footprint; reassigning re-projects the current list for the new layout.</summary>
    public RecentDrivesListSize Size
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
        _state is RecentDrivesListState.Loaded or RecentDrivesListState.Stale or RecentDrivesListState.Offline;

    private void Apply(RepositoryResult<IReadOnlyList<RecentDrive>> result)
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
        IReadOnlyList<RecentDrive> drives,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = RecentDrivesListProjection.Project(drives, _size, _units, _clock());

        // Web parity: items.length > 0 ? list : <EmptyState> — an empty drive list renders the empty state
        // regardless of freshness.
        if (!display.HasData)
        {
            SetEmpty(fetchedAt);
            return;
        }

        Display = display;
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? RecentDrivesListState.Offline
            : stale ? RecentDrivesListState.Stale : RecentDrivesListState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = RecentDrivesListProjection.Project(Array.Empty<RecentDrive>(), _size, _units, _clock());
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = RecentDrivesListState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = RecentDrivesListProjection.Project(Array.Empty<RecentDrive>(), _size, _units, _clock());
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = RecentDrivesListState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = RecentDrivesListState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.recentDrivesList.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.recentDrivesList.error.offline",
            _ => "widget.recentDrivesList.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view recent drives",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached drives",
            _ => "Couldn't load recent drives",
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
