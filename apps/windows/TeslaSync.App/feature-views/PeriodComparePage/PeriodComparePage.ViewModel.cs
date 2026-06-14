using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>PeriodComparePage</c> view — the native port of the web page's
/// data flow (web/src/features/analytics/pages/PeriodComparePage.tsx). It owns the URL-equivalent state (selected
/// vehicle and the two trailing-day windows), reads the fleet then the two per-vehicle period-stats envelopes through
/// the injected <see cref="IPeriodCompareFeed"/>, and projects the result through <see cref="PeriodCompareProjection"/>
/// (in the active units) so the view is a thin renderer. It surfaces the four web data states
/// (loading / empty / error / success) plus an in-flight flag; observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class PeriodComparePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IPeriodCompareFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly PeriodCompareDiagnostics _diagnostics;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private bool _disposed;
    private bool _loadedOnce;

    private IReadOnlyList<PeriodCompareVehicle> _vehicles = Array.Empty<PeriodCompareVehicle>();
    private long? _selectedId;
    private int _periodADays = PeriodCompareRegistration.DefaultPeriodADays;
    private int _periodBDays = PeriodCompareRegistration.DefaultPeriodBDays;
    private PeriodStats? _statsA;
    private PeriodStats? _statsB;
    private bool _statsLoading = true;
    private string? _vehiclesError;
    private string? _statsAError;
    private string? _statsBError;

    private PeriodCompareState _state = PeriodCompareState.Loading;
    private PeriodCompareDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer, unit preference and (optional) diagnostics.</summary>
    /// <param name="feed">The vehicles / period-stats data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit-display preference (defaults to metric, the web default).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public PeriodComparePageViewModel(
        IPeriodCompareFeed feed,
        ILocalizer localizer,
        UnitPref? units = null,
        PeriodCompareDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _diagnostics = diagnostics ?? new PeriodCompareDiagnostics();
        _display = PeriodCompareProjection.Project(BuildModel(), _localizer, _units);
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public PeriodCompareState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public PeriodCompareDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The currently selected vehicle id (web <c>vehicleId</c>), or null when the fleet is empty.</summary>
    public long? SelectedVehicleId => _selectedId;

    /// <summary>The current Period A window in days (web <c>period_a</c>).</summary>
    public int PeriodADays => _periodADays;

    /// <summary>The current Period B window in days (web <c>period_b</c>).</summary>
    public int PeriodBDays => _periodBDays;

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

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the fleet + the two per-vehicle period-stats reads for the current selection / windows.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_loadedOnce)
        {
            _statsLoading = true;
            Reproject();
        }

        try
        {
            var vehicles = await _feed.FetchVehiclesAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _vehicles = vehicles ?? Array.Empty<PeriodCompareVehicle>();
            _vehiclesError = null;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            // web vehiclesError — the fleet falls back to empty; the error banner surfaces the failure.
            _vehiclesError = ex.Message;
            _vehicles = Array.Empty<PeriodCompareVehicle>();
        }

        // web: activeVehicle = vehicleId || vehicles?.[0]?.id — keep the current pick when still present, else the first.
        if (_selectedId is null || !ContainsVehicle(_selectedId.Value))
        {
            _selectedId = _vehicles.Count > 0 ? _vehicles[0].Id : null;
        }

        if (_selectedId is { } id)
        {
            try
            {
                await LoadStatsAsync(id, cts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
        else
        {
            // web: with no vehicle the period-stats queries are disabled and `data` is undefined → empty state.
            _statsA = null;
            _statsB = null;
            _statsAError = null;
            _statsBError = null;
        }

        _loadedOnce = true;
        _statsLoading = false;
        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the current selection / windows (web auto-refetch + manual refresh).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Select a vehicle from the picker (web <c>setVehicleId</c>); reloads both period envelopes.</summary>
    public Task SelectVehicleAsync(long vehicleId, CancellationToken cancellationToken = default)
    {
        if (vehicleId <= 0)
        {
            return Task.CompletedTask;
        }

        _selectedId = vehicleId;
        return LoadAsync(cancellationToken);
    }

    /// <summary>Set the Period A window (web <c>setPeriodA</c>); reloads Period A for the current vehicle.</summary>
    public Task SetPeriodADaysAsync(int days, CancellationToken cancellationToken = default)
    {
        _periodADays = NormalizeDays(days);
        return LoadAsync(cancellationToken);
    }

    /// <summary>Set the Period B window (web <c>setPeriodB</c>); reloads Period B for the current vehicle.</summary>
    public Task SetPeriodBDaysAsync(int days, CancellationToken cancellationToken = default)
    {
        _periodBDays = NormalizeDays(days);
        return LoadAsync(cancellationToken);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _cts);
    }

    private async Task LoadStatsAsync(long id, CancellationToken token)
    {
        try
        {
            var statsA = await _feed.FetchStatsAsync(id, _periodADays, token).ConfigureAwait(false);
            token.ThrowIfCancellationRequested();
            _statsA = statsA ?? PeriodStats.Zero;
            _statsAError = null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _statsAError = ex.Message;
            _statsA = null;
        }

        try
        {
            var statsB = await _feed.FetchStatsAsync(id, _periodBDays, token).ConfigureAwait(false);
            token.ThrowIfCancellationRequested();
            _statsB = statsB ?? PeriodStats.Zero;
            _statsBError = null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _statsBError = ex.Message;
            _statsB = null;
        }
    }

    private bool ContainsVehicle(long id)
    {
        foreach (var vehicle in _vehicles)
        {
            if (vehicle.Id == id)
            {
                return true;
            }
        }

        return false;
    }

    private static int NormalizeDays(int days) => days < 0 ? 0 : days;

    private PeriodCompareModel BuildModel() => new(
        Vehicles: _vehicles,
        SelectedVehicleId: _selectedId,
        PeriodADays: _periodADays,
        PeriodBDays: _periodBDays,
        StatsA: _statsA,
        StatsB: _statsB,
        IsLoading: _statsLoading,
        HasError: _vehiclesError is not null || _statsAError is not null || _statsBError is not null,
        ErrorDetail: _vehiclesError ?? _statsAError ?? _statsBError);

    private void Reproject()
    {
        var display = PeriodCompareProjection.Project(BuildModel(), _localizer, _units);
        Display = display;
        State = display.State;
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
