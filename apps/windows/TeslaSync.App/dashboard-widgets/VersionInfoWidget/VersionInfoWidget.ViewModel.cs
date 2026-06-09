using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="VersionInfoViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of merged version-info readings — the native analogue of the web
/// <c>useVersionInfo</c> + <c>useCaptureStats</c> hook composition
/// (web/src/features/dashboard/widgets/VersionInfoWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="VersionInfoSource"/> (or a test fake) drives this.
/// </summary>
public interface IVersionInfoSource
{
    /// <summary>Stream the cache-then-network merged version-info readings, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<VersionInfoReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Version Info surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/system.ts (<c>version-info</c>). The dashboard grid system binds
/// this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class VersionInfoRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "version-info";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "system";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "VersionInfoWidget";

    /// <summary>Default footprint: 2 columns × 2 rows.</summary>
    public static VersionInfoSize DefaultSize => new(2, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static VersionInfoSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static VersionInfoSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Version Info").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.versionInfo.title", "Version Info");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.versionInfo.description",
            "TeslaSync version, build info, uptime, data capture rates");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(VersionInfoSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static VersionInfoSize Clamp(VersionInfoSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Version Info surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a version, SHA, or count — so a
/// diagnostics line can never leak operational data. Thread-safe.
/// </summary>
public sealed class VersionInfoDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public VersionInfoDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VersionInfoWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VersionInfoRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="VersionInfoWidget"/> view — the native port of the
/// web <c>VersionInfoWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/VersionInfoWidget.tsx). It consumes the cache-then-network
/// <see cref="IVersionInfoSource"/> (a combine of the version / capture reads), projects each merged reading
/// through <see cref="VersionInfoProjection"/> for the active footprint, and exposes the mutually-exclusive
/// <see cref="State"/> plus the version-driven freshness flags so the view is a thin renderer. A reading whose
/// version slice is present renders the body (web <c>hasData</c>); the source collapses a reading with no
/// version to <see cref="VersionInfoState.Empty"/> and a version hard-failure to
/// <see cref="VersionInfoState.Error"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class VersionInfoViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IVersionInfoSource _source;
    private readonly ILocalizer _localizer;

    private VersionInfoSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<VersionInfoReading>? _last;
    private bool _disposed;

    private VersionInfoState _state = VersionInfoState.Loading;
    private VersionInfoDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and footprint.</summary>
    /// <param name="source">The cache-then-network merged version-info source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact / standard / wide layout).</param>
    public VersionInfoViewModel(IVersionInfoSource source, ILocalizer localizer, VersionInfoSize size)
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
    public VersionInfoState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready body model (null until a reading resolves, or on the empty surface).</summary>
    public VersionInfoDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip (web <c>version.dataUpdatedAt</c>).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a version refresh is in flight (web <c>version.isFetching</c>; freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the version read failed (web <c>version.isError</c>; drives the error chip / surface).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown body is backed by a version read older than the freshness window (web <c>version.isStale</c>).</summary>
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

    /// <summary>True when the version read resolved and the body is renderable (web <c>hasData</c>).</summary>
    public bool HasData => _display is { HasData: true };

    /// <summary>Localized widget title (web <c>widget.versionInfo.title</c> "Version Info").</summary>
    public string Title => _localizer.GetString("widget.versionInfo.title", "Version Info");

    /// <summary>Localized empty-state message (web <c>widget.versionInfo.noData</c> "No version data available").</summary>
    public string EmptyMessage => _localizer.GetString("widget.versionInfo.noData", "No version data available");

    /// <summary>The widget footprint. Reassigning re-projects so the compact / standard / wide layout follows the new size.</summary>
    public VersionInfoSize Size
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
    /// visible (otherwise keeps the body while refreshing), and folds every emission into <see cref="State"/> +
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
        _state is VersionInfoState.Loaded or VersionInfoState.Stale or VersionInfoState.Offline;

    private void Apply(RepositoryResult<VersionInfoReading> result)
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
        VersionInfoReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = VersionInfoProjection.Project(reading, _size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? VersionInfoState.Offline
            : stale ? VersionInfoState.Stale : VersionInfoState.Loaded;
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
        State = VersionInfoState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = VersionInfoState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Display = null;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = VersionInfoState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.versionInfo.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.versionInfo.error.offline",
            _ => "widget.versionInfo.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view version info",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached version info",
            _ => "Couldn't load version info",
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
