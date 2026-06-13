using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>SignalLogViewerPage</c> view — the native port of the web
/// page's data flow (web/src/features/telemetry/pages/SignalLogViewerPage.tsx). It owns the URL-equivalent state
/// (selected vehicle, selected signals, range, per-page) plus the latched <c>queryKey</c>, reads the fleet then the
/// per-vehicle available-signal catalogue through the injected <see cref="ISignalLogViewerFeed"/>, and — only when
/// the user clicks <c>Query</c> — runs the deferred history fetch. The result is projected through
/// <see cref="SignalLogViewerProjection"/> so the view is a thin renderer. It surfaces the four web data states
/// (loading / empty / error / success) plus an in-flight flag; observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SignalLogViewerPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISignalLogViewerFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly SignalLogViewerDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;
    private bool _loadedOnce;

    private IReadOnlyList<SignalLogViewerVehicle> _vehicles = Array.Empty<SignalLogViewerVehicle>();
    private long? _selectedId;
    private IReadOnlyList<string> _availableSignals = Array.Empty<string>();
    private List<string> _selectedSignals = new();
    private DateRange _range;
    private int _perPage = SignalLogViewerRegistration.DefaultPerPage;

    private bool _hasQueried;
    private bool _historyLoading;
    private IReadOnlyList<SignalLogEntry> _rows = Array.Empty<SignalLogEntry>();

    private bool _loading = true;
    private string? _error;
    private bool _isFetching;

    private SignalLogViewerState _state = SignalLogViewerState.Loading;
    private SignalLogViewerDisplay _display;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The vehicles / available-signals / history data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic range defaults / timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SignalLogViewerPageViewModel(
        ISignalLogViewerFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        SignalLogViewerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new SignalLogViewerDiagnostics();

        // web useRangeState defaultPresetId: 'today'.
        var today = DateOnly.FromDateTime(_clock().DateTime);
        _range = new DateRange(today, today);

        _display = SignalLogViewerProjection.Project(BuildModel(), _localizer, _clock());
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public SignalLogViewerState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SignalLogViewerDisplay Display
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

    /// <summary>True once a query has been issued (web <c>hasQueried</c> / <c>queryKey !== null</c>).</summary>
    public bool HasQueried => _hasQueried;

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
            _vehicles = vehicles ?? Array.Empty<SignalLogViewerVehicle>();
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            // web: a vehicles failure leaves the fleet empty (the page falls back to the no-vehicle empty state);
            // useSelectedVehicle does not raise the page's error banner.
            _vehicles = Array.Empty<SignalLogViewerVehicle>();
        }

        // web useSelectedVehicle: keep the current pick when still present, else fall back to the first vehicle.
        if (_selectedId is null || !ContainsVehicle(_selectedId.Value))
        {
            _selectedId = _vehicles.Count > 0 ? _vehicles[0].Id : null;
        }

        await LoadAvailableSignalsAsync(cts.Token).ConfigureAwait(false);

        if (_hasQueried && _selectedId is not null)
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

    /// <summary>Select a vehicle from the picker (web <c>VehicleSelect</c>); reloads its available signals.</summary>
    public async Task SelectVehicleAsync(long vehicleId, CancellationToken cancellationToken = default)
    {
        if (vehicleId <= 0 || vehicleId == _selectedId)
        {
            return;
        }

        var cts = Supersede(ref _cts, cancellationToken);
        _selectedId = vehicleId;
        Reproject();

        await LoadAvailableSignalsAsync(cts.Token).ConfigureAwait(false);

        if (_hasQueried)
        {
            await RunHistoryAsync(cts.Token).ConfigureAwait(false);
        }

        Reproject();
    }

    /// <summary>Replace the committed signal selection (web <c>setSelectedSignals</c>); no fetch, re-projects.</summary>
    public void SetSelectedSignals(IReadOnlyList<string>? signals)
    {
        _selectedSignals = signals is null ? new List<string>() : new List<string>(signals);
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
        int next = SignalLogViewerRegistration.IsKnownPerPage(perPage) ? perPage : SignalLogViewerRegistration.DefaultPerPage;
        if (_perPage == next)
        {
            return;
        }

        _perPage = next;
        Reproject();
    }

    /// <summary>
    /// Run the deferred history query for the current signals + range (web <c>handleQuery</c> → <c>setQueryKey</c>).
    /// A no-op when the query is not yet valid (web <c>canQuery</c> guard).
    /// </summary>
    public async Task QueryAsync(CancellationToken cancellationToken = default)
    {
        if (!CanQuery())
        {
            return;
        }

        _hasQueried = true;
        var cts = Supersede(ref _cts, cancellationToken);
        await RunHistoryAsync(cts.Token).ConfigureAwait(false);
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
            return;
        }

        try
        {
            var signals = await _feed.FetchAvailableSignalsAsync(vehicleId, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _availableSignals = signals ?? Array.Empty<string>();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // web: a useSignals failure leaves availableSignals undefined (the selector renders empty); it does not
            // raise the page's error banner (only the history query feeds anyError).
            _availableSignals = Array.Empty<string>();
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
        _error = null;
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
            _rows = rows ?? Array.Empty<SignalLogEntry>();
            _error = null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            // web anyError: the history query failure raises the failure banner; the table falls back to empty.
            _error = ex.Message;
            _rows = Array.Empty<SignalLogEntry>();
        }
        finally
        {
            _historyLoading = false;
            IsFetching = false;
        }
    }

    private bool CanQuery() =>
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

    private SignalLogViewerModel BuildModel() => new(
        Vehicles: _vehicles,
        SelectedVehicleId: _selectedId,
        AvailableSignals: _availableSignals,
        SelectedSignals: _selectedSignals,
        Range: _range,
        PerPage: _perPage,
        HasQueried: _hasQueried,
        HistoryLoading: _historyLoading,
        Rows: _rows,
        Loading: _loading,
        IsFetching: _isFetching,
        HasError: _error is not null,
        ErrorDetail: _error);

    private void Reproject()
    {
        var display = SignalLogViewerProjection.Project(BuildModel(), _localizer, _clock());
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
