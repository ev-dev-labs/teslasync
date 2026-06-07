using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// Canonical registry metadata for the Charging Session Detail surface — the native mirror of the web
/// registry entry in web/src/features/dashboard/widgets/registry/charging.ts
/// (<c>charging-session-detail</c>). The dashboard grid system binds this surface with the same
/// <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class ChargingSessionDetailRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "charging-session-detail";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChargingSessionDetailWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static ChargingSessionDetailSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static ChargingSessionDetailSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static ChargingSessionDetailSize MaxSize => new(4, 40);

    /// <summary>Localized registry display name (web registry "Charge Session Detail").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.chargingSessionDetail.name", "Charge Session Detail");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.chargingSessionDetail.description",
            "Last charge session power curve with SoC overlay, kWh added, peak power");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(ChargingSessionDetailSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static ChargingSessionDetailSize Clamp(ChargingSessionDetailSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Charging Session Detail surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a kWh figure, peak power, charger
/// type, session id, VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class ChargingSessionDetailDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChargingSessionDetailDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargingSessionDetailWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargingSessionDetailRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ChargingSessionDetailWidget"/> view — the
/// native port of the web <c>ChargingSessionDetailWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/ChargingSessionDetailWidget.tsx). It consumes the cache-then-network
/// <see cref="IChargingSessionDetailSource"/> (whose mapper already applies the web <c>!detail</c> empty
/// gate), projects each snapshot through <see cref="ChargingSessionDetailProjection"/>, and exposes the
/// mutually-exclusive <see cref="State"/> plus the header freshness flags so the view is a thin renderer.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ChargingSessionDetailViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IChargingSessionDetailSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private ChargingSessionDetailSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<ChargingSessionDetailSnapshot>? _last;
    private bool _disposed;

    private ChargingSessionDetailState _state = ChargingSessionDetailState.Loading;
    private ChargingSessionDetailDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and clock.</summary>
    /// <param name="source">The cache-then-network session-detail source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (drives the compact branch).</param>
    /// <param name="clock">The reference clock for date labels; defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public ChargingSessionDetailViewModel(
        IChargingSessionDetailSource source,
        ILocalizer localizer,
        ChargingSessionDetailSize size,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = ChargingSessionDetailProjection.Empty(_size, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public ChargingSessionDetailState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (compact fields + stats + chart).</summary>
    public ChargingSessionDetailDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
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

    /// <summary>Localized widget header title (web <c>widget.chargingSessionDetail.title</c>).</summary>
    public string Title => _localizer.GetString("widget.chargingSessionDetail.title", "Charge Session Detail");

    /// <summary>Localized empty-state message (web <c>widget.chargingSessionDetail.empty</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.chargingSessionDetail.empty", "No charge sessions");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public ChargingSessionDetailSize Size
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
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Display"/>. A superseding load cancels the prior one.
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
        _state is ChargingSessionDetailState.Loaded or ChargingSessionDetailState.Stale or ChargingSessionDetailState.Offline;

    private void Apply(RepositoryResult<ChargingSessionDetailSnapshot> result)
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
        ChargingSessionDetailSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = ChargingSessionDetailProjection.Project(snapshot, _size, _localizer, _clock());
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? ChargingSessionDetailState.Offline
            : stale ? ChargingSessionDetailState.Stale : ChargingSessionDetailState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = ChargingSessionDetailProjection.Empty(_size, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = ChargingSessionDetailState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = ChargingSessionDetailProjection.Empty(_size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = ChargingSessionDetailState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = ChargingSessionDetailState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.chargingSessionDetail.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.chargingSessionDetail.error.offline",
            _ => "widget.chargingSessionDetail.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view charge sessions",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached charge session",
            _ => "Couldn't load the charge session",
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
