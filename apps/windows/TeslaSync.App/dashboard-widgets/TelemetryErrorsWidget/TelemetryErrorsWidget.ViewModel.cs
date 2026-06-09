using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets.TelemetryErrors;

/// <summary>
/// The data port the <see cref="TelemetryErrorsViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the merged cache-then-network sequence of telemetry-error snapshots — the combination of
/// <c>GET /tesla/fleet-telemetry/error-vins</c> and <c>GET /tesla/fleet-telemetry/errors</c> — the native
/// analogue of the web component's <c>useFleetTelemetryErrorVINs</c> + <c>useFleetTelemetryErrors</c> hook
/// composition. The view never performs HTTP itself; the concrete <see cref="TelemetryErrorsSource"/> (or a
/// test fake) drives this.
/// </summary>
public interface ITelemetryErrorsSource
{
    /// <summary>Stream the merged cache-then-network telemetry-error snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<TelemetryErrorsSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Telemetry Errors surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/system.ts (id <c>telemetry-errors</c>). The
/// dashboard grid system binds this surface with the same <see cref="Id"/> and honours the same size
/// constraints (default 2×4, min 1×2, max 4×40).
/// </summary>
public static class TelemetryErrorsRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "telemetry-errors";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "system";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TelemetryErrorsWidget";

    /// <summary>Default footprint: 2 columns × 4 rows (web registry <c>defaultSize</c>).</summary>
    public static TelemetryErrorsSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows (web registry <c>minSize</c>).</summary>
    public static TelemetryErrorsSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows (web registry <c>maxSize</c>).</summary>
    public static TelemetryErrorsSize MaxSize => new(4, 40);

    /// <summary>Localized registry display name (web registry "Telemetry Errors").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.telemetryErrors.title", "Telemetry Errors");
    }

    /// <summary>Localized registry description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.telemetryErrors.description",
            "Fleet Telemetry error monitor: VINs with errors, error types, counts");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(TelemetryErrorsSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static TelemetryErrorsSize Clamp(TelemetryErrorsSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Telemetry Errors surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a VIN, error code or error message —
/// so a diagnostics line can never leak which vehicle or fault was involved. Thread-safe.
/// </summary>
public sealed class TelemetryErrorsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TelemetryErrorsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TelemetryErrorsWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TelemetryErrorsRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TelemetryErrorsWidget"/> view — the native port
/// of the web <c>TelemetryErrorsWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx). It consumes the merged
/// cache-then-network <see cref="ITelemetryErrorsSource"/>, projects each snapshot through
/// <see cref="TelemetryErrorsProjection"/>, and exposes the mutually-exclusive <see cref="State"/> plus the
/// header freshness flags so the view is a thin renderer. Drive it from one confinement (the UI thread); it
/// is not internally synchronised.
/// </summary>
public sealed class TelemetryErrorsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ITelemetryErrorsSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private TelemetryErrorsSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<TelemetryErrorsSnapshot>? _last;
    private bool _disposed;

    private TelemetryErrorsState _state = TelemetryErrorsState.Loading;
    private TelemetryErrorsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    public TelemetryErrorsViewModel(
        ITelemetryErrorsSource source,
        ILocalizer localizer,
        TelemetryErrorsSize size,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = TelemetryErrorsProjection.Project(TelemetryErrorsSnapshot.Empty, _size, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public TelemetryErrorsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the compact hero or the error feed).</summary>
    public TelemetryErrorsDisplay Display
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

    /// <summary>True when the snapshot has data to render (web <c>hasData</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized widget title (web <c>widget.telemetryErrors.title</c>).</summary>
    public string Title => _localizer.GetString("widget.telemetryErrors.title", "Telemetry Errors");

    /// <summary>Localized empty-state message (web <c>widget.telemetryErrors.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.telemetryErrors.noData", "No telemetry error data");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public TelemetryErrorsSize Size
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
    /// visible (otherwise keeps content while refreshing), and folds every merged emission into
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
        _state is TelemetryErrorsState.Loaded or TelemetryErrorsState.Stale or TelemetryErrorsState.Offline;

    private void Apply(RepositoryResult<TelemetryErrorsSnapshot> result)
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
        TelemetryErrorsSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = TelemetryErrorsProjection.Project(snapshot, _size, _localizer, _clock());

        if (!snapshot.HasData)
        {
            SetEmpty(fetchedAt, keepDisplay: true);
            return;
        }

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? TelemetryErrorsState.Offline : stale ? TelemetryErrorsState.Stale : TelemetryErrorsState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last && last.Value is { } snapshot)
        {
            Display = TelemetryErrorsProjection.Project(snapshot, _size, _localizer, _clock());
        }
        else
        {
            Display = TelemetryErrorsProjection.Project(TelemetryErrorsSnapshot.Empty, _size, _localizer, _clock());
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = TelemetryErrorsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt, bool keepDisplay = false)
    {
        if (!keepDisplay)
        {
            Display = TelemetryErrorsProjection.Project(TelemetryErrorsSnapshot.Empty, _size, _localizer, _clock());
        }

        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = TelemetryErrorsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = TelemetryErrorsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.telemetryErrors.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.telemetryErrors.error.offline",
            _ => "widget.telemetryErrors.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view telemetry errors",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached telemetry errors",
            _ => "Couldn't load telemetry errors",
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
