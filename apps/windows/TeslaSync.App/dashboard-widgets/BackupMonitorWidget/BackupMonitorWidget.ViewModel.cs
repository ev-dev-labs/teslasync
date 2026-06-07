using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// Canonical registry metadata for the Backup Monitor surface — the native mirror of the web registry entry
/// in web/src/features/dashboard/widgets/registry/system.ts. The dashboard grid system binds this surface
/// with the same <see cref="Id"/> and honours the same size constraints. The generated OpenAPI operation id
/// is centralized here so a single test asserts it resolves against the generated endpoint table (catching
/// contract drift at build/test time rather than at runtime).
/// </summary>
public static class BackupMonitorRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "backup-monitor";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "system";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BackupMonitorWidget";

    /// <summary>Generated operation id for the backup-runs list (web <c>useBackupRuns</c>).</summary>
    public const string RunsOperationId = "get_api_v1_backup_runs";

    /// <summary>Default footprint: 2 columns × 2 rows.</summary>
    public static BackupMonitorSize DefaultSize => new(2, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static BackupMonitorSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static BackupMonitorSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Backup Monitor").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.backupMonitor.title", "Backup Monitor");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.backupMonitor.description",
            "Database backup status: last run, size, retention, success/fail history");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(BackupMonitorSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static BackupMonitorSize Clamp(BackupMonitorSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Backup Monitor surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a backup file name, size or timestamp
/// — so a diagnostics line can never leak an operator's backup schedule or storage footprint. Thread-safe.
/// </summary>
public sealed class BackupMonitorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BackupMonitorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BackupMonitorWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BackupMonitorRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="BackupMonitorWidget"/> view — the native port of
/// the web component's <c>useBackupRuns</c> composition
/// (web/src/features/dashboard/widgets/BackupMonitorWidget.tsx). It consumes the cache-then-network
/// <see cref="IBackupMonitorSource"/>, projects each snapshot through <see cref="BackupMonitorProjection"/>,
/// and exposes the mutually-exclusive <see cref="State"/> (loading / loaded / empty / error / stale /
/// offline) plus the header freshness flags so the view is a thin renderer. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class BackupMonitorViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IBackupMonitorSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private BackupMonitorSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<BackupMonitorSnapshot>? _last;
    private bool _disposed;

    private BackupMonitorState _state = BackupMonitorState.Loading;
    private BackupMonitorDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    public BackupMonitorViewModel(
        IBackupMonitorSource source,
        ILocalizer localizer,
        BackupMonitorSize size,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = BackupMonitorProjection.Project(BackupMonitorSnapshot.Empty, _size, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public BackupMonitorState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (latest-run stats + capped run feed).</summary>
    public BackupMonitorDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasRuns));
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

    /// <summary>True when at least one backup run is available to render.</summary>
    public bool HasRuns => _display.HasRuns;

    /// <summary>Localized widget title (web <c>widget.backupMonitor.title</c>).</summary>
    public string Title => BackupMonitorRegistration.Name(_localizer);

    /// <summary>Localized "no backup data" empty-state message (web <c>widget.backupMonitor.noData</c>).</summary>
    public string EmptyMessage =>
        _localizer.GetString("widget.backupMonitor.noData", "No backup data");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public BackupMonitorSize Size
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
        _state is BackupMonitorState.Loaded
            or BackupMonitorState.Empty
            or BackupMonitorState.Stale
            or BackupMonitorState.Offline;

    private void Apply(RepositoryResult<BackupMonitorSnapshot> result)
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
        BackupMonitorSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = BackupMonitorProjection.Project(snapshot, _size, _localizer, _clock());

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // Web parity: an empty runs list (`runs.length === 0`) is its own empty surface. Offline / stale
        // freshness take precedence for the header chip (as in the sibling widgets); the body still renders
        // the right empty/content via Display.
        State = offline
            ? BackupMonitorState.Offline
            : stale
                ? BackupMonitorState.Stale
                : !Display.HasRuns
                    ? BackupMonitorState.Empty
                    : BackupMonitorState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = BackupMonitorProjection.Project(BackupMonitorSnapshot.Empty, _size, _localizer, _clock());
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = BackupMonitorState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        // The source returns a value for every outcome, so the engine's generic Empty is never expected; the
        // contract is honoured defensively by rendering the same "no backup data" empty surface.
        Display = BackupMonitorProjection.Project(
            new BackupMonitorSnapshot(Array.Empty<BackupRun>()), _size, _localizer, _clock());
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = BackupMonitorState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = BackupMonitorState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.backupMonitor.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.backupMonitor.error.offline",
            _ => "widget.backupMonitor.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view backup status",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached backup status",
            _ => "Couldn't load backup status",
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
