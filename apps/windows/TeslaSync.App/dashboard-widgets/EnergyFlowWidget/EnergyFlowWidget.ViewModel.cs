using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="EnergyFlowViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of energy-flow snapshots for the primary (or explicit) vehicle — the native
/// analogue of the web <c>useVehicles</c> + <c>useVehicleState</c> hook composition
/// (web/src/features/dashboard/widgets/EnergyFlowWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="EnergyFlowSource"/> (or a test fake) drives this.
/// </summary>
public interface IEnergyFlowSource
{
    /// <summary>Stream the cache-then-network energy-flow snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<EnergyFlowSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Energy Flow surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/battery.ts (<c>energy-flow</c>). The dashboard grid system binds
/// this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class EnergyFlowRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "energy-flow";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "battery";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "EnergyFlowWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static EnergyFlowSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 2 columns × 4 rows.</summary>
    public static EnergyFlowSize MinSize => new(2, 4);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static EnergyFlowSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Energy Flow").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.energyFlow.name", "Energy Flow");
    }

    /// <summary>Localized description (web registry "Live power flow diagram").</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.energyFlow.description", "Live power flow diagram");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(EnergyFlowSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static EnergyFlowSize Clamp(EnergyFlowSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Energy Flow surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a power/energy figure, charger power, battery percent,
/// VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class EnergyFlowDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public EnergyFlowDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EnergyFlowWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EnergyFlowRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="EnergyFlowWidget"/> view — the native port of the
/// web <c>EnergyFlowWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/EnergyFlowWidget.tsx). It consumes the cache-then-network
/// <see cref="IEnergyFlowSource"/>, projects each snapshot through <see cref="EnergyFlowProjection"/>, and
/// exposes the mutually-exclusive <see cref="State"/> plus the header freshness flags so the view is a thin
/// renderer. A surface with a resolved state always renders the flow diagram (web <c>state ? … : empty</c>);
/// the engine collapses a stateless response to <see cref="EnergyFlowState.Empty"/>. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class EnergyFlowViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IEnergyFlowSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private EnergyFlowState _state = EnergyFlowState.Loading;
    private EnergyFlowDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source and localizer.</summary>
    /// <param name="source">The cache-then-network energy-flow source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public EnergyFlowViewModel(IEnergyFlowSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public EnergyFlowState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready flow-diagram model (null until a state resolves).</summary>
    public EnergyFlowDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasState));
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

    /// <summary>True when a vehicle state has resolved and the diagram is renderable (web <c>state</c> truthy).</summary>
    public bool HasState => _display is not null;

    /// <summary>Localized widget title (web <c>widget.energyFlow</c> "Energy Flow").</summary>
    public string Title => _localizer.GetString("widget.energyFlow", "Energy Flow");

    /// <summary>Localized empty-state message (web <c>widget.noEnergyData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noEnergyData", "No energy data available");

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps the diagram while refreshing), and folds every emission into
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
        _state is EnergyFlowState.Loaded or EnergyFlowState.Stale or EnergyFlowState.Offline;

    private void Apply(RepositoryResult<EnergyFlowSnapshot> result)
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
        EnergyFlowSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = EnergyFlowProjection.Project(snapshot, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? EnergyFlowState.Offline
            : stale ? EnergyFlowState.Stale : EnergyFlowState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = EnergyFlowState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = EnergyFlowState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = EnergyFlowState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.energyFlow.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.energyFlow.error.offline",
            _ => "widget.energyFlow.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view energy flow",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached energy flow",
            _ => "Couldn't load energy flow",
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
