using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>TeslaChargingSessionsPage</c> view — the native port of the web
/// page's data flow (web/src/features/charging/pages/TeslaChargingSessionsPage.tsx). It owns the URL-equivalent state
/// (the selected VIN), reads the enrolled vehicles (web <c>useVehicles</c>) and the charging-sessions snapshot (web
/// <c>useTeslaChargingSessions(vin)</c>) through the injected <see cref="ITeslaChargingSessionsFeed"/>, drives the
/// refresh-from-Tesla mutation (web <c>useRefreshTeslaChargingSessions</c>, with the distinct HTTP 403
/// "business account required" branch), and projects the result through <see cref="TeslaChargingSessionsProjection"/>
/// so the view is a thin renderer. It surfaces the four web data states (loading / empty / error / success) plus an
/// in-flight flag; observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class TeslaChargingSessionsPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ITeslaChargingSessionsFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly TeslaChargingSessionsDiagnostics _diagnostics;
    private readonly UnitPref _units;
    private readonly string _currencySymbol;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private bool _hasData;
    private IReadOnlyList<TeslaChargingSession> _sessions = Array.Empty<TeslaChargingSession>();
    private TeslaChargingSessionSummary _summary = TeslaChargingSessionSummary.Empty;
    private IReadOnlyList<TeslaChargingVehicle> _vehicles = Array.Empty<TeslaChargingVehicle>();
    private bool _vehiclesLoaded;
    private string _selectedVin = string.Empty;
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private bool _refreshPending;
    private bool _refreshForbidden;

    private TeslaChargingSessionsState _state = TeslaChargingSessionsState.Loading;
    private TeslaChargingSessionsDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics / units / currency.</summary>
    /// <param name="feed">The charging-sessions data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="units">The user's unit display preference (web <c>useUnits</c>); defaults to metric.</param>
    /// <param name="currencySymbol">The user's currency symbol (web <c>settings.currency_symbol</c>); defaults to "$".</param>
    public TeslaChargingSessionsPageViewModel(
        ITeslaChargingSessionsFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        TeslaChargingSessionsDiagnostics? diagnostics = null,
        UnitPref? units = null,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new TeslaChargingSessionsDiagnostics();
        _units = units ?? UnitPref.Metric;
        _currencySymbol = string.IsNullOrEmpty(currencySymbol)
            ? TeslaChargingSessionsProjection.DefaultCurrencySymbol
            : currencySymbol;
        _display = TeslaChargingSessionsProjection.Project(BuildModel(), _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public TeslaChargingSessionsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public TeslaChargingSessionsDisplay Display
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

    /// <summary>The currently selected VIN filter (web <c>selectedVin</c>); empty = all vehicles.</summary>
    public string SelectedVin => _selectedVin;

    /// <summary>The localized page title (web <c>tesla_sessions.title</c>).</summary>
    public string Title => _localizer.GetString("tesla_sessions.title", "Fleet Charging Sessions");

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the full page load: the vehicle dropdown (once) plus the charging-sessions query.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasData)
        {
            _loading = true;
            Reproject();
        }

        if (!_vehiclesLoaded)
        {
            try
            {
                _vehicles = await _feed.FetchVehiclesAsync(cts.Token).ConfigureAwait(false);
                _vehiclesLoaded = true;
            }
            catch (OperationCanceledException)
            {
                // Superseded by a newer load (or disposed) — drop this result silently.
                return;
            }
            catch
            {
                // web parity: a failing vehicles query just leaves the dropdown at "All Vehicles"; never fail the page.
                _vehicles = Array.Empty<TeslaChargingVehicle>();
            }
        }

        await LoadSessionsAsync(cts).ConfigureAwait(false);
    }

    /// <summary>Refresh the current query (web auto-refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Select a VIN from the dropdown (web <c>setSelectedVin</c>); reloads the sessions for that vehicle.</summary>
    public Task SetVehicleAsync(string vin, CancellationToken cancellationToken = default)
    {
        string next = vin ?? string.Empty;
        if (next == _selectedVin)
        {
            return Task.CompletedTask;
        }

        _selectedVin = next;
        var cts = Supersede(ref _cts, cancellationToken);
        IsFetching = true;
        return LoadSessionsAsync(cts);
    }

    /// <summary>
    /// Trigger a refresh-from-Tesla (web <c>refreshMutation.mutate</c>). Sets the in-flight label, clears any prior
    /// 403 banner, and on a 403 surfaces the distinct "business account required" note (web <c>is403</c>) without
    /// failing the page; on success it folds the fresh snapshot in.
    /// </summary>
    public async Task RefreshFromTeslaAsync(CancellationToken cancellationToken = default)
    {
        if (_refreshPending)
        {
            return;
        }

        var cts = Supersede(ref _cts, cancellationToken);

        _refreshPending = true;
        _refreshForbidden = false;
        Reproject();

        try
        {
            var snapshot = await _feed.RefreshAsync(string.IsNullOrEmpty(_selectedVin) ? null : _selectedVin, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _hasData = snapshot.HasData;
            _sessions = snapshot.Sessions ?? Array.Empty<TeslaChargingSession>();
            _summary = snapshot.Summary ?? TeslaChargingSessionSummary.Empty;
            _hasError = false;
            _errorDetail = null;
            _loading = false;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (ApiException ex) when (ex.StatusCode == 403)
        {
            // web is403: personal accounts get a 403 — show the "business account required" note, keep existing data.
            _refreshForbidden = true;
        }
        catch
        {
            // Any other refresh failure is non-fatal to the page; the existing data + table remain.
        }
        finally
        {
            _refreshPending = false;
        }

        IsFetching = false;
        Reproject();
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

    private async Task LoadSessionsAsync(CancellationTokenSource cts)
    {
        try
        {
            var snapshot = await _feed.FetchSessionsAsync(
                string.IsNullOrEmpty(_selectedVin) ? null : _selectedVin,
                cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _hasData = snapshot.HasData;
            _sessions = snapshot.Sessions ?? Array.Empty<TeslaChargingSession>();
            _summary = snapshot.Summary ?? TeslaChargingSessionSummary.Empty;
            _hasError = false;
            _errorDetail = null;
            _loading = false;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception ex)
        {
            // web error: surface the page failure surface; every data region falls back to its empty branch.
            _hasError = true;
            _errorDetail = ex.Message;
            _hasData = false;
            _sessions = Array.Empty<TeslaChargingSession>();
            _summary = TeslaChargingSessionSummary.Empty;
            _loading = false;
        }

        IsFetching = false;
        Reproject();
    }

    private TeslaChargingSessionsModel BuildModel() => new(
        HasData: _hasData,
        Sessions: _sessions,
        Summary: _summary,
        Vehicles: _vehicles,
        SelectedVin: _selectedVin,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        RefreshPending: _refreshPending,
        RefreshForbidden: _refreshForbidden,
        Units: _units,
        CurrencySymbol: _currencySymbol);

    private void Reproject()
    {
        var display = TeslaChargingSessionsProjection.Project(BuildModel(), _localizer, _clock());
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
