using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// Canonical registry metadata for the Charge Session Chart surface — the native mirror of the web
/// registry entry in web/src/features/dashboard/widgets/registry/charging.ts
/// (<c>charge-session-chart</c>). The dashboard grid system binds this surface with the same
/// <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class ChargeSessionChartRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "charge-session-chart";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChargeSessionChartWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static ChargeSessionChartSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static ChargeSessionChartSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static ChargeSessionChartSize MaxSize => new(4, 40);

    /// <summary>Localized registry display name (web registry "Charge Session Chart").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.chargeSessionChart.name", "Charge Session Chart");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.chargeSessionChart.description",
            "Bar chart of recent charge sessions: energy per session, color-coded by charger type (home/SC/destination)");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(ChargeSessionChartSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static ChargeSessionChartSize Clamp(ChargeSessionChartSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Charge Session Chart surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a kWh figure, session count,
/// charger type, VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class ChargeSessionChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChargeSessionChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargeSessionChartWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargeSessionChartRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ChargeSessionChartWidget"/> view — the native
/// port of the web <c>ChargeSessionChartWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/ChargeSessionChartWidget.tsx). It consumes the cache-then-network
/// <see cref="IChargeSessionChartSource"/>, applies the web <c>hasData</c> gate (a list with no charging
/// sessions renders the friendly empty state, mirroring <c>WidgetChartSummary isEmpty</c>), projects the
/// rest through <see cref="ChargeSessionChartProjection"/>, and exposes the mutually-exclusive
/// <see cref="State"/> plus the header freshness flags so the view is a thin renderer. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ChargeSessionChartViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IChargeSessionChartSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private ChargeSessionChartSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>? _last;
    private bool _disposed;

    private ChargeSessionChartState _state = ChargeSessionChartState.Loading;
    private ChargeSessionChartDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and clock.</summary>
    /// <param name="source">The cache-then-network charging-session source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (drives the compact branch).</param>
    /// <param name="clock">The reference clock for date labels; defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public ChargeSessionChartViewModel(
        IChargeSessionChartSource source,
        ILocalizer localizer,
        ChargeSessionChartSize size,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = ChargeSessionChartProjection.Project(
            Array.Empty<ChargeSessionChartSession>(), _size, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public ChargeSessionChartState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (stats + bars + legend).</summary>
    public ChargeSessionChartDisplay Display
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

    /// <summary>Localized widget header title (web <c>widget.chargeSessionChart.title</c> "Charge Sessions").</summary>
    public string Title => _localizer.GetString("widget.chargeSessionChart.title", "Charge Sessions");

    /// <summary>Localized empty-state message (web <c>widget.chargeSessionChart.empty</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.chargeSessionChart.empty", "No charge sessions yet");

    /// <summary>The widget footprint; reassigning re-projects the current list for the new layout.</summary>
    public ChargeSessionChartSize Size
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
        _state is ChargeSessionChartState.Loaded or ChargeSessionChartState.Stale or ChargeSessionChartState.Offline;

    private void Apply(RepositoryResult<IReadOnlyList<ChargeSessionChartSession>> result)
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
        IReadOnlyList<ChargeSessionChartSession> sessions,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = ChargeSessionChartProjection.Project(sessions, _size, _localizer, _clock());

        // Web parity: WidgetChartSummary's isEmpty gate — no sessions renders the empty state regardless of
        // freshness.
        if (!display.HasData)
        {
            SetEmpty(fetchedAt);
            return;
        }

        Display = display;
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? ChargeSessionChartState.Offline
            : stale ? ChargeSessionChartState.Stale : ChargeSessionChartState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = ChargeSessionChartProjection.Project(
                Array.Empty<ChargeSessionChartSession>(), _size, _localizer, _clock());
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = ChargeSessionChartState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = ChargeSessionChartProjection.Project(
            Array.Empty<ChargeSessionChartSession>(), _size, _localizer, _clock());
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = ChargeSessionChartState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = ChargeSessionChartState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.chargeSessionChart.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.chargeSessionChart.error.offline",
            _ => "widget.chargeSessionChart.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view charge sessions",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached charge sessions",
            _ => "Couldn't load charge sessions",
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
