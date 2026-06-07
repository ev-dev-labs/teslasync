using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="BackupHistoryViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed <see cref="BackupHistorySnapshot"/> values — the native analogue
/// of the web component's composed <c>useTeslaEnergySites</c> + <c>useTeslaBackupHistory</c> hooks. The view
/// never performs HTTP itself; the concrete <see cref="BackupHistorySource"/> (or a test fake) drives this.
/// </summary>
public interface IBackupHistorySource
{
    /// <summary>Stream the cache-then-network backup-history snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<BackupHistorySnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Backup History surface — the native mirror of the web registry entry
/// in web/src/features/dashboard/widgets/registry/energy.ts. The dashboard grid system binds this surface
/// with the same <see cref="Id"/> and honours the same size constraints. The generated OpenAPI operation ids
/// are centralized here so a single test asserts they resolve against the generated endpoint table
/// (catching contract drift at build/test time rather than at runtime).
/// </summary>
public static class BackupHistoryRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "backup-history";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "energy";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BackupHistoryWidget";

    /// <summary>Trailing window in days for the backup-history read (web <c>thirtyDaysAgo()</c>).</summary>
    public const int LookbackDays = 30;

    /// <summary>Generated operation id for the energy-sites list (web <c>useTeslaEnergySites</c>).</summary>
    public const string SitesOperationId = "get_api_v1_tesla_energy_sites";

    /// <summary>Generated operation id for a site's backup history (web <c>useTeslaBackupHistory</c>).</summary>
    public const string BackupHistoryOperationId = "get_api_v1_tesla_energy_sites_siteID_backup_history";

    /// <summary>Path-parameter name in the backup-history endpoint template.</summary>
    public const string SitePathParam = "siteID";

    /// <summary>Trailing-window query-parameter name (web <c>since</c>).</summary>
    public const string SinceQueryParam = "since";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static BackupHistorySize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static BackupHistorySize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static BackupHistorySize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Backup History").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.backupHistory.title", "Backup History");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.backupHistory.description",
            "Power outage events: Powerwall backup triggers, duration, energy used");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(BackupHistorySize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static BackupHistorySize Clamp(BackupHistorySize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Backup History surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a site id, outage timestamp or
/// duration — so a diagnostics line can never leak a home's power-outage pattern. Thread-safe.
/// </summary>
public sealed class BackupHistoryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BackupHistoryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BackupHistoryWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BackupHistoryRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="BackupHistoryWidget"/> view — the native port of
/// the web component's two-hook composition (web/src/features/dashboard/widgets/BackupHistoryWidget.tsx). It
/// consumes the cache-then-network <see cref="IBackupHistorySource"/>, projects each snapshot through
/// <see cref="BackupHistoryProjection"/>, and exposes the mutually-exclusive <see cref="State"/> (including
/// the two distinct empty surfaces <see cref="BackupHistoryState.NoSite"/> and
/// <see cref="BackupHistoryState.NoEvents"/>) plus the header freshness flags so the view is a thin renderer.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class BackupHistoryViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IBackupHistorySource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private BackupHistorySize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<BackupHistorySnapshot>? _last;
    private bool _disposed;

    private BackupHistoryState _state = BackupHistoryState.Loading;
    private BackupHistoryDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    public BackupHistoryViewModel(
        IBackupHistorySource source,
        ILocalizer localizer,
        BackupHistorySize size,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = BackupHistoryProjection.Project(BackupHistorySnapshot.Empty, _size, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public BackupHistoryState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (stat values + capped outage feed).</summary>
    public BackupHistoryDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasEvents));
            Raise(nameof(HasSites));
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

    /// <summary>True when at least one outage row is available to render.</summary>
    public bool HasEvents => _display.HasEvents;

    /// <summary>True when a Tesla Energy site is linked.</summary>
    public bool HasSites => _display.HasSites;

    /// <summary>Localized widget title (web <c>widget.backupHistory.title</c>).</summary>
    public string Title => BackupHistoryRegistration.Name(_localizer);

    /// <summary>Localized "no linked site" empty-state message (web <c>widget.backupHistory.noSite</c>).</summary>
    public string NoSiteMessage =>
        _localizer.GetString("widget.backupHistory.noSite", "No Tesla Energy site linked");

    /// <summary>Localized "no events" empty-state message (web <c>widget.backupHistory.noEvents</c>).</summary>
    public string NoEventsMessage =>
        _localizer.GetString("widget.backupHistory.noEvents", "No backup events in the last 30 days");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public BackupHistorySize Size
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
    /// visible (otherwise keeps content while refreshing), and folds every emission into
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

    /// <summary>Retry after a failure (or refresh on demand) — re-runs the load from the top.</summary>
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
        _state is BackupHistoryState.Loaded
            or BackupHistoryState.NoSite
            or BackupHistoryState.NoEvents
            or BackupHistoryState.Stale
            or BackupHistoryState.Offline;

    private void Apply(RepositoryResult<BackupHistorySnapshot> result)
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
        BackupHistorySnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = BackupHistoryProjection.Project(snapshot, _size, _localizer, _clock());

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // Web parity: the no-site gate (!hasSites) and the no-events gate (items.length === 0) are distinct
        // empty surfaces. Offline / stale freshness take precedence for the header chip (as in the sibling
        // widgets); the body still renders the right empty/content via Display.
        State = offline
            ? BackupHistoryState.Offline
            : stale
                ? BackupHistoryState.Stale
                : !Display.HasSites
                    ? BackupHistoryState.NoSite
                    : !Display.HasEvents
                        ? BackupHistoryState.NoEvents
                        : BackupHistoryState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = BackupHistoryProjection.Project(BackupHistorySnapshot.Empty, _size, _localizer, _clock());
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = BackupHistoryState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        // The composite never resolves to the engine's generic Empty (the source returns a value for every
        // outcome), but the contract is honoured defensively: treat it as a linked site with no events.
        Display = BackupHistoryProjection.Project(
            BackupHistorySnapshot.NoSites with { HasSites = true }, _size, _localizer, _clock());
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = BackupHistoryState.NoEvents;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = BackupHistoryState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.backupHistory.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.backupHistory.error.offline",
            _ => "widget.backupHistory.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view backup history",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached backup history",
            _ => "Couldn't load backup history",
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
