using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="MediaNowPlayingViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of media readings for the primary (or explicit) vehicle — the native analogue of
/// the web <c>useVehicles</c> + <c>useMediaLatest</c> hook composition
/// (web/src/features/dashboard/widgets/MediaNowPlayingWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="MediaNowPlayingSource"/> (or a test fake) drives this.
/// </summary>
public interface IMediaNowPlayingSource
{
    /// <summary>Stream the cache-then-network media readings, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<MediaNowPlayingReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the now-playing surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/media.ts (<c>media-now-playing</c>). The dashboard grid system
/// binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class MediaNowPlayingRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "media-now-playing";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "media";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "MediaNowPlayingWidget";

    /// <summary>Default footprint: 2 columns × 2 rows.</summary>
    public static MediaNowPlayingSize DefaultSize => new(2, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static MediaNowPlayingSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static MediaNowPlayingSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Now Playing").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.nowPlaying", "Now Playing");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.mediaNowPlaying.description",
            "Current media: song title, artist, source");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(MediaNowPlayingSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static MediaNowPlayingSize Clamp(MediaNowPlayingSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the now-playing surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a track title, artist, album, station, source or
/// vehicle id — so a diagnostics line can never leak media or fleet data. Thread-safe.
/// </summary>
public sealed class MediaNowPlayingDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public MediaNowPlayingDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MediaNowPlayingWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MediaNowPlayingRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="MediaNowPlayingWidget"/> view — the native port of
/// the web <c>MediaNowPlayingWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/MediaNowPlayingWidget.tsx). It consumes the cache-then-network
/// <see cref="IMediaNowPlayingSource"/>, projects each reading through <see cref="MediaNowPlayingProjection"/>,
/// and exposes the mutually-exclusive <see cref="State"/> plus the freshness flags so the view is a thin
/// renderer. A surface with a resolved reading always renders the track (web <c>media ? … : empty</c>); the
/// engine collapses a body with no media object to <see cref="MediaNowPlayingState.Empty"/>. The
/// <see cref="Size"/> changes which elements the view shows (compact / standard / tall) but never re-projects —
/// the projection is footprint-independent. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class MediaNowPlayingViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IMediaNowPlayingSource _source;
    private readonly ILocalizer _localizer;

    private MediaNowPlayingSize _size;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    private MediaNowPlayingState _state = MediaNowPlayingState.Loading;
    private MediaNowPlayingDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and footprint.</summary>
    /// <param name="source">The cache-then-network media source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the view's compact / tall branches).</param>
    public MediaNowPlayingViewModel(
        IMediaNowPlayingSource source,
        ILocalizer localizer,
        MediaNowPlayingSize size)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public MediaNowPlayingState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready now-playing model (null until a state resolves / in the empty state).</summary>
    public MediaNowPlayingDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasReading));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip.</summary>
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

    /// <summary>True when the last load failed (drives the error surface + freshness chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown reading is older than the freshness window.</summary>
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

    /// <summary>True when a media object has resolved and the track is renderable (web <c>media</c> truthy).</summary>
    public bool HasReading => _display is not null;

    /// <summary>Localized widget title (web <c>widget.nowPlaying</c> "Now Playing").</summary>
    public string Title => _localizer.GetString("widget.nowPlaying", "Now Playing");

    /// <summary>Localized empty-state message (web <c>widget.noMedia</c> "Nothing playing").</summary>
    public string EmptyMessage => _localizer.GetString("widget.noMedia", "Nothing playing");

    /// <summary>
    /// The widget footprint. Reassigning never re-projects (the projection is footprint-independent), but raises
    /// a change so the view re-renders its compact / standard / tall layout for the new size.
    /// </summary>
    public MediaNowPlayingSize Size
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

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps the track while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. A superseding load cancels the prior one.
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
        _state is MediaNowPlayingState.Loaded or MediaNowPlayingState.Stale or MediaNowPlayingState.Offline;

    private void Apply(RepositoryResult<MediaNowPlayingReading> result)
    {
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
        MediaNowPlayingReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = MediaNowPlayingProjection.Project(reading, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? MediaNowPlayingState.Offline
            : stale ? MediaNowPlayingState.Stale : MediaNowPlayingState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = MediaNowPlayingState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = MediaNowPlayingState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = MediaNowPlayingState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.mediaNowPlaying.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.mediaNowPlaying.error.offline",
            _ => "widget.mediaNowPlaying.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view what's playing",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached track",
            _ => "Couldn't load what's playing",
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
