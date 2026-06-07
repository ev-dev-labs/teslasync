using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="AlertFeedViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of parsed alert snapshots for <c>GET /alerts</c> — the native
/// analogue of the web <c>useAlerts</c> hook. The view never performs HTTP itself; the concrete
/// <c>AlertFeedSource</c> (or a test fake) drives this.
/// </summary>
public interface IAlertFeedSource
{
    /// <summary>Stream the cache-then-network alert snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<AlertFeedAlert>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Alert Feed surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/alerts.ts. The dashboard grid system binds
/// this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class AlertFeedRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "alert-feed";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "alerts";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AlertFeedWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static AlertFeedSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 2 columns × 4 rows.</summary>
    public static AlertFeedSize MinSize => new(2, 4);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static AlertFeedSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Alert Feed").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.alertFeed", "Alert Feed");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.alertFeed.description",
            "Recent alerts reverse-chronological with severity badges");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(AlertFeedSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static AlertFeedSize Clamp(AlertFeedSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Alert Feed surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an alert title, message, VIN
/// or location — so a diagnostics line can never leak what an alert was about. Thread-safe.
/// </summary>
public sealed class AlertFeedDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AlertFeedDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AlertFeedWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AlertFeedRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AlertFeedWidget"/> view — the native port
/// of the web <c>AlertFeedWidget</c>'s hook composition (web/src/features/dashboard/widgets/AlertFeedWidget.tsx).
/// It consumes the cache-then-network <see cref="IAlertFeedSource"/>, projects each snapshot through
/// <see cref="AlertFeedProjection"/>, and exposes the mutually-exclusive <see cref="State"/> plus the
/// header freshness flags so the view is a thin renderer. Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </summary>
public sealed class AlertFeedViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAlertFeedSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private AlertFeedSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<IReadOnlyList<AlertFeedAlert>>? _last;
    private bool _disposed;

    private AlertFeedState _state = AlertFeedState.Loading;
    private IReadOnlyList<AlertFeedRow> _rows = Array.Empty<AlertFeedRow>();
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    public AlertFeedViewModel(
        IAlertFeedSource source,
        ILocalizer localizer,
        AlertFeedSize size,
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
    public AlertFeedState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, newest-first, capped alert rows.</summary>
    public IReadOnlyList<AlertFeedRow> Rows
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

    /// <summary>Localized widget title (web <c>widget.alertFeed</c>).</summary>
    public string Title => AlertFeedRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.noAlerts</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noAlerts", "No alerts yet");

    /// <summary>The widget footprint; reassigning re-projects the current rows for the new row budget.</summary>
    public AlertFeedSize Size
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

    private void Apply(RepositoryResult<IReadOnlyList<AlertFeedAlert>> result)
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
        IReadOnlyList<AlertFeedAlert> alerts,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var rows = AlertFeedProjection.Project(alerts, _size, _localizer, _clock());
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
        State = offline ? AlertFeedState.Offline : stale ? AlertFeedState.Stale : AlertFeedState.Loaded;
    }

    private void SetLoading()
    {
        Rows = Array.Empty<AlertFeedRow>();
        IsError = false;
        ErrorMessage = null;
        State = AlertFeedState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Rows = Array.Empty<AlertFeedRow>();
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = AlertFeedState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Rows = Array.Empty<AlertFeedRow>();
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = AlertFeedState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.alertFeed.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.alertFeed.error.offline",
            _ => "widget.alertFeed.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view alerts",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached alerts",
            _ => "Couldn't load alerts",
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
