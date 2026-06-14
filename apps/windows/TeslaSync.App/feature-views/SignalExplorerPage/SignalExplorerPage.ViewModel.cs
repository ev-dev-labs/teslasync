using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>SignalExplorerPage</c> view — the native port of the web page's
/// data flow (web/src/features/telemetry/pages/SignalExplorerPage.tsx). It owns the URL-equivalent state (selected
/// vehicle, selected signals, range, per-page) plus the latched <c>exploreKey</c> and the mutually-exclusive Live
/// toggle, reads the fleet then the per-vehicle available-signal catalogue through the injected
/// <see cref="ISignalExplorerFeed"/>, and — only when the user clicks <c>Explore</c> — runs the deferred history
/// fetch that feeds the stats / chart / table. It exposes <see cref="UpdateLiveState"/> as the P1/S4 SSE seam that
/// drives the live connection badge. The result is projected through <see cref="SignalExplorerProjection"/> so the
/// view is a thin renderer. It surfaces the four web data states (loading / empty / error / success) plus an
/// in-flight flag; observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SignalExplorerPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISignalExplorerFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly SignalExplorerDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;
    private bool _loadedOnce;

    private IReadOnlyList<SignalExplorerVehicle> _vehicles = Array.Empty<SignalExplorerVehicle>();
    private long? _selectedId;
    private IReadOnlyList<string> _availableSignals = Array.Empty<string>();
    private List<string> _selectedSignals = new();
    private DateRange _range;
    private int _perPage = SignalExplorerRegistration.DefaultPerPage;

    private bool _isLive;
    private bool _liveConnected;

    private bool _hasExplored;
    private bool _historyLoading;
    private IReadOnlyList<SignalExplorerEntry> _rows = Array.Empty<SignalExplorerEntry>();

    private bool _loading = true;
    private string? _signalsError;
    private string? _historyError;
    private bool _isFetching;

    private SignalExplorerState _state = SignalExplorerState.Loading;
    private SignalExplorerDisplay _display;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The vehicles / available-signals / history data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic range defaults / timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SignalExplorerPageViewModel(
        ISignalExplorerFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        SignalExplorerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new SignalExplorerDiagnostics();

        // web useRangeState defaultPresetId: 'today'.
        var today = DateOnly.FromDateTime(_clock().DateTime);
        _range = new DateRange(today, today);

        _display = SignalExplorerProjection.Project(BuildModel(), _localizer, _clock());
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public SignalExplorerState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SignalExplorerDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while the deferred history query is in flight (web <c>isFetching</c>).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The currently selected vehicle id (web <c>vehicleId</c>), or null when the fleet is empty.</summary>
    public long? SelectedVehicleId => _selectedId;

    /// <summary>The committed signal selection (web <c>selectedSignals</c>).</summary>
    public IReadOnlyList<string> SelectedSignals => _selectedSignals;

    /// <summary>The selected inclusive date range (web <c>start</c>/<c>end</c>).</summary>
    public DateRange Range => _range;

    /// <summary>The current page size (web <c>perPage</c>).</summary>
    public int PerPage => _perPage;

    /// <summary>True once an Explore query has been issued (web <c>exploreKey !== null</c>).</summary>
    public bool HasExplored => _hasExplored;

    /// <summary>True while Live streaming is active (web <c>isLive</c>).</summary>
    public bool IsLive => _isLive;

    /// <summary>True while the live SSE seam reports a connected stream (web <c>live.connected</c>).</summary>
    public bool LiveConnected => _liveConnected;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the fleet + per-vehicle available-signals load for the current selection.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        if (!_loadedOnce)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var vehicles = await _feed.FetchVehiclesAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _vehicles = vehicles ?? Array.Empty<SignalExplorerVehicle>();
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            // web: a vehicles failure leaves the fleet empty (the page falls back to the no-vehicle empty state);
            // useSelectedVehicle does not raise the page's error banner.
            _vehicles = Array.Empty<SignalExplorerVehicle>();
        }

        // web useSelectedVehicle: keep the current pick when still present, else fall back to the first vehicle.
        if (_selectedId is null || !ContainsVehicle(_selectedId.Value))
        {
            _selectedId = _vehicles.Count > 0 ? _vehicles[0].Id : null;
        }

        await LoadAvailableSignalsAsync(cts.Token).ConfigureAwait(false);

        if (_hasExplored && !_isLive && _selectedId is not null)
        {
            // web: the history useQuery's key includes vehicleId, so a still-latched query re-runs for the fleet.
            await RunHistoryAsync(cts.Token).ConfigureAwait(false);
        }

        _loading = false;
        _loadedOnce = true;
        Reproject();
    }

    /// <summary>Refresh the current selection (web manual refresh + auto-refetch).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Select a vehicle from the picker (web <c>VehicleSelect</c>); reloads its available signals and — like the web
    /// <c>useEffect(() =&gt; setExploreKey(null), [vehicleId])</c> — wipes the latched Explore results so the two
    /// vehicles' histories never intermix.
    /// </summary>
    public async Task SelectVehicleAsync(long vehicleId, CancellationToken cancellationToken = default)
    {
        if (vehicleId <= 0 || vehicleId == _selectedId)
        {
            return;
        }

        var cts = Supersede(ref _cts, cancellationToken);
        _selectedId = vehicleId;
        _hasExplored = false;
        _rows = Array.Empty<SignalExplorerEntry>();
        _historyError = null;
        Reproject();

        await LoadAvailableSignalsAsync(cts.Token).ConfigureAwait(false);
        Reproject();
    }

    /// <summary>Replace the committed signal selection (web <c>setSelectedSignals</c>, capped at five); re-projects.</summary>
    public void SetSelectedSignals(IReadOnlyList<string>? signals)
    {
        if (signals is null)
        {
            _selectedSignals = new List<string>();
        }
        else
        {
            int take = Math.Min(signals.Count, SignalExplorerProjection.MaxSignals);
            var next = new List<string>(take);
            for (int i = 0; i < take; i++)
            {
                next.Add(signals[i]);
            }

            _selectedSignals = next;
        }

        Reproject();
    }

    /// <summary>Set the date range (web <c>RangePicker.onChange</c>); no fetch, re-projects.</summary>
    public void SetRange(DateRange range)
    {
        if (_range.Equals(range))
        {
            return;
        }

        _range = range;
        Reproject();
    }

    /// <summary>Set the page size (web <c>setPerPage</c> + <c>setPage(1)</c>); no fetch, re-projects.</summary>
    public void SetPerPage(int perPage)
    {
        int next = SignalExplorerRegistration.IsKnownPerPage(perPage) ? perPage : SignalExplorerRegistration.DefaultPerPage;
        if (_perPage == next)
        {
            return;
        }

        _perPage = next;
        Reproject();
    }

    /// <summary>
    /// Run the deferred history query for the current signals + range (web <c>handleExplore</c> → <c>setExploreKey</c>).
    /// Clears Live mode (web <c>setIsLive(false)</c>) and is a no-op when the query is not yet valid (web
    /// <c>canExplore</c> guard).
    /// </summary>
    public async Task ExploreAsync(CancellationToken cancellationToken = default)
    {
        if (!CanExplore())
        {
            return;
        }

        _isLive = false;
        _liveConnected = false;
        _hasExplored = true;
        var cts = Supersede(ref _cts, cancellationToken);
        await RunHistoryAsync(cts.Token).ConfigureAwait(false);
        Reproject();
    }

    /// <summary>
    /// Toggle Live mode (web <c>toggleLive</c>). Turning it on flips the page into the streaming layout (the
    /// historical query is suspended); turning it off restores the latched Explore results. A no-op when no signal
    /// is selected and Live is currently off (web <c>disabled={selectedSignals.length === 0 &amp;&amp; !isLive}</c>).
    /// </summary>
    public void ToggleLive()
    {
        if (!_isLive && _selectedSignals.Count == 0)
        {
            return;
        }

        _isLive = !_isLive;
        _liveConnected = false;
        Reproject();
    }

    /// <summary>
    /// Apply a live SSE update (web <c>live.connected</c>). The live-stream wiring (P1/S4) calls this as events
    /// arrive: <paramref name="connected"/> drives the header connection badge. Ignored unless Live mode is active.
    /// </summary>
    public void UpdateLiveState(bool connected)
    {
        if (!_isLive)
        {
            return;
        }

        if (_liveConnected == connected)
        {
            return;
        }

        _liveConnected = connected;
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

    private async Task LoadAvailableSignalsAsync(CancellationToken cancellationToken)
    {
        if (_selectedId is not { } vehicleId)
        {
            _availableSignals = Array.Empty<string>();
            _signalsError = null;
            return;
        }

        try
        {
            var signals = await _feed.FetchAvailableSignalsAsync(vehicleId, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _availableSignals = signals ?? Array.Empty<string>();
            _signalsError = null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            // web: `const { error: signalsError } = useSignals(...)` feeds `anyError` — the page raises its banner.
            _availableSignals = Array.Empty<string>();
            _signalsError = ex.Message;
        }
    }

    private async Task RunHistoryAsync(CancellationToken cancellationToken)
    {
        if (_selectedId is not { } vehicleId)
        {
            return;
        }

        _historyLoading = true;
        IsFetching = true;
        _historyError = null;
        Reproject();

        try
        {
            var rows = await _feed.FetchHistoryAsync(
                vehicleId,
                _selectedSignals,
                ToIsoStart(_range.Start),
                ToIsoEnd(_range.End),
                _perPage * 10,
                cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _rows = rows ?? Array.Empty<SignalExplorerEntry>();
            _historyError = null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            // web anyError: the history query failure raises the failure banner; the table falls back to empty.
            _historyError = ex.Message;
            _rows = Array.Empty<SignalExplorerEntry>();
        }
        finally
        {
            _historyLoading = false;
            IsFetching = false;
        }
    }

    private bool CanExplore() =>
        _selectedId is { } id && id > 0 && _selectedSignals.Count > 0 && _range.IsValid;

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

    private SignalExplorerModel BuildModel()
    {
        // web: `anyError = (signalsError ?? historicalError)` — the catalogue error wins, else the history error.
        string? error = _signalsError ?? _historyError;
        return new SignalExplorerModel(
            Vehicles: _vehicles,
            SelectedVehicleId: _selectedId,
            AvailableSignals: _availableSignals,
            SelectedSignals: _selectedSignals,
            Range: _range,
            PerPage: _perPage,
            IsLive: _isLive,
            LiveConnected: _liveConnected,
            HasExplored: _hasExplored,
            HistoryLoading: _historyLoading,
            Rows: _rows,
            Loading: _loading,
            IsFetching: _isFetching,
            HasError: error is not null,
            ErrorDetail: error);
    }

    private void Reproject()
    {
        var display = SignalExplorerProjection.Project(BuildModel(), _localizer, _clock());
        Display = display;
        State = display.State;
    }

    private static string ToIsoStart(DateOnly date) =>
        new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero)
            .ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);

    private static string ToIsoEnd(DateOnly date) =>
        new DateTimeOffset(date.ToDateTime(new TimeOnly(23, 59, 59, 999)), TimeSpan.Zero)
            .ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);

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
