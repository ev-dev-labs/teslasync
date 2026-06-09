using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="LiveSignalsViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of merged live-signal readings for the primary (or explicit) vehicle — the native
/// analogue of the web <c>useVehicles</c> + <c>useMotorLatest</c> + <c>useClimateLatest</c> +
/// <c>useSecurityLatest</c> + <c>useLatestTirePressure</c> hook composition
/// (web/src/features/dashboard/widgets/LiveSignalsWidget.tsx). The view never performs HTTP itself; the concrete
/// <see cref="LiveSignalsSource"/> (or a test fake) drives this.
/// </summary>
public interface ILiveSignalsSource
{
    /// <summary>Stream the cache-then-network merged live-signal readings, newest first.</summary>
    IAsyncEnumerable<RepositoryResult<LiveSignalsReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Live Signals surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/telemetry.ts (<c>live-signals</c>). The dashboard grid system
/// binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class LiveSignalsRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "live-signals";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "telemetry";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "LiveSignalsWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static LiveSignalsSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 2 columns × 2 rows.</summary>
    public static LiveSignalsSize MinSize => new(2, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static LiveSignalsSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Live Signals").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.liveSignals", "Live Signals");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.liveSignals.description",
            "Real-time signal values with sparklines");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(LiveSignalsSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static LiveSignalsSize Clamp(LiveSignalsSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Live Signals surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a torque / temperature / pressure / lock / sentry
/// value, VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class LiveSignalsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LiveSignalsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LiveSignalsWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LiveSignalsRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="LiveSignalsWidget"/> view — the native port of the
/// web <c>LiveSignalsWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/LiveSignalsWidget.tsx). It consumes the cache-then-network
/// <see cref="ILiveSignalsSource"/> (a combine-latest merge of the motor / climate / security / tire reads),
/// projects each merged reading through <see cref="LiveSignalsProjection"/> with the active units, and exposes
/// the mutually-exclusive <see cref="State"/> plus the motor-driven freshness flags so the view is a thin
/// renderer. A reading with any section renders the grid (web <c>hasData</c>); the source collapses a reading
/// with no section to <see cref="LiveSignalsState.Empty"/> and a motor hard-failure with nothing to show to
/// <see cref="LiveSignalsState.Error"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class LiveSignalsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILiveSignalsSource _source;
    private readonly ILocalizer _localizer;

    private LiveSignalsSize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<LiveSignalsReading>? _last;
    private bool _disposed;

    private LiveSignalsState _state = LiveSignalsState.Loading;
    private LiveSignalsDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and unit preference.</summary>
    /// <param name="source">The cache-then-network merged live-signals source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry metadata; the web renders identically at every size).</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    public LiveSignalsViewModel(
        ILiveSignalsSource source,
        ILocalizer localizer,
        LiveSignalsSize size,
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
    public LiveSignalsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready grid model (null until a reading resolves, or on the empty surface).</summary>
    public LiveSignalsDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip (web <c>motorUpdatedAt</c>).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a motor refresh is in flight (web <c>motorFetching</c>; freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the motor read failed (web <c>motorError</c>; drives the error chip / surface).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown grid is backed by a motor read older than the freshness window (web <c>motorStale</c>).</summary>
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

    /// <summary>True when at least one read resolved and the grid is renderable (web <c>hasData</c>).</summary>
    public bool HasData => _display is not null;

    /// <summary>Localized widget title (web <c>widget.liveSignals</c> "Live Signals").</summary>
    public string Title => _localizer.GetString("widget.liveSignals", "Live Signals");

    /// <summary>Localized empty-state message (web <c>widget.noSignals</c> "No live signal data").</summary>
    public string EmptyMessage => _localizer.GetString("widget.noSignals", "No live signal data");

    /// <summary>The widget footprint. The web renders identically at every size, so reassigning never re-projects.</summary>
    public LiveSignalsSize Size
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

    /// <summary>The user's unit preference; reassigning re-projects the temperatures and pressures in the new units.</summary>
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
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps the grid while refreshing), and folds every emission into <see cref="State"/> +
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
        _state is LiveSignalsState.Loaded or LiveSignalsState.Stale or LiveSignalsState.Offline;

    private void Apply(RepositoryResult<LiveSignalsReading> result)
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
        LiveSignalsReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = LiveSignalsProjection.Project(reading, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? LiveSignalsState.Offline
            : stale ? LiveSignalsState.Stale : LiveSignalsState.Loaded;
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
        State = LiveSignalsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = LiveSignalsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Display = null;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = LiveSignalsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.liveSignals.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.liveSignals.error.offline",
            _ => "widget.liveSignals.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view live signals",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached signals",
            _ => "Couldn't load live signals",
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
