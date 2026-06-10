using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RegionSettings"/> view — the native port of the web
/// component's hook composition (web/src/features/settings/components/RegionSettings.tsx). It drives the
/// cache-then-network region read through the <see cref="IRegionSettingsSource"/> (web
/// <c>useTeslaUserRegion</c>) to compute the surface state, runs the "Refresh" mutation (web
/// <c>useRefreshTeslaRegion</c>) and exposes a transient post-refresh notice (the native analogue of the web
/// toast). The view is a thin renderer that reflects the exposed state, labels, values and freshness. The web
/// component is purely presentational; this holder is the native equivalent so the surface logic is verified
/// without a UI host. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class RegionSettingsViewModel : INotifyPropertyChanged, IDisposable
{
    /// <summary>Em-dash fallback for a missing value (web <c>?? '—'</c>).</summary>
    private const string EmDash = "\u2014";

    private readonly IRegionSettingsSource _source;
    private readonly ILocalizer _localizer;
    private readonly RegionSettingsDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _regionCts;
    private RegionConfig _config = RegionConfig.Empty;
    private bool _disposed;

    private RegionSettingsSurfaceState _state = RegionSettingsSurfaceState.Loading;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isRefreshing;
    private DateTimeOffset? _updatedAt;
    private int _attempts;
    private RegionRefreshNotice? _refreshNotice;

    /// <summary>Creates the holder over its data source, localizer, diagnostics and (optional) clock.</summary>
    public RegionSettingsViewModel(
        IRegionSettingsSource source,
        ILocalizer localizer,
        RegionSettingsDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new RegionSettingsDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Composed surface state ───────────────────────────────────────────────────────────────────────

    /// <summary>The effective top-level state the view renders (always one visible surface).</summary>
    public RegionSettingsSurfaceState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The current region snapshot the view renders (never null — <see cref="RegionConfig.Empty"/>).</summary>
    public RegionConfig Config
    {
        get => _config;
        private set
        {
            if (!Equals(_config, value))
            {
                _config = value;
                Raise(nameof(Config));
                RaiseValues();
            }
        }
    }

    /// <summary>Last successful region-fetch timestamp (drives the freshness chip).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background region (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the region read failed (hard error or offline).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown region is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True while the "Refresh" mutation + reload runs (drives the button busy ring).</summary>
    public bool IsRefreshing
    {
        get => _isRefreshing;
        private set
        {
            if (Set(ref _isRefreshing, value))
            {
                Raise(nameof(IsRefreshEnabled));
            }
        }
    }

    /// <summary>Region load attempts so far (including retries) — drives the query-error "tried N times" copy.</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when the refresh action can be invoked (web parity: disabled while the mutation is pending).</summary>
    public bool IsRefreshEnabled => !_isRefreshing;

    /// <summary>
    /// The transient post-refresh notice (success / failure), or null before any refresh resolves — the native
    /// analogue of the web toast. The view announces it through an assertive live region.
    /// </summary>
    public RegionRefreshNotice? RefreshNotice
    {
        get => _refreshNotice;
        private set => Set(ref _refreshNotice, value);
    }

    // ── Values (web data.region / data.fleet_api_base_url / fetched_at) ───────────────────────────────

    /// <summary>The region code shown in the first card (web <c>data.region</c>), em-dash when absent.</summary>
    public string RegionValue => _config.HasRegion ? _config.Region! : EmDash;

    /// <summary>The Fleet API base URL shown in the second card (web <c>data.fleet_api_base_url ?? '—'</c>).</summary>
    public string FleetApiUrlValue =>
        string.IsNullOrWhiteSpace(_config.FleetApiBaseUrl) ? EmDash : _config.FleetApiBaseUrl!;

    /// <summary>True when the envelope carries a sync time (web <c>regionConfig?.fetched_at</c> guard).</summary>
    public bool HasSyncTime => _config.HasSyncTime;

    /// <summary>The "Synced {time}" caption (web <c>{lastSynced} {formatDateTime(fetched_at)}</c>), or null.</summary>
    public string? SyncedLabel => _config.HasSyncTime
        ? $"{RegionSettingsRegistration.LastSynced(_localizer)} {FormattedSyncTime}"
        : null;

    private string FormattedSyncTime =>
        DateTimeFormatting.Format(_config.SyncedAt, DateTimeVariant.Full, _clock());

    // ── Localized copy (web t(...) keys) ─────────────────────────────────────────────────────────────

    /// <summary>Panel title (web <c>region.title</c>) — also the surface's accessible name.</summary>
    public string Title => RegionSettingsRegistration.Title(_localizer);

    /// <summary>Panel subtitle (web <c>region.subtitle</c>).</summary>
    public string Subtitle => RegionSettingsRegistration.Subtitle(_localizer);

    /// <summary>Refresh button label (web <c>region.refresh</c>).</summary>
    public string RefreshLabel => RegionSettingsRegistration.Refresh(_localizer);

    /// <summary>"Region" card label (web <c>region.regionCode</c>).</summary>
    public string RegionCodeLabel => RegionSettingsRegistration.RegionCode(_localizer);

    /// <summary>"Fleet API Base URL" card label (web <c>region.fleetApiUrl</c>).</summary>
    public string FleetApiUrlLabel => RegionSettingsRegistration.FleetApiUrl(_localizer);

    /// <summary>Empty-surface message (web <c>region.noData</c>).</summary>
    public string NoDataMessage => RegionSettingsRegistration.NoData(_localizer);

    /// <summary>Loading caption shown while the first read is in flight.</summary>
    public string LoadingLabel => RegionSettingsRegistration.Loading(_localizer);

    /// <summary>Offline-chip caption when the network is unreachable.</summary>
    public string OfflineLabel => RegionSettingsRegistration.Offline(_localizer);

    /// <summary>Retry affordance label for the error surface.</summary>
    public string RetryLabel => RegionSettingsRegistration.Retry(_localizer);

    /// <summary>Hard-failure message for the error surface.</summary>
    public string ErrorMessage => RegionSettingsRegistration.LoadFailed(_localizer);

    /// <summary>Success notice copy (web <c>toast.regionRefreshed</c>).</summary>
    public string RefreshSucceededMessage => RegionSettingsRegistration.RefreshSucceeded(_localizer);

    /// <summary>Failure notice copy (web <c>toast.regionFailed</c>).</summary>
    public string RefreshFailedMessage => RegionSettingsRegistration.RefreshFailed(_localizer);

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network region read (web initial query).</summary>
    public Task LoadAsync(CancellationToken cancellationToken = default) => StreamRegionAsync(cancellationToken);

    /// <summary>
    /// "Refresh" — POST the refresh mutation, surface the success/failure notice (web toast), then re-read the
    /// region to reflect the authoritative state (web <c>invalidateQueries</c> → refetch). The POST resolves to
    /// a notice, never an unhandled rejection; the subsequent reload always reflects the current server state.
    /// </summary>
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_isRefreshing)
        {
            return;
        }

        IsRefreshing = true;
        IsFetching = true;
        _diagnostics.RecordRefreshRequested();

        RegionRefreshOutcome outcome;
        try
        {
            outcome = await _source.RefreshAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            IsRefreshing = false;
            return;
        }

        RefreshNotice = outcome.Success
            ? new RegionRefreshNotice(RegionRefreshNoticeKind.Success, RefreshSucceededMessage)
            : new RegionRefreshNotice(RegionRefreshNoticeKind.Error, RefreshFailedMessage);
        _diagnostics.RecordRefreshResolved(outcome.Success);

        try
        {
            await StreamRegionAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            IsRefreshing = false;
        }
    }

    /// <summary>Retry from the error surface — re-run the region read (web parity for a manual refetch).</summary>
    public Task RetryAsync(CancellationToken cancellationToken = default) => StreamRegionAsync(cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _regionCts);
        GC.SuppressFinalize(this);
    }

    // ── Internals ────────────────────────────────────────────────────────────────────────────────────

    private async Task StreamRegionAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _regionCts, cancellationToken);
        Attempts++;

        try
        {
            await foreach (var result in _source.StreamRegionAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    private void Apply(RepositoryResult<RegionConfig> result)
    {
        Config = NextConfig(result, _config);

        var outcome = Classify(result);
        State = outcome.State;
        IsFetching = outcome.IsFetching;
        IsError = outcome.IsError;
        IsStale = outcome.IsStale;
        if (outcome.UpdatedAt is { } ts)
        {
            UpdatedAt = ts;
        }
    }

    private RegionOutcome Classify(RepositoryResult<RegionConfig> result)
    {
        bool known = result.HasValue || _config.HasRegion;
        return result.Status switch
        {
            LoadStatus.Loading => known
                ? new RegionOutcome(RegionSettingsSurfaceState.Ready, true, false, false, _updatedAt)
                : new RegionOutcome(RegionSettingsSurfaceState.Loading, true, false, false, null),

            LoadStatus.Cached => new RegionOutcome(
                ContentState(result.IsStale), true, false, result.IsStale, result.FetchedAt),

            LoadStatus.Refreshing => new RegionOutcome(
                ContentState(result.IsStale), true, false, result.IsStale, result.FetchedAt),

            LoadStatus.Loaded => new RegionOutcome(
                _config.HasRegion ? RegionSettingsSurfaceState.Ready : RegionSettingsSurfaceState.Empty,
                false, false, false, result.FetchedAt),

            LoadStatus.Empty => new RegionOutcome(
                RegionSettingsSurfaceState.Empty, false, false, false, result.FetchedAt),

            LoadStatus.Offline => new RegionOutcome(
                RegionSettingsSurfaceState.Offline, false, true, true, result.FetchedAt),

            _ => new RegionOutcome(RegionSettingsSurfaceState.Error, false, true, false, null),
        };
    }

    // A cached/refreshing emission shows the populated layout when a region is known (stale past the freshness
    // window), or the empty surface when the cached row carries no region (web parity: the `data.region` guard).
    private RegionSettingsSurfaceState ContentState(bool stale)
    {
        if (!_config.HasRegion)
        {
            return RegionSettingsSurfaceState.Empty;
        }

        return stale ? RegionSettingsSurfaceState.Stale : RegionSettingsSurfaceState.Ready;
    }

    private static RegionConfig NextConfig(RepositoryResult<RegionConfig> result, RegionConfig previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                                  // transient — keep prior content
            LoadStatus.Empty or LoadStatus.Error => RegionConfig.Empty,      // nothing to show
            _ => result.Value ?? previous,                                  // cached / refreshing / loaded / offline
        };

    private void RaiseValues()
    {
        Raise(nameof(RegionValue));
        Raise(nameof(FleetApiUrlValue));
        Raise(nameof(HasSyncTime));
        Raise(nameof(SyncedLabel));
    }

    private static CancellationTokenSource Supersede(
        ref CancellationTokenSource? slot,
        CancellationToken cancellationToken)
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

    private readonly record struct RegionOutcome(
        RegionSettingsSurfaceState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        DateTimeOffset? UpdatedAt);
}
