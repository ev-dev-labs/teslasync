using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>LiveSignalInspectorPage</c> view — the native port of the web
/// page's data flow (web/src/features/admin/pages/LiveSignalInspectorPage.tsx). It owns the page-local selected
/// vehicle (web <c>useState&lt;number | null&gt;</c>), reads the fleet through the injected
/// <see cref="ILiveSignalInspectorFeed"/> (web <c>useVehicles</c>), and projects the result through
/// <see cref="LiveSignalInspectorProjection"/> so the view is a thin renderer. It surfaces the three web data
/// states (loading / empty / success); observable so the view re-renders on <see cref="PropertyChanged"/>. The
/// per-second live read is owned by the composed <see cref="LiveSignalsTable"/>, not this holder. Drive it from
/// one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class LiveSignalInspectorPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILiveSignalInspectorFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly LiveSignalInspectorDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;
    private bool _loadedOnce;

    private IReadOnlyList<VehicleOption> _vehicles = Array.Empty<VehicleOption>();
    private long? _selectedId;
    private bool _loading = true;

    private LiveSignalInspectorState _state = LiveSignalInspectorState.Loading;
    private LiveSignalInspectorDisplay _display;

    /// <summary>Creates the holder over its data feed, localizer and (optional) diagnostics.</summary>
    /// <param name="feed">The fleet-list data port (web <c>useVehicles</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public LiveSignalInspectorPageViewModel(
        ILiveSignalInspectorFeed feed,
        ILocalizer localizer,
        LiveSignalInspectorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new LiveSignalInspectorDiagnostics();

        _display = LiveSignalInspectorProjection.Project(BuildModel(), _localizer);
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / success).</summary>
    public LiveSignalInspectorState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public LiveSignalInspectorDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The currently selected vehicle id (web <c>vehicleId</c>), or null when none is picked.</summary>
    public long? SelectedVehicleId => _selectedId;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the fleet load (web <c>useVehicles</c>).</summary>
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
            _vehicles = vehicles ?? Array.Empty<VehicleOption>();
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            // web: a useVehicles failure leaves the fleet empty (the page stays on the no-vehicle empty state); it
            // raises no page-level error banner — the only error surface is the composed live table.
            _vehicles = Array.Empty<VehicleOption>();
        }

        // web parity: the page does NOT auto-select — vehicleId starts null and stays so until the user picks.
        // Drop a selection that is no longer present in the fleet so the picker never shows a phantom scope.
        if (_selectedId is { } id && !ContainsVehicle(id))
        {
            _selectedId = null;
        }

        _loading = false;
        _loadedOnce = true;
        Reproject();
    }

    /// <summary>Refresh the fleet (web auto-refetch / manual refresh).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Select (or clear) the page-local vehicle scope (web <c>setVehicleId(v ? Number(v) : null)</c>). A null or
    /// non-positive id clears the scope back to the no-vehicle empty state. No fetch — the live snapshot read is
    /// owned by the composed <see cref="LiveSignalsTable"/>; this only re-projects the page branch.
    /// </summary>
    public void SelectVehicle(long? vehicleId)
    {
        long? next = vehicleId is { } id && id > 0 ? id : null;
        if (_selectedId == next)
        {
            return;
        }

        _selectedId = next;
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

    private LiveSignalInspectorModel BuildModel() => new(
        Vehicles: _vehicles,
        SelectedVehicleId: _selectedId,
        Loading: _loading);

    private void Reproject()
    {
        var display = LiveSignalInspectorProjection.Project(BuildModel(), _localizer);
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
