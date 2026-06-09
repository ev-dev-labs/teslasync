using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="GuardModeViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of merged guard snapshots (configuration + events) for the primary (or
/// explicit) vehicle — the native analogue of the web <c>useVehicles</c> + <c>useGuardConfig</c> +
/// <c>useGuardEvents</c> hook composition (web/src/features/dashboard/widgets/GuardModeWidget.tsx). The
/// view never performs HTTP itself; the concrete <see cref="GuardModeSource"/> (or a test fake) drives
/// this.
/// </summary>
public interface IGuardModeSource
{
    /// <summary>Stream the cache-then-network guard snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<GuardModeSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Guard Mode surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/security.ts (<c>guard-mode</c>). The dashboard grid system
/// binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class GuardModeRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "guard-mode";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "security";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "GuardModeWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static GuardModeSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static GuardModeSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static GuardModeSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Guard Mode").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.guardMode", "Guard Mode");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.guardMode.description",
            "Anti-theft guard status, recent security events, panic button");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(GuardModeSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static GuardModeSize Clamp(GuardModeSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Guard Mode surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an event type, acknowledgement,
/// sensitivity, VIN or vehicle id — so a diagnostics line can never leak what a guard event was about.
/// Thread-safe.
/// </summary>
public sealed class GuardModeDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public GuardModeDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=GuardModeWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={GuardModeRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="GuardModeWidget"/> view — the native port of
/// the web <c>GuardModeWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/GuardModeWidget.tsx). It consumes the cache-then-network
/// <see cref="IGuardModeSource"/>, projects each merged snapshot through <see cref="GuardModeProjection"/>
/// at the active footprint, and exposes the mutually-exclusive <see cref="State"/> plus the header
/// freshness flags so the view is a thin renderer. A resolved configuration always renders the status card
/// + event feed (web parity: the surface shows whenever <c>config</c> is truthy); the source collapses a
/// missing configuration to <see cref="GuardModeState.Empty"/> and a hard configuration failure to
/// <see cref="GuardModeState.Error"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class GuardModeViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IGuardModeSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private GuardModeSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<GuardModeSnapshot>? _last;
    private bool _disposed;

    private GuardModeState _state = GuardModeState.Loading;
    private GuardModeDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    /// <param name="source">The cache-then-network guard source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (drives the compact / full branch and the feed cap).</param>
    /// <param name="clock">Injected clock for deterministic relative-time projection (defaults to now).</param>
    public GuardModeViewModel(
        IGuardModeSource source,
        ILocalizer localizer,
        GuardModeSize size,
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
    public GuardModeState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready guard model (null until a configuration resolves, or on empty/error).</summary>
    public GuardModeDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasDisplay));
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

    /// <summary>True when the last read failed (drives the error surface + header chip colour).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown surface is older than the freshness window.</summary>
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

    /// <summary>True when a guard configuration has resolved and the status card is renderable.</summary>
    public bool HasDisplay => _display is not null;

    /// <summary>Localized widget title (web registry "Guard Mode").</summary>
    public string Title => _localizer.GetString("widget.guardMode", "Guard Mode");

    /// <summary>Localized widget-level empty message (web <c>widget.noGuardData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noGuardData", "No guard data");

    /// <summary>Localized event-feed empty message (web <c>widget.guardNoEvents</c>).</summary>
    public string NoEventsMessage => _localizer.GetString("widget.guardNoEvents", "No guard events");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new feed cap / branch.</summary>
    public GuardModeSize Size
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
        _state is GuardModeState.Loaded or GuardModeState.Stale or GuardModeState.Offline;

    private void Apply(RepositoryResult<GuardModeSnapshot> result)
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
                ApplyDisplay(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyDisplay(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyDisplay(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyDisplay(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyDisplay(
        GuardModeSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = GuardModeProjection.Project(snapshot, _size, _localizer, _clock());
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? GuardModeState.Offline
            : stale ? GuardModeState.Stale : GuardModeState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = GuardModeState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = GuardModeState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Display = null;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = GuardModeState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.guardMode.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.guardMode.error.offline",
            _ => "widget.guardMode.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view guard mode",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached guard state",
            _ => "Couldn't load guard mode",
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
