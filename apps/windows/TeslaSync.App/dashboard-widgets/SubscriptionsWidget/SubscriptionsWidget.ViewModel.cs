using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="SubscriptionsViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed <see cref="SubscriptionsSnapshot"/> values — the native analogue of
/// the web component's <c>useVehicles</c> + <c>useVehicleSubscriptions</c> hook composition
/// (web/src/features/dashboard/widgets/SubscriptionsWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="SubscriptionsSource"/> (or a test fake) drives this.
/// </summary>
public interface ISubscriptionsSource
{
    /// <summary>Stream the cache-then-network subscription snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<SubscriptionsSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Subscriptions surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/vehicle.ts (id <c>subscriptions</c>, category <c>vehicle</c>).
/// The dashboard grid system binds this surface with the same <see cref="Id"/> and honours the same size
/// constraints. The generated OpenAPI operation id is centralized here so a single test asserts it resolves
/// against the generated endpoint table (catching contract drift at build/test time rather than at runtime).
/// </summary>
public static class SubscriptionsRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "subscriptions";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "vehicle";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SubscriptionsWidget";

    /// <summary>Generated operation id for the subscriptions read (web <c>useVehicleSubscriptions</c>).</summary>
    public const string SubscriptionsOperationId = "get_api_v1_vehicles_vehicleID_subscriptions";

    /// <summary>Path-parameter name in the subscriptions endpoint template.</summary>
    public const string VehiclePathParam = "vehicleID";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static SubscriptionsSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static SubscriptionsSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static SubscriptionsSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Subscriptions").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.subscriptions.title", "Subscriptions");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.subscriptions.description",
            "Tesla subscriptions: Premium Connectivity, FSD, expiry dates, renewal");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(SubscriptionsSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static SubscriptionsSize Clamp(SubscriptionsSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Subscriptions surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a subscription name, expiry date,
/// renewal type or vehicle id — so a diagnostics line can never leak which Tesla services an owner pays for.
/// Thread-safe.
/// </summary>
public sealed class SubscriptionsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SubscriptionsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SubscriptionsWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SubscriptionsRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SubscriptionsWidget"/> view — the native port of
/// the web component's hook composition (web/src/features/dashboard/widgets/SubscriptionsWidget.tsx). It
/// consumes the cache-then-network <see cref="ISubscriptionsSource"/>, projects each snapshot through
/// <see cref="SubscriptionsProjection"/> with an injected clock (so the countdown / active flags are
/// deterministic in tests), and exposes the mutually-exclusive <see cref="State"/> plus the freshness flags
/// so the view is a thin renderer. A surface whose parsed list is empty renders the single "No subscriptions"
/// empty surface (web's empty <c>WidgetDetailCard</c> / compact <c>EmptyState</c>). Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SubscriptionsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISubscriptionsSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _now;

    private SubscriptionsSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<SubscriptionsSnapshot>? _last;
    private bool _disposed;

    private SubscriptionsState _state = SubscriptionsState.Loading;
    private SubscriptionsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    /// <param name="source">The cache-then-network subscriptions source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact summary branch).</param>
    /// <param name="now">Clock for the countdown / active projection; defaults to <see cref="DateTimeOffset.UtcNow"/>.</param>
    public SubscriptionsViewModel(
        ISubscriptionsSource source,
        ILocalizer localizer,
        SubscriptionsSize size,
        Func<DateTimeOffset>? now = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _now = now ?? (() => DateTimeOffset.UtcNow);
        _display = SubscriptionsProjection.Project(SubscriptionsSnapshot.None, _size, _now(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public SubscriptionsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (entries + compact summary).</summary>
    public SubscriptionsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasSubscriptions));
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

    /// <summary>True when at least one subscription parsed (web <c>parsed.length &gt; 0</c>).</summary>
    public bool HasSubscriptions => _display.HasSubscriptions;

    /// <summary>Localized widget title (web registry "Subscriptions").</summary>
    public string Title => _localizer.GetString("widget.subscriptions.title", "Subscriptions");

    /// <summary>Localized empty-state message (web <c>widget.subscriptions.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.subscriptions.noData", "No subscriptions");

    /// <summary>Localized "active" caption shown under the compact active count.</summary>
    public string ActiveCountLabel => _localizer.GetString("widget.subscriptions.activeCount", "active");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public SubscriptionsSize Size
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

    /// <summary>Retry after a failure (or refresh on demand) — re-runs the load from the top.</summary>
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
        _state is SubscriptionsState.Loaded
            or SubscriptionsState.Empty
            or SubscriptionsState.Stale
            or SubscriptionsState.Offline;

    private void Apply(RepositoryResult<SubscriptionsSnapshot> result)
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
        SubscriptionsSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = SubscriptionsProjection.Project(snapshot, _size, _now(), _localizer);

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // Web parity: the single empty surface ("No subscriptions") shows whenever the parsed list is empty.
        // Offline / stale freshness take precedence for the header chip; the body still renders the right
        // empty/content via Display.
        State = offline
            ? SubscriptionsState.Offline
            : stale
                ? SubscriptionsState.Stale
                : Display.HasSubscriptions
                    ? SubscriptionsState.Loaded
                    : SubscriptionsState.Empty;
    }

    private void Reproject()
    {
        if (_last is { } last && last.Status is not LoadStatus.Loading and not LoadStatus.Error)
        {
            Apply(last);
        }
        else
        {
            Display = SubscriptionsProjection.Project(SubscriptionsSnapshot.None, _size, _now(), _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = SubscriptionsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = SubscriptionsProjection.Project(SubscriptionsSnapshot.None, _size, _now(), _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = SubscriptionsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = SubscriptionsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.subscriptions.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.subscriptions.error.offline",
            _ => "widget.subscriptions.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view subscriptions",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached subscriptions",
            _ => "Couldn't load subscriptions",
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
