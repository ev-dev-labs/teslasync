using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>DigitalTwinPage</c> view — the native port of the web page's data
/// flow (web/src/features/vehicles/pages/DigitalTwinPage.tsx). It owns the shared <see cref="VehicleSelectState"/>
/// (the native equivalent of the web <c>useSelectedVehicle()</c> store the header picker binds to), loads the fleet
/// through the injected <see cref="IDigitalTwinPageFeed"/> (web <c>useVehicles</c>), defaults the selection to the
/// first vehicle (web "first vehicle in the fleet" precedence), then reads the selected vehicle's state / security /
/// charging trio (web <c>useVehicleState</c> + <c>useSecurityLatest</c> + <c>useChargingTelemetryLatest</c>) and
/// re-reads on the 5 s poll (web <c>REFRESH_INTERVAL</c>) and on every selection change. Each result projects through
/// <see cref="DigitalTwinPageProjection"/> so the view is a thin renderer; observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class DigitalTwinPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDigitalTwinPageFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly DigitalTwinPageDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;
    private bool _suppressSelectionReload;

    private IReadOnlyList<DigitalTwinVehicle> _vehicles = Array.Empty<DigitalTwinVehicle>();
    private DigitalTwinReadings _readings = DigitalTwinReadings.Empty;
    private bool _loading = true;

    private DigitalTwinPageDisplay _display;

    /// <summary>Creates the holder over its data feed and localizer.</summary>
    /// <param name="feed">The digital-twin data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DigitalTwinPageViewModel(
        IDigitalTwinPageFeed feed,
        ILocalizer localizer,
        DigitalTwinPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new DigitalTwinPageDiagnostics();
        _display = DigitalTwinPageProjection.Project(BuildModel(), _localizer);

        SelectState.PropertyChanged += OnSelectStateChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The shared fleet + scope holder the header vehicle picker binds to (web <c>useSelectedVehicle()</c>).</summary>
    public VehicleSelectState SelectState { get; } = new();

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public DigitalTwinPageDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The current top-level data state (loading / empty / success).</summary>
    public DigitalTwinPageState State => _display.State;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run (or re-run) the full load: fetch the fleet, default the selection to the first vehicle when none is set
    /// (web first-vehicle precedence), then read the selected vehicle's live state.
    /// </summary>
    /// <param name="cancellationToken">Cancels the load.</param>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        if (_vehicles.Count == 0)
        {
            _loading = true;
            Reproject();
        }

        SelectState.SetLoading();

        IReadOnlyList<DigitalTwinVehicle> vehicles;
        try
        {
            vehicles = await _feed.FetchVehiclesAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            SelectState.SetError(ex.Message);
            _vehicles = Array.Empty<DigitalTwinVehicle>();
            _loading = false;
            Reproject();
            return;
        }

        _vehicles = vehicles;
        _loading = false;

        _suppressSelectionReload = true;
        SelectState.SetLoaded(vehicles.Select(v => v.ToOption()).ToList());

        // web useSelectedVehicle: default to the first vehicle the moment the fleet loads.
        if (SelectState.SelectedId is null && vehicles.Count > 0)
        {
            SelectState.SelectedId = vehicles[0].Id;
        }

        _suppressSelectionReload = false;

        await ReloadReadingsAsync(cts).ConfigureAwait(false);
    }

    /// <summary>Re-read the selected vehicle's live state (the web 5 s refetch / retry).</summary>
    /// <param name="cancellationToken">Cancels the refresh.</param>
    public Task RefreshAsync(CancellationToken cancellationToken = default) =>
        ReloadReadingsAsync(Supersede(ref _cts, cancellationToken));

    /// <summary>
    /// Change the selected vehicle (web header picker <c>onChange</c>) and re-read its live state. A no-op when the
    /// id is unchanged; the selection re-projects immediately so the twin reflects the new vehicle before the read
    /// resolves.
    /// </summary>
    /// <param name="vehicleId">The vehicle id to select, or null to clear.</param>
    /// <param name="cancellationToken">Cancels the reload.</param>
    public Task SelectVehicleAsync(long? vehicleId, CancellationToken cancellationToken = default)
    {
        if (SelectState.SelectedId == vehicleId)
        {
            return Task.CompletedTask;
        }

        _suppressSelectionReload = true;
        SelectState.SelectedId = vehicleId;
        _suppressSelectionReload = false;

        _readings = DigitalTwinReadings.Empty;
        Reproject();
        return ReloadReadingsAsync(Supersede(ref _cts, cancellationToken));
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        SelectState.PropertyChanged -= OnSelectStateChanged;
        Cancel(ref _cts);
    }

    private async Task ReloadReadingsAsync(CancellationTokenSource cts)
    {
        var vehicle = EffectiveVehicle();
        if (vehicle is null)
        {
            _readings = DigitalTwinReadings.Empty;
            Reproject();
            return;
        }

        try
        {
            var readings = await _feed.FetchReadingsAsync(vehicle.Id, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _readings = readings;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception)
        {
            // web parity: a failed refetch keeps the last-known twin rather than blanking the page.
        }

        Reproject();
    }

    private void OnSelectStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(VehicleSelectState.SelectedId))
        {
            return;
        }

        Reproject();

        if (_suppressSelectionReload || _disposed)
        {
            return;
        }

        // The shared header picker wrote a new scope id — re-read the newly selected vehicle.
        _readings = DigitalTwinReadings.Empty;
        _ = ReloadReadingsAsync(Supersede(ref _cts, CancellationToken.None));
    }

    private DigitalTwinVehicle? EffectiveVehicle() =>
        SelectState.SelectedId is { } id ? _vehicles.FirstOrDefault(v => v.Id == id) : null;

    private DigitalTwinPageModel BuildModel() => new(_vehicles, EffectiveVehicle(), _readings, _loading);

    private void Reproject() => Display = DigitalTwinPageProjection.Project(BuildModel(), _localizer);

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
        if (name == nameof(Display))
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(State)));
        }
    }
}
