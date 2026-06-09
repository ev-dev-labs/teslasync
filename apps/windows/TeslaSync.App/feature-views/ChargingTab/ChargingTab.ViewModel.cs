using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ChargingTab"/> view — the native port of the web
/// component's data flow (web/src/features/analytics/components/analytics/ChargingTab.tsx, fed by the parent
/// <c>AnalyticsPage</c>'s fleet-analytics query). It drives one cache-then-network read through the
/// <see cref="IChargingTabSource"/>, projects each emission through <see cref="ChargingTabProjection"/>, and
/// exposes the full state matrix (loading / ready / empty / stale / offline / error) plus freshness so the view
/// is a thin renderer. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ChargingTabViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IChargingTabSource _source;
    private readonly ILocalizer _localizer;
    private readonly string _currencySymbol;

    private CancellationTokenSource? _cts;
    private ChargingTabData? _data;
    private bool _disposed;

    private ChargingTabState _state = ChargingTabState.Loading;
    private ChargingTabDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isOffline;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) currency symbol.</summary>
    /// <param name="source">The cache-then-network data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    public ChargingTabViewModel(IChargingTabSource source, ILocalizer localizer, string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? ChargingTabRegistration.DefaultCurrencySymbol
            : currencySymbol;
        _display = ChargingTabProjection.Project(null, _localizer, _currencySymbol);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── State ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The current surface state (loading / ready / empty / stale / offline / error).</summary>
    public ChargingTabState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content (summary cards + chart datasets + detail datasets).</summary>
    public ChargingTabDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>Last successful update timestamp (for the freshness chip).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last read failed (hard error or offline-with-cache).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown content is a cached value past the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True when the network failed but cached content is still being shown.</summary>
    public bool IsOffline
    {
        get => _isOffline;
        private set => Set(ref _isOffline, value);
    }

    /// <summary>Localized error message (null when not errored).</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Load attempts so far (including retries) — drives "tried N times" messaging.</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    // ── Localized copy (web t(...) keys) ────────────────────────────────────────────────────────────────

    /// <summary>The accessible surface title (web tab label "Charging").</summary>
    public string SurfaceTitle => ChargingTabRegistration.SurfaceTitle(_localizer);

    /// <summary>"Charger Types" panel title.</summary>
    public string ChargerTypesTitle => ChargingTabRegistration.ChargerTypesTitle(_localizer);

    /// <summary>"Start Battery Distribution" panel title.</summary>
    public string StartBatteryTitle => ChargingTabRegistration.StartBatteryTitle(_localizer);

    /// <summary>"Hourly Charging Pattern" panel title.</summary>
    public string HourlyPatternTitle => ChargingTabRegistration.HourlyPatternTitle(_localizer);

    /// <summary>"Charger Brands" panel title.</summary>
    public string ChargerBrandsTitle => ChargingTabRegistration.ChargerBrandsTitle(_localizer);

    /// <summary>"Monthly Charging Trend" panel title.</summary>
    public string MonthlyTrendTitle => ChargingTabRegistration.MonthlyTrendTitle(_localizer);

    /// <summary>"Cost Analysis" panel title.</summary>
    public string CostAnalysisTitle => ChargingTabRegistration.CostAnalysisTitle(_localizer);

    /// <summary>"Cost by Charger Type" panel title.</summary>
    public string CostByTypeTitle => ChargingTabRegistration.CostByTypeTitle(_localizer);

    /// <summary>"Charges" series name.</summary>
    public string ChargesSeries => ChargingTabRegistration.ChargesSeries(_localizer);

    /// <summary>"Energy (kWh)" series name.</summary>
    public string EnergySeries => ChargingTabRegistration.EnergySeries(_localizer);

    /// <summary>"Avg Power (kW)" series name.</summary>
    public string AvgPowerSeries => ChargingTabRegistration.AvgPowerSeries(_localizer);

    /// <summary>"Sessions" series name (reused for the monthly sessions bar).</summary>
    public string SessionsSeries => ChargingTabRegistration.SessionsLabel(_localizer);

    /// <summary>Lowercase "sessions" word for the brand leaderboard count line.</summary>
    public string SessionsWord => ChargingTabRegistration.SessionsWord(_localizer);

    /// <summary>Charger-types empty message.</summary>
    public string NoChargerTypes => ChargingTabRegistration.NoChargerTypes(_localizer);

    /// <summary>Battery-distribution empty message.</summary>
    public string NoBatteryDistribution => ChargingTabRegistration.NoBatteryDistribution(_localizer);

    /// <summary>Hourly-pattern empty message.</summary>
    public string NoHourly => ChargingTabRegistration.NoHourly(_localizer);

    /// <summary>Charger-brands empty message.</summary>
    public string NoBrands => ChargingTabRegistration.NoBrands(_localizer);

    /// <summary>Monthly-trend empty message.</summary>
    public string NoMonthly => ChargingTabRegistration.NoMonthly(_localizer);

    /// <summary>Cost-statistics empty message.</summary>
    public string NoCostStats => ChargingTabRegistration.NoCostStats(_localizer);

    /// <summary>Cost-by-type empty message.</summary>
    public string NoCostByType => ChargingTabRegistration.NoCostByType(_localizer);

    /// <summary>Stale freshness chip label.</summary>
    public string StaleLabel => ChargingTabRegistration.StaleLabel(_localizer);

    /// <summary>Offline freshness chip label.</summary>
    public string OfflineLabel => ChargingTabRegistration.OfflineLabel(_localizer);

    /// <summary>Retry affordance label.</summary>
    public string RetryLabel => ChargingTabRegistration.RetryLabel(_localizer);

    /// <summary>Whole-surface empty message (null body).</summary>
    public string EmptyText => ChargingTabRegistration.EmptyText(_localizer);

    /// <summary>A polite Narrator announcement for the current state (null when nothing to announce).</summary>
    public string? StatusAnnouncement => _state switch
    {
        ChargingTabState.Loading => ChargingTabRegistration.LoadingLabel(_localizer),
        ChargingTabState.Stale => StaleLabel,
        ChargingTabState.Offline => _errorMessage ?? ChargingTabRegistration.OfflineText(_localizer),
        ChargingTabState.Error => _errorMessage ?? ChargingTabRegistration.ErrorText(_localizer),
        ChargingTabState.Empty => EmptyText,
        _ => null,
    };

    // ── Commands ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network charging-analytics load.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;

        if (_data is null)
        {
            State = ChargingTabState.Loading;
            IsFetching = true;
            IsError = false;
            IsStale = false;
            IsOffline = false;
            ErrorMessage = null;
            RefreshDisplay();
        }
        else
        {
            IsFetching = true;
        }

        Raise(nameof(StatusAnnouncement));

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

    /// <summary>Retry the surface after a failure (web <c>QueryError</c> retry → refetch).</summary>
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

    // ── Internals ─────────────────────────────────────────────────────────────────────────────────────

    private void Apply(RepositoryResult<ChargingTabData> result)
    {
        _data = NextData(result, _data);

        var outcome = Classify(result, _data);
        State = outcome.State;
        IsFetching = outcome.IsFetching;
        IsError = outcome.IsError;
        IsStale = outcome.IsStale;
        IsOffline = outcome.IsOffline;
        ErrorMessage = outcome.ErrorMessage;
        if (outcome.UpdatedAt is { } ts)
        {
            UpdatedAt = ts;
        }

        RefreshDisplay();
        Raise(nameof(StatusAnnouncement));
    }

    private ChargingOutcome Classify(RepositoryResult<ChargingTabData> result, ChargingTabData? data)
    {
        bool hasValue = data is not null;

        return result.Status switch
        {
            LoadStatus.Loading => hasValue
                ? new ChargingOutcome(ChargingTabState.Ready, true, false, false, false, null, null)
                : new ChargingOutcome(ChargingTabState.Loading, true, false, false, false, null, null),

            LoadStatus.Cached => new ChargingOutcome(
                result.IsStale ? ChargingTabState.Stale : ContentState(data),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Refreshing => new ChargingOutcome(
                result.IsStale ? ChargingTabState.Stale : ContentState(data),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Loaded => new ChargingOutcome(
                ContentState(data), false, false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new ChargingOutcome(
                ChargingTabState.Empty, false, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasValue
                ? new ChargingOutcome(
                    ChargingTabState.Offline, false, true, true, true,
                    ChargingTabRegistration.OfflineText(_localizer), result.FetchedAt)
                : new ChargingOutcome(
                    ChargingTabState.Error, false, true, false, false,
                    ChargingTabRegistration.ErrorText(_localizer), result.FetchedAt),

            _ => new ChargingOutcome(
                ChargingTabState.Error, false, true, false, false,
                ChargingTabRegistration.ErrorText(_localizer), null),
        };
    }

    // Web parity: the tab renders its per-section content (with per-section empty states) whenever the snapshot
    // object is present, even if every charging list is empty. Only a null body is a whole-surface empty.
    private static ChargingTabState ContentState(ChargingTabData? data) =>
        data is null ? ChargingTabState.Empty : ChargingTabState.Ready;

    private static ChargingTabData? NextData(RepositoryResult<ChargingTabData> result, ChargingTabData? previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                  // transient — keep the prior value visible
            LoadStatus.Empty or LoadStatus.Error => null,    // resolved with nothing to show
            _ => result.Value ?? previous,                   // cached / refreshing / loaded / offline carry a value
        };

    private void RefreshDisplay() => Display = ChargingTabProjection.Project(_data, _localizer, _currencySymbol);

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

    private readonly record struct ChargingOutcome(
        ChargingTabState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        bool IsOffline,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
