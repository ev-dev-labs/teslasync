using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The read seam the <see cref="TimelinePageViewModel"/> binds to (P1/S8 state-holder layer) — the native port of
/// the web page's three data sources (web/src/features/analytics/pages/TimelinePage.tsx): the <c>useVehicles</c>
/// fleet list that fills the picker, and the per-vehicle <c>GET /vehicle-states/timeline</c> and
/// <c>GET /vehicle-states/summary</c> queries that fill the panels. Each source is fetched independently so the
/// view-model can mirror the web's <c>anyError</c> precedence and per-region empty states. The view never performs
/// HTTP; the contract-client-backed <see cref="TimelineClientFeed"/> (or a test fake) drives this.
/// </summary>
public interface ITimelineFeed
{
    /// <summary>Fetch the fleet list for the vehicle picker (web <c>useVehicles → GET /vehicles</c>).</summary>
    Task<IReadOnlyList<TimelineVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Fetch the FSM transition log for <paramref name="vehicleId"/> over the trailing <paramref name="days"/> window.</summary>
    Task<IReadOnlyList<TransitionRecord>> FetchTimelineAsync(long vehicleId, int days, CancellationToken cancellationToken);

    /// <summary>Fetch the time-in-state summary for <paramref name="vehicleId"/> over the trailing <paramref name="days"/> window.</summary>
    Task<StateSummary> FetchSummaryAsync(long vehicleId, int days, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to an empty fleet and empty data (the empty data state, no HTTP).</summary>
public sealed class EmptyTimelineFeed : ITimelineFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyTimelineFeed Instance { get; } = new();

    private EmptyTimelineFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<TimelineVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<TimelineVehicle>>(Array.Empty<TimelineVehicle>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<TransitionRecord>> FetchTimelineAsync(long vehicleId, int days, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<TransitionRecord>>(Array.Empty<TransitionRecord>());
    }

    /// <inheritdoc />
    public Task<StateSummary> FetchSummaryAsync(long vehicleId, int days, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(StateSummary.Empty);
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>TimelinePage</c> view — the native port of the web page's data
/// flow (web/src/features/analytics/pages/TimelinePage.tsx). It owns the URL-equivalent state (selected vehicle and
/// trailing-day window), reads the fleet then the per-vehicle timeline + summary through the injected
/// <see cref="ITimelineFeed"/>, and projects the result through <see cref="TimelineProjection"/> so the view is a
/// thin renderer. It surfaces the four web data states (loading / empty / error / success) plus an in-flight flag;
/// observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class TimelinePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ITimelineFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly TimelineDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;
    private bool _loadedOnce;

    private IReadOnlyList<TimelineVehicle> _vehicles = Array.Empty<TimelineVehicle>();
    private long? _selectedId;
    private int _days = TimelineRegistration.DefaultDays;
    private IReadOnlyList<TransitionRecord> _transitions = Array.Empty<TransitionRecord>();
    private StateSummary _summary = StateSummary.Empty;
    private bool _timelineLoading = true;
    private bool _summaryLoading = true;
    private string? _vehiclesError;
    private string? _timelineError;
    private string? _summaryError;

    private TimelineState _state = TimelineState.Loading;
    private TimelineDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The vehicles / timeline / summary data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic duration / timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TimelinePageViewModel(
        ITimelineFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        TimelineDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new TimelineDiagnostics();
        _display = TimelineProjection.Project(BuildModel(), _localizer, _clock());
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public TimelineState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public TimelineDisplay Display
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

    /// <summary>The current trailing-day window (web <c>days</c>).</summary>
    public int Days => _days;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the fleet + per-vehicle timeline/summary load for the current selection / window.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_loadedOnce)
        {
            _timelineLoading = true;
            _summaryLoading = true;
            Reproject();
        }

        try
        {
            var vehicles = await _feed.FetchVehiclesAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _vehicles = vehicles ?? Array.Empty<TimelineVehicle>();
            _vehiclesError = null;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            // web vehiclesError — folded into anyError; the fleet falls back to empty.
            _vehiclesError = ex.Message;
            _vehicles = Array.Empty<TimelineVehicle>();
        }

        // web useSelectedVehicle: keep the current pick when still present, else fall back to the first vehicle.
        if (_selectedId is null || !ContainsVehicle(_selectedId.Value))
        {
            _selectedId = _vehicles.Count > 0 ? _vehicles[0].Id : null;
        }

        if (_selectedId is { } id)
        {
            try
            {
                await LoadVehicleAsync(id, cts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
        else
        {
            _transitions = Array.Empty<TransitionRecord>();
            _summary = StateSummary.Empty;
            _timelineLoading = false;
            _summaryLoading = false;
            _timelineError = null;
            _summaryError = null;
        }

        _loadedOnce = true;
        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the current selection / window (web manual refresh + auto-refetch).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Select a vehicle from the picker (web <c>onPickVehicle</c>); reloads its timeline + summary.</summary>
    public Task SelectVehicleAsync(long vehicleId, CancellationToken cancellationToken = default)
    {
        if (vehicleId <= 0)
        {
            return Task.CompletedTask;
        }

        _selectedId = vehicleId;
        return LoadAsync(cancellationToken);
    }

    /// <summary>Set the trailing-day window (web <c>RangePicker.onChange → days</c>); reloads the current vehicle.</summary>
    public Task SetDaysAsync(int days, CancellationToken cancellationToken = default)
    {
        _days = Math.Max(1, days);
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

    private async Task LoadVehicleAsync(long id, CancellationToken token)
    {
        try
        {
            var transitions = await _feed.FetchTimelineAsync(id, _days, token).ConfigureAwait(false);
            token.ThrowIfCancellationRequested();
            _transitions = transitions ?? Array.Empty<TransitionRecord>();
            _timelineError = null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _timelineError = ex.Message;
            _transitions = Array.Empty<TransitionRecord>();
        }
        finally
        {
            _timelineLoading = false;
        }

        try
        {
            var summary = await _feed.FetchSummaryAsync(id, _days, token).ConfigureAwait(false);
            token.ThrowIfCancellationRequested();
            _summary = summary ?? StateSummary.Empty;
            _summaryError = null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _summaryError = ex.Message;
            _summary = StateSummary.Empty;
        }
        finally
        {
            _summaryLoading = false;
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

    private TimelineModel BuildModel() => new(
        Vehicles: _vehicles,
        SelectedVehicleId: _selectedId,
        Days: _days,
        Transitions: _transitions,
        Summary: _summary,
        TimelineLoading: _timelineLoading,
        SummaryLoading: _summaryLoading,
        HasError: _vehiclesError is not null || _timelineError is not null || _summaryError is not null,
        ErrorDetail: _vehiclesError ?? _timelineError ?? _summaryError);

    private void Reproject()
    {
        var display = TimelineProjection.Project(BuildModel(), _localizer, _clock());
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
