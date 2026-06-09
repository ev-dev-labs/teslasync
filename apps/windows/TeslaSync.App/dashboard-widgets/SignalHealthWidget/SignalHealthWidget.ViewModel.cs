using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="SignalHealthViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of merged signal-health readings for the primary (or explicit) vehicle — the
/// native analogue of the web <c>useVehicles</c> + <c>useSignalStats</c> + <c>useSignals</c> +
/// <c>useSignalGaps</c> hook composition
/// (web/src/features/dashboard/widgets/SignalHealthWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="SignalHealthSource"/> (or a test fake) drives this.
/// </summary>
public interface ISignalHealthSource
{
    /// <summary>Stream the cache-then-network merged signal-health readings, newest first.</summary>
    IAsyncEnumerable<RepositoryResult<SignalHealthReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Signal Health surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/telemetry.ts (<c>signal-health</c>). The dashboard grid system
/// binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class SignalHealthRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "signal-health";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "telemetry";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SignalHealthWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static SignalHealthSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static SignalHealthSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static SignalHealthSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Signal Health").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.signalHealth.title", "Signal Health");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.signalHealth.description",
            "Telemetry signal coverage: active signals, data gaps, freshness");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(SignalHealthSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static SignalHealthSize Clamp(SignalHealthSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Signal Health surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a signal name, timestamp, count or
/// vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class SignalHealthDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SignalHealthDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SignalHealthWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SignalHealthRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SignalHealthWidget"/> view — the native port of the
/// web <c>SignalHealthWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/SignalHealthWidget.tsx). It consumes the cache-then-network
/// <see cref="ISignalHealthSource"/> (a combine-latest merge of the stats / available / live reads), projects
/// each merged reading through <see cref="SignalHealthProjection"/> for the active footprint and clock, and
/// exposes the mutually-exclusive <see cref="State"/> plus the stats-driven freshness flags so the view is a
/// thin renderer. A reading with any read renders the body (web <c>hasData</c>); the source collapses a reading
/// with nothing to <see cref="SignalHealthState.Empty"/> and a stats hard-failure with nothing to show to
/// <see cref="SignalHealthState.Error"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class SignalHealthViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISignalHealthSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private SignalHealthSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<SignalHealthReading>? _last;
    private bool _disposed;

    private SignalHealthState _state = SignalHealthState.Loading;
    private SignalHealthDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    /// <param name="source">The cache-then-network merged signal-health source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact / wide layout).</param>
    /// <param name="clock">The wall clock used to age live timestamps; defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public SignalHealthViewModel(
        ISignalHealthSource source,
        ILocalizer localizer,
        SignalHealthSize size,
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
    public SignalHealthState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready body model (null until a reading resolves, or on the empty surface).</summary>
    public SignalHealthDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip (web <c>statsUpdatedAt</c>).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a stats refresh is in flight (web <c>statsFetching</c>; freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the stats read failed (web <c>statsError</c>; drives the error chip / surface).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown body is backed by a stats read older than the freshness window (web <c>statsStale</c>).</summary>
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

    /// <summary>True when at least one read resolved and the body is renderable (web <c>hasData</c>).</summary>
    public bool HasData => _display is { HasData: true };

    /// <summary>Localized widget title (web <c>widget.signalHealth.title</c> "Signal Health").</summary>
    public string Title => _localizer.GetString("widget.signalHealth.title", "Signal Health");

    /// <summary>Localized empty-state message (web <c>widget.signalHealth.noData</c> "No signal health data").</summary>
    public string EmptyMessage => _localizer.GetString("widget.signalHealth.noData", "No signal health data");

    /// <summary>The widget footprint. Reassigning re-projects so the compact / wide layout follows the new size.</summary>
    public SignalHealthSize Size
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
        _state is SignalHealthState.Loaded or SignalHealthState.Stale or SignalHealthState.Offline;

    private void Apply(RepositoryResult<SignalHealthReading> result)
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
        SignalHealthReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = SignalHealthProjection.Project(reading, _size, _clock(), _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? SignalHealthState.Offline
            : stale ? SignalHealthState.Stale : SignalHealthState.Loaded;
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
        State = SignalHealthState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = SignalHealthState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Display = null;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = SignalHealthState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.signalHealth.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.signalHealth.error.offline",
            _ => "widget.signalHealth.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view signal health",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached signal health",
            _ => "Couldn't load signal health",
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
