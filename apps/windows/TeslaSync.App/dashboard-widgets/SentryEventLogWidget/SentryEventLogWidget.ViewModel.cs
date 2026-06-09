using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="SentryEventLogViewModel"/> binds to (P1/S8 state-holder seam). It
/// yields the cache-then-network sequence of parsed security snapshots for the primary (or explicit)
/// vehicle — the native analogue of the web <c>useVehicles</c> + <c>useQuery('/security?vehicle_id=…')</c>
/// hook composition (web/src/features/dashboard/widgets/SentryEventLogWidget.tsx). The view never
/// performs HTTP itself; the concrete <see cref="SentryEventLogSource"/> (or a test fake) drives this.
/// </summary>
public interface ISentryEventLogSource
{
    /// <summary>Stream the cache-then-network security snapshots (empty when no vehicle is resolved).</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<SentryLogEvent>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Sentry Event Log surface — the native mirror of the web
/// registry entry in web/src/features/dashboard/widgets/registry/security.ts. The dashboard grid
/// system binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class SentryEventLogRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "sentry-event-log";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "security";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SentryEventLogWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static SentryEventLogSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 2 columns × 4 rows.</summary>
    public static SentryEventLogSize MinSize => new(2, 4);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static SentryEventLogSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Sentry Event Log").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.sentryEventLog", "Sentry Event Log");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.sentryEventLog.description",
            "Recent sentry events with timestamps");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(SentryEventLogSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static SentryEventLogSize Clamp(SentryEventLogSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Sentry Event Log surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a door name, lock state, VIN
/// or location — so a diagnostics line can never leak what a security event was about. Thread-safe.
/// </summary>
public sealed class SentryEventLogDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SentryEventLogDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SentryEventLogWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SentryEventLogRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SentryEventLogWidget"/> view — the native
/// port of the web <c>SentryEventLogWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/SentryEventLogWidget.tsx). It consumes the cache-then-network
/// <see cref="ISentryEventLogSource"/>, projects each snapshot through
/// <see cref="SentryEventLogProjection"/>, and exposes the mutually-exclusive <see cref="State"/> plus
/// the header freshness flags so the view is a thin renderer. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class SentryEventLogViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISentryEventLogSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private SentryEventLogSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<IReadOnlyList<SentryLogEvent>>? _last;
    private bool _disposed;

    private SentryEventLogState _state = SentryEventLogState.Loading;
    private IReadOnlyList<SentryEventRow> _rows = Array.Empty<SentryEventRow>();
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    public SentryEventLogViewModel(
        ISentryEventLogSource source,
        ILocalizer localizer,
        SentryEventLogSize size,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public SentryEventLogState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, newest-first, capped security-event rows.</summary>
    public IReadOnlyList<SentryEventRow> Rows
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

    /// <summary>True when there is at least one row to render.</summary>
    public bool HasRows => _rows.Count > 0;

    /// <summary>Localized widget title (web <c>widget.sentryEventLog</c>).</summary>
    public string Title => SentryEventLogRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.noSentryEvents</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noSentryEvents", "No security events recorded");

    /// <summary>The widget footprint; reassigning re-projects the current rows for the new row budget.</summary>
    public SentryEventLogSize Size
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
            if (_last is { } last)
            {
                Apply(last);
            }
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when no rows are
    /// already visible (otherwise keeps content while refreshing), and folds every emission into
    /// <see cref="State"/> + <see cref="Rows"/>. A superseding load cancels the prior one.
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

    private void Apply(RepositoryResult<IReadOnlyList<SentryLogEvent>> result)
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
        IReadOnlyList<SentryLogEvent> events,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var rows = SentryEventLogProjection.Project(events, _size, _localizer, _clock());
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
        State = offline ? SentryEventLogState.Offline : stale ? SentryEventLogState.Stale : SentryEventLogState.Loaded;
    }

    private void SetLoading()
    {
        Rows = Array.Empty<SentryEventRow>();
        IsError = false;
        ErrorMessage = null;
        State = SentryEventLogState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Rows = Array.Empty<SentryEventRow>();
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = SentryEventLogState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Rows = Array.Empty<SentryEventRow>();
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = SentryEventLogState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.sentryEventLog.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.sentryEventLog.error.offline",
            _ => "widget.sentryEventLog.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view security events",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached events",
            _ => "Couldn't load security events",
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
