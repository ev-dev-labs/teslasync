using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="DestinationETAViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of location snapshots for the primary (or explicit) vehicle — the native analogue
/// of the web <c>useVehicles</c> + <c>useLocationSnapshotLatest</c> hook composition
/// (web/src/features/dashboard/widgets/DestinationETAWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="DestinationETASource"/> (or a test fake) drives this.
/// </summary>
public interface IDestinationETASource
{
    /// <summary>Stream the cache-then-network location-snapshot readings, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<DestinationETAReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Destination ETA surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/maps.ts (<c>destination-eta</c>). The dashboard grid system binds
/// this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class DestinationETARegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "destination-eta";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "maps";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DestinationETAWidget";

    /// <summary>Default footprint: 2 columns × 2 rows.</summary>
    public static DestinationETASize DefaultSize => new(2, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static DestinationETASize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 3 columns × 40 rows.</summary>
    public static DestinationETASize MaxSize => new(3, 40);

    /// <summary>Localized display name (web registry "Destination ETA").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.destinationETA.title", "Destination ETA");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.destinationETA.description",
            "Active navigation: destination, distance remaining, arrival countdown");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(DestinationETASize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static DestinationETASize Clamp(DestinationETASize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Destination ETA surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a destination name, distance, ETA, presence
/// flag, VIN or vehicle id — so a diagnostics line can never leak fleet data or a user's location. Thread-safe.
/// </summary>
public sealed class DestinationETADiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DestinationETADiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DestinationETAWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DestinationETARegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DestinationETAWidget"/> view — the native port of the
/// web <c>DestinationETAWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/DestinationETAWidget.tsx). It consumes the cache-then-network
/// <see cref="IDestinationETASource"/>, projects each reading through <see cref="DestinationETAProjection"/> with
/// the active units, and exposes the mutually-exclusive <see cref="State"/> plus the freshness flags so the view
/// is a thin renderer. A resolved snapshot always renders (web <c>!snapshot ? empty : …</c>); the engine
/// collapses a body with no snapshot object to <see cref="DestinationETAState.Empty"/>. The footprint
/// (<see cref="Size"/>) is observable because the web branches its layout on it (compact vs standard). Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class DestinationETAViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDestinationETASource _source;
    private readonly ILocalizer _localizer;

    private DestinationETASize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<DestinationETAReading>? _last;
    private bool _disposed;

    private DestinationETAState _state = DestinationETAState.Loading;
    private DestinationETADisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and unit preference.</summary>
    /// <param name="source">The cache-then-network location-snapshot source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint; the web chooses a compact vs standard layout from it.</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    public DestinationETAViewModel(
        IDestinationETASource source,
        ILocalizer localizer,
        DestinationETASize size,
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
    public DestinationETAState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready destination-ETA model (null until a state resolves).</summary>
    public DestinationETADisplay? Display
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

    /// <summary>True when a snapshot has resolved and the body is renderable (web <c>snapshot</c> truthy).</summary>
    public bool HasReading => _display is not null;

    /// <summary>Localized widget title (web <c>widget.destinationETA.title</c> "Destination ETA").</summary>
    public string Title => _localizer.GetString("widget.destinationETA.title", "Destination ETA");

    /// <summary>Localized empty-state message (web <c>widget.destinationETA.noData</c> "No location data").</summary>
    public string EmptyMessage => _localizer.GetString("widget.destinationETA.noData", "No location data");

    /// <summary>True at the compact footprint (web <c>size.cols &lt;= 1</c>) — the view drops the title and uses the compact body.</summary>
    public bool IsCompact => _size.IsCompact;

    /// <summary>The widget footprint. Reassigning re-renders because the web layout branches on the column span.</summary>
    public DestinationETASize Size
    {
        get => _size;
        set
        {
            if (_size == value)
            {
                return;
            }

            bool compactChanged = _size.IsCompact != value.IsCompact;
            _size = value;
            Raise(nameof(Size));
            if (compactChanged)
            {
                Raise(nameof(IsCompact));
            }
        }
    }

    /// <summary>The user's unit preference; reassigning re-projects the remaining distance in the new units.</summary>
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
        _state is DestinationETAState.Loaded or DestinationETAState.Stale or DestinationETAState.Offline;

    private void Apply(RepositoryResult<DestinationETAReading> result)
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
        DestinationETAReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = DestinationETAProjection.Project(reading, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? DestinationETAState.Offline
            : stale ? DestinationETAState.Stale : DestinationETAState.Loaded;
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
        State = DestinationETAState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = DestinationETAState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = DestinationETAState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.destinationETA.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.destinationETA.error.offline",
            _ => "widget.destinationETA.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view navigation",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached route",
            _ => "Couldn't load destination ETA",
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
