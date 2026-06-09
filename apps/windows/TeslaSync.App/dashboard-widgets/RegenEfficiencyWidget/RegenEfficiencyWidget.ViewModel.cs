using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="RegenEfficiencyViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed regen summaries for <c>GET /analytics/regen?vehicle_id={id}</c> — the
/// native analogue of the web <c>useVehicles</c> + <c>useRegenEfficiency</c> hook composition (vehicle
/// resolution included). The view never performs HTTP itself; the concrete <see cref="RegenEfficiencySource"/>
/// (or a test fake) drives this.
/// </summary>
public interface IRegenEfficiencySource
{
    /// <summary>Stream the cache-then-network regen snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<RegenEfficiencyData>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Regen Braking surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/driving.ts (<c>regen-efficiency</c>). The dashboard grid system
/// binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class RegenEfficiencyRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "regen-efficiency";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "driving";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "RegenEfficiencyWidget";

    /// <summary>Default footprint: 1 column × 2 rows.</summary>
    public static RegenEfficiencySize DefaultSize => new(1, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static RegenEfficiencySize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 3 columns × 40 rows.</summary>
    public static RegenEfficiencySize MaxSize => new(3, 40);

    /// <summary>Localized display name (web registry "Regen Braking").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.regenEfficiency.title", "Regen Braking");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.regenEfficiency.description",
            "Regenerative braking recovery rate, total kWh recovered, max regen power");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(RegenEfficiencySize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static RegenEfficiencySize Clamp(RegenEfficiencySize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Regen Braking surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a regen value, VIN or vehicle id — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class RegenEfficiencyDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public RegenEfficiencyDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RegenEfficiencyWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RegenEfficiencyRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RegenEfficiencyWidget"/> view — the native port of
/// the web <c>RegenEfficiencyWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx). It consumes the cache-then-network
/// <see cref="IRegenEfficiencySource"/>, projects each summary through <see cref="RegenEfficiencyProjection"/>
/// (in the user's <see cref="UnitPref"/>), and exposes the mutually-exclusive <see cref="State"/> plus the
/// header freshness flags so the view is a thin renderer. A surface with a resolved summary always renders the
/// gauge (web <c>data ? gauge : empty</c>); the engine collapses a non-object response to
/// <see cref="RegenEfficiencyState.Empty"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class RegenEfficiencyViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IRegenEfficiencySource _source;
    private readonly ILocalizer _localizer;

    private RegenEfficiencySize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<RegenEfficiencyData>? _last;
    private bool _disposed;

    private RegenEfficiencyState _state = RegenEfficiencyState.Loading;
    private RegenEfficiencyDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and unit preference.</summary>
    public RegenEfficiencyViewModel(
        IRegenEfficiencySource source,
        ILocalizer localizer,
        RegenEfficiencySize size,
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
    public RegenEfficiencyState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready gauge model (null until a summary resolves).</summary>
    public RegenEfficiencyDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
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

    /// <summary>True when a summary has resolved and the gauge is renderable (web <c>data</c> truthy).</summary>
    public bool HasData => _display is not null;

    /// <summary>Localized widget title (web <c>widget.regenEfficiency.title</c>, "Regen Braking").</summary>
    public string Title => _localizer.GetString("widget.regenEfficiency.title", "Regen Braking");

    /// <summary>Localized empty-state message (web <c>widget.regenEfficiency.noData</c>, "No regen data").</summary>
    public string EmptyMessage => _localizer.GetString("widget.regenEfficiency.noData", "No regen data");

    /// <summary>Localized help body shown in the title-row help tooltip (web <c>help.regenEfficiency.body</c>).</summary>
    public string HelpText => _localizer.GetString(
        "help.regenEfficiency.body",
        "Energy recovered through regenerative braking divided by total energy used during driving. Higher is better — Tesla cars typically reach 15–30% recovery in mixed driving.");

    /// <summary>The widget footprint; reassigning re-projects the current summary for the new layout.</summary>
    public RegenEfficiencySize Size
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

    /// <summary>The user's unit preference; reassigning re-projects the current summary in the new units.</summary>
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
    /// visible (otherwise keeps the gauge while refreshing), and folds every emission into <see cref="State"/>
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
        _state is RegenEfficiencyState.Loaded or RegenEfficiencyState.Stale or RegenEfficiencyState.Offline;

    private void Apply(RepositoryResult<RegenEfficiencyData> result)
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
                ApplyData(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyData(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyData(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyData(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyData(
        RegenEfficiencyData data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = RegenEfficiencyProjection.Project(data, _size, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? RegenEfficiencyState.Offline : stale ? RegenEfficiencyState.Stale : RegenEfficiencyState.Loaded;
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
        State = RegenEfficiencyState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = RegenEfficiencyState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = RegenEfficiencyState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.regenEfficiency.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.regenEfficiency.error.offline",
            _ => "widget.regenEfficiency.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view regen data",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached regen data",
            _ => "Couldn't load regen data",
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
