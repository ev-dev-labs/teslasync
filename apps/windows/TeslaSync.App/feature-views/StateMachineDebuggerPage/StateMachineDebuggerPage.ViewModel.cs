using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>StateMachineDebuggerPage</c> view — the native port of the web
/// page's hook + local-state orchestration (<c>web/src/features/system/pages/StateMachineDebuggerPage.tsx</c>). It
/// reads the five data sources through the injected <see cref="IStateMachineDebuggerFeed"/> (vehicles, live state,
/// FSM stats, paged transitions, per-transition snapshot), owns the filter / pagination / live-freeze / selection
/// state, and projects everything through <see cref="StateMachineDebuggerProjection"/> so the view is a thin
/// renderer. Observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the
/// UI thread); it is not internally synchronised.
/// </summary>
public sealed class StateMachineDebuggerPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IStateMachineDebuggerFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly StateMachineDebuggerDiagnostics _diagnostics;

    private CancellationTokenSource? _loadCts;
    private CancellationTokenSource? _snapshotCts;
    private bool _disposed;

    private IReadOnlyList<VehicleOptionRecord> _vehicles = Array.Empty<VehicleOptionRecord>();
    private long? _selectedVehicleId;
    private string _fsmType = FsmTypeCatalog.All;
    private RangePreset _range = RangePreset.Last7d;
    private int _page = 1;
    private int _perPage = 50;

    private CurrentStateInfo? _currentState;
    private IReadOnlyList<FsmTransitionRecord> _transitions = Array.Empty<FsmTransitionRecord>();
    private int _totalRows;
    private IReadOnlyList<ActiveSubFSM> _activeSubs = Array.Empty<ActiveSubFSM>();

    private bool _isLive = true;
    private int _windowMinutes = 10;
    private long? _selectedTransitionId;
    private SignalSnapshot? _selectedSnapshot;
    private SignalSnapshot? _previousSnapshot;
    private bool _snapshotLoading;

    private bool _stateLoading;
    private bool _statsLoading;
    private bool _transitionsLoading;
    private bool _vehiclesLoaded;
    private bool _hasLoaded;

    private StateMachineDebuggerDisplay _display;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The debugger data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic relative-time / windowing in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public StateMachineDebuggerPageViewModel(
        IStateMachineDebuggerFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        StateMachineDebuggerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new StateMachineDebuggerDiagnostics();
        _display = StateMachineDebuggerProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public StateMachineDebuggerDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The currently selected vehicle id, or null when none is in scope.</summary>
    public long? SelectedVehicleId => _selectedVehicleId;

    /// <summary>The localized page title (web <c>fsm.title</c>) — the page chrome.</summary>
    public string Title => StateMachineDebuggerRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>fsm.subtitle</c>) — the page chrome.</summary>
    public string Subtitle => StateMachineDebuggerRegistration.Subtitle(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run the initial load: vehicles (once), then the selected vehicle's state / stats / transitions.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!_vehiclesLoaded)
        {
            try
            {
                _vehicles = await _feed.FetchVehiclesAsync(cancellationToken).ConfigureAwait(false);
                _vehiclesLoaded = true;
                if (_selectedVehicleId is null && _vehicles.Count > 0)
                {
                    _selectedVehicleId = _vehicles[0].Id;
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception)
            {
                _vehiclesLoaded = true;
            }
        }

        await ReloadAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Re-fetch the selected vehicle's state, stats and transition page (web auto-refresh / filter change).</summary>
    public async Task RefreshAsync(CancellationToken cancellationToken = default) => await ReloadAsync(cancellationToken).ConfigureAwait(false);

    /// <summary>Select a different vehicle (web sticky picker) — resets the page + selection and reloads.</summary>
    public async Task SelectVehicleAsync(long vehicleId, CancellationToken cancellationToken = default)
    {
        if (_selectedVehicleId == vehicleId)
        {
            return;
        }

        _selectedVehicleId = vehicleId;
        _page = 1;
        ClearSelectionState();
        await ReloadAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Change the FSM-type filter (web <c>setFsmType</c>) — resets the page and reloads.</summary>
    public async Task SetFsmTypeAsync(string fsmType, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(fsmType);
        if (string.Equals(_fsmType, fsmType, StringComparison.Ordinal))
        {
            return;
        }

        _fsmType = fsmType;
        _page = 1;
        ClearSelectionState();
        await ReloadAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Change the look-back range (web RangePicker) — resets the page and reloads.</summary>
    public async Task SetRangeAsync(RangePreset range, CancellationToken cancellationToken = default)
    {
        if (_range == range)
        {
            return;
        }

        _range = range;
        _page = 1;
        ClearSelectionState();
        await ReloadAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Change the page size (web <c>setPerPage</c>) — resets to page 1 and reloads.</summary>
    public async Task SetPerPageAsync(int perPage, CancellationToken cancellationToken = default)
    {
        if (perPage <= 0 || _perPage == perPage)
        {
            return;
        }

        _perPage = perPage;
        _page = 1;
        await ReloadAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Navigate to a transition-log page (web <c>setServerPage</c>) and reload that slice.</summary>
    public async Task SetPageAsync(int page, CancellationToken cancellationToken = default)
    {
        if (page < 1 || _page == page)
        {
            return;
        }

        _page = page;
        await ReloadAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Toggle live streaming vs. freeze (web <c>onToggleLive</c>); going live clears the selection.</summary>
    public void SetLive(bool live)
    {
        _isLive = live;
        if (live)
        {
            ClearSelectionState();
        }

        Reproject();
    }

    /// <summary>Change the timeline buffer window in minutes (web <c>onWindowChange</c> / <c>onWidenWindow</c>).</summary>
    public void SetWindowMinutes(int minutes)
    {
        if (minutes <= 0 || _windowMinutes == minutes)
        {
            return;
        }

        _windowMinutes = minutes;
        Reproject();
    }

    /// <summary>Clear the transition buffer + selection (web <c>onClearBuffer</c>).</summary>
    public void ClearBuffer()
    {
        ClearSelectionState();
        Reproject();
    }

    /// <summary>Select a transition (web detail toggle / timeline tick) — freezes and fetches its snapshots.</summary>
    public async Task SelectTransitionAsync(long? transitionId, CancellationToken cancellationToken = default)
    {
        if (transitionId is null)
        {
            ClearSelectionState();
            Reproject();
            return;
        }

        // Toggle off when re-selecting the same row (web setSelectedId(selectedId === id ? null : id)).
        if (_selectedTransitionId == transitionId)
        {
            ClearSelectionState();
            Reproject();
            return;
        }

        _isLive = false;
        _selectedTransitionId = transitionId;
        await FetchSnapshotsAsync(transitionId.Value, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Step to the previous transition in time order (web <c>handleStepPrev</c>).</summary>
    public Task StepPreviousAsync(CancellationToken cancellationToken = default) => StepAsync(-1, cancellationToken);

    /// <summary>Step to the next transition in time order (web <c>handleStepNext</c>).</summary>
    public Task StepNextAsync(CancellationToken cancellationToken = default) => StepAsync(1, cancellationToken);

    /// <summary>Jump to and select the most recent transition (web <c>handleJumpToLast</c>).</summary>
    public Task JumpToLastAsync(CancellationToken cancellationToken = default)
    {
        var last = Sorted().LastOrDefault();
        return last is null ? Task.CompletedTask : SelectTransitionAsync(last.Id, cancellationToken);
    }

    /// <summary>Re-fetch the snapshots for the current selection (web inspector Retry affordance).</summary>
    public Task RefetchSnapshotAsync(CancellationToken cancellationToken = default) =>
        _selectedTransitionId is { } id ? FetchSnapshotsAsync(id, cancellationToken) : Task.CompletedTask;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _loadCts);
        Cancel(ref _snapshotCts);
    }

    private async Task ReloadAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _loadCts, cancellationToken);
        long? vehicleId = _selectedVehicleId;

        if (vehicleId is null)
        {
            _currentState = null;
            _transitions = Array.Empty<FsmTransitionRecord>();
            _totalRows = 0;
            _activeSubs = Array.Empty<ActiveSubFSM>();
            _hasLoaded = true;
            Reproject();
            return;
        }

        _stateLoading = true;
        _statsLoading = true;
        _transitionsLoading = true;
        Reproject();

        int hours = RangePresets.Hours(_range);
        CurrentStateInfo? state;
        IReadOnlyList<ActiveSubFSM> subs;
        FsmTransitionsPage page;

        try
        {
            state = await _feed.FetchStateAsync(vehicleId.Value, cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            state = null;
        }

        try
        {
            subs = await _feed.FetchActiveSubsAsync(vehicleId.Value, cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            subs = Array.Empty<ActiveSubFSM>();
        }

        try
        {
            page = await _feed.FetchTransitionsAsync(vehicleId.Value, _fsmType, hours, _page, _perPage, cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            page = FsmTransitionsPage.Empty;
        }

        if (cts.Token.IsCancellationRequested)
        {
            return;
        }

        _currentState = state;
        _activeSubs = subs;
        _transitions = page.Rows;
        _totalRows = page.Total;

        _stateLoading = false;
        _statsLoading = false;
        _transitionsLoading = false;
        _hasLoaded = true;
        Reproject();
    }

    private async Task FetchSnapshotsAsync(long transitionId, CancellationToken cancellationToken)
    {
        var selected = _transitions.FirstOrDefault(t => t.Id == transitionId);
        if (selected?.TsRaw is not { Length: > 0 } selectedAt || _selectedVehicleId is not { } vehicleId)
        {
            _selectedSnapshot = null;
            _previousSnapshot = null;
            _snapshotLoading = false;
            Reproject();
            return;
        }

        var cts = Supersede(ref _snapshotCts, cancellationToken);
        _selectedSnapshot = null;
        _previousSnapshot = null;
        _snapshotLoading = true;
        Reproject();

        var sorted = Sorted();
        int idx = sorted.FindIndex(t => t.Id == transitionId);
        string? previousAt = idx > 0 ? sorted[idx - 1].TsRaw : null;

        try
        {
            var selectedSnap = await _feed.FetchSnapshotAsync(vehicleId, selectedAt, cts.Token).ConfigureAwait(false);
            SignalSnapshot? previousSnap = null;
            if (!string.IsNullOrEmpty(previousAt))
            {
                previousSnap = await _feed.FetchSnapshotAsync(vehicleId, previousAt!, cts.Token).ConfigureAwait(false);
            }

            if (cts.Token.IsCancellationRequested)
            {
                return;
            }

            _selectedSnapshot = selectedSnap;
            _previousSnapshot = previousSnap;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            _selectedSnapshot = null;
            _previousSnapshot = null;
        }

        _snapshotLoading = false;
        Reproject();
    }

    private async Task StepAsync(int direction, CancellationToken cancellationToken)
    {
        var sorted = Sorted();
        if (sorted.Count == 0)
        {
            return;
        }

        _isLive = false;
        int idx = _selectedTransitionId is { } id ? sorted.FindIndex(t => t.Id == id) : -1;
        int next = direction < 0
            ? (idx <= 0 ? 0 : idx - 1)
            : (idx < 0 ? sorted.Count - 1 : Math.Min(idx + 1, sorted.Count - 1));
        await SelectTransitionAsync(sorted[next].Id, cancellationToken).ConfigureAwait(false);
    }

    private List<FsmTransitionRecord> Sorted() =>
        _transitions.Where(t => t.Timestamp is not null).OrderBy(t => t.Timestamp!.Value).ToList();

    private void ClearSelectionState()
    {
        _selectedTransitionId = null;
        _selectedSnapshot = null;
        _previousSnapshot = null;
        _snapshotLoading = false;
        Cancel(ref _snapshotCts);
    }

    private StateMachineDebuggerModel BuildModel() => new(
        Vehicles: _vehicles,
        SelectedVehicleId: _selectedVehicleId,
        FsmType: _fsmType,
        Range: _range,
        Page: _page,
        PerPage: _perPage,
        CurrentState: _currentState,
        Transitions: _transitions,
        TotalRows: _totalRows,
        ActiveSubs: _activeSubs,
        IsLive: _isLive,
        WindowMinutes: _windowMinutes,
        SelectedTransitionId: _selectedTransitionId,
        SelectedSnapshot: _selectedSnapshot,
        PreviousSnapshot: _previousSnapshot,
        SnapshotLoading: _snapshotLoading,
        StateLoading: _stateLoading,
        StatsLoading: _statsLoading,
        TransitionsLoading: _transitionsLoading,
        HasLoaded: _hasLoaded,
        Now: _clock());

    private void Reproject() => Display = StateMachineDebuggerProjection.Project(BuildModel(), _localizer);

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
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
