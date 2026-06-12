using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>EnergyPage</c> view — the native port of the web page's
/// data flow (web/src/features/battery/pages/EnergyPage.tsx). It consumes the three cache-then-network ports
/// (<see cref="IEnergyStatsSource"/> = <c>useEnergyStats</c>, <see cref="IChargingSessionsSource"/> =
/// <c>useChargingSessionsPaginated</c>, <see cref="IChargingTelemetryLatestSource"/> =
/// <c>useChargingTelemetryLatest</c>) concurrently, derives the page-level <see cref="State"/> from the
/// energy-stats spine (web <c>isLoading</c> / <c>statsError</c>), and projects all three snapshots through
/// <see cref="EnergyProjection"/> into a render-ready <see cref="Display"/>. A populated-but-empty stats response
/// still renders the success layout (each panel covers its own empty body), so the page never collapses to a
/// blank surface. Drive it from one confinement (the UI thread); concurrent source updates are serialized
/// internally.
/// </summary>
public sealed class EnergyPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IEnergyStatsSource _statsSource;
    private readonly IChargingSessionsSource _sessionsSource;
    private readonly IChargingTelemetryLatestSource _liveSource;
    private readonly ILocalizer _localizer;
    private readonly EnergyDiagnostics _diagnostics;
    private readonly object _gate = new();

    private UnitPref _units;
    private string _currencySymbol;
    private int _currencyPrecision;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    private RepositoryResult<EnergyStats> _statsResult = RepositoryResult<EnergyStats>.Loading();
    private IReadOnlyList<EnergyChargingSession> _sessions = Array.Empty<EnergyChargingSession>();
    private EnergyLiveCharging _live = EnergyLiveCharging.Empty;

    private EnergyState _state = EnergyState.Loading;
    private EnergyDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;

    /// <summary>Creates the holder over its three data sources, localizer, units and currency preference.</summary>
    /// <param name="statsSource">The cache-then-network energy-stats port (native <c>useEnergyStats</c>).</param>
    /// <param name="sessionsSource">The charging-sessions port (native <c>useChargingSessionsPaginated</c>).</param>
    /// <param name="liveSource">The latest-live-charging port (native <c>useChargingTelemetryLatest</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit-display preference (defaults to metric).</param>
    /// <param name="currencySymbol">The account currency symbol (defaults to "$").</param>
    /// <param name="currencyPrecision">Currency fraction digits (defaults to 2).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public EnergyPageViewModel(
        IEnergyStatsSource statsSource,
        IChargingSessionsSource sessionsSource,
        IChargingTelemetryLatestSource liveSource,
        ILocalizer localizer,
        UnitPref? units = null,
        string? currencySymbol = null,
        int currencyPrecision = DefaultPrecision,
        EnergyDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(statsSource);
        ArgumentNullException.ThrowIfNull(sessionsSource);
        ArgumentNullException.ThrowIfNull(liveSource);
        ArgumentNullException.ThrowIfNull(localizer);
        _statsSource = statsSource;
        _sessionsSource = sessionsSource;
        _liveSource = liveSource;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        _currencyPrecision = currencyPrecision < 0 ? 0 : currencyPrecision;
        _diagnostics = diagnostics ?? new EnergyDiagnostics();
        _display = BuildDisplay();
    }

    /// <summary>The default currency fraction digits (web <c>useFormatting</c> <c>decimal_precision ?? 2</c>).</summary>
    public const int DefaultPrecision = 2;

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / ready / error / stale / offline).</summary>
    public EnergyState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public EnergyDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
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

    /// <summary>True when the energy-stats read failed with no cached snapshot (drives the error surface).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window (the 2-minute contract).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the retry surface.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>The localized page title (web <c>energy.pageTitle</c>).</summary>
    public string Title => EnergyRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>energy.pageSubtitle</c>).</summary>
    public string Subtitle => EnergyRegistration.Subtitle(_localizer);

    /// <summary>True for the states where the hero / metrics / charts / sessions are rendered.</summary>
    public bool HasContent => _state is EnergyState.Ready or EnergyState.Stale or EnergyState.Offline;

    /// <summary>The user's unit preference; reassigning re-projects the current snapshot in the new units.</summary>
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
            Reproject();
        }
    }

    /// <summary>The currency symbol; reassigning re-projects the formatted costs.</summary>
    public string CurrencySymbol
    {
        get => _currencySymbol;
        set
        {
            string resolved = string.IsNullOrWhiteSpace(value) ? "$" : value;
            if (string.Equals(_currencySymbol, resolved, StringComparison.Ordinal))
            {
                return;
            }

            _currencySymbol = resolved;
            Reproject();
        }
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run a cache-then-network load of all three sources concurrently: shows the skeleton only when nothing is
    /// already visible (otherwise keeps content while refreshing), folds every energy-stats emission into
    /// <see cref="State"/>, and rebuilds <see cref="Display"/> as each source emits. A superseding load cancels
    /// the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        if (!HasContent)
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await Task.WhenAll(
                ConsumeStatsAsync(cts.Token),
                ConsumeSessionsAsync(cts.Token),
                ConsumeLiveAsync(cts.Token)).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Refresh the current snapshots (web auto-refetch / manual refresh).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

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
    }

    private async Task ConsumeStatsAsync(CancellationToken cancellationToken)
    {
        await foreach (var result in _statsSource.StreamAsync(cancellationToken).ConfigureAwait(false))
        {
            lock (_gate)
            {
                _statsResult = result;
            }

            Recompute();
        }
    }

    private async Task ConsumeSessionsAsync(CancellationToken cancellationToken)
    {
        await foreach (var result in _sessionsSource.StreamAsync(cancellationToken).ConfigureAwait(false))
        {
            lock (_gate)
            {
                _sessions = result.HasValue ? result.Value! : Array.Empty<EnergyChargingSession>();
            }

            Recompute();
        }
    }

    private async Task ConsumeLiveAsync(CancellationToken cancellationToken)
    {
        await foreach (var result in _liveSource.StreamAsync(cancellationToken).ConfigureAwait(false))
        {
            lock (_gate)
            {
                _live = result.HasValue ? result.Value! : EnergyLiveCharging.Empty;
            }

            Recompute();
        }
    }

    private void Recompute()
    {
        RepositoryResult<EnergyStats> stats;
        EnergyDisplay display;
        lock (_gate)
        {
            stats = _statsResult;
            display = BuildDisplay();
        }

        Display = display;
        ApplyStatsState(stats);
    }

    private void ApplyStatsState(RepositoryResult<EnergyStats> stats)
    {
        switch (stats.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent)
                {
                    SetLoading();
                }
                else
                {
                    IsFetching = true;
                }

                break;

            case LoadStatus.Cached:
                ApplyContent(stats.FetchedAt, stats.IsStale, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyContent(stats.FetchedAt, stats.IsStale, fetching: true, offline: false, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyContent(stats.FetchedAt, stale: false, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Empty:
                // Web parity: an empty stats response still renders the page (empty hero + per-panel empties).
                ApplyContent(stats.FetchedAt, stale: false, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Offline:
                ApplyContent(stats.FetchedAt, stale: true, fetching: false, offline: true, error: stats.Error);
                break;

            default:
                SetError(stats.Error);
                break;
        }
    }

    private void ApplyContent(DateTimeOffset? fetchedAt, bool stale, bool fetching, bool offline, RepositoryError? error)
    {
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? EnergyState.Offline : stale ? EnergyState.Stale : EnergyState.Ready;
    }

    private void Reproject()
    {
        EnergyDisplay display;
        lock (_gate)
        {
            display = BuildDisplay();
        }

        Display = display;
    }

    private EnergyDisplay BuildDisplay()
    {
        var stats = _statsResult.HasValue ? _statsResult.Value! : EnergyStats.Empty;
        return EnergyProjection.Project(stats, _sessions, _live, _units, _currencySymbol, _currencyPrecision, _localizer);
    }

    private void SetLoading()
    {
        IsFetching = true;
        IsError = false;
        ErrorMessage = null;
        State = EnergyState.Loading;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = EnergyState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "error.offline",
            _ => "error.loadFailed",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view your energy analytics",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached energy data",
            _ => "Failed to load data",
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
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
