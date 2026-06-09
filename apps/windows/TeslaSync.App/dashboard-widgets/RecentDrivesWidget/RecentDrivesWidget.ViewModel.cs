using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// Canonical registry metadata for the Recent Drives surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/driving.ts (<c>recent-drives</c>). The dashboard
/// grid system binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class RecentDrivesRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "recent-drives";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "driving";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "RecentDrivesWidget";

    /// <summary>Default footprint: 2 columns × 4 rows (web registry <c>defaultSize</c>).</summary>
    public static RecentDrivesSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 2 columns × 2 rows (web registry <c>minSize</c>).</summary>
    public static RecentDrivesSize MinSize => new(2, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows (web registry <c>maxSize</c>).</summary>
    public static RecentDrivesSize MaxSize => new(4, 40);

    /// <summary>Localized registry display name (web registry "Recent Drives").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.recentDrives", "Recent Drives");
    }

    /// <summary>Localized registry description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.recentDrives.description",
            "Last 5 drives with distance and efficiency");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(RecentDrivesSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static RecentDrivesSize Clamp(RecentDrivesSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Recent Drives surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a distance, duration, SoC, VIN or
/// vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class RecentDrivesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public RecentDrivesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RecentDrivesWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RecentDrivesRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RecentDrivesWidget"/> view — the native port
/// of the web <c>RecentDrivesWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/RecentDrivesWidget.tsx). It consumes the cache-then-network
/// <see cref="IRecentDrivesSource"/>, projects each snapshot through <see cref="RecentDrivesProjection"/>
/// with the active units, applies the web <c>items.length === 0</c> empty gate, and exposes the
/// mutually-exclusive <see cref="State"/> plus the header freshness flags so the view is a thin renderer.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class RecentDrivesViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IRecentDrivesSource _source;
    private readonly ILocalizer _localizer;

    private RecentDrivesSize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<IReadOnlyList<RecentDrivesDrive>>? _last;
    private bool _disposed;

    private RecentDrivesState _state = RecentDrivesState.Loading;
    private IReadOnlyList<RecentDrivesRow> _rows = Array.Empty<RecentDrivesRow>();
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and units.</summary>
    /// <param name="source">The cache-then-network recent-drives source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (carried for the registry/grid API; the list is footprint-independent).</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    public RecentDrivesViewModel(
        IRecentDrivesSource source,
        ILocalizer localizer,
        RecentDrivesSize size,
        UnitPref? units = null)
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
    public RecentDrivesState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, newest-first, capped drive rows.</summary>
    public IReadOnlyList<RecentDrivesRow> Rows
    {
        get => _rows;
        private set
        {
            _rows = value;
            Raise(nameof(Rows));
            Raise(nameof(HasRows));
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

    /// <summary>True when the shown rows are older than the freshness window.</summary>
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

    /// <summary>True when there is at least one drive row to render.</summary>
    public bool HasRows => _rows.Count > 0;

    /// <summary>Localized widget title (web <c>widget.recentDrives</c> "Recent Drives").</summary>
    public string Title => RecentDrivesRegistration.Name(_localizer);

    /// <summary>Localized "View all" header action label (web <c>widget.viewAll</c>).</summary>
    public string ViewAllLabel => _localizer.GetString("widget.viewAll", "View all");

    /// <summary>Localized empty-state message (web <c>widget.noDrives</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noDrives", "No recent drives");

    /// <summary>The drive-list route the "View all" action navigates to (web <c>/drives</c>).</summary>
    public static string ListRoute => RecentDrivesProjection.ListRoute;

    /// <summary>
    /// The widget footprint. The web Recent Drives surface does not branch on its footprint, so reassigning
    /// only updates the registry/grid-facing value (no re-projection of the rows is required).
    /// </summary>
    public RecentDrivesSize Size
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
        }
    }

    /// <summary>The user's unit preference; reassigning re-projects the current rows in the new units.</summary>
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
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when no rows are already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Rows"/>. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasRows)
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

    private void Apply(RepositoryResult<IReadOnlyList<RecentDrivesDrive>> result)
    {
        _last = result;
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasRows)
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplyRows(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyRows(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyRows(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyRows(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyRows(
        IReadOnlyList<RecentDrivesDrive> drives,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var rows = RecentDrivesProjection.Project(drives, _units, _localizer);

        // Web parity: items.length === 0 renders the empty state regardless of freshness.
        if (rows.Count == 0)
        {
            SetEmpty(fetchedAt);
            return;
        }

        Rows = rows;
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? RecentDrivesState.Offline : stale ? RecentDrivesState.Stale : RecentDrivesState.Loaded;
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
        Rows = Array.Empty<RecentDrivesRow>();
        IsError = false;
        ErrorMessage = null;
        State = RecentDrivesState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Rows = Array.Empty<RecentDrivesRow>();
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = RecentDrivesState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Rows = Array.Empty<RecentDrivesRow>();
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = RecentDrivesState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.recentDrives.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.recentDrives.error.offline",
            _ => "widget.recentDrives.error",
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
