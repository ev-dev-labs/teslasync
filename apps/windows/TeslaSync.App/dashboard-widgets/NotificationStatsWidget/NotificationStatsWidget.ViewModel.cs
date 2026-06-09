using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="NotificationStatsViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of merged notification readings — the native analogue of the web
/// <c>useNotificationStats</c> + <c>useNotificationLogs</c> hook composition
/// (web/src/features/dashboard/widgets/NotificationStatsWidget.tsx). The view never performs HTTP itself;
/// the concrete <see cref="NotificationStatsSource"/> (or a test fake) drives this.
/// </summary>
public interface INotificationStatsSource
{
    /// <summary>Stream the cache-then-network merged notification readings, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<NotificationStatsReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Notification Stats surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/alerts.ts (<c>notification-stats</c>). The dashboard
/// grid system binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class NotificationStatsRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "notification-stats";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "alerts";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "NotificationStatsWidget";

    /// <summary>Default footprint: 2 columns × 2 rows.</summary>
    public static NotificationStatsSize DefaultSize => new(2, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static NotificationStatsSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static NotificationStatsSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Notification Stats").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.notificationStats.title", "Notification Stats");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.notificationStats.description",
            "Notification delivery rate, active channels, recent delivery log");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(NotificationStatsSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static NotificationStatsSize Clamp(NotificationStatsSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Notification Stats surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a delivery count, channel title,
/// message body or recipient — so a diagnostics line can never leak what a notification was about.
/// Thread-safe.
/// </summary>
public sealed class NotificationStatsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public NotificationStatsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=NotificationStatsWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={NotificationStatsRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="NotificationStatsWidget"/> view — the native
/// port of the web <c>NotificationStatsWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/NotificationStatsWidget.tsx). It consumes the cache-then-network
/// <see cref="INotificationStatsSource"/>, projects each merged reading through
/// <see cref="NotificationStatsProjection"/> at the active footprint, and exposes the mutually-exclusive
/// <see cref="State"/> plus the header freshness flags so the view is a thin renderer. Faithful to the web
/// component, the load-bearing stats read drives the state matrix (a hard failure shows the retry surface,
/// exactly as the web's <c>WidgetShell error={statsError}</c> replaces the body). Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class NotificationStatsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly INotificationStatsSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private NotificationStatsSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<NotificationStatsReading>? _last;
    private bool _disposed;

    private NotificationStatsState _state = NotificationStatsState.Loading;
    private NotificationStatsDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    /// <param name="source">The cache-then-network notification source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (drives the compact / wide branches).</param>
    /// <param name="clock">Injectable clock so the relative-time tiers are deterministic in tests.</param>
    public NotificationStatsViewModel(
        INotificationStatsSource source,
        ILocalizer localizer,
        NotificationStatsSize size,
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
    public NotificationStatsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (null until a reading resolves, or on the empty surface).</summary>
    public NotificationStatsDisplay? Display
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

    /// <summary>True when the load-bearing read failed (drives the error surface / offline chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window (stats or logs).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the error / offline surface.</summary>
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

    /// <summary>True when a reading has resolved and the surface is renderable (web <c>stats != null</c>).</summary>
    public bool HasData => _display is not null;

    /// <summary>Localized widget title (web <c>widget.notificationStats.title</c>).</summary>
    public string Title => NotificationStatsRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.notificationStats.noData</c>).</summary>
    public string EmptyMessage =>
        _localizer.GetString("widget.notificationStats.noData", "No notification data");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public NotificationStatsSize Size
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
        _state is NotificationStatsState.Loaded or NotificationStatsState.Stale or NotificationStatsState.Offline;

    private void Apply(RepositoryResult<NotificationStatsReading> result)
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
        NotificationStatsReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = NotificationStatsProjection.Project(reading, _size, _localizer, _clock());
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? NotificationStatsState.Offline
            : stale ? NotificationStatsState.Stale : NotificationStatsState.Loaded;
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
        State = NotificationStatsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = NotificationStatsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = NotificationStatsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.notificationStats.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.notificationStats.error.offline",
            _ => "widget.notificationStats.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view notification stats",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached notification stats",
            _ => "Couldn't load notification stats",
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
