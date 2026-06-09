using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// Canonical registry metadata for the Speed Heatmap surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/driving.ts (<c>speed-heatmap</c>). The dashboard grid system
/// binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class SpeedHeatmapRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "speed-heatmap";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "driving";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SpeedHeatmapWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static SpeedHeatmapSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 4 rows.</summary>
    public static SpeedHeatmapSize MinSize => new(1, 4);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static SpeedHeatmapSize MaxSize => new(4, 40);

    /// <summary>Localized registry display name (web registry "Speed Heatmap").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.speedHeatmap.title", "Speed Heatmap");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.speedHeatmap.description",
            "Heatmap: time-of-day vs day-of-week speed distribution");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(SpeedHeatmapSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static SpeedHeatmapSize Clamp(SpeedHeatmapSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Speed Heatmap surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a speed, drive count, vehicle id or VIN —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class SpeedHeatmapDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SpeedHeatmapDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SpeedHeatmapWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SpeedHeatmapRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SpeedHeatmapWidget"/> view — the native port of
/// the web <c>SpeedHeatmapWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/SpeedHeatmapWidget.tsx). It consumes the cache-then-network
/// <see cref="ISpeedHeatmapSource"/>, projects each drive list through <see cref="SpeedHeatmapProjection"/>
/// (in the user's <see cref="UnitPref"/> and local time zone), applies the web empty gate (a grid with no
/// bucketed drives renders the friendly empty state, mirroring <c>totalDrives &gt; 0 ? heatmap :
/// &lt;EmptyState&gt;</c>), and exposes the mutually-exclusive <see cref="State"/> plus the header freshness
/// flags so the view is a thin renderer. <see cref="Display"/> is always populated so the single-column compact
/// layout can render its peak metric (with a "—" fallback) in every state. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SpeedHeatmapViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISpeedHeatmapSource _source;
    private readonly ILocalizer _localizer;
    private readonly TimeZoneInfo _timeZone;

    private SpeedHeatmapSize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<IReadOnlyList<DriveSample>>? _last;
    private bool _disposed;

    private SpeedHeatmapState _state = SpeedHeatmapState.Loading;
    private SpeedHeatmapDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint, units and time zone.</summary>
    public SpeedHeatmapViewModel(
        ISpeedHeatmapSource source,
        ILocalizer localizer,
        SpeedHeatmapSize size,
        UnitPref? units = null,
        TimeZoneInfo? timeZone = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _units = units ?? UnitPref.Metric;
        _timeZone = timeZone ?? TimeZoneInfo.Local;
        _display = Project(Array.Empty<DriveSample>());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public SpeedHeatmapState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready heatmap model (always populated; never null).</summary>
    public SpeedHeatmapDisplay Display
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

    /// <summary>True when at least one drive bucket is being shown (web truthy <c>totalDrives &gt; 0</c>).</summary>
    public bool HasData =>
        _state is SpeedHeatmapState.Loaded or SpeedHeatmapState.Stale or SpeedHeatmapState.Offline;

    /// <summary>Localized widget title shown in the header (web <c>widget.speedHeatmap.title</c>).</summary>
    public string Title => _localizer.GetString("widget.speedHeatmap.title", "Speed Heatmap");

    /// <summary>Localized empty-state message (web <c>widget.speedHeatmap.empty</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.speedHeatmap.empty", "No drive data yet");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public SpeedHeatmapSize Size
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
        _state is SpeedHeatmapState.Loaded or SpeedHeatmapState.Stale or SpeedHeatmapState.Offline;

    private SpeedHeatmapDisplay Project(IReadOnlyList<DriveSample> drives) =>
        SpeedHeatmapProjection.Project(drives, _size, _units, _timeZone, _localizer);

    private void Apply(RepositoryResult<IReadOnlyList<DriveSample>> result)
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
        IReadOnlyList<DriveSample> drives,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = Project(drives);

        // Web parity: totalDrives > 0 ? heatmap : <EmptyState> — a list with no bucketed drives renders the
        // empty surface regardless of freshness (the compact layout still shows the "—" peak metric).
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
            ? SpeedHeatmapState.Offline
            : stale ? SpeedHeatmapState.Stale : SpeedHeatmapState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = Project(Array.Empty<DriveSample>());
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = SpeedHeatmapState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = Project(Array.Empty<DriveSample>());
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = SpeedHeatmapState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = SpeedHeatmapState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.speedHeatmap.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.speedHeatmap.error.offline",
            _ => "widget.speedHeatmap.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view the speed heatmap",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached speed heatmap",
            _ => "Couldn't load the speed heatmap",
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
