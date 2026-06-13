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
/// UI-thread-free state holder backing the WinUI <c>SignalsWorkspacePage</c> view — the native port of the web
/// page's composed query + URL state (web/src/features/telemetry/pages/SignalsWorkspacePage.tsx). It reads the
/// available-signal catalog (web <c>useSignals</c>) and the pinned rows (web <c>usePinned</c>) through the injected
/// <see cref="ISignalsWorkspaceFeed"/>, fetches the two-snapshot diff when Compare mode is active (web
/// <c>useSignalDiffServer</c>), owns the pin / unpin flow (web <c>useTogglePin</c>) and the mutually-exclusive
/// Live / Compare mode toggles, and projects the result through <see cref="SignalsWorkspaceProjection"/> so the view
/// is a thin renderer. Observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SignalsWorkspacePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISignalsWorkspaceFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly SignalsWorkspaceDiagnostics _diagnostics;

    private CancellationTokenSource? _catalogCts;
    private CancellationTokenSource? _diffCts;
    private bool _disposed;

    private long _vehicleId;
    private SignalsWorkspaceDataState _catalogState = SignalsWorkspaceDataState.Loading;
    private IReadOnlyList<string> _available = Array.Empty<string>();
    private IReadOnlyList<string> _selected = Array.Empty<string>();
    private IReadOnlyList<PinnedSignal> _pinned = Array.Empty<PinnedSignal>();
    private SignalsWorkspaceMode _mode = SignalsWorkspaceMode.Historical;
    private bool _liveConnected;
    private int _liveRate;
    private SignalsWorkspaceDataState _diffState = SignalsWorkspaceDataState.Empty;
    private IReadOnlyList<SignalDiffRow> _diffRows = Array.Empty<SignalDiffRow>();
    private string _diffSearch = string.Empty;
    private DateTimeOffset? _windowA;
    private DateTimeOffset? _windowB;
    private bool _hasHistorical;
    private bool _isBusy;

    private SignalsWorkspaceDisplay _display;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The workspace data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The selected vehicle id (web <c>useSelectedVehicle</c>); 0 = none.</param>
    /// <param name="clock">Injectable clock for deterministic window-span formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SignalsWorkspacePageViewModel(
        ISignalsWorkspaceFeed feed,
        ILocalizer localizer,
        long vehicleId = 0,
        Func<DateTimeOffset>? clock = null,
        SignalsWorkspaceDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _vehicleId = vehicleId;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new SignalsWorkspaceDiagnostics();

        // Seed the compare windows the same way the web does: Window A one hour back, Window B now.
        _windowB = _clock();
        _windowA = _windowB.Value.AddHours(-1);

        _display = SignalsWorkspaceProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SignalsWorkspaceDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a catalog or diff fetch is in flight.</summary>
    public bool IsBusy
    {
        get => _isBusy;
        private set => Set(ref _isBusy, value);
    }

    /// <summary>The localized page title (web <c>signalsWorkspace.title</c>) — the PageContainer chrome.</summary>
    public string Title => _localizer.GetString("signalsWorkspace.title", "Signals");

    /// <summary>The localized page subtitle (web <c>signalsWorkspace.subtitle</c>) — the PageContainer chrome.</summary>
    public string Subtitle => _display.Subtitle;

    /// <summary>The currently-selected signal names (web <c>selectedSignals</c>).</summary>
    public IReadOnlyList<string> SelectedSignals => _selected;

    /// <summary>The available-signal catalog (web <c>availableSignals</c>).</summary>
    public IReadOnlyList<string> AvailableSignals => _available;

    /// <summary>The current workspace mode (web <c>isLive</c> / <c>isCompare</c>).</summary>
    public SignalsWorkspaceMode Mode => _mode;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Point the workspace at a different vehicle (web vehicle-picker change) and reload.</summary>
    public Task SetVehicleAsync(long vehicleId, CancellationToken cancellationToken = default)
    {
        if (_vehicleId == vehicleId)
        {
            return Task.CompletedTask;
        }

        _vehicleId = vehicleId;
        _selected = Array.Empty<string>();
        _hasHistorical = false;
        return LoadAsync(cancellationToken);
    }

    /// <summary>Run (or re-run) the catalog + pinned load (web <c>useSignals</c> + <c>usePinned</c>).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _catalogCts, cancellationToken);

        if (_vehicleId <= 0)
        {
            // web: no vehicle selected → the "select a vehicle" empty state; nothing is fetched.
            _catalogState = SignalsWorkspaceDataState.Empty;
            _available = Array.Empty<string>();
            _pinned = Array.Empty<PinnedSignal>();
            Reproject();
            return;
        }

        IsBusy = true;
        _catalogState = SignalsWorkspaceDataState.Loading;
        Reproject();

        try
        {
            var available = await _feed.FetchAvailableAsync(_vehicleId, cts.Token).ConfigureAwait(false);
            var pinned = await _feed.FetchPinnedAsync(_vehicleId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _available = available ?? Array.Empty<string>();
            _pinned = pinned ?? Array.Empty<PinnedSignal>();
            _catalogState = _available.Count > 0
                ? SignalsWorkspaceDataState.Success
                : SignalsWorkspaceDataState.Empty;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            // web: surface the load-failed banner; never render a blank catalog with no explanation.
            _catalogState = SignalsWorkspaceDataState.Error;
            _available = Array.Empty<string>();
            _pinned = Array.Empty<PinnedSignal>();
        }

        IsBusy = false;
        Reproject();

        if (_mode == SignalsWorkspaceMode.Compare)
        {
            await LoadDiffAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>Refresh the workspace (web auto-refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Replace the selected-signal set (web <c>setSelectedSignals</c>).</summary>
    public void SetSelectedSignals(IReadOnlyList<string>? signals)
    {
        _selected = signals ?? Array.Empty<string>();
        Reproject();
    }

    /// <summary>Set the diff name filter (web <c>setDiffSearch</c>).</summary>
    public void SetDiffSearch(string? search)
    {
        _diffSearch = search ?? string.Empty;
        Reproject();
    }

    /// <summary>Toggle Live mode (web <c>toggleLive</c>); turning it on clears Compare.</summary>
    public Task ToggleLiveAsync(CancellationToken cancellationToken = default)
    {
        _mode = _mode == SignalsWorkspaceMode.Live ? SignalsWorkspaceMode.Historical : SignalsWorkspaceMode.Live;
        _liveConnected = _mode == SignalsWorkspaceMode.Live;
        if (_mode != SignalsWorkspaceMode.Live)
        {
            _liveRate = 0;
        }

        _diffState = SignalsWorkspaceDataState.Empty;
        Reproject();
        return Task.CompletedTask;
    }

    /// <summary>
    /// Apply a live SSE update (web <c>live.connected</c> / <c>live.tailRate</c>). The live-stream wiring (P1/S4)
    /// calls this as events arrive: <paramref name="connected"/> drives the header connection badge and
    /// <paramref name="rate"/> feeds the "Live rate" stat card. Ignored unless Live mode is active.
    /// </summary>
    public void UpdateLiveState(bool connected, int rate)
    {
        if (_mode != SignalsWorkspaceMode.Live)
        {
            return;
        }

        _liveConnected = connected;
        _liveRate = rate < 0 ? 0 : rate;
        Reproject();
    }

    /// <summary>Toggle Compare mode (web <c>toggleCompare</c>); turning it on clears Live and fetches the diff.</summary>
    public async Task ToggleCompareAsync(CancellationToken cancellationToken = default)
    {
        if (_mode == SignalsWorkspaceMode.Compare)
        {
            _mode = SignalsWorkspaceMode.Historical;
            _diffState = SignalsWorkspaceDataState.Empty;
            _diffRows = Array.Empty<SignalDiffRow>();
            Reproject();
            return;
        }

        _mode = SignalsWorkspaceMode.Compare;
        _liveConnected = false;
        Reproject();
        await LoadDiffAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Mark a historical query as run (web <c>handleRun</c> sets <c>exploreKey</c>).</summary>
    public void RunHistorical()
    {
        if (_selected.Count == 0 || _vehicleId <= 0)
        {
            return;
        }

        _hasHistorical = true;
        Reproject();
    }

    /// <summary>
    /// Fetch the two-snapshot diff (web <c>useSignalDiffServer</c>). Only meaningful in Compare mode with a vehicle
    /// selected; resolves loading → success / empty / error.
    /// </summary>
    public async Task LoadDiffAsync(CancellationToken cancellationToken = default)
    {
        if (_mode != SignalsWorkspaceMode.Compare || _vehicleId <= 0)
        {
            _diffState = SignalsWorkspaceDataState.Empty;
            _diffRows = Array.Empty<SignalDiffRow>();
            Reproject();
            return;
        }

        var cts = Supersede(ref _diffCts, cancellationToken);

        IsBusy = true;
        _diffState = SignalsWorkspaceDataState.Loading;
        Reproject();

        try
        {
            var rows = await _feed.FetchDiffAsync(_vehicleId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _diffRows = rows ?? Array.Empty<SignalDiffRow>();
            _diffState = _diffRows.Count > 0
                ? SignalsWorkspaceDataState.Success
                : SignalsWorkspaceDataState.Empty;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            _diffState = SignalsWorkspaceDataState.Error;
            _diffRows = Array.Empty<SignalDiffRow>();
        }

        IsBusy = false;
        Reproject();
    }

    /// <summary>
    /// Pin or unpin a signal (web <c>useTogglePin</c>). On success the pinned list reloads so the dependent surfaces
    /// re-render in pin order; a failure leaves the list intact (web surfaces a toast).
    /// </summary>
    public async Task TogglePinAsync(string signal, bool pin, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(signal);
        if (_vehicleId <= 0)
        {
            return;
        }

        string context = SignalsWorkspaceRegistration.PinContext(_vehicleId);

        try
        {
            if (pin)
            {
                await _feed.PinAsync(
                    SignalsWorkspaceRegistration.SignalItemPrefix + signal,
                    context,
                    cancellationToken).ConfigureAwait(false);
            }
            else
            {
                var existing = _pinned.FirstOrDefault(p => string.Equals(p.Name, signal, StringComparison.Ordinal));
                if (existing is null)
                {
                    return;
                }

                await _feed.UnpinAsync(existing.Id, cancellationToken).ConfigureAwait(false);
            }

            var refreshed = await _feed.FetchPinnedAsync(_vehicleId, cancellationToken).ConfigureAwait(false);
            _pinned = refreshed ?? Array.Empty<PinnedSignal>();
            Reproject();
        }
        catch (OperationCanceledException)
        {
            // dropped silently
        }
        catch (Exception)
        {
            // web onError raises a toast and leaves the pinned set intact.
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _catalogCts);
        Cancel(ref _diffCts);
    }

    private SignalsWorkspaceModel BuildModel() => new(
        VehicleId: _vehicleId,
        CatalogState: _catalogState,
        AvailableSignals: _available,
        SelectedSignals: _selected,
        PinnedSignals: _pinned.Select(p => p.Name).ToHashSet(StringComparer.Ordinal),
        Mode: _mode,
        LiveConnected: _liveConnected,
        LiveRate: _liveRate,
        DiffState: _diffState,
        DiffRows: _diffRows,
        DiffSearch: _diffSearch,
        WindowA: _windowA,
        WindowB: _windowB,
        HasHistorical: _hasHistorical);

    private void Reproject() => Display = SignalsWorkspaceProjection.Project(BuildModel(), _localizer);

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
