using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state the Service Health surface can be in. Every branch maps onto a visible surface — none
/// is ever hidden (engineering rule #6). The web shows <c>Skeleton → MetricCards + DataTable | empty text</c>;
/// the native surface additionally renders an explicit <c>error</c> (retry) and <c>offline</c> branch (a
/// strict superset of the web that satisfies the prompt's mandated state set).
/// </summary>
public enum ServiceHealthSectionState
{
    /// <summary>First fetch with nothing cached — render the skeleton.</summary>
    Loading,

    /// <summary>A fresh (network or non-stale cache) telemetry snapshot with content to show.</summary>
    Loaded,

    /// <summary>The read resolved with no telemetry body — the friendly empty surface.</summary>
    Empty,

    /// <summary>The read failed and no cached snapshot exists — the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ServiceHealthSection"/> view — the native port of
/// the web component's hook composition
/// (web/src/features/system/components/status/ServiceHealthSection.tsx). It drives the single
/// cache-then-network telemetry-status read through the <see cref="IServiceHealthSource"/> (web
/// <c>useQuery(getTelemetryStatus)</c>), projects it through <see cref="ServiceHealthProjection"/>, and
/// exposes the section state + freshness + localized copy so the view is a thin renderer. The web's
/// <c>refetchInterval: 2_000</c> is realised by the view re-invoking <see cref="RefreshAsync"/> on a timer.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ServiceHealthViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IServiceHealthSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private ServiceHealthSnapshot? _snapshot;
    private bool _disposed;

    private ServiceHealthSectionState _state = ServiceHealthSectionState.Loading;
    private ServiceHealthDisplay _display = ServiceHealthDisplay.Empty;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isRefreshing;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) clock.</summary>
    public ServiceHealthViewModel(IServiceHealthSource source, ILocalizer localizer, Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── State ────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The section's lifecycle state.</summary>
    public ServiceHealthSectionState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected display (header badges, metric tiles, vehicle rows).</summary>
    public ServiceHealthDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>Last successful update timestamp (drives the freshness chip).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last read failed (drives the offline/error chip).</summary>
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

    /// <summary>Localized error message for the section (null when not errored).</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Load attempts (including retries) — surfaced to the query-error affordance.</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when the header badges should render (web <c>data ? … : undefined</c>).</summary>
    public bool HasBadges => _snapshot is not null;

    // ── Localized copy (web t(...) keys) ───────────────────────────────────────────────────────────

    /// <summary>Accordion title.</summary>
    public string Title => _localizer.GetString(ServiceHealthCopy.TitleKey, ServiceHealthCopy.Title);

    /// <summary>Accordion description.</summary>
    public string Description => _localizer.GetString(ServiceHealthCopy.DescriptionKey, ServiceHealthCopy.Description);

    /// <summary>"Mode" metric label.</summary>
    public string ModeLabel => _localizer.GetString(ServiceHealthCopy.MetricModeKey, ServiceHealthCopy.MetricMode);

    /// <summary>"Vehicles Connected" metric label.</summary>
    public string VehiclesConnectedLabel =>
        _localizer.GetString(ServiceHealthCopy.MetricVehiclesConnectedKey, ServiceHealthCopy.MetricVehiclesConnected);

    /// <summary>"Total Signals" metric label.</summary>
    public string TotalSignalsLabel =>
        _localizer.GetString(ServiceHealthCopy.MetricTotalSignalsKey, ServiceHealthCopy.MetricTotalSignals);

    /// <summary>"Avg Signals/s" metric label.</summary>
    public string AvgSignalsLabel =>
        _localizer.GetString(ServiceHealthCopy.MetricAvgSignalsKey, ServiceHealthCopy.MetricAvgSignals);

    /// <summary>"VIN" column header.</summary>
    public string VinHeader => _localizer.GetString(ServiceHealthCopy.ColVinKey, ServiceHealthCopy.ColVin);

    /// <summary>"Status" column header.</summary>
    public string StatusHeader => _localizer.GetString(ServiceHealthCopy.ColStatusKey, ServiceHealthCopy.ColStatus);

    /// <summary>"Signals" column header.</summary>
    public string SignalsHeader => _localizer.GetString(ServiceHealthCopy.ColSignalsKey, ServiceHealthCopy.ColSignals);

    /// <summary>"Signals/s" column header.</summary>
    public string SignalsPerSecondHeader =>
        _localizer.GetString(ServiceHealthCopy.ColSignalsPerSecondKey, ServiceHealthCopy.ColSignalsPerSecond);

    /// <summary>"Latency" column header.</summary>
    public string LatencyHeader => _localizer.GetString(ServiceHealthCopy.ColLatencyKey, ServiceHealthCopy.ColLatency);

    /// <summary>"Last Received" column header.</summary>
    public string LastReceivedHeader =>
        _localizer.GetString(ServiceHealthCopy.ColLastReceivedKey, ServiceHealthCopy.ColLastReceived);

    /// <summary>Section-empty message (web <c>t('No telemetry data available')</c>).</summary>
    public string NoDataMessage => _localizer.GetString(ServiceHealthCopy.NoDataKey, ServiceHealthCopy.NoData);

    /// <summary>Vehicles-table empty message (web <c>t('No vehicles connected')</c>).</summary>
    public string NoVehiclesMessage => _localizer.GetString(ServiceHealthCopy.NoVehiclesKey, ServiceHealthCopy.NoVehicles);

    /// <summary>Loading announcement for assistive tech.</summary>
    public string LoadingLabel => _localizer.GetString(ServiceHealthCopy.LoadingKey, ServiceHealthCopy.Loading);

    /// <summary>Retry affordance label.</summary>
    public string RetryLabel => _localizer.GetString(ServiceHealthCopy.RetryKey, ServiceHealthCopy.Retry);

    /// <summary>Default hard-error message.</summary>
    public string ErrorMessageDefault => _localizer.GetString(ServiceHealthCopy.ErrorKey, ServiceHealthCopy.Error);

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network telemetry-status load.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;
        if (_snapshot is null)
        {
            State = ServiceHealthSectionState.Loading;
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

    /// <summary>
    /// Re-run the load (web <c>refetchInterval</c> tick / manual refresh). The poll is a no-op while a
    /// refresh is already in flight so overlapping ticks never stack.
    /// </summary>
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_isRefreshing)
        {
            return;
        }

        _isRefreshing = true;
        try
        {
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _isRefreshing = false;
        }
    }

    /// <summary>Retry the section after a failure (web <c>refetch()</c> from the QueryError affordance).</summary>
    public Task RetryAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _cts);
        GC.SuppressFinalize(this);
    }

    // ── Internals ────────────────────────────────────────────────────────────────────────────────────

    private void Apply(RepositoryResult<ServiceHealthSnapshot> result)
    {
        _snapshot = NextSnapshot(result, _snapshot);
        Display = _snapshot is null
            ? ServiceHealthDisplay.Empty
            : ServiceHealthProjection.Project(_snapshot, _localizer, _clock());
        Raise(nameof(HasBadges));

        var outcome = Classify(result, _snapshot is not null);
        State = outcome.State;
        IsFetching = outcome.IsFetching;
        IsError = outcome.IsError;
        IsStale = outcome.IsStale;
        ErrorMessage = outcome.ErrorMessage;
        if (outcome.UpdatedAt is { } ts)
        {
            UpdatedAt = ts;
        }
    }

    private SectionOutcome Classify(RepositoryResult<ServiceHealthSnapshot> result, bool hasContent) =>
        result.Status switch
        {
            LoadStatus.Loading => hasContent
                ? new SectionOutcome(ServiceHealthSectionState.Loaded, true, false, false, null, null)
                : new SectionOutcome(ServiceHealthSectionState.Loading, true, false, false, null, null),

            LoadStatus.Cached => hasContent
                ? new SectionOutcome(StaleOrLoaded(result.IsStale), true, false, result.IsStale, null, result.FetchedAt)
                : new SectionOutcome(ServiceHealthSectionState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Refreshing => hasContent
                ? new SectionOutcome(StaleOrLoaded(result.IsStale), true, false, result.IsStale, null, result.FetchedAt)
                : new SectionOutcome(ServiceHealthSectionState.Empty, true, false, false, null, result.FetchedAt),

            LoadStatus.Loaded => hasContent
                ? new SectionOutcome(ServiceHealthSectionState.Loaded, false, false, false, null, result.FetchedAt)
                : new SectionOutcome(ServiceHealthSectionState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new SectionOutcome(
                ServiceHealthSectionState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasContent
                ? new SectionOutcome(ServiceHealthSectionState.Offline, false, true, true, ErrorTextFor(result.Error), result.FetchedAt)
                : new SectionOutcome(ServiceHealthSectionState.Error, false, true, false, ErrorTextFor(result.Error), result.FetchedAt),

            _ => new SectionOutcome(
                ServiceHealthSectionState.Error, false, true, false, ErrorTextFor(result.Error), null),
        };

    private static ServiceHealthSectionState StaleOrLoaded(bool stale) =>
        stale ? ServiceHealthSectionState.Stale : ServiceHealthSectionState.Loaded;

    private static ServiceHealthSnapshot? NextSnapshot(
        RepositoryResult<ServiceHealthSnapshot> result,
        ServiceHealthSnapshot? previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                       // transient — keep prior content visible
            LoadStatus.Empty or LoadStatus.Error => null,         // resolved with nothing to show
            _ => result.Value ?? previous,                        // cached / refreshing / loaded / offline carry a snapshot
        };

    private string ErrorTextFor(RepositoryError? error)
    {
        var (key, fallback) = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => (ServiceHealthCopy.AuthKey, ServiceHealthCopy.Auth),
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => (ServiceHealthCopy.OfflineKey, ServiceHealthCopy.Offline),
            _ => (ServiceHealthCopy.ErrorKey, ServiceHealthCopy.Error),
        };

        return _localizer.GetString(key, fallback);
    }

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? slot, CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref slot, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private static void Cancel(ref CancellationTokenSource? slot)
    {
        var cts = Interlocked.Exchange(ref slot, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    private readonly record struct SectionOutcome(
        ServiceHealthSectionState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
