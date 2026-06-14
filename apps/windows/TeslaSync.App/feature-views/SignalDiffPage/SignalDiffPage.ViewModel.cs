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
/// UI-thread-free state holder backing the WinUI <c>SignalDiffPage</c> view — the native port of the web page's
/// composed query + URL state (web/src/features/telemetry/pages/SignalDiffPage.tsx). It reads the fleet vehicles for
/// the page-local picker (web <c>useVehicles</c>) and auto-selects the first when none is chosen, fetches the
/// available-signal catalog (web <c>useSignals</c>) and the two-snapshot diff (web <c>useSignalDiffServer</c>), reads
/// the pinned rows (web <c>usePinned</c>), owns the pin / unpin + bulk pin / unpin flow (web <c>useTogglePin</c>) and
/// the name / category filter + multi-row selection + the two compare windows, and projects the result through
/// <see cref="SignalDiffPageProjection"/> so the view is a thin renderer. Observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SignalDiffPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISignalDiffPageFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly SignalDiffPageDiagnostics _diagnostics;

    private CancellationTokenSource? _loadCts;
    private CancellationTokenSource? _diffCts;
    private bool _disposed;

    private long _vehicleId;
    private IReadOnlyList<SignalDiffVehicle> _vehicles = Array.Empty<SignalDiffVehicle>();
    private IReadOnlyList<string> _available = Array.Empty<string>();
    private IReadOnlyList<PinnedSignal> _pinned = Array.Empty<PinnedSignal>();
    private SignalsWorkspaceDataState _diffState = SignalsWorkspaceDataState.Empty;
    private IReadOnlyList<SignalDiffRow> _diffRows = Array.Empty<SignalDiffRow>();
    private string _search = string.Empty;
    private string? _category;
    private readonly List<string> _selected = new();
    private DateTimeOffset? _windowA;
    private DateTimeOffset? _windowB;

    private SignalDiffPageDisplay _display;
    private bool _isBusy;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The Signal Diff data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The initially-selected vehicle id (web URL <c>vehicle</c> param); 0 = auto-pick first.</param>
    /// <param name="clock">Injectable clock for deterministic window seeding in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SignalDiffPageViewModel(
        ISignalDiffPageFeed feed,
        ILocalizer localizer,
        long vehicleId = 0,
        Func<DateTimeOffset>? clock = null,
        SignalDiffPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _vehicleId = vehicleId;
        _diagnostics = diagnostics ?? new SignalDiffPageDiagnostics();

        // Seed the compare windows the same way the web does: Window A one hour back, Window B now.
        var now = (clock ?? (() => DateTimeOffset.Now))();
        _windowB = now;
        _windowA = now.AddHours(-1);

        _display = SignalDiffPageProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SignalDiffPageDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a vehicles / catalog / diff fetch is in flight.</summary>
    public bool IsBusy
    {
        get => _isBusy;
        private set => Set(ref _isBusy, value);
    }

    /// <summary>The localized page title (web <c>signalDiff.title</c>) — the PageContainer chrome.</summary>
    public string Title => _localizer.GetString("signalDiff.title", "Signal Diff");

    /// <summary>The localized page subtitle (web <c>signalDiff.subtitle</c>) — the PageContainer chrome.</summary>
    public string Subtitle => _display.Subtitle;

    /// <summary>The currently-selected vehicle id (web <c>vehicleId</c>).</summary>
    public long VehicleId => _vehicleId;

    /// <summary>The currently-selected signal names (web <c>selectedSignals</c>).</summary>
    public IReadOnlyList<string> SelectedSignals => _selected.AsReadOnly();

    /// <summary>The per-vehicle pin context (web <c>signal-diff:vehicle:{id}</c>).</summary>
    public string PinContext => SignalDiffPageRegistration.PinContext(_vehicleId);

    /// <summary>The Window-A instant as a <c>datetime-local</c> input value, for seeding the compare bar (web <c>atA</c>).</summary>
    public string WindowAInput => FormatWindow(_windowA);

    /// <summary>The Window-B instant as a <c>datetime-local</c> input value, for seeding the compare bar (web <c>atB</c>).</summary>
    public string WindowBInput => FormatWindow(_windowB);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the full load: vehicles → auto-pick → catalog + pins + diff.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _loadCts, cancellationToken);

        IsBusy = true;
        try
        {
            var vehicles = await _feed.FetchVehiclesAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _vehicles = vehicles ?? Array.Empty<SignalDiffVehicle>();

            // web: vehicleId = vehicleIdParam || vehicles[0].id — auto-pick the first vehicle when none is selected.
            if (_vehicleId <= 0 && _vehicles.Count > 0)
            {
                _vehicleId = _vehicles[0].Id;
            }

            Reproject();
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            _vehicles = Array.Empty<SignalDiffVehicle>();
            Reproject();
        }

        await LoadVehicleDataAsync(cts.Token).ConfigureAwait(false);
        IsBusy = false;
    }

    /// <summary>Refresh the page (web auto-refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Point the page at a different vehicle (web picker change) and reload its catalog + pins + diff.</summary>
    public Task SetVehicleAsync(long vehicleId, CancellationToken cancellationToken = default)
    {
        if (_vehicleId == vehicleId)
        {
            return Task.CompletedTask;
        }

        _vehicleId = vehicleId;
        _selected.Clear();
        return LoadVehicleDataAsync(cancellationToken);
    }

    /// <summary>Set the signal-name filter (web <c>setSignalFilter</c>); re-projects without refetching.</summary>
    public void SetSearch(string? search)
    {
        string next = search ?? string.Empty;
        if (string.Equals(_search, next, StringComparison.Ordinal))
        {
            return;
        }

        _search = next;
        Reproject();
    }

    /// <summary>Set the active category filter (web <c>setActiveCategory</c>); re-projects without refetching.</summary>
    public void SetCategory(string? category)
    {
        string? next = string.IsNullOrEmpty(category) ? null : category;
        if (string.Equals(_category, next, StringComparison.Ordinal))
        {
            return;
        }

        _category = next;
        Reproject();
    }

    /// <summary>Set the Window-A instant from a local <c>datetime-local</c> string (web <c>setAtA</c>).</summary>
    public void SetWindowA(string? localValue)
    {
        _windowA = ParseWindow(localValue);
        Reproject();
    }

    /// <summary>Set the Window-B instant from a local <c>datetime-local</c> string (web <c>setAtB</c>).</summary>
    public void SetWindowB(string? localValue)
    {
        _windowB = ParseWindow(localValue);
        Reproject();
    }

    /// <summary>Replace the selected-signal set (web <c>setSelectedSignals</c>).</summary>
    public void SetSelection(IReadOnlyList<string>? signals)
    {
        _selected.Clear();
        if (signals is not null)
        {
            foreach (var s in signals)
            {
                if (!_selected.Contains(s))
                {
                    _selected.Add(s);
                }
            }
        }

        Reproject();
    }

    /// <summary>Toggle one row's selection (web checkbox toggle → <c>onSelectionChange</c>).</summary>
    public void ToggleSelection(string signal)
    {
        ArgumentNullException.ThrowIfNull(signal);
        if (!_selected.Remove(signal))
        {
            _selected.Add(signal);
        }

        Reproject();
    }

    /// <summary>Select every currently-visible (filtered) row, or clear all (web select-all header checkbox).</summary>
    public void SetSelectAll(bool selectAll)
    {
        _selected.Clear();
        if (selectAll)
        {
            foreach (var row in _display.DiffDisplay.Rows)
            {
                _selected.Add(row.Name);
            }
        }

        Reproject();
    }

    /// <summary>Clear the selection (web bulk-bar clear).</summary>
    public void ClearSelection()
    {
        if (_selected.Count == 0)
        {
            return;
        }

        _selected.Clear();
        Reproject();
    }

    /// <summary>True when <paramref name="signal"/> is currently selected.</summary>
    public bool IsSelected(string signal) => _selected.Contains(signal);

    /// <summary>True when <paramref name="signal"/> is currently pinned.</summary>
    public bool IsPinned(string signal) =>
        _pinned.Any(p => string.Equals(p.Name, signal, StringComparison.Ordinal));

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

        string context = SignalDiffPageRegistration.PinContext(_vehicleId);

        try
        {
            if (pin)
            {
                if (IsPinned(signal))
                {
                    return;
                }

                await _feed.PinAsync(
                    SignalDiffPageRegistration.SignalItemPrefix + signal,
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

    /// <summary>
    /// Bulk pin / unpin every currently-selected signal (web bulk-action toolbar). Pin skips already-pinned signals
    /// and unpin skips signals that are not pinned, exactly as the web loop does, then the pinned list is refreshed once.
    /// </summary>
    public async Task BulkTogglePinAsync(bool pin, CancellationToken cancellationToken = default)
    {
        if (_vehicleId <= 0 || _selected.Count == 0)
        {
            return;
        }

        string context = SignalDiffPageRegistration.PinContext(_vehicleId);
        bool mutated = false;

        try
        {
            foreach (var signal in _selected.ToArray())
            {
                if (pin)
                {
                    if (IsPinned(signal))
                    {
                        continue;
                    }

                    await _feed.PinAsync(SignalDiffPageRegistration.SignalItemPrefix + signal, context, cancellationToken).ConfigureAwait(false);
                    mutated = true;
                }
                else
                {
                    var existing = _pinned.FirstOrDefault(p => string.Equals(p.Name, signal, StringComparison.Ordinal));
                    if (existing is null)
                    {
                        continue;
                    }

                    await _feed.UnpinAsync(existing.Id, cancellationToken).ConfigureAwait(false);
                    mutated = true;
                }
            }

            if (mutated)
            {
                var refreshed = await _feed.FetchPinnedAsync(_vehicleId, cancellationToken).ConfigureAwait(false);
                _pinned = refreshed ?? Array.Empty<PinnedSignal>();
                Reproject();
            }
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

    /// <summary>
    /// The currently-visible (filtered + pinned-first) diff rows the bulk CSV export targets — the page composes the
    /// CSV in the view (clipboard is a WinUI seam), so the view-model just surfaces the projected rows.
    /// </summary>
    public IReadOnlyList<SignalDiffDisplayRow> VisibleRows => _display.DiffDisplay.Rows;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _loadCts);
        Cancel(ref _diffCts);
    }

    private async Task LoadVehicleDataAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _diffCts, cancellationToken);

        if (_vehicleId <= 0)
        {
            // No vehicle: nothing is fetched; the seeded windows keep the "no changes" empty state visible (web parity).
            _available = Array.Empty<string>();
            _pinned = Array.Empty<PinnedSignal>();
            _diffRows = Array.Empty<SignalDiffRow>();
            _diffState = SignalsWorkspaceDataState.Empty;
            Reproject();
            return;
        }

        _diffState = SignalsWorkspaceDataState.Loading;
        Reproject();

        try
        {
            // web: useSignals feeds the diff's `signals` CSV param; the native diff endpoint defaults its window, so
            // the catalog is read for parity (and future param wiring) but does not alter the diff request shape.
            var available = await _feed.FetchAvailableAsync(_vehicleId, cts.Token).ConfigureAwait(false);
            var pinned = await _feed.FetchPinnedAsync(_vehicleId, cts.Token).ConfigureAwait(false);
            var rows = await _feed.FetchDiffAsync(_vehicleId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _available = available ?? Array.Empty<string>();
            _pinned = pinned ?? Array.Empty<PinnedSignal>();
            _diffRows = rows ?? Array.Empty<SignalDiffRow>();
            _diffState = SignalsWorkspaceDataState.Success;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            // web: surface the "Failed to load diff" banner; never render a silent blank panel.
            _diffRows = Array.Empty<SignalDiffRow>();
            _diffState = SignalsWorkspaceDataState.Error;
        }

        Reproject();
    }

    private SignalDiffPageModel BuildModel() => new(
        VehicleId: _vehicleId,
        Vehicles: _vehicles,
        DiffState: _diffState,
        DiffRows: _diffRows,
        Search: _search,
        Category: _category,
        PinnedSignals: _pinned.Select(p => p.Name).ToHashSet(StringComparer.Ordinal),
        SelectedSignals: _selected.AsReadOnly(),
        WindowA: _windowA,
        WindowB: _windowB);

    private void Reproject() => Display = SignalDiffPageProjection.Project(BuildModel(), _localizer);

    private static DateTimeOffset? ParseWindow(string? localValue) =>
        SignalDiff.SignalCompareControlsTime.TryParseLocalInput(localValue, out var dt)
            ? new DateTimeOffset(dt)
            : null;

    private static string FormatWindow(DateTimeOffset? value) =>
        value is { } v ? SignalDiff.SignalCompareControlsTime.ToLocalDatetimeInput(v.LocalDateTime) : string.Empty;

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
