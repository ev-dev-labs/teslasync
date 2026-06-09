using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// Canonical registry metadata for the Uptime Monitor surface — the native mirror of the web registry entry
/// in web/src/features/dashboard/widgets/registry/system.ts (<c>uptime-monitor</c>). The dashboard grid system
/// binds this surface with the same <see cref="Id"/> and honours the same size constraints. The generated
/// OpenAPI operation id is centralized here so a single test asserts it resolves against the generated
/// endpoint table (catching contract drift at build/test time rather than at runtime).
/// </summary>
public static class UptimeMonitorRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "uptime-monitor";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "system";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "UptimeMonitorWidget";

    /// <summary>Generated operation id for the system-health read (web <c>useSystemHealth</c>).</summary>
    public const string HealthOperationId = "get_api_v1_system_health";

    /// <summary>Default footprint: 2 columns × 2 rows.</summary>
    public static UptimeMonitorSize DefaultSize => new(2, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static UptimeMonitorSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static UptimeMonitorSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Uptime Monitor").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.uptime.title", "Uptime Monitor");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.uptime.description",
            "System health: DB, MQTT, Tesla API, Fleet Telemetry status");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(UptimeMonitorSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static UptimeMonitorSize Clamp(UptimeMonitorSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Uptime Monitor surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a component status, error message or
/// database size — so a diagnostics line can never leak an operator's infrastructure state. Thread-safe.
/// </summary>
public sealed class UptimeMonitorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public UptimeMonitorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=UptimeMonitorWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={UptimeMonitorRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="UptimeMonitorWidget"/> view — the native port of
/// the web component's <c>useSystemHealth</c> composition
/// (web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx). It consumes the cache-then-network
/// <see cref="IUptimeMonitorSource"/>, projects each snapshot through <see cref="UptimeMonitorProjection"/>,
/// and exposes the mutually-exclusive <see cref="State"/> (loading / loaded / empty / error / stale / offline)
/// plus the header freshness flags so the view is a thin renderer. <see cref="Display"/> is always populated so
/// the compact healthy-count metric renders in every state. Drive it from one confinement (the UI thread); it
/// is not internally synchronised.
/// </summary>
public sealed class UptimeMonitorViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IUptimeMonitorSource _source;
    private readonly ILocalizer _localizer;

    private UptimeMonitorSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<UptimeHealthSnapshot>? _last;
    private bool _disposed;

    private UptimeMonitorState _state = UptimeMonitorState.Loading;
    private UptimeMonitorDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and footprint.</summary>
    public UptimeMonitorViewModel(IUptimeMonitorSource source, ILocalizer localizer, UptimeMonitorSize size)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _display = UptimeMonitorProjection.Project(UptimeHealthSnapshot.Empty, _size, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public UptimeMonitorState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (overall badge + service rows + footer values).</summary>
    public UptimeMonitorDisplay Display
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

    /// <summary>Localized error message shown in the error surface / offline chip tooltip.</summary>
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

    /// <summary>True when a system-health body is available to render (web truthy <c>data</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized widget title (web <c>widget.uptime.title</c>).</summary>
    public string Title => UptimeMonitorRegistration.Name(_localizer);

    /// <summary>Localized "no system health data" empty-state message (web <c>widget.uptime.noData</c>).</summary>
    public string EmptyMessage =>
        _localizer.GetString("widget.uptime.noData", "No system health data");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public UptimeMonitorSize Size
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
        _state is UptimeMonitorState.Loaded
            or UptimeMonitorState.Empty
            or UptimeMonitorState.Stale
            or UptimeMonitorState.Offline;

    private void Apply(RepositoryResult<UptimeHealthSnapshot> result)
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
        UptimeHealthSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = UptimeMonitorProjection.Project(snapshot, _size, _localizer);

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // Web parity: a non-object body (`data` falsy) is its own empty surface. Offline / stale freshness take
        // precedence for the header chip (as in the sibling widgets); the body still renders the right
        // empty/content via Display.
        State = offline
            ? UptimeMonitorState.Offline
            : stale
                ? UptimeMonitorState.Stale
                : !Display.HasData
                    ? UptimeMonitorState.Empty
                    : UptimeMonitorState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = UptimeMonitorProjection.Project(UptimeHealthSnapshot.Empty, _size, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = UptimeMonitorState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        // The source returns a value for every outcome, so the engine's generic Empty is never expected; the
        // contract is honoured defensively by rendering the same "no system health data" empty surface.
        Display = UptimeMonitorProjection.Project(UptimeHealthSnapshot.Empty, _size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = UptimeMonitorState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = UptimeMonitorState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.uptime.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.uptime.error.offline",
            _ => "widget.uptime.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view system health",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached system health",
            _ => "Couldn't load system health",
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
